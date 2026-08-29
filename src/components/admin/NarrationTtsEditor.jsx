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

// Per Enda's follow-up 26 report: a narrator working through many lines in one sitting
// hit a real, total freeze — every control on the panel stuck disabled, no error, no
// spinner ever resolving, the only way out a hard refresh that throws away whatever
// wasn't saved yet. Root cause: `base44.functions.invoke('generateTts'/
// 'uploadNarrationAudio', …)` calls a plain network request with no ceiling of its own,
// and none of Parse & Generate / a per-subsection commit / a per-line quick save /
// Save & Finish's final upload ever wrapped it in a timeout — so a single stalled
// request (a network hiccup, a slow backend response) left `busy` (via
// generatingSegmentId/committingIndex/savingSegmentId/generatingCombined) permanently
// true, and every one of those flags gates nearly every other control on the whole
// page. This is the exact same class of bug already fixed once for playback (see
// FETCH_TIMEOUT_MS in audioCombiner.js, and withTimeout() around playSegmentsPrecisely
// in handleBuildAndPlay below) — just never extended to these four call sites. A
// generous but FINITE ceiling here means a stalled request always either finishes or
// fails with a clear, recoverable error, never hangs forever.
const TTS_CALL_TIMEOUT_MS = 30000;

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
// broke the flow of the narration. Raised to 3, then to 12 for the same reason, then
// — per the follow-up 26/27 conversation — raised again, much further, to 125.
//
// Per Enda (follow-up 27): a per-line/per-subsection edit that pushes ONE box past
// this ceiling is allowed to stand (nothing forces a re-flow mid-pass — see
// chunkBySizes/deriveSubsections below) — but a SECOND "Parse & Generate" in the same
// session re-derives every box from scratch and would then split that one oversized
// box back down to this ceiling again. Nothing gets silently lost when that happens —
// the full text is always still there, just regrouped into more boxes — but a second
// Parse & Generate also wipes every already-generated clip and restarts the whole
// sequential Continue/Build & Play pass from the beginning regardless of this number,
// which is disruptive to a narrator's rhythm on its own. Raised from 12 to 125 (Enda's
// own suggestion: "ridiculously high") specifically so that in ordinary use no single
// natural run of narration ever comes close to hitting this ceiling in the first
// place, making the reshuffle-on-a-second-parse scenario a non-issue in practice,
// while still leaving a real (if very generous) ceiling in place rather than removing
// chunking altogether — a single "part" covering an entire multi-waypoint script would
// also do away with the original reason subsections exist at all: matching a natural
// run of narration to the DISTANCE it covers while driving, so a narrator can pace-
// check one part against the next as they Continue down the list.
const SUBSECTION_MAX_SEGMENTS = 125;

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

