import React, { useState, useRef, useEffect } from 'react';
import { getNarratorAuthPayload } from '@/lib/useNarratorApiKeys';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { LANGUAGES } from '@/lib/languages';
import { parseScript, rebuildScript, countCharacters, countBreaks } from '@/lib/ttsParser';
import TtsSegmentCard from './TtsSegmentCard';
import TranslationPanel from './TranslationPanel';
import AudioPlayer from '@/components/ui/AudioPlayer';
import { Loader2, Sparkles, Pause, Play, Download, Braces, FileText, Square, CheckCircle2 } from 'lucide-react';
import { downloadScriptAsDocx } from '@/lib/docxExporter';
import { useNarratorApiKeys } from '@/lib/useNarratorApiKeys';
import { getFnErrorMessage, withTimeout } from '@/lib/utils';
import { playSegmentsPrecisely, combineSegmentsToWav, blobToBase64 } from '@/lib/audioCombiner';

const VOICES = [
  { value: 'NEUTRAL', label: 'Default voice (auto)' },
  { value: 'FEMALE', label: 'Female voice' },
  { value: 'MALE', label: 'Male voice' },
];

const LANG_TO_CODE = {
  English: 'en-US', Dutch: 'nl-NL', Czech: 'cs-CZ', German: 'de-DE',
  French: 'fr-FR', Italian: 'it-IT', Arabic: 'ar-XA', Hebrew: 'he-IL',
  Polish: 'pl-PL', Spanish: 'es-ES', Portuguese: 'pt-PT', Turkish: 'tr-TR',
  Russian: 'ru-RU', Hungarian: 'hu-HU',
};

const MAX_CHARS = 5000;

// How many raw pieces (a narration line and a pause each count as ONE piece toward
// this) a single box may hold before a new one starts — a CEILING, never a target: a
// box can close earlier (see the dangling-pause defer below), it just never grows past
// this many pieces. Per Enda: for a short time this was capped at exactly ONE
// narration line per box (see CLAUDE_CHANGELOG.md follow-up 17), fixing a real bug
// where an unrelated sentence could get silently swallowed into whatever box was being
// edited — but that fix broke something more important: matching speech length against
// driving/walking speed needs a whole natural run of several consecutive narration
// lines to sit together in ONE box, so they can all be heard, judged, and adjusted as
// one connected passage — one sentence in total isolation made that impossible and
// broke the flow of the narration. Raised well past the original default of 3 so a
// real run of connected narration can sit together in one box; a document that happens
// to have several genuinely unrelated SHORT lines in a row can still end up sharing a
// box up to this ceiling — that's an accepted tradeoff for keeping longer passages
// together, not a bug — but a box can never grow BEYOND this ceiling just from
// bundling, only from the narrator's own edit to their own box's text (see
// chunkBySizes/deriveSubsections below).
const SUBSECTION_MAX_SEGMENTS = 12;

// A "subsection" (per Enda's term) is a run of segment cards ending at a Build & Play /
// Continue control, up to SUBSECTION_MAX_SEGMENTS raw pieces long (see above).
//
// Per Enda: a subsection must never end right on a pause when there's still a
// narration line after it — a pause exists to lead into whatever comes next, so
// splitting them apart (with the editable box + Continue/Build & Play controls
// wedged in between) visually breaks that pair apart. So a would-be boundary that
// lands on a pause is deferred — the pause stays grouped with the text segment that
// follows it — rather than closing the subsection right there.
function chunkIntoSubsections(segments) {
  const subsections = [];
  let current = [];
  segments.forEach((seg, idx) => {
    current.push(seg);
    const isLastOverall = idx === segments.length - 1;
    const endsOnDanglingPause = seg.type === 'pause' && !isLastOverall;
    if (!endsOnDanglingPause && (current.length >= SUBSECTION_MAX_SEGMENTS || isLastOverall)) {
      subsections.push(current);
      current = [];
    }
  });
  if (current.length > 0) subsections.push(current);
  return subsections;
}

// Slices a flat, freshly re-parsed segments array back into subsections using a given
// list of per-subsection segment counts, in order — used to PRESERVE existing
// subsection boundaries across a re-parse (see deriveSubsections below), instead of
// re-flowing the whole document into fresh groups every time. Any leftover (a
// rare mismatch, e.g. editing a box in a way that doesn't cleanly reparse to the same
// shape) is appended as one extra trailing subsection rather than silently dropped.
function chunkBySizes(segments, sizes) {
  const result = [];
  let cursor = 0;
  for (const size of sizes) {
    if (size <= 0) continue;
    result.push(segments.slice(cursor, cursor + size));
    cursor += size;
  }
  if (cursor < segments.length) result.push(segments.slice(cursor));
  return result;
}

// Per Enda: typing a new <break> tag INSIDE one subsection's own edit box must only
// ever split that ONE box's own cards apart — every OTHER subsection needs to keep
// exactly what it already had, just shifted later on the page in the same order, never
// reshuffled into the wrong box. Re-flowing the whole document into fresh groups from
// scratch on every re-parse (the original chunkIntoSubsections behaviour) doesn't do
// that — inserting segments anywhere shifts every later group's boundary too.
//
// Takes `subsectionSizes` — the FROZEN, explicitly-maintained segment count per
// subsection (see the state declaration further down) — never the live box text.
// An earlier version took `subsectionTexts` instead and re-parsed every box's own
// current text to work out its size, on the theory that a box's own text is always
// the freshest source of "how many segments should this box claim now". That's true
// for the ONE box actually being committed, but this function sizes EVERY box, and
// the other boxes' text can be a narrator's own uncommitted draft sitting there
// unsaved (see the [segments] effect below for the full "must survive an unrelated
// change" requirement that draft has to meet). Re-parsing that draft's length to
// decide a completely different subsection's boundary meant an uncommitted draft
// with a different piece count than its subsection's real segments — typed but
// Continue never clicked — could silently shift every LATER subsection's slice the
// moment ANY subsection elsewhere committed, stealing a real segment from one
// subsection into another and corrupting its display, while ALSO fooling the
// ground-truth comparison in that effect into thinking the wrong subsection had
// changed (follow-up 23 audit, third review pass). Sizing only from the frozen,
// explicitly-set `subsectionSizes` — updated precisely by commitSubsectionEdit and
// commitSegmentEdit, in the same update as segments itself, never inferred from
// text — makes chunk index i mean the same logical subsection from one run of the
// effect to the next, no matter what's mid-typing in an unrelated box. Falls back to
// the original fixed-grouping rule whenever there's no valid frozen breakdown yet —
// the very first Parse & Generate of a pass, or (defensively) if the sizes on hand
// don't actually sum to the current segment count.
function deriveSubsections(segments, subsectionSizes) {
  if (!segments) return [];
  const sizesValid = Array.isArray(subsectionSizes)
    && subsectionSizes.length > 0
    && subsectionSizes.reduce((a, b) => a + b, 0) === segments.length;
  if (sizesValid) {
    return chunkBySizes(segments, subsectionSizes);
  }
  return chunkIntoSubsections(segments);
}

