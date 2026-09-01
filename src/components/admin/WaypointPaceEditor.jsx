import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Loader2, Play, Save, AlertTriangle, Clock, Trash2, X, Check, BookOpen } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { getNarratorAuthPayload, useNarratorApiKeys } from '@/lib/useNarratorApiKeys';
import { parseScript, rebuildScript } from '@/lib/ttsParser';
import { combineSegmentsToWav, blobToBase64 } from '@/lib/audioCombiner';
import { getFnErrorMessage, withTimeout } from '@/lib/utils';
import PronunciationDictionaryDialog from './PronunciationDictionaryDialog';

// Kept as its own small copy rather than importing NarrationTtsEditor's own
// LANG_TO_CODE (not exported, and this component is deliberately self-contained —
// see the file comment below for why it doesn't reach into that file at all).
const LANG_TO_CODE = {
  English: 'en-US', Dutch: 'nl-NL', Czech: 'cs-CZ', German: 'de-DE',
  French: 'fr-FR', Italian: 'it-IT', Arabic: 'ar-XA', Hebrew: 'he-IL',
  Polish: 'pl-PL', Spanish: 'es-ES', Portuguese: 'pt-PT', Turkish: 'tr-TR',
  Russian: 'ru-RU', Hungarian: 'hu-HU',
};

const TTS_CALL_TIMEOUT_MS = 30000;
// Voice is fixed rather than offered as a picker — per Enda, this screen is scoped to
// wording and pause timing (see the file comment below), nothing about voice/language.
// Nothing about a waypoint's originally-chosen voice/gender is persisted anywhere once
// its audio has been finalized (see NarrationTtsEditor's finalizeAndSave — only the
// combined file survives), so there is no real "original" value to default to here
// either way.
const VOICE = 'NEUTRAL';