export default function NarrationTtsEditor({ script, audioUrl, onScriptChange, onAudioChange, onAutoSave, fixedLanguage, waypointSegmentId, waypointSegmentTitle, doneLocked = false }) {
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
  // Per Enda (follow-up 31 — a deliberate, explicit redesign of the review/finalize
  // workflow, replacing follow-up 30's subsectionCursor/playedSegmentIds approach
  // entirely): the whole point of this panel is a script written "for the ear, not the
  // eye" — a narrator must be forced to actually LISTEN to the complete, current state
  // of a part before they can either edit it further or declare it finished. Follow-up
  // 30 let a narrator satisfy that by listening to every line individually, which
  // technically worked but didn't force listening to the lines TOGETHER, in context,
  // back-to-back the way an end user actually hears them — Enda asked for something
  // stricter: listening and editing are now two completely separate, alternating
  // MODES, never available at the same time.
  //
  // reviewPhase is 'listen' (only the whole-document Build & Play control is shown —
  // no per-line play, no editing, nothing else) or 'edit' (every line's own play/edit
  // control and every subsection's own script box are unlocked, but the combined
  // Build & Play control is gone — the only way to hear the result of an edit is to
  // finish editing and go listen again). See handleBuildAndPlay/handleSaveAndListenAgain
  // further down for the two moves that flip between them.
  const [reviewPhase, setReviewPhase] = useState('listen');
  // How many COMPLETE, uninterrupted whole-document Build & Play passes have finished
  // since the most recent fresh Parse & Generate (the manual button, or a brand new
  // import/translate) — deliberately NOT reset by handleSaveAndListenAgain's own
  // re-parse, so it keeps counting across as many listen/edit cycles as the narrator
  // wants to repeat (Enda: "There should be no limit to the amount of times this can be
  // repeated"). A pass stopped early (Stop clicked) or that errors out does NOT
  // increment this. Per Enda: "the ability to declare something done must never appear
  // after the first Build and Play pass" — Mark Segment as Done requires this to be at
  // least 2 (the original pass, plus at least one further pass after an edit), never
  // available straight off the very first listen.
  const [listenPassCount, setListenPassCount] = useState(0);
  // True the moment ANY edit (a per-line save, a per-subsection "Save This Part", or a
  // pause-duration slider nudge) is actually applied during an 'edit' phase, cleared
  // back to false only when the NEXT full listen pass completes. Per Enda: "Done" must
  // "never appear after an editing pass" — i.e. the instant something changes, it has
  // to be heard again (a fresh Build & Play pass) before Done can reappear, however
  // many completed passes came before it.
  const [editedSinceLastListen, setEditedSinceLastListen] = useState(false);
  // Per Enda's follow-up 32 request: "irrespective of this being the first, fifth or
  // 10th editing attempt", a narrator must play a line's own clip through in full again
  // right before that line's edit pencil unlocks — Anoushka changes her mind mid-
  // sentence often enough that Enda wants a fresh listen forced every single time, not
  // just once. Tracks every segment id whose clip has been played to completion
  // (onended — see playSegment below; a manual interruption, like starting a different
  // line's clip early, does NOT count) since the CURRENT 'edit' phase visit began.
  // Reset to empty by every fresh Parse & Generate (handleParseAndGenerate) — the only
  // path that leads into a new 'edit' phase visit (via a completed Build & Play pass) —
  // so a narrator always starts each visit needing to (re-)listen to every line before
  // touching it, with nothing extra needed when Build & Play itself completes. Saving
  // an edit (commitSegmentEdit) or a whole part (commitSubsectionEdit) always assigns
  // brand-new ids to whatever it just regenerated, so those pieces are naturally absent
  // from this set afterwards too — re-editing the SAME line a second time still
  // requires hearing its newly-generated audio first, with no extra invalidation logic
  // needed.
  const [playedSegmentIds, setPlayedSegmentIds] = useState(new Set());
  // Which segment id(s) came from the most recent "Save this line" — a pure location
  // bookmark. Per Enda: "This is not to entice them to edit again, or to block further
  // editing, it's to show them where they left off" — after answering a call of nature,
  // making coffee, or just taking a break, especially with 15 or so lines in one
  // segment. Deliberately independent of playedSegmentIds above: it stays put even
  // after that line gets played again, and only moves when a DIFFERENT line is saved,
  // or clears on a fresh pass or once the segment is marked done.
  const [lastEditedSegmentIds, setLastEditedSegmentIds] = useState(new Set());
  // Which subsection is actively mid-playback right now during a Build & Play pass, if
  // any — used to show "Playing part X of Y" and Stop in the right spot.
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
  // Enda): fixing ONE line's wording should be a small, self-contained action — its own
  // quick editor right on that line's own card, not the big per-subsection edit box
  // further down (editing THAT box was originally a real bug before its own Continue
  // had ever run once — see the "two audios playing at once" history in playSegment/
  // handleBuildAndPlay below). Per the follow-up 31 redesign, this editor (like every
  // other editing control) is only ever actually usable during the 'edit' phase —
  // reviewPhase above — never during a Build & Play pass. editingSegmentId/
  // segmentEditText track which ONE text segment's own quick editor (on its
  // TtsSegmentCard, see that file) is open right now and what's currently typed into
  // it — only one line open at a time, closing whichever was open before opening a
  // different one, matching how a narrator actually
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
  const errorRef = useRef(null);
  // Per Enda's follow-up 33 report: after Parse & Generate, the 'listen' phase box
  // (with the Build & Play button) renders below the fold on a document of any real
  // length — Anoushka had to scroll down herself to find it, which read as the page
  // not having done anything. Only ever attached while reviewPhase is 'listen' (see
  // the ref on that box further down) — used by the effect below to bring it into view
  // automatically the moment a fresh parse starts.
  const listenBoxRef = useRef(null);
  // Per Enda's follow-up 34 report: the same "have to scroll to find it" problem, one
  // step earlier — the "Parse & Generate" button (past the pause-insert row, the big
  // script box, and the Voice/Language pickers) sits below the fold right after
  // importing/translating a file too. Always present in the DOM once !segments, so
  // this just needs to be scrolled TO, not conditionally attached like listenBoxRef.
  const parseGenerateRef = useRef(null);
  // Bumped once every time TranslationPanel's onTranslated fires (see below) — the
  // effect further down watches this and scrolls parseGenerateRef into view. A plain
  // counter rather than watching `segments` directly (already null both BEFORE and
  // AFTER an import in the ordinary case, so a `[segments]`-keyed effect wouldn't see
  // any change to react to) or `script` (which also changes on every single keystroke
  // while typing directly in the top box — scrolling on every keystroke would be far
  // worse than the original problem).
  const [justImportedTick, setJustImportedTick] = useState(0);

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

  // Per Enda's follow-up 26 report: on a long document this list can run many screens
  // tall, and every error this panel raises — a per-line save refused for being empty
  // or over the character limit, a subsection commit that failed, a missing API key —
  // used to only ever appear in the ONE banner right at the very top, above the whole
  // list (see below). Working on a line deep in the list, that banner sits far off
  // screen: the save silently does nothing VISIBLE, the text you typed just sits there
  // unchanged, and there's no way to tell why without scrolling all the way back up —
  // which reads exactly like the page has frozen, even though it hasn't; the error was
  // real and correct the whole time, just invisible. Scrolls the banner into view the
  // moment an error is actually set, wherever on the page you currently are, so a
  // refusal is never silent just because of where you happened to be scrolled to.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  // Per Enda's follow-up 33 report: bring the 'listen' phase box (Build & Play) into
  // view the moment a fresh parse starts, rather than leaving a narrator to scroll down
  // and find it themselves. `segments` changes to a new array reference on every fresh
  // Parse & Generate (the manual button, or "Save & Listen Again") — that's also the
  // only path that ever puts reviewPhase back to 'listen' (see handleParseAndGenerate),
  // so gating on both together means this never fires for a `segments` change that
  // happens mid-'edit'-phase (a per-line save, a duration nudge, etc — see
  // commitSegmentEdit/commitSubsectionEdit/handleDurationChange), only for an actual
  // fresh pass. listenBoxRef is only ever attached while reviewPhase is 'listen' (see
  // the ref on that box further down), so it's already pointing at the right element by
  // the time this runs.
  useEffect(() => {
    if (segments && reviewPhase === 'listen') {
      listenBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [segments]);

  // Per Enda's follow-up 34 report: same idea, one step earlier — bring "Parse &
  // Generate" into view the moment a file's been imported/translated and loaded into
  // the script box, rather than leaving a narrator to scroll down and find it
  // themselves. justImportedTick > 0 (not just "truthy") so this never fires on the
  // initial render, only on an actual import.
  useEffect(() => {
    if (justImportedTick > 0) {
      parseGenerateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [justImportedTick]);

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
  // having flushed by the time a caller needs them) — kept even though its only current
  // caller (handleSaveSubsectionPart) doesn't use the return value, since a future
  // caller acting on this part's freshly-committed data right away shouldn't have to
  // wait for a re-render to see it, exactly as it was originally needed for.
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
      const response = await withTimeout(
        base44.functions.invoke('generateTts', {
          text: seg.content,
          gender: selectedVoice,
          language_code: languageCode,
          apiKey: apiKeys.google_tts_api_key,
          ...getNarratorAuthPayload(),
        }),
        TTS_CALL_TIMEOUT_MS,
        "Generating this part's audio took too long (check your connection) — nothing has been lost, just try again."
      );
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
    // This was missing entirely before this fix: every OTHER commit path in this file
    // (the top box, a per-subsection box's plain typing, a per-line "Save this line")
    // tells the parent about a text change via onScriptChange — this one, "Save This
    // Part", never did. It regenerated audio and updated this component's own local
    // segments/subsectionTexts (so the card visibly showed the new text and a working
    // Play button, looking exactly like a real save), but the parent's own copy of this
    // waypoint's narration_script never changed — meaning it was never actually
    // persisted anywhere outside this one render of this one component. Reported by
    // Enda as "Save this line pretended to save" — this function is what "a few sub
    // segments" almost certainly went through, and this is the confirmed reason none of
    // it survived.
    onScriptChange(rebuildScript(newSegments));
    // Per follow-up 40: don't just hand the edit to the parent's in-memory `form` and
    // leave it there hoping the narrator remembers to click Save Route — request an
    // actual server save right now, the same way "Mark Waypoint as Done" and "Save
    // this line" do.
    onAutoSave?.();

    return { segments: newSegments, segmentAudios: newSegmentAudios };
  };

  // Per Enda's follow-up 31 redesign: this box's own text no longer needs to be
  // "committed" before moving on (there's no more per-block Continue to bundle it
  // with) — it behaves exactly like the top script box already does, living as plain
  // typed text that only actually takes effect the next time a full reparse runs (see
  // handleSaveAndListenAgain below). This button is a pure convenience on top of that:
  // saving THIS part now, without waiting for the next full listen pass, regenerates
  // just its own lines' audio so the narrator can preview them via each line's own ▶
  // Play button straight away — reusing commitSubsectionEdit exactly as before, just no
  // longer tied to "and then start playing the next part".
  const handleSaveSubsectionPart = async (si) => {
    if (passLocked) return;
    setError('');
    setCommittingIndex(si);
    try {
      await commitSubsectionEdit(si);
      setEditedSinceLastListen(true);
    } catch (err) {
      setError(`Could not save this part: ${getFnErrorMessage(err)}`);
    }
    setCommittingIndex(null);
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
    // Defense in depth (see the comment above): the pencil that opens this editor
    // should already be impossible to click before this line's own clip has been
    // played through in full this pass (see playedSegmentIds/editToggleDisabled) —
    // this is the one place that actually commits the edit, so it's worth guarding
    // here too rather than trusting the UI alone.
    if (!playedSegmentIds.has(segmentId)) {
      setError('Play this line, start to finish, before editing it.');
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
        const response = await withTimeout(
          base44.functions.invoke('generateTts', {
            text: seg.content,
            gender: selectedVoice,
            language_code: languageCode,
            apiKey: apiKeys.google_tts_api_key,
            ...getNarratorAuthPayload(),
          }),
          TTS_CALL_TIMEOUT_MS,
          'Generating audio for this line took too long (check your connection) — nothing has been lost, just try again.'
        );
        if (!response.data?.url) throw new Error('No audio URL returned for the edited text.');
        newAudios[seg.id] = response.data.url;
      }

      const newSegments = [...segments.slice(0, segIndex), ...freshSegs, ...segments.slice(segIndex + 1)];
      const newSegmentAudios = { ...segmentAudios, ...newAudios };

      // Keep the owning subsection's own box (and the parent's full script) in sync —
      // see the comment above for why this matters even when freshSegs.length === 1.
      //
      // onScriptChange used to be called from INSIDE the setSubsectionTexts updater
      // above — a side-effecting call (it ultimately calls setForm/setDirty in
      // WalkEditor, two renders up) sitting inside a state updater function, which React
      // is allowed to invoke more than once for the same update in some circumstances
      // (Strict Mode double-invoking to surface exactly this kind of impurity; a
      // Concurrent render that gets interrupted and restarted). Moved out to plain,
      // ordinary code below instead, called exactly once — reading the CURRENT
      // subsectionTexts directly rather than through an updater's `prev`, which is
      // equally correct here since nothing else can change it between the last render
      // and this point (every other control on this panel is locked while a commit like
      // this one is in flight).
      const ownerIndex = subsections.findIndex((sub) => sub.some((s) => s.id === segmentId));
      if (ownerIndex !== -1) {
        const updatedOwnerSegs = subsections[ownerIndex].flatMap((s) => (s.id === segmentId ? freshSegs : [s]));
        const updatedOwnerText = rebuildScript(updatedOwnerSegs);
        const base = subsectionTexts && subsectionTexts.length === subsections.length
          ? subsectionTexts
          : subsections.map(rebuildScript);
        const updatedTexts = base.map((t, i) => (i === ownerIndex ? updatedOwnerText : t));
        setSubsectionTexts(updatedTexts);
        onScriptChange(updatedTexts.join('\n\n'));
        // Same reasoning as commitSubsectionEdit: tell the effect this subsection's
        // new true segment count directly, instead of leaving it to infer sizing
        // from box text elsewhere (see deriveSubsections' comment for why that was
        // the real bug the follow-up 23 audit's third review pass found).
        const baseSizes = subsectionSizes && subsectionSizes.length === subsections.length
          ? subsectionSizes
          : subsections.map((s) => s.length);
        setSubsectionSizes(baseSizes.map((sz, i) => (i === ownerIndex ? updatedOwnerSegs.length : sz)));
      } else {
        // Should not happen in practice (chunkBySizes always appends any leftover
        // segments as a trailing subsection rather than dropping them — see its own
        // comment), but "should not happen" is exactly the kind of assumption that
        // silently lost real work before. Guaranteed fallback: the parent still gets
        // told about this edit either way, from the definitely-correct newSegments,
        // rather than the edit only ever being saved in the lucky case.
        onScriptChange(rebuildScript(newSegments));
      }

      setSegments(newSegments);
      setSegmentAudios(newSegmentAudios);
      setEditingSegmentId(null);
      // Per Enda's follow-up 31 redesign: a saved line edit is what "an editing pass"
      // means — Mark Segment as Done must stay unavailable until the next COMPLETE
      // Build & Play pass confirms this change was actually heard.
      setEditedSinceLastListen(true);
      // Per Enda's follow-up 32 request: move the "where you left off" bookmark to
      // whichever fresh piece(s) this edit just produced — freshSegs.length is almost
      // always 1, but a narrator typing a new <break> tag into this line's own editor
      // can turn one line into several, and every piece that came out of THIS edit
      // should carry the bookmark.
      setLastEditedSegmentIds(new Set(freshSegs.map((s) => s.id)));
      // Per follow-up 40: same reasoning as commitSubsectionEdit above — request a
      // real server save now instead of leaving this edit sitting only in the
      // parent's in-memory form until Save Route happens to get clicked.
      onAutoSave?.();
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
    // Per Enda's follow-up 31 redesign: every fresh parse — the first one, or one
    // triggered by "Save & Listen Again" after an edit — starts back in the 'listen'
    // phase. listenPassCount is deliberately NOT reset here (see its declaration
    // above) — it only resets on a brand new document (TranslationPanel's onTranslated)
    // or after Mark Segment as Done finalizes, so it keeps counting across as many
    // listen/edit cycles as this pass goes through.
    setReviewPhase('listen');
    setActiveSubsectionIndex(null);
    // A fresh pass starts with a clean slate — any line's quick-edit box left open from
    // the previous pass would now be pointing at a segment id that no longer exists.
    setEditingSegmentId(null);
    // Per Enda's follow-up 32 request: this is the one place that always leads into a
    // fresh 'edit' phase visit (via a completed Build & Play pass) — clearing both here
    // means every visit starts with every line requiring a fresh listen again before
    // its pencil unlocks, and the "where you left off" bookmark from a previous pass no
    // longer applies to a document that's just been re-parsed from scratch.
    setPlayedSegmentIds(new Set());
    setLastEditedSegmentIds(new Set());
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
        const response = await withTimeout(
          base44.functions.invoke('generateTts', {
            text: seg.content,
            gender: selectedVoice,
            language_code: languageCode,
            apiKey: apiKeys.google_tts_api_key,
            ...getNarratorAuthPayload(),
          }),
          TTS_CALL_TIMEOUT_MS,
          `Generating segment ${seg.id}'s audio took too long (check your connection) — try Parse & Generate again.`
        );
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
    // A pause length nudge changes the audio just as much as a wording edit does — Mark
    // Segment as Done must wait for the next full listen pass to confirm it, same as
    // any other edit (see commitSegmentEdit above).
    setEditedSinceLastListen(true);
  };

  // Per Anoushka/Enda: playing one line's own clip (this) and the combined Build & Play
  // engine (handleBuildAndPlay, below) used to be two completely separate audio
  // pathways that never checked each other — clicking one while the other was
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
    audio.onended = () => {
      setCurrentPlayingIndex(null);
      // Per Enda's follow-up 32 request: only a full, natural completion unlocks this
      // line's own edit pencil (see playedSegmentIds above/editToggleDisabled below) —
      // starting a DIFFERENT line's clip pauses this one (just above) without ever
      // firing 'ended', so an interrupted listen correctly does not count.
      setPlayedSegmentIds((prev) => {
        const next = new Set(prev);
        next.add(segmentId);
        return next;
      });
    };
    audio.onerror = () => setCurrentPlayingIndex(null);
    audio.play().catch(() => setCurrentPlayingIndex(null));
  };

  // Per Enda's follow-up 35 report: he hit "Preview failed: Could not fetch segment 0's
  // audio (HTTP 403)" on his tour's first waypoint (the longer "get ready" script
  // recorded before the tour starts moving) and initially suspected that waypoint's
  // speed being set to 0 was the cause. It isn't — nothing in this file, TtsSegmentCard,
  // or the generateTts backend function ever reads a waypoint's speed at all, so there's
  // no code path for it to matter here. "Segment 0" is simply whichever segment
  // decodeAndBoundSegments (audioCombiner.js) happens to reach FIRST in its fetch loop —
  // it stops at the first failure, so this same message would appear even if several
  // segments' URLs had gone bad, not only the very first one. The more likely real
  // cause is ordinary staleness: segment 0 is generated earliest by
  // handleParseAndGenerate's own loop, so by the time a narrator finally clicks Build &
  // Play its own audio URL has been sitting unused the LONGEST of any segment in the
  // document — worst-case exposure to whatever invalidates a generated-audio URL over
  // time. Rather than requiring certainty about the exact mechanism, this makes the
  // whole pipeline self-healing: passed to audioCombiner.js's onRegenerateAudio option
  // (see decodeAndBoundSegments there), it re-requests fresh audio for just the one
  // segment that failed to fetch and updates segmentAudios with the new URL so the
  // caller can retry — used by both the live preview (handleBuildAndPlay below) and the
  // final save (finalizeAndSave just below), since either can hit the same stale URL.
  const regenerateSegmentAudio = async (seg) => {
    if (seg.type !== 'text' || !apiKeys.google_tts_api_key) return null;
    try {
      const languageCode = LANG_TO_CODE[selectedLanguage] || 'en-US';
      const response = await withTimeout(
        base44.functions.invoke('generateTts', {
          text: seg.content,
          gender: selectedVoice,
          language_code: languageCode,
          apiKey: apiKeys.google_tts_api_key,
          ...getNarratorAuthPayload(),
        }),
        TTS_CALL_TIMEOUT_MS,
        "Re-generating this line's audio took too long — try again."
      );
      const freshUrl = response.data?.url;
      if (!freshUrl) return null;
      setSegmentAudios((prev) => ({ ...prev, [seg.id]: freshUrl }));
      return freshUrl;
    } catch {
      // Swallowed deliberately — the caller (decodeAndBoundSegments) treats a null
      // return the same as "couldn't get a fresh URL" and falls through to its own
      // normal HTTP-status error, which is exactly what should surface to the narrator
      // if even a fresh regeneration attempt doesn't work.
      return null;
    }
  };

  // Builds the final combined file and saves it — the action behind "Mark Segment as
  // Done" (see handleMarkAsDone below). Decodes fresh here rather than reusing any
  // earlier precomputed clips, since combineSegmentsToWav already supports decoding on
  // its own perfectly well when nothing is passed.
  // Accepts optional fresh segments/segmentAudios overrides — not currently used by
  // handleMarkAsDone (Mark Segment as Done only ever appears once every edit is already
  // committed, via commitSegmentEdit or the "Save This Part" button, so component state
  // is always current by then), but left in place in case a future caller ever needs to
  // finalize data it just committed a moment before component state would reflect it —
  // state set via setSegments/setSegmentAudios doesn't necessarily flush/re-render
  // before the very next line runs.
  const finalizeAndSave = async (segmentsOverride, segmentAudiosOverride) => {
    const segsToUse = segmentsOverride || segments;
    const audiosToUse = segmentAudiosOverride || segmentAudios;
    setGeneratingCombined(true);
    addLog('Rendering combined audio file…');
    try {
      const wavBlob = await combineSegmentsToWav(segsToUse, audiosToUse, undefined, { onRegenerateAudio: regenerateSegmentAudio });
      addLog(`Combined audio rendered (${(wavBlob.size / 1024 / 1024).toFixed(2)} MB). Uploading…`);
      const audioBase64 = await blobToBase64(wavBlob);
      // A longer ceiling than the per-line/per-segment calls above — this uploads the
      // WHOLE combined file in one request, which can legitimately take a while longer
      // on a slow connection, but must still have SOME limit rather than none at all.
      const response = await withTimeout(
        base44.functions.invoke('uploadNarrationAudio', {
          audioBase64,
          mimeType: 'audio/wav',
          filename: `narration_${Date.now()}.wav`,
          ...getNarratorAuthPayload(),
        }),
        TTS_CALL_TIMEOUT_MS * 2,
        'Uploading the combined audio took too long (check your connection) — nothing has been lost, just try again.'
      );
      if (response.data?.url) {
        onAudioChange(response.data.url);
        addLog('Combined audio saved.');
        // Per Enda: once Mark Segment as Done has saved this pass, the editor goes back
        // to the beginning — segments/audio cleared so "Parse & Generate" has to be
        // clicked again to start a fresh pass over the (possibly just-edited) script.
        // Only done on a successful save, so a failed upload doesn't lose the
        // segments/audio the narrator would otherwise have to regenerate from scratch.
        // listenPassCount/editedSinceLastListen reset here too — the NEXT segment (or a
        // fresh pass on this one) starts its own review cycle from zero, exactly like a
        // brand new import/translate does (see TranslationPanel's onTranslated below).
        setSegments(null);
        setSegmentAudios({});
        setReviewPhase('listen');
        setListenPassCount(0);
        setEditedSinceLastListen(false);
        setEditingSegmentId(null);
        setPlayedSegmentIds(new Set());
        setLastEditedSegmentIds(new Set());
        // Per follow-up 40: Mark Segment as Done finalizes the combined audio for this
        // waypoint — request a real server save now, same as the other commit paths.
        onAutoSave?.();
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

  // Plays the WHOLE document, subsection by subsection, automatically chained with no
  // pause for editing between parts — this is the entire "listen" phase (see
  // reviewPhase above). Per Enda's follow-up 31 redesign: a Build & Play pass is now
  // meant to be a single, complete, uninterrupted listen from start to finish, with
  // absolutely nothing else clickable while it runs (see the render below — no segment
  // cards, no edit boxes are even shown during 'listen'), so there's no more reason to
  // stop between subsections the way the old per-subsection Continue button did.
  //
  // Only counts as a genuine, complete pass — incrementing listenPassCount and moving
  // the panel into 'edit' phase — if it plays every subsection through to the end
  // without the narrator clicking Stop and without an error along the way. A stopped or
  // failed pass leaves reviewPhase alone (still 'listen'), ready to press Build & Play
  // again from the top.
  const handleBuildAndPlay = async () => {
    if (reviewPhase !== 'listen' || passLocked || generatingCombined || !hasSegmentAudios || !subsections.length) return;

    // See the comment on playSegment above — a lingering single-line preview clip
    // doesn't touch `playing`, so it wouldn't otherwise be stopped just because this
    // combined playback is about to start.
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
      setCurrentPlayingIndex(null);
    }

    stopRef.current = false;
    setPlaying(true);
    setError('');
    let interrupted = false;

    for (let i = 0; i < subsections.length; i++) {
      setActiveSubsectionIndex(i);
      const targetSegments = subsections[i];
      let playback = null;
      try {
        // Per Enda: this used to be able to hang completely (a stalled fetch inside
        // playSegmentsPrecisely, fixed at the source in audioCombiner.js) — every
        // control on this panel gates on `playing`, which stayed stuck true forever
        // with nothing to click and no error. withTimeout() is a second, general-
        // purpose safety net here (on top of that source fix) so ANY unexpected hang
        // in this step still surfaces a clear, recoverable error instead of freezing
        // the panel again.
        playback = await withTimeout(
          playSegmentsPrecisely(targetSegments, segmentAudios, { onRegenerateAudio: regenerateSegmentAudio }),
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
        // If we got as far as having a real `playback` (i.e. this was the
        // "playback.done took too long" timeout, not a failure to even start), its
        // audio sources may still be physically scheduled/playing even though we've
        // given up waiting on them — stop() cuts them off and closes the
        // AudioContext, so a timeout doesn't leave stray audio running behind an
        // editor that now thinks nothing is playing.
        if (playback) { try { playback.stop(); } catch { /* already stopped */ } }
        const msg = getFnErrorMessage(err);
        addLog(`Preview ERROR: ${msg}`);
        setError(`Preview failed: ${msg}`);
        interrupted = true;
      }
      currentPlaybackRef.current = null;
      if (stopRef.current || interrupted) {
        interrupted = true;
        break;
      }
    }

    setPlaying(false);
    setActiveSubsectionIndex(null);

    if (stopRef.current) {
      stopRef.current = false;
      return; // stopped early — no pass credit, stay in 'listen', ready to try again
    }
    if (interrupted) return; // errored mid-way — same, no credit

    // A full, uninterrupted pass just finished. Per Enda: "when they are happy, then,
    // and only then can they declare the segment as done" — this is the moment that
    // becomes possible (see listenPassCount/editedSinceLastListen above for the exact
    // eligibility rule), and the panel switches into 'edit' phase, unlocking every
    // line's own play/edit control and every subsection's own script box.
    setListenPassCount((n) => n + 1);
    setEditedSinceLastListen(false);
    setReviewPhase('edit');
  };

  // Ends the 'edit' phase: whatever's currently typed into any subsection's script box
  // (or the top box) is already the live `script` value (see handleScriptEdit/
  // handleSubsectionScriptEdit — typing there always keeps it in sync, exactly like the
  // top box already worked before this redesign), so this simply re-runs the same
  // Parse & Generate pass as the manual button does: fresh ids, fresh audio for every
  // segment, and back to the 'listen' phase — Enda: "every Save and finish must be
  // followed by a new Parse and Generate, and the Build and Play". Deliberately reuses
  // handleParseAndGenerate itself rather than a separate implementation, so this always
  // behaves identically to a manual re-parse — and deliberately does NOT reset
  // listenPassCount (handleParseAndGenerate no longer does that itself either), so
  // repeating this as many times as the narrator wants keeps counting toward Mark
  // Segment as Done's 2-pass requirement.
  const handleSaveAndListenAgain = async () => {
    if (passLocked) return;
    await handleParseAndGenerate();
  };

  // The actual finalize action — renders the combined file, uploads it, and resets the
  // panel (see finalizeAndSave above). Per Enda: only reachable once a full listen pass
  // has confirmed the CURRENT state was actually heard — see the render below for
  // exactly when the button itself is shown; this guard is defense in depth, the same
  // pattern every other action on this panel already follows.
  const handleMarkAsDone = async () => {
    if (passLocked || reviewPhase !== 'edit' || listenPassCount < 2 || editedSinceLastListen) return;
    await finalizeAndSave();
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
  // panel — combined playback, a whole-subsection "Save This Part" commit, the final
  // render/upload, a single line's own quick-edit save (see commitSegmentEdit above),
  // or Parse & Generate's own initial generation loop. Used to disable everything else
  // while any one of them is in flight, so two of these can never race each other or
  // overlap their audio.
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
  // Generate, Build & Play, Save & Listen Again, Mark Segment as Done) and the
  // per-subsection edit box. Without this, an open-but-unsaved per-line edit could be
  // silently discarded or desynced by one of those (full audit in CLAUDE_CHANGELOG.md
  // follow-up 23). Deliberately kept SEPARATE from `busy` rather than folded into it:
  // `busy` also drives a card's own Play button and its pause Slider, and there's no
  // reason listening to (or nudging the duration of) a DIFFERENT line should be
  // blocked just because one line's own quick editor happens to be open elsewhere.
  // Per Enda's report: this whole panel had no concept of the waypoint's own Done
  // status (wp.waypoint_done, the same flag the Waypoints tab already locks editing
  // on) — a Done waypoint's script/audio could still be freely rewritten from here.
  // doneLocked is passed in from TourSimulator.jsx (the only caller) and is folded
  // directly into passLocked/editingLocked/topScriptLocked below — the three master
  // locks nearly every mutating control on this panel already keys off — rather than
  // added as a one-off check on individual fields, so nothing here can slip through
  // a control this audit didn't happen to touch by name.
  const passLocked = doneLocked || busy || editingSegmentId !== null;

  // Per Enda's follow-up 31 redesign: separate listening and per-line/per-subsection
  // editing are two alternating MODES, never available together — "when it is running
  // through a Build and Play pass, the ability to listen and edit a single sub segment
  // must be disabled. When doing a editing pass, it must obviously be enabled." Covers
  // BOTH the "actively playing" sub-state and the "parsed but Build & Play not clicked
  // yet" sub-state uniformly — both are still the 'listen' phase.
  const editingLocked = doneLocked || reviewPhase !== 'edit';

  // Per Enda's follow-up 31 redesign: covers the top script textarea and its "Insert
  // pause" quick-insert buttons — the ones editingLocked alone can't gate, because
  // editingLocked defaults to true (reviewPhase starts as 'listen') even before any
  // segments exist, and that box has to stay usable for the very first import/write.
  // Locked only once a pass is actually active (segments exist) and it isn't the
  // 'edit' phase yet, or whenever something else on the panel is busy.
  //
  // Per Enda's immediate follow-up to follow-up 75: hiding this box once a pass
  // exists (showTopScriptBox above) wasn't the whole fix — for a translation clone
  // it's still visible AND directly editable before that first Parse & Generate, and
  // 100% of a Narrator's legitimate text ever arrives here programmatically, via
  // TranslationPanel's "Translate & Load" (onTranslated below) — never by typing
  // into this box by hand. So for a clone (fixedLanguage set) it's locked
  // unconditionally, at every stage it's ever shown, not just once a pass exists —
  // still visible so the imported text can be checked by eye, never something a
  // Narrator can pre-emptively rewrite before ever listening to it. Unchanged for an
  // Admin authoring an original master script (fixedLanguage unset) — this remains
  // their only way to write or fix that text at all.
  const topScriptLocked = doneLocked || busy || (!!segments && editingLocked) || !!fixedLanguage;

  // Per Enda (relaying Anoushka, follow-up 75): "if she is given the opportunity to
  // take a shortcut, temptation will at some stage strike" — the per-line and
  // per-subsection listen-before-edit gates below already force a narrator to hear
  // each part before touching it, but topScriptLocked alone still leaves this box
  // itself sitting there, unlocking for the WHOLE document the instant reviewPhase
  // reaches 'edit' — a narrator could rewrite anything through it without listening
  // to any individual part again, defeating every one of those gates at once. Per
  // Enda: this box "should really not be there, and should certainly not be
  // editable" once that's possible — not just disabled, gone entirely — so a
  // narrator is never shown an edit surface that bypasses listening.
  //
  // Scoped to a translation clone specifically (fixedLanguage is only ever set for
  // one — see its own declaration above) rather than removing this box everywhere:
  // for an Admin writing an original master script from scratch there is no import
  // to substitute for it — this box is the only place to write or fix that text at
  // all, and Enda's report here is specifically about a Narrator's temptation to
  // shortcut translation review, not about changing how Admins draft their own
  // scripts. Still shown, unchanged, for the very first pass in EITHER case (no
  // segments yet) — that's the only way imported/typed text ever reaches this panel
  // in the first place, clone or not.
  const showTopScriptBox = !segments || !fixedLanguage;

  // Per Enda: "the ability to declare a segment as Done should only appear after a full
  // Build a play procedure, never after and editing pass" and "must never appear after
  // the first Build and Play pass". listenPassCount only ever increments on a complete,
  // uninterrupted pass (see handleBuildAndPlay above); editedSinceLastListen flips back
  // to true the instant anything is actually changed (a saved line/part edit, or a
  // duration nudge) and only clears on the NEXT complete pass — so this is true for
  // exactly the narrow window Enda described: right after listening, before any further
  // edit.
  const canMarkAsDone = reviewPhase === 'edit' && listenPassCount >= 2 && !editedSinceLastListen;

  // Per Enda's follow-up 33 report: handleParseAndGenerate's own per-line TTS loop sets
  // this while it's still working through the document — the Build & Play button stays
  // disabled the whole time (via passLocked/busy above), but with nothing SAYING so it
  // just looked stuck rather than working. Drives both the explanatory text and the
  // button's own label/spinner in the 'listen' phase box below.
  const stillGeneratingAudio = generatingSegmentId !== null;

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
          // A brand new document — its own review cycle starts from zero, same as
          // after Mark Segment as Done finalizes (see finalizeAndSave above).
          setReviewPhase('listen');
          setListenPassCount(0);
          setEditedSinceLastListen(false);
          setEditingSegmentId(null);
          setPlayedSegmentIds(new Set());
          setLastEditedSegmentIds(new Set());
          // Per Enda's follow-up 34 report: scroll "Parse & Generate" into view — see
          // justImportedTick/parseGenerateRef above.
          setJustImportedTick((n) => n + 1);
        }}
        fixedLanguage={fixedLanguage}
        waypointSegmentId={waypointSegmentId}
        waypointSegmentTitle={waypointSegmentTitle}
        // Per the follow-up 23 audit's fourth review pass: this panel's own
        // Import/Translate & Load controls used to be completely ungated by
        // anything happening below — a narrator could fire a translation reset
        // while a Save This Part/per-line save was still mid-flight awaiting its
        // own TTS call, and that commit's stale pre-reset closure would resurrect
        // the old document on top of the fresh reset once it resolved, discarding
        // the translation and any other unrelated draft.
        // Locked the same way every other segments-mutating control here is.
        disabled={passLocked}
      />

      {/* Insert break tags at cursor, and the top script textarea itself, just below.
          Per Enda (follow-up 75): for a translation clone, once a pass exists, this
          whole block disappears rather than merely locking — see showTopScriptBox
          above. Still shown for the very first pass (no segments yet) either way, and
          always shown for an Admin's own master-script authoring (no fixedLanguage) —
          only a Narrator reviewing a translation loses it, and only once there's
          something to listen to first. */}
      {showTopScriptBox && (
        <>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-slate-500">Insert pause:</span>
            {/* 0.1s — a mid-sentence pause is often much shorter than half a second; 0.5s
                alone made that impossible to express with a quick-insert button. */}
            <Button type="button" size="sm" variant="ghost"
              onClick={() => insertBreakTag('<break time="0.1s"/>')}
              disabled={topScriptLocked}
              className="text-slate-400 hover:text-slate-200 h-7 px-2 text-xs gap-1">
              <Pause className="w-3 h-3" /> 0.1s
            </Button>
            <Button type="button" size="sm" variant="ghost"
              onClick={() => insertBreakTag('<break time="0.5s"/>')}
              disabled={topScriptLocked}
              className="text-slate-400 hover:text-slate-200 h-7 px-2 text-xs gap-1">
              <Pause className="w-3 h-3" /> 0.5s (default)
            </Button>
            {[1, 2, 3].map((s) => (
              <Button key={s} type="button" size="sm" variant="ghost"
                onClick={() => insertBreakTag(`<break time="${s}s"/>`)}
                disabled={topScriptLocked}
                className="text-slate-400 hover:text-slate-200 h-7 px-2 text-xs gap-1">
                <Pause className="w-3 h-3" /> {s}s
              </Button>
            ))}
          </div>

          {/* Editable script textarea — same pastel yellow as every duplicate copy further
              down (per Enda: every editable script box must look identical, so it's never
              ambiguous which boxes on this panel are text you can type into). Per Enda's
              follow-up 31 redesign: "no edits possible" during a listen pass has to cover
              THIS box too, not just the per-line/per-subsection controls further down —
              without locking it, a narrator could still freely rewrite the raw script here
              while Build & Play is running (or before it's even been clicked), which is
              exactly the kind of edit-without-listening the whole redesign exists to
              prevent. Locked (topScriptLocked, see below) whenever a pass is active
              (segments exist) and reviewPhase isn't 'edit' yet, or whenever anything else
              on the panel is busy — but deliberately NOT locked before the very first Parse
              & Generate (no segments yet), since that's the only way to import/write the
              script in the first place. */}
          <div>
            <Textarea
              ref={textareaRef}
              value={script || ''}
              onChange={handleScriptEdit}
              placeholder={'Import a script file or write here...\n\nUse <break time="2s"/> for pauses.'}
              rows={6}
              disabled={topScriptLocked}
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
        </>
      )}

      {/* Voice + Language */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-slate-400 text-xs mb-1 block">Voice (Google)</Label>
          {/*
            Per the follow-up 23 audit's fifth review pass: this used to be changeable
            at ANY time, including mid-pass — every Save-this-line/Save This Part click
            reads selectedVoice fresh at the moment it fires, so switching voices
            partway through working down a long document (an entirely ordinary thing to
            do between edit rounds, with nothing else on the panel stopping it) silently
            produced ONE saved narration mixing two different voices, with no warning
            at all. Locked to whatever was chosen before the pass started (Parse &
            Generate) until it finishes (Mark Segment as Done) or is abandoned (segments
            reset) — exactly like the Language picker already is for a translation clone
            via fixedLanguage, just for the ordinary non-clone case too.
          */}
          <Select value={selectedVoice} onValueChange={setSelectedVoice} disabled={!!segments}>
            <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-8 text-sm" title={segments ? 'Set for this pass when Parse & Generate was clicked — Finalize Narration Audio (or start a fresh pass) to change it.' : undefined}>
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
              <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-8 text-sm" title={segments ? 'Set for this pass when Parse & Generate was clicked — Finalize Narration Audio (or start a fresh pass) to change it.' : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => <SelectItem key={lang} value={lang}>{lang}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Parse & Generate — only shown before the very first pass. Once segments exist,
          Save & Listen Again (further down, in 'edit' phase) is the one and only way to
          re-parse — see the comment on handleSaveAndListenAgain above for why showing
          both at once would just be two confusing paths to a similar-but-different
          action. ref={parseGenerateRef} pairs with the scroll effect above — per
          Enda's follow-up 34 report, this button sits below the fold on most screens
          (past the pause-insert row, the big script box, and the Voice/Language
          pickers), so a narrator had to scroll down themselves to find it after
          importing a file. */}
      {!segments && (
        <div ref={parseGenerateRef}>
          <Button
            type="button"
            onClick={() => {
              setListenPassCount(0);
              handleParseAndGenerate();
            }}
            disabled={generatingSegmentId !== null || overLimit || !script?.trim() || passLocked}
            className="w-full bg-purple-600 hover:bg-purple-700 gap-2 text-white"
          >
            {generatingSegmentId !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Braces className="w-4 h-4" />}
            {generatingSegmentId !== null ? 'Generating…' : 'Parse & Generate'}
          </Button>
        </div>
      )}

      {error && (
        <div ref={errorRef} className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Per Enda's follow-up 31 redesign: a script written "for the ear, not the eye"
          means a narrator must be forced to actually listen, so listening and editing
          are two alternating MODES (see reviewPhase above), never available together.
          'listen': ONLY the whole-document Build & Play control below is shown — no
          segment cards, no edit boxes, nothing else to click. A complete, uninterrupted
          pass through every subsection is what unlocks 'edit': every line's own
          play/edit control and every subsection's own script box, but Build & Play
          itself is gone — the only way to hear the result of an edit is to finish
          editing (Save & Listen Again) and go listen again. Mark Segment as Done only
          ever appears in 'edit' phase, and only in the narrow window right after a
          pass completes, before anything is changed again — see canMarkAsDone above. */}
      {segments && subsections.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
            <span>{countCharacters(segments)} characters</span>
            <span>·</span>
            <span>{countBreaks(segments)} breaks detected</span>
            <span className="text-slate-600">Use &lt;break time="Xs"/&gt; for pauses</span>
          </div>

          {reviewPhase === 'listen' ? (
            // LISTEN PHASE — the whole point is that nothing else is even shown here:
            // no segment cards, no edit boxes, nothing to click but Build & Play/Stop.
            // Per Enda's follow-up 33 report: Anoushka clicked Build & Play repeatedly
            // while it was still disabled (audio still generating for every line — see
            // stillGeneratingAudio below) because nothing on screen told her to wait, or
            // made the button itself look any different than when it was actually
            // ready — by the time it "showed in full colour" she was already annoyed.
            // ref={listenBoxRef} pairs with the scroll effect above, so this box comes
            // into view on its own the moment a fresh parse starts.
            <div ref={listenBoxRef} className="bg-slate-800/50 rounded-lg border border-purple-600/30 p-4 space-y-3">
              <p className="text-sm text-slate-300 text-center">
                {stillGeneratingAudio
                  ? "Still generating audio for every line — the Build & Play button below will light up and become clickable the moment it's ready. Clicking it before then won't do anything, so there's no need to keep clicking it."
                  : listenPassCount === 0
                    ? "Listen to the whole part, start to finish, before you can make any changes."
                    : "Listen to your edits, start to finish, before you can edit again."}
              </p>
              {playing ? (
                <>
                  <p className="text-xs text-purple-300 text-center">
                    Playing part {(activeSubsectionIndex ?? 0) + 1} of {subsections.length}…
                  </p>
                  <Button type="button" onClick={handleStopPlay} className="w-full bg-red-600 hover:bg-red-700 gap-2 text-white">
                    <Square className="w-4 h-4" /> Stop
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  onClick={handleBuildAndPlay}
                  disabled={passLocked || !hasSegmentAudios}
                  className="w-full bg-purple-600 hover:bg-purple-700 gap-2 text-white"
                >
                  {stillGeneratingAudio ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Generating audio…
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" /> Build & Play
                    </>
                  )}
                </Button>
              )}
            </div>
          ) : (
            // EDIT PHASE — every line's own play/edit control and every subsection's
            // own script box are unlocked; Build & Play itself is gone (see the comment
            // block above this whole section for the full reasoning).
            <>
              {canMarkAsDone && (
                <div className="bg-emerald-900/20 border border-emerald-600/40 rounded-lg p-3 space-y-2 text-center">
                  <p className="text-sm text-emerald-300 flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> You've listened all the way through — happy with it?
                  </p>
                  <Button
                    type="button"
                    onClick={handleMarkAsDone}
                    disabled={passLocked}
                    // Per Enda's follow-up 42 report: this used to share the exact same
                    // classes, icon, and near-identical wording ("Mark Segment as Done")
                    // as the unrelated "Mark Waypoint as Done" button (waypoint checklist
                    // flag) — impossible to tell apart at a glance, and that's exactly
                    // what led him to believe this button was checking the Waypoints tab
                    // box when it never did. Deliberately different color family (emerald,
                    // matching this box's own "you've listened through" styling above) so
                    // the two are never visually confusable again.
                    className="w-full bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-600/50 text-emerald-300 hover:text-emerald-200 gap-2"
                  >
                    {generatingCombined ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {generatingCombined ? 'Finalizing…' : 'Finalize Narration Audio'}
                  </Button>
                  <p className="text-xs text-emerald-400/70">Not happy yet? Just make your changes below instead.</p>
                </div>
              )}

              {subsections.map((subsectionSegments, si) => {
                const isCommittingThis = committingIndex === si;
                const partHasDraft = subsectionTexts?.[si] !== undefined && subsectionTexts[si] !== rebuildScript(subsectionSegments);

                return (
                  <div key={`subsection-${si}`} className="space-y-2 pt-2 border-t border-slate-700/60 first:border-t-0 first:pt-0">
                    {subsectionSegments.map((seg) => {
                      const globalIdx = segments.findIndex((s) => s.id === seg.id);
                      // Per Enda's follow-up 32 request: a text line's own pencil must
                      // stay locked until ITS OWN clip has been played through in full
                      // this pass — see playedSegmentIds above. A pause has no pencil
                      // at all (onToggleEdit is only ever passed for text segments), so
                      // this is meaningless for one and left false.
                      const needsListenBeforeEdit = seg.type === 'text' && !playedSegmentIds.has(seg.id);
                      const isLastEdited = lastEditedSegmentIds.has(seg.id);
                      return (
                        <TtsSegmentCard
                          key={seg.id}
                          segment={seg}
                          audioUrl={segmentAudios[seg.id]}
                          isGenerating={generatingSegmentId === seg.id}
                          isPlaying={currentPlayingIndex === globalIdx}
                          onPlay={playSegment}
                          onDurationChange={handleDurationChange}
                          controlsDisabled={busy || editingLocked}
                          isEditing={editingSegmentId === seg.id}
                          editValue={editingSegmentId === seg.id ? segmentEditText : ''}
                          onEditChange={setSegmentEditText}
                          onToggleEdit={seg.type === 'text' ? () => handleToggleSegmentEdit(seg) : undefined}
                          needsListenBeforeEdit={needsListenBeforeEdit}
                          isLastEdited={isLastEdited}
                          // Per the follow-up 23 audit (Bug C): opening a DIFFERENT
                          // line's editor while this one is still open used to
                          // silently discard whatever was typed here, with no warning
                          // at all. Blocked at the source instead of just documented —
                          // every card but the one currently open (isEditing handles
                          // that one via TtsSegmentCard's own logic) is locked out of
                          // opening a new editor while editingSegmentId already points
                          // elsewhere.
                          //
                          // Also blocked (symmetric with the per-subsection Textarea's
                          // own lock further below) whenever THIS subsection's own
                          // combined box already has an uncommitted draft sitting in
                          // it — typed before this editor was ever opened, not just
                          // during. Saving a per-line edit refreshes its owning
                          // subsection's box to the new ground truth (see
                          // commitSegmentEdit above); doing that while an unrelated
                          // manual draft is already sitting there would silently
                          // discard it, so opening the per-line editor at all is
                          // refused until that draft is saved (via "Save This Part"
                          // below) or cleared first.
                          //
                          // Also refused (needsListenBeforeEdit, follow-up 32) until
                          // THIS line's own clip has been played through in full this
                          // pass — every single time, not just the first — see
                          // playedSegmentIds above.
                          editToggleDisabled={
                            busy
                            || editingLocked
                            || (editingSegmentId !== null && editingSegmentId !== seg.id)
                            || partHasDraft
                            || needsListenBeforeEdit
                          }
                          onCancelEdit={handleCancelSegmentEdit}
                          onSaveEdit={() => commitSegmentEdit(seg.id)}
                          isSavingEdit={savingSegmentId === seg.id}
                        />
                      );
                    })}

                    {/* Per-subsection editable script box — shows and edits ONLY this
                        block's own text (see subsectionTexts/handleSubsectionScriptEdit
                        above), not the whole document, so it's never necessary to
                        scroll through everything else to find the right passage. Per
                        Enda's follow-up 31 redesign: this box's typed text, like the
                        top script box, takes effect the next time a full reparse runs
                        ("Save & Listen Again" below) — "Save This Part" is a pure
                        convenience that regenerates just this part's own audio early,
                        so its lines can be previewed via their own ▶ Play buttons
                        without waiting for the next full listen pass. Deliberately
                        styled unlike the dark narration cards around it (a muted
                        pastel yellow with black text) so it reads clearly as an
                        editing tool wedged into the list, not another narration
                        block. */}
                    <div>
                      <Label className="text-amber-200/80 text-xs mb-1 block">Edit this part's script</Label>
                      <Textarea
                        value={subsectionTexts?.[si] ?? rebuildScript(subsectionSegments)}
                        onChange={(e) => handleSubsectionScriptEdit(si, e.target.value)}
                        rows={4}
                        // Per the follow-up 23 audit (Bug B): typing into this box
                        // while ITS OWN "Save This Part" (or any other commit/save/
                        // render) is already in flight used to go unseen by that
                        // in-flight commit (which captured this box's text the moment
                        // it started) but WOULD still feed the [segments] effect's
                        // re-derivation once that commit finished — sizing this
                        // subsection using text that was never actually the text sent
                        // to TTS. Locked for the same window everything else on the
                        // panel already locks for — and, per the follow-up 31
                        // redesign, for the whole 'listen' phase too.
                        //
                        // Also locked (Bug B's narrower sibling) whenever one of THIS
                        // subsection's own segments has its per-line quick editor
                        // open — without this, typing here while that per-line save
                        // lands would get silently discarded the moment its commit
                        // refreshes this same box from the newly-true segments (see
                        // the [segments] effect above). A DIFFERENT subsection's box
                        // is untouched by this check — only the one that actually
                        // owns the open editor locks.
                        disabled={busy || editingLocked || subsectionSegments.some((s) => s.id === editingSegmentId)}
                        className="bg-amber-100 border-amber-300 text-black placeholder:text-amber-900/50 text-sm font-mono resize-y focus-visible:ring-amber-400"
                      />
                      {/* Per Enda's follow-up 26 report: this box going grey with no
                          explanation read as "stuck" — it's actually locked for a real
                          reason (a line inside it has its own quick editor open right
                          now; typing here while that line's save lands would get
                          silently thrown away), but with nothing on screen saying so,
                          closing that one line's editor felt like the only way to find
                          out why, and it wasn't obvious that was even what was
                          happening. Spelling it out here instead of just going quiet —
                          this box unlocks the moment that line's own editor is closed
                          or saved, no page action needed. */}
                      {!busy && subsectionSegments.some((s) => s.id === editingSegmentId) && (
                        <p className="text-xs text-amber-500/80 mt-1">
                          Locked while one of this part's own lines has its own editor open above — close or save that line first.
                        </p>
                      )}
                      {partHasDraft && (
                        <div className="flex justify-end mt-1.5">
                          <button
                            type="button"
                            onClick={() => handleSaveSubsectionPart(si)}
                            disabled={passLocked}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/50 text-amber-400 hover:text-amber-300 disabled:opacity-40 transition-colors"
                          >
                            {isCommittingThis ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                            {isCommittingThis ? 'Saving…' : 'Save This Part (preview before listening again)'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="flex gap-2 items-center pt-2 border-t border-slate-700/60">
                <Button
                  type="button"
                  onClick={handleSaveAndListenAgain}
                  disabled={passLocked}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 gap-2 text-white"
                >
                  {generatingSegmentId !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  {generatingSegmentId !== null ? 'Generating…' : 'Save & Listen Again'}
                </Button>
                <Button
                  type="button" variant="outline"
                  onClick={handleDownload}
                  disabled={!hasSegmentAudios || busy}
                  className="border-slate-500 text-slate-300 gap-2"
                >
                  <Download className="w-4 h-4" /> Download
                </Button>
              </div>
            </>
          )}
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
            To change this: edit the script above and click <strong>Parse &amp; Generate</strong>, then
            <strong> Build &amp; Play</strong> — listen to the whole thing, start to finish. Only once that
            complete pass finishes do you get access to each line's own play/edit controls and every part's
            own script box; make your changes, then <strong>Save &amp; Listen Again</strong> to hear them
            together in context before you can edit further. Repeat as many times as you like — once
            you've listened straight through at least twice with nothing left unheard,{' '}
            <strong>Finalize Narration Audio</strong> saves the new version. No need to leave this screen.
          </p>
          <p className="text-xs text-slate-500">
            This deliberately forces a listen between every round of edits — a script has to sound right
            to the EAR, not just read right on screen, so every change gets heard in context before it can
            be called finished. The same idea applies to a single line: its own pencil stays locked until
            that line's own clip has just been played through in full, every time, however many times
            you've edited it before.
          </p>
        </div>
      )}
    </div>
  );
}