export default function NarrationTtsEditor({ script, audioUrl, onScriptChange, onAudioChange, fixedLanguage }) {
  const { keys: apiKeys } = useNarratorApiKeys();
  const [selectedVoice, setSelectedVoice] = useState('NEUTRAL');
  const [selectedLanguage, setSelectedLanguage] = useState(fixedLanguage || 'English');
  const [error, setError] = useState('');
  const [segments, setSegments] = useState(null);
  const [segmentAudios, setSegmentAudios] = useState({});
  const [generatingSegmentId, setGeneratingSegmentId] = useState(null);
  const [generatingCombined, setGeneratingCombined] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState(null);
  // The debug log used to render as a box under Parse & Generate — per Enda, it served
  // no purpose for a narrator and just took up space, so it's no longer shown. Kept as
  // write-only internal bookkeeping (addLog below) rather than ripped out everywhere it
  // was called, in case it's ever useful again behind a future admin/debug view.
  const [, setDebugLog] = useState([]);
  // Which subsection the narrator has reached so far (0-based). Subsections before this
  // one are "done" (with a Replay option); this one is the active Build & Play /
  // Continue; anything after is locked until the narrator works through to it.
  const [subsectionCursor, setSubsectionCursor] = useState(0);
  // Which subsection is actively mid-playback right now, if any — used to show Stop in
  // the right spot instead of a single global control.
  const [activeSubsectionIndex, setActiveSubsectionIndex] = useState(null);
  // Per Enda: past 12-13 subsections it became hard to find the right passage to edit,
  // because every duplicate "Edit script" box further down showed and edited the WHOLE
  // document — so each one is now scoped to just its OWN subsection's own text instead.
  // This holds that per-subsection breakdown as an editable array (one string per
  // subsection, same order), reseeded fresh from `segments` any time a new Parse &
  // Generate pass starts (see the effect below) — matching exactly how the document is
  // currently broken into parts. Editing one subsection's box only ever changes its own
  // slot in this array; the full script sent up via onScriptChange is always every
  // slot rejoined in order with the same "\n\n" separator rebuildScript uses
  // everywhere else, so it reconstructs identically to editing the full script by
  // hand — just without having to scroll through it to find the right part.
  const [subsectionTexts, setSubsectionTexts] = useState(null);
  // How many segments each subsection currently CLAIMS, for grouping the actual
  // TtsSegmentCard list/controls further down — deliberately a SEPARATE piece of state
  // from subsectionTexts above, updated ONLY by the effect below (i.e. only on an
  // actual Parse & Generate), never while a box is merely being typed into. Segment
  // cards must stay exactly where they are — "takes effect on the next Parse &
  // Generate" — while the box itself updates live on every keystroke; using the live
  // subsectionTexts to size the card groups too would reshuffle cards mid-typing,
  // before a re-parse has actually happened, which is the bug this fixes.
  const [subsectionSizes, setSubsectionSizes] = useState(null);
  // Per Enda: "Continue" (and "Save & Finish") must SAVE whatever's currently sitting in
  // that subsection's own edit box — including a brand-new <break> tag just typed in —
  // before moving on, not silently defer it until a full Parse & Generate is clicked
  // again. This tracks which subsection index is mid-save right now (regenerating its
  // audio and re-splitting its cards if the text actually changed), so that block's
  // control can show "Saving…" and every other control on the panel can be disabled
  // while it's in flight, rather than allowing a second click to race it.
  const [committingIndex, setCommittingIndex] = useState(null);
  // Per Anoushka (a narrator — see CLAUDE_CHANGELOG.md for her full request, relayed by
  // Enda): fixing ONE line's wording right after Parse & Generate shouldn't require
  // sitting through the full sequential Build & Play first, and shouldn't go anywhere
  // near the big per-subsection edit box further down (editing THAT box before ever
  // pressing Continue once was a real bug — see the "two audios playing at once" fix in
  // playSegment/handlePlayTarget below). editingSegmentId/segmentEditText track which
  // ONE text segment's own quick editor (on its TtsSegmentCard, see that file) is open
  // right now and what's currently typed into it — only one line open at a time, closing
  // whichever was open before opening a different one, matching how a narrator actually
  // works down the list. savingSegmentId tracks which line is mid-save (regenerating its
  // own audio) so its own card can show "Saving…" and every other control on the panel
  // can be disabled while it's in flight, exactly like committingIndex does for a whole
  // subsection's Continue/Save & Finish.
  const [editingSegmentId, setEditingSegmentId] = useState(null);
  const [segmentEditText, setSegmentEditText] = useState('');
  const [savingSegmentId, setSavingSegmentId] = useState(null);
  const textareaRef = useRef(null);
  const currentAudioRef = useRef(null);
  const stopRef = useRef(false);
  const currentPlaybackRef = useRef(null);

  const charCount = (script || '').length;
  const overLimit = charCount > MAX_CHARS;

  // Per Enda: the language for a translation clone is locked in the moment it's cloned
  // (target_language on the walk) — a narrator must never be able to pick a different
  // one here, or the script/TTS language could drift from what the clone actually is
  // (e.g. translating into German while generating Arabic audio, on a Spanish clone).
  // Keeps this in sync if fixedLanguage arrives after the initial render (e.g. the walk
  // is still loading when this component first mounts).
  useEffect(() => {
    if (fixedLanguage) setSelectedLanguage(fixedLanguage);
  }, [fixedLanguage]);

  // Ground truth for each subsection's box text AS OF the last time this effect ran —
  // i.e. what rebuildScript(that subsection's real segments) actually was, regardless
  // of whatever a narrator might have typed (but not yet committed) into the box on
  // top of it. Used only to detect whether a subsection's OWN underlying data actually
  // changed between one run of this effect and the next (see below) — never read or
  // written anywhere else.
  const subsectionTruthRef = useRef(null);

  // Keeps the per-subsection edit boxes AND the frozen card-grouping sizes in sync any
  // time `segments` actually changes — a fresh Parse & Generate, a pause-duration tweak
  // via a slider, a whole-subsection Continue/Save & Finish commit, or a per-line quick
  // edit — using deriveSubsections (see above) so each box's boundary is PRESERVED
  // wherever possible instead of the whole document being re-flowed into fresh groups
  // from scratch every time. Reads `subsectionSizes` as it stands at the moment this
  // effect runs (deliberately left out of the dependency array — this must only re-run
  // when `segments` itself changes, not merely because subsectionSizes was updated in
  // the very same batch by whichever handler changed segments; see deriveSubsections
  // above for why sizing must come from here, never from subsectionTexts).
  //
  // Per the follow-up 23 audit: this used to unconditionally overwrite EVERY
  // subsection's box text with a fresh rebuild on ANY segments change, even for a
  // subsection whose own data didn't change at all — so an uncommitted draft sitting in
  // subsection A's box (typed but Continue never clicked) would be silently wiped out
  // the moment ANYTHING else changed `segments` elsewhere: a duration slider dragged in
  // a completely different subsection, or a whole-subsection/per-line commit anywhere
  // else in the document.
  //
  // Per the follow-up 23 audit's THIRD review pass: an initial fix comparing each
  // subsection's fresh rebuilt "truth" against its OWN truth last time (only refresh if
  // it changed) wasn't enough on its own, because the chunk boundaries it was comparing
  // were themselves still being sized from live subsectionTexts (via the old
  // deriveSubsections) — see the long comment above deriveSubsections/chunkBySizes for
  // the full concrete failure this caused. Sizing now comes only from the frozen
  // `subsectionSizes` (set precisely by commitSubsectionEdit/commitSegmentEdit alongside
  // segments itself, and otherwise left untouched by anything that doesn't change a
  // subsection's segment COUNT, like a duration slider), so chunk index i is guaranteed
  // to mean the same logical subsection on this run as it did last run.
  //
  // Per the follow-up 23 audit's FIFTH review pass: even with correct sizing, comparing
  // "did this subsection's truth change" was still the wrong question — a pause-duration
  // slider dragged on a segment WITHIN a subsection that ALSO has its own uncommitted
  // text draft sitting in its box counts as that subsection's truth changing (the
  // duration really did change), so the old rule refreshed the box and silently
  // discarded the narrator's in-progress wording edit, keeping only the new duration.
  // The right question isn't "did truth change" but "does the box currently hold
  // anything other than what we last knew to be true" — i.e. is there something here
  // (a draft, or a value a commit handler already applied directly) that this effect
  // must not clobber. `commitSubsectionEdit` now explicitly writes the committed
  // subsection's own box to its canonical rebuilt text itself (matching what
  // `commitSegmentEdit` already did), so by the time this effect runs after ANY real
  // commit, that subsection's box already holds exactly the right value — meaning it's
  // always safe to leave a subsection's box alone whenever it doesn't match last known
  // truth, and only pull in the fresh rebuild when a box exactly matches last known
  // truth (nothing pending, nothing already applied) and something changed it — which
  // can now only be a duration tweak on a segment inside it. A subsection whose box
  // holds a genuine narrator draft keeps that draft, no matter what changed elsewhere,
  // including its own pause durations — the trade-off being that if the narrator later
  // commits that draft, it re-parses their own typed text as-is, so a duration nudged in
  // the meantime would need to be redone after commit; losing a cheap-to-redo duration
  // tweak is preferable to silently losing typed narration wording.
  useEffect(() => {
    if (!segments) {
      setSubsectionTexts(null);
      setSubsectionSizes(null);
      subsectionTruthRef.current = null;
      return;
    }
    const chunks = deriveSubsections(segments, subsectionSizes);
    const freshTruth = chunks.map(rebuildScript);
    const priorTruth = subsectionTruthRef.current;

    setSubsectionTexts((prevTexts) => {
      if (!prevTexts || prevTexts.length !== freshTruth.length || !priorTruth || priorTruth.length !== freshTruth.length) {
        // No matching prior baseline to compare against (the very first Parse &
        // Generate of a pass, or the subsection COUNT itself changed) — nothing
        // meaningful to preserve; take the fresh derivation for every box.
        return freshTruth;
      }
      return freshTruth.map((truth, i) => (prevTexts[i] === priorTruth[i] ? truth : prevTexts[i]));
    });
    setSubsectionSizes(chunks.map((c) => c.length));
    subsectionTruthRef.current = freshTruth;
  }, [segments]);

  const addLog = (msg) => setDebugLog((prev) => [...prev, msg]);

  const insertBreakTag = (tag) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onScriptChange((script || '') + tag);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newScript = (script || '').slice(0, start) + tag + (script || '').slice(end);
    onScriptChange(newScript);
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + tag.length;
    }, 0);
  };

  // Shared by the top script box AND every duplicate copy of it shown further down
  // (one per subsection — see the segments list below). Per Enda: editing the script
  // anywhere, mid-pass, must NOT wipe out the segments/audio already generated — a
  // narrator working through a long waypoint needs to keep listening/continuing through
  // what's already built, fixing text as they go, without losing their place. The edit
  // only actually changes anything the next time "Parse & Generate" is clicked.
  const handleScriptEdit = (e) => {
    onScriptChange(e.target.value);
  };

  // Edits ONE subsection's own box (further down the list) without touching any other
  // part's text. Updates just that one slot in subsectionTexts, then sends the FULL
  // script back up as every slot rejoined in order — so the parent's saved script is
  // always the real, complete document, exactly as if the whole thing had been edited
  // by hand, just found and changed without scrolling through everything else.
  const handleSubsectionScriptEdit = (si, value) => {
    setSubsectionTexts((prev) => {
      const base = prev && prev.length === subsections.length ? prev : subsections.map(rebuildScript);
      const updated = base.map((t, i) => (i === si ? value : t));
      onScriptChange(updated.join('\n\n'));
      return updated;
    });
  };

  // Commits ONE subsection's own edit box — regenerating audio for just that piece and
  // re-splitting its cards if the text actually changed — WITHOUT touching any other
  // subsection or requiring the global "Parse & Generate" button to be clicked again.
  // Per Enda: "Continue" (and "Save & Finish") must save what was just typed before
  // moving on, not silently ignore it until the next full re-parse.
  //
  // If the box's text is exactly what it already was (rebuildScript of its current
  // cards), there's nothing to commit — skipped entirely so simply listening through
  // without editing never costs an extra TTS API call. Otherwise: re-parses just this
  // box's own text, generates fresh audio for every text piece in it (fresh ids so they
  // never collide with anything elsewhere in the document), and splices the result into
  // the full flat segments/segmentAudios in this subsection's exact position — leaving
  // every other subsection's own cards/ids completely untouched, just shifted later in
  // the array if this box grew or shrank.
  //
  // Returns the FRESH segments/segmentAudios directly (not relying on React state
  // having flushed by the time the caller needs them) so callers — handleContinueClick,
  // handleFinalizeClick — can use the up-to-date data immediately.
  const commitSubsectionEdit = async (si) => {
    const currentText = subsectionTexts?.[si];
    const currentSegs = subsections[si];
    if (currentText === undefined || !currentSegs) {
      return { segments, segmentAudios };
    }
    if (rebuildScript(currentSegs) === currentText) {
      return { segments, segmentAudios };
    }
    if (!apiKeys.google_tts_api_key) {
      throw new Error('No Google TTS API key found for your account yet. Add your own key via "API Keys" in the header.');
    }

    const maxId = segments.reduce((m, s) => Math.max(m, s.id), -1);
    const freshSegs = parseScript(currentText).map((seg, i) => ({ ...seg, id: maxId + 1 + i }));

    const before = subsections.slice(0, si).flat();
    const after = subsections.slice(si + 1).flat();

    // Per the follow-up 23 audit's fifth review pass: the MAX_CHARS limit was only ever
    // checked on a fresh Parse & Generate — an edit made through THIS box (or the
    // per-line quick editor below) could grow the document past the limit via ordinary
    // Continue/Save-this-line clicks, with the narrator only finding out on the NEXT
    // full re-parse, by which point a Save & Finish may already have gone through over
    // the intended cap. Checked here too, before spending any TTS API calls on an edit
    // that wouldn't be allowed anyway.
    const prospectiveTotal = rebuildScript([...before, ...freshSegs, ...after]).length;
    if (prospectiveTotal > MAX_CHARS) {
      throw new Error(`This edit would bring the whole document to ${prospectiveTotal} characters, over the ${MAX_CHARS} limit. Shorten it, or trim elsewhere first.`);
    }

    const languageCode = LANG_TO_CODE[selectedLanguage] || 'en-US';
    const newAudios = {};
    for (const seg of freshSegs) {
      if (seg.type !== 'text') continue;
      const response = await base44.functions.invoke('generateTts', {
        text: seg.content,
        gender: selectedVoice,
        language_code: languageCode,
        apiKey: apiKeys.google_tts_api_key,
        ...getNarratorAuthPayload(),
      });
      if (!response.data?.url) throw new Error('No audio URL returned for the edited text.');
      newAudios[seg.id] = response.data.url;
    }

    const newSegments = [...before, ...freshSegs, ...after];
    const newSegmentAudios = { ...segmentAudios, ...newAudios };

    // Per the follow-up 23 audit's third review pass: tell the [segments] effect
    // EXACTLY how many segments this subsection now has, in the same update as
    // setSegments, rather than letting that effect infer it from live box text
    // elsewhere — see the comment above deriveSubsections/chunkBySizes for why that
    // used to be able to silently misalign a completely different subsection.
    const baseSizes = subsectionSizes && subsectionSizes.length === subsections.length
      ? subsectionSizes
      : subsections.map((s) => s.length);
    setSubsectionSizes(baseSizes.map((sz, i) => (i === si ? freshSegs.length : sz)));
    // Per the follow-up 23 audit's fifth review pass: write this subsection's own box
    // to its canonical rebuilt text directly, in the same update as setSegments —
    // exactly like commitSegmentEdit already does for the segment it edits. Without
    // this, the [segments] effect's own draft-preserving logic (see the long comment
    // above it) would have nothing telling it this box's new content is already
    // correct and settled, not a still-pending draft, immediately after the very
    // commit that just saved it.
    setSubsectionTexts((prev) => {
      const base = prev && prev.length === subsections.length ? prev : subsections.map(rebuildScript);
      return base.map((t, i) => (i === si ? rebuildScript(freshSegs) : t));
    });

    setSegments(newSegments);
    setSegmentAudios(newSegmentAudios);

    return { segments: newSegments, segmentAudios: newSegmentAudios };
  };

  // Opens (or, clicked again, closes) the compact quick-edit box on ONE text segment's
  // own card — see the comment on editingSegmentId above and TtsSegmentCard.jsx for the
  // UI itself. Seeds the editor with that segment's OWN current text, not the whole
  // subsection's.
  const handleToggleSegmentEdit = (segment) => {
    if (editingSegmentId === segment.id) {
      setEditingSegmentId(null);
      return;
    }
    setEditingSegmentId(segment.id);
    setSegmentEditText(segment.content);
    setError('');
  };

  const handleCancelSegmentEdit = () => {
    setEditingSegmentId(null);
  };

  // Commits ONE line's own quick edit — regenerating audio for whatever the edited
  // text now parses into (almost always still just one text piece, but a narrator
  // typing a NEW <break> tag in here is now fully supported too — see below) and
  // splicing the fresh piece(s) back into that exact position in the flat
  // segments/segmentAudios — entirely independently of Continue/Save & Finish and
  // without requiring the narrator to have played (or even reached) that part yet.
  //
  // An earlier version of this rejected any edit that split into more than one piece
  // (i.e. adding a pause), because the per-subsection card grouping further down
  // (subsectionSizes) is frozen until the next Parse & Generate, and only stays
  // accurate automatically (via the [segments] effect above) by re-deriving from
  // subsectionTexts — which this function didn't used to touch, so a piece-count
  // change here would have gone unseen by that effect and left the grouping stale.
  // Fixed properly instead of just documented as a limit: this now ALSO finds which
  // subsection owns the edited segment and updates THAT subsection's own entry in
  // subsectionTexts (and sends the full script back up via onScriptChange, exactly
  // like handleSubsectionScriptEdit does) in the same update as the segments change —
  // so by the time the [segments] effect runs, subsectionTexts already reflects the
  // new piece count and the grouping re-derives correctly no matter how many pieces
  // this one line turned into. This also fixes a real (if narrower) bug the earlier
  // version had even for a plain wording-only edit: it changed `segments` directly
  // but never told the parent via onScriptChange, so the top-level script text (and
  // a subsequent full Parse & Generate) could silently revert a quick edit that
  // hadn't gone through a whole-subsection Continue yet.
  const commitSegmentEdit = async (segmentId) => {
    // Defense in depth: the "Save this line" button that calls this should already be
    // impossible to click while a whole-subsection commit or playback is in flight (see
    // passLocked/editToggleDisabled below, which stop an editor from even OPENING during
    // one) — but that's a UI-level guard, and this is the one place where a whole
    // subsection's segments get reassigned fresh ids/audio, so a defensive check here too
    // costs nothing and guarantees this can never race commitSubsectionEdit even if some
    // future code path calls it directly.
    if (committingIndex !== null || playing || generatingCombined) return;
    const segIndex = segments.findIndex((s) => s.id === segmentId);
    const oldSeg = segIndex >= 0 ? segments[segIndex] : null;
    if (!oldSeg || oldSeg.type !== 'text') {
      setEditingSegmentId(null);
      return;
    }
    const newText = segmentEditText;
    if (newText === oldSeg.content) {
      // Nothing actually changed — close the editor without spending an API call.
      setEditingSegmentId(null);
      return;
    }
    if (!apiKeys.google_tts_api_key) {
      setError('No Google TTS API key found for your account yet. Add your own key via "API Keys" in the header.');
      return;
    }

    const freshPieces = parseScript(newText);
    if (freshPieces.length === 0) {
      setError("A line can't be saved empty. Delete it entirely via the larger script box further down instead, if that's what you meant.");
      return;
    }

    // Per the follow-up 23 audit's fifth review pass: see the matching comment in
    // commitSubsectionEdit — the document-wide character limit used to only ever be
    // checked on a fresh Parse & Generate, not on an incremental per-line save like
    // this one, which could quietly grow the document past MAX_CHARS with no warning
    // until the next full re-parse.
    const prospectiveTotal = rebuildScript([...segments.slice(0, segIndex), ...freshPieces, ...segments.slice(segIndex + 1)]).length;
    if (prospectiveTotal > MAX_CHARS) {
      setError(`This edit would bring the whole document to ${prospectiveTotal} characters, over the ${MAX_CHARS} limit. Shorten it, or trim elsewhere first.`);
      return;
    }

    setSavingSegmentId(segmentId);
    setError('');
    try {
      const maxId = segments.reduce((m, s) => Math.max(m, s.id), -1);
      const freshSegs = freshPieces.map((seg, i) => ({ ...seg, id: maxId + 1 + i }));

      const languageCode = LANG_TO_CODE[selectedLanguage] || 'en-US';
      const newAudios = {};
      for (const seg of freshSegs) {
        if (seg.type !== 'text') continue;
        const response = await base44.functions.invoke('generateTts', {
          text: seg.content,
          gender: selectedVoice,
          language_code: languageCode,
          apiKey: apiKeys.google_tts_api_key,
          ...getNarratorAuthPayload(),
        });
        if (!response.data?.url) throw new Error('No audio URL returned for the edited text.');
        newAudios[seg.id] = response.data.url;
      }

      const newSegments = [...segments.slice(0, segIndex), ...freshSegs, ...segments.slice(segIndex + 1)];
      const newSegmentAudios = { ...segmentAudios, ...newAudios };

      // Keep the owning subsection's own box (and the parent's full script) in sync —
      // see the comment above for why this matters even when freshSegs.length === 1.
      const ownerIndex = subsections.findIndex((sub) => sub.some((s) => s.id === segmentId));
      if (ownerIndex !== -1) {
        const updatedOwnerSegs = subsections[ownerIndex].flatMap((s) => (s.id === segmentId ? freshSegs : [s]));
        const updatedOwnerText = rebuildScript(updatedOwnerSegs);
        setSubsectionTexts((prev) => {
          const base = prev && prev.length === subsections.length ? prev : subsections.map(rebuildScript);
          const updated = base.map((t, i) => (i === ownerIndex ? updatedOwnerText : t));
          onScriptChange(updated.join('\n\n'));
          return updated;
        });
        // Same reasoning as commitSubsectionEdit: tell the effect this subsection's
        // new true segment count directly, instead of leaving it to infer sizing
        // from box text elsewhere (see deriveSubsections' comment for why that was
        // the real bug the follow-up 23 audit's third review pass found).
        const baseSizes = subsectionSizes && subsectionSizes.length === subsections.length
          ? subsectionSizes
          : subsections.map((s) => s.length);
        setSubsectionSizes(baseSizes.map((sz, i) => (i === ownerIndex ? updatedOwnerSegs.length : sz)));
      }

      setSegments(newSegments);
      setSegmentAudios(newSegmentAudios);
      setEditingSegmentId(null);
    } catch (err) {
      setError(`Could not save this line: ${getFnErrorMessage(err)}`);
    }
    setSavingSegmentId(null);
  };

  const handleParseAndGenerate = async () => {
    // Per the follow-up 23 audit: this used to be the one control on the whole panel
    // that ignored `busy`/an open per-line editor entirely — clickable mid-playback,
    // mid-commit, or with an unsaved per-line edit still open, silently pulling the rug
    // out from under whichever of those was in flight (its own fresh re-parse races
    // that other one's eventual setSegments call). Guarded the same way every other
    // control on this panel already is.
    if (passLocked) return;
    if (!script || !script.trim()) {
      setError('Please import or write a script first.');
      return;
    }
    if (overLimit) {
      setError(`Script exceeds the ${MAX_CHARS} character limit.`);
      return;
    }
    if (!apiKeys.google_tts_api_key) {
      setError('No Google TTS API key found for your account yet. Add your own key via "API Keys" in the header.');
      return;
    }

    setError('');
    setDebugLog([]);
    const parsed = parseScript(script);
    setSegments(parsed);
    setSegmentAudios({});
    setSubsectionCursor(0);
    setActiveSubsectionIndex(null);
    // A fresh pass starts with a clean slate — any line's quick-edit box left open from
    // the previous pass would now be pointing at a segment id that no longer exists.
    setEditingSegmentId(null);
    // Per the follow-up 23 audit: without this, a SECOND Parse & Generate in the same
    // pass (e.g. editing the top script box directly and re-parsing, without ever
    // finishing/resetting via Save & Finish first) reused the PREVIOUS pass's
    // subsectionTexts to size the brand-new segments array — chunkBySizes would then
    // slice using sizes that no longer summed to the new segment count, producing a
    // phantom empty subsection (script got shorter) or one subsection silently growing
    // past SUBSECTION_MAX_SEGMENTS (script got longer/reshaped). Nulling both here
    // forces the [segments] effect below to fall back to a fresh, correct
    // chunkIntoSubsections — exactly what already happens automatically whenever
    // `segments` itself is set to null first (see finalizeAndSave's success path and
    // TranslationPanel's onTranslated above) — this just makes it explicit here too,
    // since this path sets `segments` straight to the new parsed array instead.
    setSubsectionTexts(null);
    setSubsectionSizes(null);

    const languageCode = LANG_TO_CODE[selectedLanguage] || 'en-US';
    const audios = {};

    for (const seg of parsed) {
      if (seg.type !== 'text') continue;
      setGeneratingSegmentId(seg.id);
      addLog(`Generating segment ${seg.id}…`);
      addLog(`Language: ${languageCode}`);
      addLog(`Text length: ${seg.content.length}`);
      try {
        const response = await base44.functions.invoke('generateTts', {
          text: seg.content,
          gender: selectedVoice,
          language_code: languageCode,
          apiKey: apiKeys.google_tts_api_key,
          ...getNarratorAuthPayload(),
        });
        if (response.data?.url) {
          audios[seg.id] = response.data.url;
          addLog(`Segment ${seg.id}: OK`);
        } else {
          addLog(`Segment ${seg.id}: no URL returned`);
        }
      } catch (err) {
        const msg = getFnErrorMessage(err);
        addLog(`Segment ${seg.id}: ERROR — ${msg}`);
        setError(`Segment ${seg.id} failed: ${msg}`);
      }
    }

    setSegmentAudios(audios);
    setGeneratingSegmentId(null);
    addLog(`Done. ${Object.keys(audios).length} segment(s) generated.`);
  };

  const handleDurationChange = (segmentId, newDuration) => {
    setSegments((prev) => {
      if (!prev) return prev;
      const updated = prev.map((seg) =>
        seg.id === segmentId ? { ...seg, duration: newDuration } : seg
      );
      onScriptChange(rebuildScript(updated));
      return updated;
    });
  };

  // Per Anoushka/Enda: playing one line's own clip (this) and the combined Build &
  // Play/Continue engine (handlePlayTarget, below) used to be two completely separate
  // audio pathways that never checked each other — clicking one while the other was
  // already going started a SECOND sound on top of the first, with no way to stop just
  // the one already playing. That's the "two audio's playing at the same time" bug
  // Anoushka described. Fixed the same way every other control on this panel already
  // treats `playing`/`generatingCombined`: as "something else has the floor right now",
  // so this simply won't start while either is true, and (below) starting the combined
  // engine always stops a lingering single-line clip first. That leaves exactly one
  // sound audible at any moment, in either direction.
  const playSegment = (segmentId) => {
    if (playing || generatingCombined) return;
    const url = segmentAudios[segmentId];
    if (!url) return;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
    }
    const segIndex = segments?.findIndex((s) => s.id === segmentId);
    setCurrentPlayingIndex(segIndex);
    const audio = new Audio(url);
    currentAudioRef.current = audio;
    audio.onended = () => setCurrentPlayingIndex(null);
    audio.onerror = () => setCurrentPlayingIndex(null);
    audio.play().catch(() => setCurrentPlayingIndex(null));
  };

  // Builds the final combined file and saves it — exactly what the single "Build &
  // Play" button used to do at the very end. Only ever called once, when the LAST
  // subsection finishes playing. Decodes fresh here (rather than reusing an earlier
  // subsection's precomputed clips) since each subsection now plays with its own,
  // separate playSegmentsPrecisely call — there's no single "precomputed" covering the
  // whole script to reuse, and combineSegmentsToWav already supports decoding on its
  // own perfectly well when nothing is passed.
  // Accepts optional fresh segments/segmentAudios (from a commitSubsectionEdit call
  // that just ran moments before, in handleFinalizeClick) rather than always reading
  // component state directly — state set via setSegments/setSegmentAudios hasn't
  // necessarily flushed and re-rendered yet by the time this runs, so passing the
  // freshly-committed values explicitly avoids finalizing against stale, pre-edit data.
  const finalizeAndSave = async (segmentsOverride, segmentAudiosOverride) => {
    const segsToUse = segmentsOverride || segments;
    const audiosToUse = segmentAudiosOverride || segmentAudios;
    setGeneratingCombined(true);
    addLog('Rendering combined audio file…');
    try {
      const wavBlob = await combineSegmentsToWav(segsToUse, audiosToUse);
      addLog(`Combined audio rendered (${(wavBlob.size / 1024 / 1024).toFixed(2)} MB). Uploading…`);
      const audioBase64 = await blobToBase64(wavBlob);
      const response = await base44.functions.invoke('uploadNarrationAudio', {
        audioBase64,
        mimeType: 'audio/wav',
        filename: `narration_${Date.now()}.wav`,
        ...getNarratorAuthPayload(),
      });
      if (response.data?.url) {
        onAudioChange(response.data.url);
        addLog('Combined audio saved.');
        // Per Enda: once the final Build & Play has saved this pass, the editor goes
        // back to the beginning — segments/audio cleared so "Parse & Generate" has to
        // be clicked again to start a fresh pass over the (possibly just-edited)
        // script. Only done on a successful save, so a failed upload doesn't lose the
        // segments/audio the narrator would otherwise have to regenerate from scratch.
        setSegments(null);
        setSegmentAudios({});
        setSubsectionCursor(0);
        setEditingSegmentId(null);
      } else {
        addLog('Combined audio: no URL returned from upload.');
        setError('Combined audio failed: upload did not return a file URL.');
      }
    } catch (err) {
      const msg = getFnErrorMessage(err);
      addLog(`Combined audio ERROR: ${msg}`);
      setError(`Combined audio failed: ${msg}`);
    }
    setGeneratingCombined(false);
  };

  // Plays ONE subsection's audio on demand — used both by the standalone "Build & Play"
  // button under Parse & Generate (which always plays the very first subsection) and by
  // every "Continue" button further down the list. Per Enda: pressing a control must
  // play the audio that comes AFTER it, never the text already shown above it — so the
  // narrator hears each part fresh, edits the text box that belongs to that part to
  // reflect what needs to change, then presses Continue to move on. Also doubles as
  // "Replay" for a part that's already been heard (targetIndex !== subsectionCursor),
  // which just plays it again without moving the narrator's place forward.
  const handlePlayTarget = async (subsections, targetIndex) => {
    const targetSegments = subsections[targetIndex];
    // Deliberately checks `playing`/`generatingCombined`/`editingSegmentId` individually
    // here rather than the `busy`/`passLocked` aggregates: this function is also called
    // synchronously from handleContinueClick right after `setCommittingIndex(null)` —
    // React hasn't re-rendered yet at that point, so `committingIndex` (and anything
    // computed from it, like `busy`/`passLocked`) would still read this render's OLD,
    // pre-reset value here and wrongly bail out, breaking Continue every time. Adding
    // `editingSegmentId` alone is safe — handleContinueClick never touches it, so it's
    // never stale in that same-tick way — and it closes off the direct-click paths (the
    // standalone Build & Play / Replay buttons) from starting while a per-line editor is
    // still open and unsaved.
    if (!targetSegments || playing || generatingCombined || editingSegmentId !== null) return;
    const isReplay = targetIndex !== subsectionCursor;

    // See the comment on playSegment above — the other half of the same fix. A
    // single-line clip started via a card's own Play button doesn't touch `playing`
    // (it's a much simpler, separate audio pathway), so it wouldn't otherwise be
    // stopped just because this combined playback is about to start. Cut it off first
    // so starting this never leaves that one still audible underneath it.
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
      setCurrentPlayingIndex(null);
    }

    stopRef.current = false;
    setPlaying(true);
    setActiveSubsectionIndex(targetIndex);
    setError('');

    let playback = null;
    try {
      // Per Enda: this used to be able to hang completely (a stalled fetch inside
      // playSegmentsPrecisely, fixed at the source in audioCombiner.js) — every
      // control on this panel gates on `playing`, which stayed stuck true forever
      // with nothing to click and no error, so the panel looked frozen and the only
      // way out was a hard refresh that lost every unsaved edit on the whole tour.
      // withTimeout() is a second, general-purpose safety net here (on top of that
      // source fix) so ANY unexpected hang in this step still surfaces a clear,
      // recoverable error instead of freezing the panel again.
      playback = await withTimeout(
        playSegmentsPrecisely(targetSegments, segmentAudios, {
          // playSegmentsPrecisely reports an index into the slice we gave it, not the
          // full segments list — map it back to the card that's actually showing that
          // segment so highlighting lands on the right one.
          onSegmentChange: (localIdx) => {
            const seg = targetSegments[localIdx];
            const globalIdx = seg ? segments.findIndex((s) => s.id === seg.id) : -1;
            if (globalIdx >= 0) setCurrentPlayingIndex(globalIdx);
          },
        }),
        20000,
        "Loading this part's audio took too long (check your connection) — nothing has been lost, just try again."
      );
      currentPlaybackRef.current = playback;
      if (stopRef.current) {
        playback.stop();
      } else {
        await withTimeout(
          playback.done,
          Math.ceil((playback.totalSeconds + 5) * 1000) + 15000,
          'Playback got stuck — nothing has been lost, just try again.'
        );
      }
    } catch (err) {
      // If we got as far as having a real `playback` (i.e. this was the "playback.done
      // took too long" timeout, not a failure to even start), its audio sources may
      // still be physically scheduled/playing even though we've given up waiting on
      // them — stop() cuts them off and closes the AudioContext, so a timeout doesn't
      // leave stray audio running behind an editor that now thinks nothing is playing.
      if (playback) { try { playback.stop(); } catch { /* already stopped */ } }
      const msg = getFnErrorMessage(err);
      addLog(`Preview ERROR: ${msg}`);
      setError(`Preview failed: ${msg}`);
      setCurrentPlayingIndex(null);
      setPlaying(false);
      setActiveSubsectionIndex(null);
      currentPlaybackRef.current = null;
      return;
    }

    currentPlaybackRef.current = null;
    setCurrentPlayingIndex(null);
    setPlaying(false);
    setActiveSubsectionIndex(null);

    if (stopRef.current) {
      stopRef.current = false;
      return;
    }
    if (isReplay) return;

    // Not a replay — this was the next part the narrator hadn't heard yet, so move the
    // marker forward. Once every subsection has been played this way, the LAST
    // subsection's own "Save & Finish" control lights up (see the render below) —
    // finalizing is now always a deliberate, separate click, never bundled into a play
    // action, so there's always a chance to edit the last bit of text after hearing it
    // and before it gets saved.
    setSubsectionCursor(targetIndex + 1);
  };

  // "Continue" for every subsection except the last. Per Enda: clicking Continue must
  // save whatever's in THIS subsection's own edit box first — regenerating its audio and
  // re-splitting its cards if a <break> was added or removed — and only then play the
  // NEXT subsection, instead of quietly ignoring the edit until a full re-parse. Safe to
  // still hand handlePlayTarget the (technically stale, pre-commit) `subsections` closure
  // here: committing subsection `si` only ever changes ITS OWN ids/boundary — every
  // subsection after it keeps the exact same segment objects/ids, just shifted position
  // in the flat array — so the NEXT subsection (targetIndex) that's about to play is
  // completely unaffected by the edit just committed.
  const handleContinueClick = async (si, targetIndex) => {
    // Per the follow-up 23 audit: also refuses to start while a per-line quick editor is
    // open (editingSegmentId !== null) — without that, committing this WHOLE subsection
    // (reassigning fresh ids to every segment in it) could run concurrently with, and
    // silently clobber or be clobbered by, a per-line save on a segment inside it. Safe
    // to call this synchronously from here (unlike inside handlePlayTarget below) since
    // nothing in THIS function's own body changes committingIndex/editingSegmentId
    // before this check runs — it's always a fresh read of the last render's state.
    if (passLocked) return;
    setError('');
    setCommittingIndex(si);
    try {
      await commitSubsectionEdit(si);
    } catch (err) {
      setCommittingIndex(null);
      setError(`Could not save your edit: ${getFnErrorMessage(err)}`);
      return;
    }
    setCommittingIndex(null);
    handlePlayTarget(subsections, targetIndex);
  };

  // The very last subsection has nothing after it to "Continue" into — its control is
  // "Save & Finish" instead, and only renders/uploads/saves (no playback of its own,
  // since its audio was already played by the Continue button before it). Kept separate
  // from handlePlayTarget so a click here can never accidentally play anything.
  //
  // Per Enda: exactly like Continue, Save & Finish must also save whatever's currently in
  // the LAST subsection's own edit box before finalizing — this is the one place where
  // the freshly-committed segments/audio (not the stale closure) actually matter, since
  // finalizeAndSave is rendering and uploading THIS possibly-just-edited subsection's own
  // audio, not just about to play some later, unaffected one.
  const handleFinalizeClick = async (si) => {
    // See the comment in handleContinueClick above — same reasoning applies here.
    if (passLocked) return;
    setError('');
    setCommittingIndex(si);
    let fresh;
    try {
      fresh = await commitSubsectionEdit(si);
    } catch (err) {
      setCommittingIndex(null);
      setError(`Could not save your edit: ${getFnErrorMessage(err)}`);
      return;
    }
    setCommittingIndex(null);
    await finalizeAndSave(fresh.segments, fresh.segmentAudios);
  };

  const handleStopPlay = () => {
    stopRef.current = true;
    if (currentPlaybackRef.current) {
      currentPlaybackRef.current.stop();
      currentPlaybackRef.current = null;
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
    }
    setPlaying(false);
    setActiveSubsectionIndex(null);
    setCurrentPlayingIndex(null);
  };

  const handleDownload = async () => {
    // Download the full edited script as .docx (break tags preserved)
    if (script) {
      downloadScriptAsDocx(script, 'narration_script.docx');
    }

    // Download the full combined audio, keeping whatever extension it was actually
    // saved with — combined audio built by the exact-silence combiner is a .wav file
    // now (see audioCombiner.js), while any older tour's combined audio saved before
    // this fix is still a real .mp3; hardcoding .mp3 here would mislabel the newer
    // ones even though playback itself doesn't care about the extension.
    if (audioUrl) {
      const extMatch = audioUrl.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
      const ext = extMatch ? extMatch[1] : 'mp3';
      const downloadName = `narration_audio.${ext}`;
      try {
        const response = await fetch(audioUrl);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = downloadName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        const a = document.createElement('a');
        a.href = audioUrl;
        a.download = downloadName;
        a.target = '_blank';
        a.click();
      }
    }
  };

  const hasSegmentAudios = Object.keys(segmentAudios).length > 0;
  // Per Enda: this must stay frozen to whatever it was as of the LAST Parse & Generate
  // — using the live subsectionTexts here (i.e. re-deriving on every keystroke) is
  // exactly what caused a newly-typed <break> tag to reshuffle the segment cards and
  // move the edit box's own position immediately, before the change had actually been
  // applied. subsectionSizes only updates via the effect above, i.e. only on an actual
  // re-parse, so the cards/boxes stay put while typing and only regroup on Parse &
  // Generate.
  const subsections = segments
    ? (subsectionSizes ? chunkBySizes(segments, subsectionSizes) : chunkIntoSubsections(segments))
    : [];

  // Shared "something else has the floor right now" flag for every control on this
  // panel — combined playback, a whole-subsection Continue/Save & Finish commit, the
  // final render/upload, a single line's own quick-edit save (see commitSegmentEdit
  // above), or Parse & Generate's own initial generation loop. Used to disable
  // everything else while any one of them is in flight, so two of these can never race
  // each other or overlap their audio.
  //
  // Per the follow-up 23 audit: `generatingSegmentId !== null` was added after finding
  // that a per-line quick edit could be saved WHILE Parse & Generate's own loop
  // (handleParseAndGenerate) was still generating the rest of the document's audio —
  // that loop only calls setSegmentAudios ONCE, right at the end, with everything it
  // has accumulated so far; if a per-line save's own setSegmentAudios call landed
  // first, the loop's later one would silently overwrite it, wiping out that line's
  // just-generated audio (its card, id, and text would all still be correct — the URL
  // to actually play it would simply be gone, with no error shown). Nothing about
  // editing a line makes sense before the very first generation pass has even finished
  // anyway, so locking every quick-edit control for that whole window costs nothing.
  const busy = playing || generatingCombined || committingIndex !== null || savingSegmentId !== null || generatingSegmentId !== null;

  // Layered on top of `busy`: a per-line quick editor being OPEN — even before its own
  // Save is clicked — must also block every "advance the pass" control (Parse &
  // Generate, Build & Play, Continue, Save & Finish, Replay) and the per-subsection
  // edit box. Without this, an open-but-unsaved per-line edit could be silently
  // discarded or desynced by one of those (full audit in CLAUDE_CHANGELOG.md
  // follow-up 23). Deliberately kept SEPARATE from `busy` rather than folded into it:
  // `busy` also drives a card's own Play button and its pause Slider, and there's no
  // reason listening to (or nudging the duration of) a DIFFERENT line should be
  // blocked just because one line's own quick editor happens to be open elsewhere.
  const passLocked = busy || editingSegmentId !== null;

  return (
    <div className="bg-slate-800/50 rounded-lg border border-blue-600/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-blue-400" />
        <Label className="text-white text-sm font-bold">Narration Script & TTS</Label>
        <span className="text-xs text-slate-400 ml-1">import, edit, generate audio</span>
      </div>

      <TranslationPanel
        onTranslated={(text) => {
          onScriptChange(text);
          setSegments(null);
          setSegmentAudios({});
          setSubsectionCursor(0);
          setEditingSegmentId(null);
        }}
        fixedLanguage={fixedLanguage}
        // Per the follow-up 23 audit's fourth review pass: this panel's own
        // Import/Translate & Load controls used to be completely ungated by
        // anything happening below — a narrator could fire a translation reset
        // while a Continue/Save & Finish/per-line save was still mid-flight
        // awaiting its own TTS call, and that commit's stale pre-reset closure
        // would resurrect the old document on top of the fresh reset once it
        // resolved, discarding the translation and any other unrelated draft.
        // Locked the same way every other segments-mutating control here is.
        disabled={passLocked}
      />

      {/* Insert break tags at cursor */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-xs text-slate-500">Insert pause:</span>
        {/* 0.1s — a mid-sentence pause is often much shorter than half a second; 0.5s
            alone made that impossible to express with a quick-insert button. */}
        <Button type="button" size="sm" variant="ghost"
          onClick={() => insertBreakTag('<break time="0.1s"/>')}
          className="text-slate-400 hover:text-slate-200 h-7 px-2 text-xs gap-1">
          <Pause className="w-3 h-3" /> 0.1s
        </Button>
        <Button type="button" size="sm" variant="ghost"
          onClick={() => insertBreakTag('<break time="0.5s"/>')}
          className="text-slate-400 hover:text-slate-200 h-7 px-2 text-xs gap-1">
          <Pause className="w-3 h-3" /> 0.5s (default)
        </Button>
        {[1, 2, 3].map((s) => (
          <Button key={s} type="button" size="sm" variant="ghost"
            onClick={() => insertBreakTag(`<break time="${s}s"/>`)}
            className="text-slate-400 hover:text-slate-200 h-7 px-2 text-xs gap-1">
            <Pause className="w-3 h-3" /> {s}s
          </Button>
        ))}
      </div>

      {/* Editable script textarea — same pastel yellow as every duplicate copy further
          down (per Enda: every editable script box must look identical, so it's never
          ambiguous which boxes on this panel are text you can type into). */}
      <div>
        <Textarea
          ref={textareaRef}
          value={script || ''}
          onChange={handleScriptEdit}
          placeholder={'Import a script file or write here...\n\nUse <break time="2s"/> for pauses.'}
          rows={6}
          className="bg-amber-100 border-amber-300 text-black placeholder:text-amber-900/50 text-sm font-mono resize-y focus-visible:ring-amber-400"
        />
        <div className="flex items-center justify-between mt-1">
          <span className={`text-xs ${overLimit ? 'text-red-400' : 'text-slate-500'}`}>
            {charCount} / {MAX_CHARS} characters
          </span>
          {charCount > 0 && (
            <span className="text-xs text-green-500">Free via Google TTS (1M chars/month)</span>
          )}
        </div>
      </div>

      {/* Voice + Language */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-slate-400 text-xs mb-1 block">Voice (Google)</Label>
          {/*
            Per the follow-up 23 audit's fifth review pass: this used to be changeable
            at ANY time, including mid-pass — every Continue/Save-this-line click reads
            selectedVoice fresh at the moment it fires, so switching voices partway
            through working down a long document (an entirely ordinary thing to do
            between subsections, with nothing else on the panel stopping it) silently
            produced ONE saved narration mixing two different voices, with no warning
            at all. Locked to whatever was chosen before the pass started (Parse &
            Generate) until it finishes (Save & Finish) or is abandoned (segments reset)
            — exactly like the Language picker already is for a translation clone via
            fixedLanguage, just for the ordinary non-clone case too.
          */}
          <Select value={selectedVoice} onValueChange={setSelectedVoice} disabled={!!segments}>
            <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-8 text-sm" title={segments ? 'Set for this pass when Parse & Generate was clicked — Save & Finish (or start a fresh pass) to change it.' : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOICES.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-slate-400 text-xs mb-1 block">Language</Label>
          {fixedLanguage ? (
            <div className="h-8 flex items-center px-3 bg-slate-800 border border-slate-600 rounded-md text-slate-300 text-sm" title="Set when this clone was created — cannot be changed here.">
              {fixedLanguage}
            </div>
          ) : (
            <Select value={selectedLanguage} onValueChange={setSelectedLanguage} disabled={!!segments}>
              <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-8 text-sm" title={segments ? 'Set for this pass when Parse & Generate was clicked — Save & Finish (or start a fresh pass) to change it.' : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => <SelectItem key={lang} value={lang}>{lang}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Parse & Generate */}
      <Button
        type="button"
        onClick={handleParseAndGenerate}
        disabled={generatingSegmentId !== null || overLimit || !script?.trim() || passLocked}
        className="w-full bg-purple-600 hover:bg-purple-700 gap-2 text-white"
      >
        {generatingSegmentId !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Braces className="w-4 h-4" />}
        {generatingSegmentId !== null ? 'Generating…' : 'Parse & Generate'}
      </Button>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Segments list, grouped into subsections (a run of up to SUBSECTION_MAX_SEGMENTS
          cards, kept intact around pauses — see chunkIntoSubsections above). Per Enda: a control must
          always play the audio that comes AFTER it, never the part already shown above
          it — the narrator should hear a part fresh, THEN read/edit its text, not the
          other way round. That means the very first part needs its own standalone
          "Build & Play" button positioned right under Parse & Generate below, since
          there's no earlier control to have played it. From there, the "Continue"
          button at the end of each subsection's block plays the NEXT subsection down;
          the narrator listens, edits that subsection's own text box to reflect what
          they just heard, then presses Continue again. The very last subsection has
          nothing left to Continue into, so its control is "Save & Finish" instead — it
          renders and saves the combined file and sends the editor back to the top for a
          fresh Parse & Generate pass. */}
      {segments && subsections.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
            <span>{countCharacters(segments)} characters</span>
            <span>·</span>
            <span>{countBreaks(segments)} breaks detected</span>
            <span className="text-slate-600">Use &lt;break time="Xs"/&gt; for pauses</span>
          </div>

          {/* Standalone starter control — plays the very first subsection's audio.
              Nothing comes before this one, so it's always "Build & Play", never
              "Continue". */}
          {(() => {
            const topIsPlayingThis = playing && activeSubsectionIndex === 0;
            const topAlreadyPlayed = subsectionCursor > 0;
            if (topIsPlayingThis) {
              return (
                <Button type="button" onClick={handleStopPlay} className="w-full bg-red-600 hover:bg-red-700 gap-2 text-white">
                  <Square className="w-4 h-4" /> Stop
                </Button>
              );
            }
            if (topAlreadyPlayed) {
              return (
                <div className="flex gap-2 items-center">
                  <span className="flex items-center gap-1.5 text-sm text-emerald-400 shrink-0">
                    <CheckCircle2 className="w-4 h-4" /> Played
                  </span>
                  <Button
                    type="button" variant="outline" size="sm"
                    onClick={() => handlePlayTarget(subsections, 0)}
                    disabled={passLocked}
                    className="border-slate-500 text-slate-300 gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" /> Replay
                  </Button>
                </div>
              );
            }
            return (
              <Button
                type="button"
                onClick={() => handlePlayTarget(subsections, 0)}
                disabled={passLocked || !hasSegmentAudios}
                className="w-full bg-purple-600 hover:bg-purple-700 gap-2 text-white"
              >
                <Play className="w-4 h-4" /> Build & Play
              </Button>
            );
          })()}

          {subsections.map((subsectionSegments, si) => {
            const isLastBlock = si === subsections.length - 1;
            const targetIndex = si + 1; // the NEXT subsection this block's control plays
            const isPlayingThis = playing && activeSubsectionIndex === targetIndex;
            const status = subsectionCursor > targetIndex ? 'done' : subsectionCursor === targetIndex ? 'active' : 'locked';
            const finalizeReady = subsectionCursor >= subsections.length;
            const isSavingThis = generatingCombined && isLastBlock;
            const isCommittingThis = committingIndex === si;

            return (
              <div key={`subsection-${si}`} className="space-y-2 pt-2 border-t border-slate-700/60 first:border-t-0 first:pt-0">
                {subsectionSegments.map((seg) => {
                  const globalIdx = segments.findIndex((s) => s.id === seg.id);
                  return (
                    <TtsSegmentCard
                      key={seg.id}
                      segment={seg}
                      audioUrl={segmentAudios[seg.id]}
                      isGenerating={generatingSegmentId === seg.id}
                      isPlaying={currentPlayingIndex === globalIdx}
                      onPlay={playSegment}
                      onDurationChange={handleDurationChange}
                      controlsDisabled={busy}
                      isEditing={editingSegmentId === seg.id}
                      editValue={editingSegmentId === seg.id ? segmentEditText : ''}
                      onEditChange={setSegmentEditText}
                      onToggleEdit={seg.type === 'text' ? () => handleToggleSegmentEdit(seg) : undefined}
                      // Per the follow-up 23 audit (Bug C): opening a DIFFERENT line's
                      // editor while this one is still open used to silently discard
                      // whatever was typed here, with no warning at all. Blocked at the
                      // source instead of just documented — every card but the one
                      // currently open (isEditing handles that one via TtsSegmentCard's
                      // own logic) is locked out of opening a new editor while
                      // editingSegmentId already points elsewhere.
                      //
                      // Also blocked (symmetric with the per-subsection Textarea's own
                      // lock further below) whenever THIS subsection's own combined box
                      // already has an uncommitted draft sitting in it — typed before
                      // this editor was ever opened, not just during. Saving a per-line
                      // edit refreshes its owning subsection's box to the new ground
                      // truth (see commitSegmentEdit above); doing that while an
                      // unrelated manual draft is already sitting there would silently
                      // discard it, so opening the per-line editor at all is refused
                      // until that draft is committed (Continue) or cleared first.
                      editToggleDisabled={
                        busy
                        || (editingSegmentId !== null && editingSegmentId !== seg.id)
                        || (subsectionTexts?.[si] !== undefined && subsectionTexts[si] !== rebuildScript(subsectionSegments))
                      }
                      onCancelEdit={handleCancelSegmentEdit}
                      onSaveEdit={() => commitSegmentEdit(seg.id)}
                      isSavingEdit={savingSegmentId === seg.id}
                    />
                  );
                })}

                {/* Per-subsection editable script box — shows and edits ONLY this
                    block's own text (see subsectionTexts/handleSubsectionScriptEdit
                    above), not the whole document, so it's never necessary to scroll
                    through everything else to find the right passage. Still just as
                    real an edit as the box at the top — it's sent up via the same
                    onScriptChange, just scoped to this one part. Per Enda: this is
                    where you write down the changes needed after hearing THIS
                    subsection's audio (played by the control above this block, or by
                    the standalone Build & Play button for the very first one) — not a
                    box you fill in before listening. Deliberately styled unlike the dark
                    narration cards around it (a muted pastel yellow with black text) so
                    it reads clearly as an editing tool wedged into the list, not another
                    narration block. */}
                <div>
                  <Label className="text-amber-200/80 text-xs mb-1 block">Edit this part's script (saved when you click Continue / Save &amp; Finish below)</Label>
                  <Textarea
                    value={subsectionTexts?.[si] ?? rebuildScript(subsectionSegments)}
                    onChange={(e) => handleSubsectionScriptEdit(si, e.target.value)}
                    rows={4}
                    // Per the follow-up 23 audit (Bug B): typing into this box while ITS
                    // OWN Continue/Save & Finish (or any other commit/save/render) is
                    // already in flight used to go unseen by that in-flight commit
                    // (which captured this box's text the moment it started) but WOULD
                    // still feed the [segments] effect's re-derivation once that commit
                    // finished — sizing this subsection using text that was never
                    // actually the text sent to TTS. Locked for the same window
                    // everything else on the panel already locks for.
                    //
                    // Also locked (Bug B's narrower sibling) whenever one of THIS
                    // subsection's own segments has its per-line quick editor open —
                    // without this, typing here while that per-line save lands would
                    // get silently discarded the moment its commit refreshes this same
                    // box from the newly-true segments (see the [segments] effect
                    // above). A DIFFERENT subsection's box is untouched by this check —
                    // only the one that actually owns the open editor locks.
                    disabled={busy || subsectionSegments.some((s) => s.id === editingSegmentId)}
                    className="bg-amber-100 border-amber-300 text-black placeholder:text-amber-900/50 text-sm font-mono resize-y focus-visible:ring-amber-400"
                  />
                </div>

                <div className="flex gap-2 items-center">
                  {isLastBlock ? (
                    finalizeReady ? (
                      <Button
                        type="button"
                        onClick={() => handleFinalizeClick(si)}
                        disabled={passLocked}
                        className="flex-1 bg-purple-600 hover:bg-purple-700 gap-2 text-white"
                      >
                        {(isSavingThis || isCommittingThis) ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {isCommittingThis ? 'Saving your edit…' : isSavingThis ? 'Saving…' : 'Save & Finish'}
                      </Button>
                    ) : (
                      <Button type="button" disabled className="flex-1 bg-slate-700 text-slate-500 gap-2 cursor-not-allowed">
                        <CheckCircle2 className="w-4 h-4" /> Save & Finish
                      </Button>
                    )
                  ) : isPlayingThis ? (
                    <Button type="button" onClick={handleStopPlay} className="flex-1 bg-red-600 hover:bg-red-700 gap-2 text-white">
                      <Square className="w-4 h-4" /> Stop
                    </Button>
                  ) : status === 'done' ? (
                    <>
                      <span className="flex items-center gap-1.5 text-sm text-emerald-400 shrink-0">
                        <CheckCircle2 className="w-4 h-4" /> Played
                      </span>
                      <Button
                        type="button" variant="outline" size="sm"
                        onClick={() => handlePlayTarget(subsections, targetIndex)}
                        disabled={passLocked}
                        className="border-slate-500 text-slate-300 gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5" /> Replay
                      </Button>
                    </>
                  ) : status === 'active' ? (
                    <Button
                      type="button"
                      onClick={() => handleContinueClick(si, targetIndex)}
                      disabled={passLocked || !hasSegmentAudios}
                      className="flex-1 bg-purple-600 hover:bg-purple-700 gap-2 text-white"
                    >
                      {isCommittingThis ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      {isCommittingThis ? 'Saving your edit…' : 'Continue'}
                    </Button>
                  ) : (
                    <Button type="button" disabled className="flex-1 bg-slate-700 text-slate-500 gap-2 cursor-not-allowed">
                      <Play className="w-4 h-4" /> Continue
                    </Button>
                  )}
                  <Button
                    type="button" variant="outline"
                    onClick={handleDownload}
                    disabled={!hasSegmentAudios || busy}
                    className="border-slate-500 text-slate-300 gap-2"
                  >
                    <Download className="w-4 h-4" /> Download
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Current saved audio — always visible once something's been built, with clear
          instructions for how to change it, since it wasn't obvious before how to go back
          and amend a previously-created audio. */}
      {audioUrl && (
        <div className="bg-green-900/20 border border-green-700/40 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-green-400 shrink-0" />
            <span className="text-green-300 text-sm font-medium">
              {segments ? 'Last saved audio (a version below may be newer, unsaved)' : 'Current saved audio'}
            </span>
          </div>
          <AudioPlayer src={audioUrl} className="w-full" />
          <p className="text-xs text-slate-500">
            To change this: edit the script above, click <strong>Parse &amp; Generate</strong>, then click
            <strong> Build &amp; Play</strong> to hear the first part. Edit the yellow text box under it to
            reflect what you just heard, then click <strong>Continue</strong> to hear the next part — repeat
            down the list. Once you have heard and adjusted every part, <strong>Save &amp; Finish</strong>
            saves the new version. No need to leave this screen.
          </p>
          <p className="text-xs text-slate-500">
            Spotted one line's mistake straight after Parse &amp; Generate, before you've heard anything
            yet? No need to wait — click that line's own <strong>play</strong> button to hear just that
            line, then the <strong>pencil</strong> next to it to fix and save just that line on its own.
          </p>
        </div>
      )}
    </div>
  );
}