/**
 * Per Enda: the old "Waypoint Audio & Break Tags" panel embedded the FULL Narration
 * Script & TTS editor right here beside the map — import/translate, voice/language
 * pickers, per-line wording edits, the whole Parse & Generate / Build & Play / Mark as
 * Done review cycle. That's the same tool used to WRITE a waypoint's script in the
 * first place (Waypoints tab). By the time a narrator is here, tuning a waypoint's
 * timing against a real drive, the wording is already final — "that should have
 * happened in the first editing session" — the only thing left to adjust is how long
 * each pause between lines runs, against how long the real drive to the next waypoint
 * actually takes. The full wording editor gave far more controls than this task needs,
 * and — per Enda's report — no real way to see the pause sliders and the driving time
 * to compare them against side by side with a leg-scoped map at all.
 *
 * This is that purpose-built replacement. It shows the waypoint's own script, broken
 * into its text/pause pieces exactly like NarrationTtsEditor already does elsewhere
 * (parseScript) — no import, no translate, no voice/language picker. A pause's own
 * duration slider is adjustable, same as always.
 *
 * Per Anoushka (relayed by Enda, follow-up 77), each text piece is ALSO directly
 * editable here now — the one deliberate reversal of this file's original "wording is
 * already final by the time you reach this screen" design (see the still-true
 * reasoning about pause timing above). Her observation: for some languages (she
 * narrates Czech), the same meaning and speech cadence can often be said in far fewer
 * words — matching a subsegment's speech against the real driving time it has to fit
 * is frequently better solved by shortening the WORDING than by only stretching or
 * shrinking pauses, and doing that right here, immediately re-testable via "Test this
 * subsegment", is far more useful than having to go back to the Waypoints tab, edit
 * blind, and return to re-check the timing.
 *
 * Editing a segment's text immediately clears ITS OWN cached audio (handleTextChange
 * below) — that cached clip was generated for whatever the wording used to be, and
 * combining it against the new text on screen would produce a real mismatch between
 * what's heard and what's written, completely silently. handleTest/handleSave both
 * run through ensureFreshSegmentAudio first, which regenerates real TTS audio for
 * every text segment missing from segmentAudios (precisely the ones just edited, and
 * only those) before ever combining anything, so a stale clip can never be used by
 * accident, on either action. Pause segments are untouched by any of this — only text
 * segments ever have cached audio to invalidate in the first place.
 *
 * Audio for the (initially unedited) text pieces is regenerated automatically the
 * moment a waypoint is opened here — a mechanical necessity: only the FINAL combined
 * file is ever persisted anywhere (see NarrationTtsEditor's own finalizeAndSave), so
 * there is no already-generated per-line audio left over from the original writing
 * session to reuse. Deliberately self-contained rather than sharing NarrationTtsEditor's
 * own state machine — that file has been through 30+ rounds of careful, narrow bug
 * fixes around its own listen/edit-phase locking, none of which is relevant to this
 * screen's much smaller, single-waypoint scope.
 *
 * "Test this subsegment" (rename of the old "Test this waypoint") builds a LIVE
 * preview — combining the current, possibly-still-unsaved wording/pause durations with
 * fresh, text-accurate line audio into one WAV, entirely in-browser
 * (combineSegmentsToWav, the exact same renderer NarrationTtsEditor's own Mark Segment
 * as Done uses) — and hands its object URL up to the parent (onTestSubsegment), which
 * plays it through the Simulator's own proven drive/geofence engine via
 * jumpToWaypoint's audioOverrideUrl, scoped to just this waypoint's own leg. Nothing is
 * saved by testing — repeatable as many times as it takes, including after editing
 * text. "Save changes" renders the same combined file again, uploads it for real
 * (uploadNarrationAudio — the exact same call finalizeAndSave uses), and only THEN
 * calls onSave with the real, uploaded URL plus the updated script text (so the new
 * wording and pause durations are both reflected in narration_script, not just the
 * audio) — followed immediately by onAutoSave(), so this is a real save, not something
 * sitting only in memory until Save Route happens to be clicked separately.
 *
 * doneLocked (per Enda's report): true whenever this waypoint is marked Done — the
 * same wp.waypoint_done the Waypoints tab already locks on. Before this, nothing here
 * checked it at all, so a "finished" waypoint's wording, pause timing, and audio could
 * still be silently rewritten from this screen with no unlock step. Disables every
 * mutating control below (text/pause edits, Save) the same way TourSimulator.jsx
 * (this component's only caller) already disables the Waypoints tab's own fields —
 * the actual unlock action (persisted untick of waypoint_done) lives up there, shared
 * with NarrationTtsEditor, since both editors sit under the same waypoint picker.
 * "Test this subsegment" deliberately stays available regardless — it only builds an
 * in-browser preview and never saves anything, same reasoning as leaving read-only
 * actions like Download unlocked elsewhere in this codebase.
 */
export default function WaypointPaceEditor({ waypoint, fixedLanguage, onSave, onAutoSave, onTestSubsegment, testDisabled, testDisabledReason, doneLocked = false }) {
  // Per Enda's report (follow-up 59): this panel opened straight to "No Google TTS API
  // key found for your account yet" even with a real key saved. Follow-up 59 fixed the
  // FIRST cause (reading the key before its own async fetch had resolved at all — see
  // keysLoading below) but Enda reported the exact same message again after that fix
  // shipped. Verified with an isolated, executed simulation of this exact race (not
  // just re-reading the code) before writing this comment: follow-up 59's own fix DOES
  // correctly wait out a slow-but-successful load, at any delay tested. What it didn't
  // cover — and what the simulation caught — is a load that FAILS outright (a network
  // hiccup, or the browser session not being fully established yet on an eager,
  // automatic-on-mount fetch like this one, unlike the old editor's fetch which always
  // had a manual click's worth of extra time to settle first). `useNarratorApiKeys`
  // already distinguishes this case for exactly this reason — `loading:false` does NOT
  // mean the load succeeded, only `loadedOk:true` does (see that hook's own comments,
  // and the 2026-08-19 API key audit in CLAUDE_CHANGELOG.md, which hit this identical
  // false-negative shape in ApiKeysDialog and fixed it the same way). This component
  // was checking `apiKeys.google_tts_api_key` without ever checking `loadedOk` first,
  // so a genuinely FAILED fetch looked byte-for-byte identical to "no key exists" —
  // actively misleading when a real key IS saved and the check itself just failed.
  const { keys: apiKeys, loading: keysLoading, loadedOk: keysLoadedOk, error: keysError, reload: reloadKeys, diag: keysDiag } = useNarratorApiKeys();
  const [segments, setSegments] = useState(null);
  const [segmentAudios, setSegmentAudios] = useState({});
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // True only for the "the key CHECK ITSELF failed" case above — distinct from a plain
  // "no key saved" error, since only this one can be fixed by simply trying again
  // (retryable via reloadKeys, wired to a visible Retry button below) rather than by
  // adding a key that may already be there.
  const [keyCheckFailed, setKeyCheckFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Per Anoushka/Enda: removing a pause entirely used to mean leaving this screen,
  // going back to the Waypoints tab, scrolling to the big combined script box there,
  // and deleting the <break> tag by hand — slow, easy to delete the WRONG one once
  // there are several, and it broke a narrator's editing flow every time. This screen
  // has no such fallback text box at all (see the file header comment above), so
  // there was previously no way to remove a pause from here whatsoever, only nudge
  // its duration. confirmRemoveId tracks which single pause segment (by id) is
  // currently showing its "Remove this pause?" confirmation, so a stray click can
  // never delete one by accident — only one segment's confirm is ever open at a time.
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);

  // Per Enda: the same LinguaGloss pronunciation-dictionary pop-up as TtsSegmentCard.jsx
  // (see that file's own comment), offered here too since this screen has its own,
  // separate set of text boxes — one at a time (dictOpenForId holds whichever segment's
  // Dictionary button was clicked; only that segment's Insert applies), same as
  // confirmRemoveId above only ever tracking one open confirm. Every text box here is
  // always directly editable (no separate "open this line's editor" step the way
  // TtsSegmentCard has), so Insert is offered whenever the box itself isn't disabled.
  const [dictOpenForId, setDictOpenForId] = useState(null);
  const textareaRefs = useRef({});
  const insertAtCursor = (segmentId, word) => {
    const el = textareaRefs.current[segmentId];
    const seg = segments?.find((s) => s.id === segmentId);
    const current = seg?.content || '';
    if (!el) {
      handleTextChange(segmentId, (current ? current.replace(/\s+$/, '') + ' ' : '') + word);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + word + current.slice(end);
    handleTextChange(segmentId, next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + word.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const lastPreviewUrlRef = useRef(null);
  // Guards the generation pass below to actually running at most once per mount, now
  // that the effect can no longer rely on `[]` deps alone to mean "exactly once" — it
  // must also re-run the instant keysLoading flips from true to false, or when a retry
  // (see handleRetryKeyCheck below) resets it back to false deliberately.
  const startedRef = useRef(false);

  const script = waypoint?.narration_script || '';

  // Runs once per mount (or once per retry — see handleRetryKeyCheck), as soon as the
  // API key fetch above has actually resolved ONE WAY OR THE OTHER — the parent renders
  // this component with `key={selectedWpIndex}` (see TourSimulator.jsx), so switching to
  // a different waypoint in the dropdown fully remounts this component fresh rather
  // than this effect needing to re-detect a waypoint change itself. Loads (regenerates)
  // audio for every text piece in this waypoint's own script, exactly once, so the
  // pause sliders below have something real to preview and combine against straight
  // away.
  useEffect(() => {
    if (keysLoading || startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    const parsed = parseScript(script);
    if (parsed.length === 0) return;
    if (!keysLoadedOk) {
      setKeyCheckFailed(true);
      // Same temporary diagnostic as the empty-key branch below — see that comment.
      const d = keysDiag;
      const diagText = d ? ` [diag: token present ${!!d.tokenPresent}, auth.me() error: ${d.authMeError || 'none'}]` : '';
      setError(`Could not check your saved API key (${keysError || 'unknown error'}) — this is NOT the same as having no key saved, the check itself just failed. Try again below.${diagText}`);
      return;
    }
    if (!apiKeys.google_tts_api_key) {
      // TEMPORARY DIAGNOSTIC (see CLAUDE_CHANGELOG.md, follow-up 61): this exact message
      // has been reported three times despite a real, working key being saved, and the
      // leading theory (a duplicate account record) has been checked and ruled out. The
      // bracketed part is the server's own account of how it identified this request and
      // what it found for that identity — needed as hard evidence to actually catch this,
      // not guess again. Please copy the FULL message (including the bracketed part) back
      // exactly as shown next time this appears.
      const d = keysDiag;
      const diagText = d
        ? ` [diag: identified via ${d.identifiedVia || 'unknown'}, as ${d.resolvedEmail || 'unknown'}, ${d.matchCount ?? '?'} account record(s) found${d.recordId ? `, record ${d.recordId}` : ', no record'}]`
        : ' [diag: unavailable — the server response did not include it, which is itself worth reporting]';
      setError(`No Google TTS API key found for your account yet. Add your own key via "API Keys" in the header.${diagText}`);
      return;
    }
    setLoading(true);
    const languageCode = LANG_TO_CODE[fixedLanguage] || 'en-US';
    (async () => {
      const audios = {};
      for (const seg of parsed) {
        if (seg.type !== 'text') continue;
        try {
          const response = await withTimeout(
            base44.functions.invoke('generateTts', {
              text: seg.content,
              gender: VOICE,
              language_code: languageCode,
              apiKey: apiKeys.google_tts_api_key,
              ...getNarratorAuthPayload(),
            }),
            TTS_CALL_TIMEOUT_MS,
            "Loading this waypoint's audio for editing took too long — try re-selecting it."
          );
          if (response.data?.url) audios[seg.id] = response.data.url;
        } catch (err) {
          if (!cancelled) setError(`Could not load audio for editing: ${getFnErrorMessage(err)}`);
        }
      }
      if (!cancelled) {
        setSegments(parsed);
        setSegmentAudios(audios);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [keysLoading, keysLoadedOk, keysError, keysDiag, apiKeys.google_tts_api_key, script, fixedLanguage]);

  // Undoes the guard above so the effect runs again — used only for the "the key check
  // itself failed" case (keyCheckFailed), never for "no key saved" (adding a key
  // doesn't need a retry click here; it needs the API Keys dialog). Calls the hook's
  // own reload(), which flips keysLoading back to true and then, on completion, false
  // again — startedRef being reset first is what lets that second "false" actually be
  // acted on instead of being swallowed by the same-run guard.
  const handleRetryKeyCheck = () => {
    startedRef.current = false;
    setKeyCheckFailed(false);
    setError('');
    reloadKeys();
  };

  // Revoke whatever live-preview blob URL this component created, on unmount (switching
  // waypoints) or before building a fresh one — an object URL left un-revoked keeps its
  // whole audio blob alive in memory for as long as the tab stays open.
  useEffect(() => () => {
    if (lastPreviewUrlRef.current) URL.revokeObjectURL(lastPreviewUrlRef.current);
  }, []);

  const handleDurationChange = (segmentId, newDuration) => {
    setSegments((prev) => prev ? prev.map((seg) => (seg.id === segmentId ? { ...seg, duration: newDuration } : seg)) : prev);
    setDirty(true);
  };

  // Per Anoushka/Enda (follow-up 77) — see the file header comment above. Updates
  // just this one segment's own wording, and immediately drops its cached audio: that
  // clip was generated for the OLD text, and leaving it in segmentAudios would let
  // handleTest/handleSave silently combine it against the NEW text now on screen.
  // ensureFreshSegmentAudio (below) regenerates real audio for exactly the segments
  // missing from segmentAudios — i.e. exactly the ones edited since the last
  // Test/Save — the next time either button runs, so this never needs to trigger a
  // TTS call itself, on every keystroke, here.
  const handleTextChange = (segmentId, newContent) => {
    setSegments((prev) => prev ? prev.map((seg) => (seg.id === segmentId ? { ...seg, content: newContent } : seg)) : prev);
    setDirty(true);
    setSegmentAudios((prev) => {
      if (!(segmentId in prev)) return prev;
      const next = { ...prev };
      delete next[segmentId];
      return next;
    });
  };

  // Per Anoushka/Enda — see confirmRemoveId above. Deletes the pause segment entirely
  // (not just shrinking its duration towards the 0.1s floor, which would still leave a
  // real, audible micro-pause). Only ever called after the two-step confirm below has
  // actually resolved to "yes".
  const handleRemoveSegment = (segmentId) => {
    setSegments((prev) => prev ? prev.filter((seg) => seg.id !== segmentId) : prev);
    setSegmentAudios((prev) => {
      if (!(segmentId in prev)) return prev;
      const next = { ...prev };
      delete next[segmentId];
      return next;
    });
    setDirty(true);
    setConfirmRemoveId(null);
  };

  // Per Enda's follow-up 35 report (same reasoning as NarrationTtsEditor's own
  // regenerateSegmentAudio): a segment's audio URL can go stale between when it was
  // generated and when it's actually needed for combining/preview. Self-heals by
  // re-requesting fresh audio for just the one piece that failed to fetch.
  const regenerateSegmentAudio = async (seg) => {
    if (seg.type !== 'text' || !apiKeys.google_tts_api_key) return null;
    try {
      const languageCode = LANG_TO_CODE[fixedLanguage] || 'en-US';
      const response = await withTimeout(
        base44.functions.invoke('generateTts', {
          text: seg.content,
          gender: VOICE,
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
      return null;
    }
  };

  // Per Anoushka/Enda (follow-up 77) — see the file header comment above. Builds a
  // fresh lookup object rather than trusting segmentAudios state directly: any
  // segment just edited was already stripped out of it by handleTextChange, and a
  // regenerate call here needs to hand combineSegmentsToWav the REAL, just-fetched
  // URL immediately — reading segmentAudios back inside the same synchronous handler
  // that calls setSegmentAudios wouldn't see that update yet (React batches state
  // updates), so this reads the return value of each regenerateSegmentAudio call
  // directly instead. A segment that already has cached audio (untouched since the
  // last Test/Save) is left completely alone — no wasted TTS calls for wording that
  // hasn't changed.
  const ensureFreshSegmentAudio = async (segs, audios) => {
    const updated = { ...audios };
    for (const seg of segs) {
      if (seg.type !== 'text' || updated[seg.id]) continue;
      const freshUrl = await regenerateSegmentAudio(seg);
      if (freshUrl) updated[seg.id] = freshUrl;
    }
    return updated;
  };

  // Per NarrationTtsEditor's own established rule for a per-line edit ("A line can't
  // be saved empty") — this screen has no equivalent of that file's larger script box
  // to delete a line through, so an emptied-out line here has no way to become a real,
  // intentional removal; it can only ever be a stray edit. Shared by handleTest and
  // handleSave so testing catches this exactly as early as saving does, rather than
  // building a preview around a blank line only for Save to refuse it later.
  const findEmptyTextSegment = (segs) => segs.find((seg) => seg.type === 'text' && !seg.content.trim());

  // Matches ANY <break .../> tag regardless of attribute form — the same broad check
  // narrationUtils.js's parseSSMLBreaks and odtExporter.js's export already use for
  // "does this look like a break tag at all", not ttsParser.js's narrower one.
  const BREAK_TAG_LOOKS_LIKE = /<break\b[^>]*\/?>/i;

  // Per Anoushka's own follow-up to follow-up 77: "I'll type a <break> tag in it for
  // 0.1s. Will that work?" — checked rather than assumed, and as originally built, no:
  // a text segment's content is sent to Google TTS completely literally (see
  // regenerateSegmentAudio above), so typing a break tag into one would make the
  // narrator audibly SAY the tag's own text out loud — a worse outcome than the
  // empty-line block she was trying to get around, not a fix for it.
  //
  // This makes her actual intent genuinely work instead: if a text segment's content,
  // once trimmed, is EXACTLY one break tag and nothing else, it's converted into a
  // real pause segment here — parseScript (the app's own canonical break-tag reader,
  // already used to parse the whole document) reads whatever attribute form was typed
  // and returns its duration, reused rather than re-implementing that parsing.
  // Content and any cached audio are dropped, since a pause never needs TTS audio —
  // genuinely equivalent to deleting the line: nothing is spoken there any more, only
  // the pause plays. The now-converted segment re-renders as an ordinary pause slider,
  // same as any other, giving a clear visual confirmation the conversion happened.
  //
  // If a break tag is typed alongside other text instead — mixed in, more than one
  // tag, or a malformed one — this deliberately does NOT attempt to re-split that one
  // box into several real segments (a much bigger feature nobody has asked for), and
  // instead blocks with a clear explanation, so a stray "<break...>" can never
  // silently reach Google TTS as literal words to pronounce.
  const collapseBreakTagOnlySegments = (segs) => {
    let blockedError = null;
    let changed = false;
    const collapsed = segs.map((seg) => {
      if (seg.type !== 'text' || blockedError) return seg;
      const trimmed = seg.content.trim();
      if (!trimmed || !BREAK_TAG_LOOKS_LIKE.test(trimmed)) return seg;
      const parsed = parseScript(trimmed);
      if (parsed.length === 1 && parsed[0].type === 'pause') {
        changed = true;
        return { id: seg.id, type: 'pause', duration: parsed[0].duration };
      }
      blockedError = "A break tag needs to be the ONLY thing in that box to turn the line into a pause — remove the extra text around it, or remove the tag and just leave real words.";
      return seg;
    });
    return { segments: collapsed, blockedError, changed };
  };

  const handleTest = async () => {
    if (!segments || testing || saving) return;
    const { segments: normalized, blockedError, changed } = collapseBreakTagOnlySegments(segments);
    if (blockedError) {
      setError(blockedError);
      return;
    }
    const empty = findEmptyTextSegment(normalized);
    if (empty) {
      setError("A line can't be left empty — type something back in, or undo the edit, or type a <break time=\"0.1s\"/> tag (and nothing else) into it to turn it into a pause instead.");
      return;
    }
    if (changed) setSegments(normalized);
    setTesting(true);
    setError('');
    try {
      const freshAudios = await ensureFreshSegmentAudio(normalized, segmentAudios);
      const wavBlob = await combineSegmentsToWav(normalized, freshAudios, undefined, { onRegenerateAudio: regenerateSegmentAudio });
      const blobUrl = URL.createObjectURL(wavBlob);
      if (lastPreviewUrlRef.current) URL.revokeObjectURL(lastPreviewUrlRef.current);
      lastPreviewUrlRef.current = blobUrl;
      onTestSubsegment(blobUrl);
    } catch (err) {
      setError(`Could not build a preview: ${getFnErrorMessage(err)}`);
    }
    setTesting(false);
  };

  const handleSave = async () => {
    if (!segments || saving || testing || doneLocked) return;
    const { segments: normalized, blockedError, changed } = collapseBreakTagOnlySegments(segments);
    if (blockedError) {
      setError(blockedError);
      return;
    }
    const empty = findEmptyTextSegment(normalized);
    if (empty) {
      setError("A line can't be left empty — type something back in, or undo the edit, or type a <break time=\"0.1s\"/> tag (and nothing else) into it to turn it into a pause instead.");
      return;
    }
    if (changed) setSegments(normalized);
    setSaving(true);
    setError('');
    try {
      const freshAudios = await ensureFreshSegmentAudio(normalized, segmentAudios);
      const wavBlob = await combineSegmentsToWav(normalized, freshAudios, undefined, { onRegenerateAudio: regenerateSegmentAudio });
      const audioBase64 = await blobToBase64(wavBlob);
      const response = await withTimeout(
        base44.functions.invoke('uploadNarrationAudio', {
          audioBase64,
          mimeType: 'audio/wav',
          filename: `narration_${Date.now()}.wav`,
          ...getNarratorAuthPayload(),
        }),
        TTS_CALL_TIMEOUT_MS * 2,
        'Uploading the updated audio took too long (check your connection) — nothing has been lost, just try again.'
      );
      if (!response.data?.url) throw new Error('Upload did not return a file URL.');
      // One atomic update — per follow-up 53's own fix (see CLAUDE_CHANGELOG.md), three
      // separate onWaypointUpdate calls for audio_clip_url/trigger_audio/waypoint_done
      // in a row silently raced each other and only the LAST one survived. This is the
      // exact same class of bug the "really saved" complaint that started this whole
      // request was about, so it's done here as one single call from the start.
      onSave({
        narration_script: rebuildScript(normalized),
        audio_clip_url: response.data.url,
        trigger_audio: true,
        waypoint_done: true,
      });
      setDirty(false);
      onAutoSave?.();
    } catch (err) {
      setError(`Could not save: ${getFnErrorMessage(err)}`);
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      {!script && (
        <div className="text-sm text-slate-500 italic border border-dashed border-slate-600 rounded-lg p-4">
          No narration script for this waypoint yet — write it in the Waypoints tab first.
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          {keyCheckFailed && (
            <Button size="sm" variant="outline" onClick={handleRetryKeyCheck} className="border-red-500 text-red-200 hover:bg-red-900/40 shrink-0">
              Retry
            </Button>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading this waypoint's audio for editing…
        </div>
      )}

      {segments && segments.length > 0 && (
        <div className="space-y-2">
          {segments.map((seg) => (
            seg.type === 'text' ? (
              <div key={seg.id} className="space-y-1">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setDictOpenForId(seg.id)}
                    title="Check the pronunciation dictionary"
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    <BookOpen className="w-3 h-3" /> Dictionary
                  </button>
                </div>
                {/* Per Anoushka/Enda (follow-up 77): editable, not just displayed —
                    same pastel yellow as every other editable script box in this app,
                    so it's never ambiguous this one can be typed into. */}
                <Textarea
                  ref={(el) => { textareaRefs.current[seg.id] = el; }}
                  value={seg.content}
                  onChange={(e) => handleTextChange(seg.id, e.target.value)}
                  disabled={loading || saving || testing || doneLocked}
                  rows={Math.max(2, Math.ceil(seg.content.length / 60))}
                  className="bg-amber-100 border-amber-300 text-black placeholder:text-amber-900/50 text-sm resize-y focus-visible:ring-amber-400"
                />
                {!segmentAudios[seg.id] && !loading && (
                  <p className="text-xs text-amber-400/80 italic">Edited — audio will regenerate the next time you Test or Save.</p>
                )}
                <PronunciationDictionaryDialog
                  open={dictOpenForId === seg.id}
                  onClose={() => setDictOpenForId(null)}
                  onInsert={(loading || saving || testing || doneLocked) ? undefined : (word) => insertAtCursor(seg.id, word)}
                />
              </div>
            ) : (
              <div key={seg.id} className="bg-slate-800 rounded-lg border border-slate-600 p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Pause
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-amber-400">{seg.duration.toFixed(1)}s</span>
                    {/* Per Anoushka/Enda: a real, complete removal — not just dragging
                        the slider down towards its 0.1s floor, which still leaves an
                        audible micro-pause behind. Two-step confirm (this button just
                        opens it; nothing is deleted until "Yes, remove" below is
                        actually clicked) so a stray click can't silently drop a pause
                        a narrator meant to keep. */}
                    {confirmRemoveId !== seg.id && (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(seg.id)}
                        disabled={loading || saving || testing || doneLocked}
                        title="Remove this pause completely"
                        className="text-slate-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-slate-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {confirmRemoveId === seg.id ? (
                  <div className="flex items-center justify-between gap-2 bg-red-900/20 border border-red-700/50 rounded-md px-2.5 py-2">
                    <span className="text-xs text-red-300">Remove this pause? This can't be undone.</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(null)}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/50 text-slate-200"
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveSegment(seg.id)}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-700/40 hover:bg-red-700/60 border border-red-600/50 text-red-100"
                      >
                        <Check className="w-3 h-3" /> Yes, remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <Slider
                    value={[seg.duration]}
                    min={0.1}
                    max={120}
                    step={0.1}
                    onValueChange={(val) => handleDurationChange(seg.id, val[0])}
                    disabled={loading || saving || testing || doneLocked}
                  />
                )}
              </div>
            )
          ))}
        </div>
      )}

      {segments && segments.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={handleTest}
            disabled={loading || testing || saving || testDisabled}
            title={testDisabled ? testDisabledReason : 'Drive from this waypoint to the next one, playing this exact wording and pause timing — click again any time, including after editing text or moving a slider, to re-test'}
            className="bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/50 text-white gap-2"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Test this subsegment
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={loading || saving || testing || !dirty || doneLocked}
            title={doneLocked ? 'Locked — unlock this waypoint above to save changes' : dirty ? 'Save this wording and pause timing as the real, live audio for this waypoint' : 'Nothing changed yet'}
            className="bg-amber-500 hover:bg-amber-600 text-white gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  );
}
