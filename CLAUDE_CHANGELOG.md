# Explore Crete App — Change Log (for Claude)

This file tracks every change made to this codebase across chat sessions,
so a new Claude instance can read it and understand what's been done
without redoing work or guessing at context.

Repo source: https://github.com/Emacmul/Explore-crete-copy
Pulled: 2026-08-03

## How to use this file
- Before starting new work, read this whole file first.
- After making any change, add a new dated entry below (newest at top)
  describing what changed, why, and which files were touched.
- Keep entries short and factual — no need for prose, just the facts.
- STANDING RULE — backend function changes: if any change touches a file
  under `base44/functions/`, say so explicitly and plainly in the chat
  reply itself (not just in this changelog), and name exactly which
  function(s). Enda's deploy process needs a separate manual redeploy
  step per backend function (add a blank line to that function's file
  in Base44, which surfaces a redeploy command, then remove the blank
  line and redeploy) — pushing the code alone does NOT make a backend
  function change take effect. A frontend-only change needs no such
  callout; a hard refresh + republish in Base44 is enough for those.

---

## 2026-08-18 (pause timing fix) — TTS break durations always rendered longer than set, worse for longer pauses
Scope: `src/lib/audioCombiner.js` (NEW), `src/components/admin/NarrationTtsEditor.jsx`,
`base44/functions/uploadNarrationAudio/entry.ts` (NEW BACKEND FUNCTION)
**— NEW backend function, needs to be created in Base44 (not just redeployed), see
callout in chat reply**.

Enda reported the `<break>` pause durations (0.2s, 0.5s, etc.) always come out longer
than set, and the longer the requested pause, the bigger the error.

**Root cause:** the "combined audio" (the actual finished narration file saved to the
walk) was built by sending the ENTIRE script — spoken text plus every
`<break time="Xs"/>` tag — to Google Cloud TTS as one SSML request
(`generateTts/entry.ts`, still used for individual segment previews, just not for
the final combine anymore). Google's own docs describe SSML break timing as an
approximation, not a guarantee, and in practice it renders pauses long, with the
error growing with the requested duration — not something fixable by adjusting the
request. Individual segment clips (from "Parse & Generate") were never affected —
each one is sent as plain spoken text with no break tags in it at all, so the actual
narration audio itself was always fine; only the silence between clips in the final
combined file was wrong.

**Fix:** the combined audio no longer asks Google to render any silence at all.
`src/lib/audioCombiner.js` (new) takes the already-generated, already-correct
per-segment speech clips and stitches them together in the browser via the Web
Audio API: each clip is scheduled to start at an exact cumulative time offset
(`AudioBufferSourceNode.start(seconds)`), and a pause is simply the gap between one
clip's start and the next — silence by construction, not a duration handed to a
black box. The result is rendered via `OfflineAudioContext` and encoded to a plain
16-bit PCM WAV file (no new dependency — hand-written encoder) at the TTS clips'
own sample rate, then uploaded through the new `uploadNarrationAudio` backend
function (same auth pattern as `generateTts`: admin, or narrator via
email+narrToken). `NarrationTtsEditor.jsx`'s `handleBuildAndPlay` now calls this
instead of a second `generateTts` call with the full script; `handleDownload` now
derives the downloaded file's extension from the actual saved URL instead of
hardcoding `.mp3`, since combined audio is now `.wav` (older tours' previously-saved
combined audio, still `.mp3`, downloads correctly too).

**Note on file size:** combined audio is now a WAV file rather than an MP3, so it's
larger per minute of narration than before (no MP3 encoder library is bundled in
this project). Flagging this in case it matters for storage/offline download size —
say the word if you'd like an MP3 encoder added instead, now that the timing itself
is fixed.

**Verified:** `npx vite build` and `npx eslint` clean on the changed frontend files;
`npx esbuild base44/functions/uploadNarrationAudio/entry.ts --format=esm` — syntax
clean (Deno type-checking not available in this environment, same caveat as other
backend function edits this session).
**Not done:** creating the new function in Base44 and redeploying it, and a live
re-test of pause accuracy after deploy.

---

## 2026-08-18 (security fix) — Base44 Security scan High finding: "Anyone can run this function" on ensureAppUserOnboarding
Scope: `base44/functions/ensureAppUserOnboarding/entry.ts`
**(backend function — needs manual redeploy in Base44, see standing rule above)**.

Base44's own Security panel flagged this function High severity: "The function trusts
client-supplied email addresses to query and update AppUser onboarding records without
enforcing token verification when a token is missing or invalid."

**Root cause:** the function derives `wpId` from the caller's WordPress JWT only after
`isTokenGenuine()` confirms it with WordPress — that part was already correct. But when
`token` was missing, invalid, or unverifiable, `wpId` just stayed `null` and the code fell
straight through to trusting the client-supplied `email` field instead: looking a row up
by that email, patching `registration_complete` on it, and even creating a brand-new
AppUser row from it if none existed. Since this function's URL is public and requires no
Base44 session (real customers have none), anyone could call it directly with an arbitrary
email and read back that account's `role` (an admin/narrator oracle), flip its
`registration_complete` flag, or spray junk rows into the table — with zero proof they
were ever that person.

**Fix:** the function now requires a genuine, WordPress-verified token before touching
`AppUser` at all.
- No `token`, or `isTokenGenuine(token, WC_SITE_URL)` returns false → immediate
  `401 Not authorized`, no entity read or write of any kind.
- Token verified but its payload carries no usable WordPress user id → also
  `401 Not authorized` (fail closed rather than fall back to client email).
- Only once a verified `wpId` is in hand does the existing lookup-by-id-then-by-email,
  patch, and create logic run — the email fallback can now only ever affect the row
  belonging to that one already-authenticated caller, never an arbitrary account.

Confirmed the only caller (`src/pages/Home.jsx`, `checkRegistration()`) already always
sends the real WordPress token alongside the email whenever it invokes this function (it
only fires once `user` — the logged-in WP session — exists), so this tightening doesn't
change behavior for any legitimate login; it only removes the unauthenticated path.

**Verified:** `npx esbuild base44/functions/ensureAppUserOnboarding/entry.ts --format=esm`
— syntax clean (Deno type-checking not available in this environment, same caveat as
other backend function edits this session).
**Not done:** Base44 manual redeploy (Enda's step) and re-running the Security scan to
confirm the finding clears.

---

## 2026-08-19 (narration editor fixes) — Five issues from live testing: dropped spaces on import, invalid-SSML combined audio, vanishing Stop button, scroll-heavy segment review, break duration floor
Scope: `src/lib/fileTextExtractor.js`, `base44/functions/generateTts/entry.ts`
**(backend function — needs manual redeploy in Base44, see standing rule above)**,
`src/components/admin/NarrationTtsEditor.jsx`, `src/components/admin/TtsSegmentCard.jsx`,
`src/lib/ttsParser.js`.

Enda reported five separate things from actually using the narration/TTS editor.
Investigated each on its own rather than assuming they were related.

**1. "Quite a few spaces between words get skipped" on import, master file confirmed
clean.** Real bug, not the file: DOCX represents a Tab keypress (routinely used to nudge
word spacing) as its own empty `<w:tab/>` element, completely separate from any `<w:t>`
text — visually identical to a space in Word, so nothing would look wrong reviewing the
document there. Extraction only ever read `<w:t>` content directly
(`getElementsByTagName('w:t')`, flattened across the whole paragraph) and silently
ignored everything else, so every one of these vanished on import with nothing left
behind. ODT has the same gap for `<text:tab/>` AND a second, arguably more likely cause:
consecutive spaces (e.g. double-spacing after a period) can't be written as literal
repeated characters in ODF at all — it uses a dedicated `<text:s text:c="N"/>` element
just to say "N spaces here," which a plain `.textContent` read never sees either. Fixed
both extractors by walking each paragraph's actual child structure (recursing into runs/
hyperlinks/etc.) instead of flattening straight to text, converting `w:tab`/`text:tab` to
a space and `w:br`/`w:cr`/`text:line-break` to a newline, and expanding `text:s`'s count
into that many real spaces. Verified against constructed test XML for both formats
(Node + jsdom, not just read — actual extraction run against `<w:tab/>` and
`<text:s text:c="3"/>` cases, confirmed correct output).

**2. "Combined audio failed: Invalid SSML. Newer voices like Neural2 require valid
SSML."** SSML is XML — a literal "&", "<", or ">" anywhere in ordinary narration text
(e.g. "Fish & Chips") is completely normal writing but invalid unescaped inside XML, and
`generateTts` was wrapping raw narration text in `<speak>...</speak>` with no escaping at
all. Per Google's own error text, newer voices enforce this strictly where older ones may
have tolerated it, which is why it surfaced now rather than always. Fixed with a new
`escapeSsmlText()` in `generateTts/entry.ts`: splits on the real `<break time="Xs"/>` tag
pattern first, escapes `&`/`<`/`>` only in the text between them, then rejoins — so actual
SSML markup stays untouched (escaping it too would turn every pause into literal text,
losing it entirely) while the narration text around it becomes valid XML. Verified with a
standalone test: a string containing both "Fish & Chips" and real `<break>` tags produces
zero remaining bare `&`/`<` after escaping, tags intact.

**3. Stop button could vanish while audio was still actually playing.** The whole
Build & Play/Stop block was gated on `segments` being non-null. Editing the script
resets `segments` (expected, not a problem per Enda) — but if that edit happened WHILE
segment-by-segment playback was still running, the block (Stop button included)
disappeared from the screen entirely even though the playback loop — which captured its
own `segments` reference when it started — kept running in the background with no way
left to stop it. Extracted the Build & Play/Stop/Download block into one reusable
`renderBuildPlayControls()` and added a fallback render of it (Stop only makes sense
here) for exactly this case: `segments` is null but `playing` is still true.

**4. Scrolling all the way down just to reach Build & Play after a long segment list.**
`renderBuildPlayControls()` (same block as above) is now also interleaved after every
3rd segment card, not just once at the very end — so it's always within a few segments'
scroll of wherever someone's actually reviewing.

**5. 0.5s minimum break duration too long for a mid-sentence pause.** Changed the floor
in `parseScript` (was `Math.max(0.5, duration)`) and the per-segment slider's min/step in
`TtsSegmentCard.jsx` (was min 0.5, step 0.5) to 0.1 throughout. Added a 0.1s quick-insert
button next to the existing 0.5s/1s/2s/3s ones. Also rounds duration to 1 decimal place
in `rebuildScript` before writing the `<break>` tag, since a 0.1 step can otherwise
produce ordinary JS float noise like 0.30000000000000004 straight into the saved script.

**Verified:** `npx vite build` and `npx eslint` (every file touched) both clean. The two
new pieces of logic (`escapeSsmlText`, the DOCX/ODT paragraph walkers) were each tested
standalone with constructed inputs before being counted as done, not just read over.

**Not done / worth knowing for next time:**
- None of this was tested live against Enda's actual master file/real Google TTS
  account — worth re-importing that specific file and re-running Parse & Generate/
  Build & Play once deployed (and remember: `generateTts` needs its manual Base44
  redeploy for #2 to take effect).
- `<w:noBreakHyphen/>`/`<w:softHyphen/>` and any other DOCX inline-content elements
  beyond `w:t`/`w:tab`/`w:br`/`w:cr` are still not specifically handled — not reported
  as a problem, just worth knowing the paragraph walker's element list isn't fully
  exhaustive of every possible OOXML inline element.

Also bumped `CACHE_VERSION` in `public/sw.js` (v7 → v8) so the update-available banner
reaches anyone with the app already open, per the standing rule from that feature's own
changelog entries.

---

---

## 2026-08-19 (update banner, fixed again) — Also removed the visibilitychange re-check; open-only really means open-only now
Scope: `index.html`, `public/sw.js` (v6 → v7).

Enda pushed back on the previous entry directly — asked why a tab-switch-and-back should
re-check for updates at all. He's right, and the reasoning in that entry doesn't hold up:
switching to another tab or app to check something (a reference doc, a source script)
and coming back is completely ordinary mid-task behavior, not the same as closing and
reopening the app. Keeping that check meant the exact interruption this whole feature
was built to avoid could still happen — just through a different trigger than the
60-second poll removed in the previous entry, not actually fixed.

Removed the `visibilitychange` listener entirely. The update check in `index.html` now
runs exactly once — right when `navigator.serviceWorker.register()` resolves after the
app loads — and nothing else ever triggers it again for the lifetime of that page. A
narrator can switch tabs, alt-tab to another app, walk away and come back, all without
ever seeing the banner again once it's already been shown (or not shown) at open. Only
an actual fresh load — closing and reopening the app, or a normal browser refresh —
checks again.

Bumped `CACHE_VERSION` again (v6 → v7) so this reaches Enda's current session: his
currently-loaded v6 code still has the visibilitychange listener live, so one more
tab-switch-and-back will catch v7 and show the banner one final time — after that
reload, the fixed v7 code with no lingering re-check is what's actually running.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-19 (update banner, fixed) — Removed the 60-second background poll that was interrupting active work; check happens on open only
Scope: `index.html`, `public/sw.js` (v5 → v6).

Enda tested the update banner live and reported exactly the problem it was meant to
avoid: it flashed up while he was mid-way through generating audio, not when he opened
the app. Traced it to the periodic poll `index.html` was still running — a
`setInterval(() => reg.update(), 60000)` that re-checked for a new version every 60
seconds for as long as the tab stayed open, completely independent of whatever was
actually happening in the app at that moment. That's exactly what could — and did — fire
in the middle of an active task.

Removed the interval entirely. The update check now only ever runs in two places: once,
immediately, right when the app is opened (`reg.update()` called straight after
registration succeeds), and again if someone switches away to another tab/app and comes
back (the existing `visibilitychange` listener, kept as-is) — since that's a genuine
"returning to the app" moment, not an interruption of continuous foreground work, as it
can only ever fire at the instant visibility actually changes. Someone who opens the app
and then works continuously in one tab for hours will correctly see nothing further
until they either switch away and back, or close and reopen — which is the point.

Bumped `CACHE_VERSION` again (v5 → v6, see the entry below for why this matters) so this
fix itself reaches anyone who already has the app open, including from Enda's own test
session just now.

**Verified:** `npx vite build` completes with no errors.

**Not done / worth knowing for next time:** the very first check (right after
registration, on open) still has to actually complete before the banner can appear —
there's no way to guarantee it lands before someone starts working, since it depends on
a real network round-trip to fetch `sw.js`. In practice this is fast (well under a
second on any reasonable connection), so it should reliably land before anyone's deep
into a task, but it's not instantaneous by construction.

---

## 2026-08-19 (update banner) — Narrators who already have the app open now get a real "update available" prompt instead of a silent forced reload
Scope: `index.html`, `public/sw.js`, new `src/components/UpdateAvailableToast.jsx`,
`src/App.jsx`.

Enda asked directly: do narrators who already installed the app automatically get all
the changes made this session, or does something need to happen for them to update?

**Short answer, and the important nuance:** closing the app and reopening it (or a plain
browser refresh) already gets the latest version automatically, with nothing to click —
navigation requests are network-first in `sw.js`, and Vite content-hashes every JS/CSS
filename, so a stale cache can never serve old code on a real reload. That part needed
no fix and was already working correctly.

The real gap was the opposite case: someone who leaves the app open for a while — very
plausible for a narrator mid-session — while a new version gets deployed underneath
them. The service worker was already designed to detect and activate a new version in
the background on its own (`skipWaiting`, `clients.claim`, polling `reg.update()` every
60s and on tab focus — all pre-existing, all correct). But once it did, `index.html`'s
message handler called `window.location.reload()` immediately and silently, with zero
warning — genuinely risky mid-task, since it could wipe out an in-progress recording or
an unsaved script edit with no notice at all.

**Fixed** by turning that silent forced reload into an actual prompt, exactly as asked:
- `index.html` now dispatches a `explore-crete:update-available` window event instead of
  reloading directly.
- New `UpdateAvailableToast.jsx` listens for it and shows a small dismissable banner —
  "A new version is available" with an **Update** button that reloads when clicked, only
  when clicked. Mounted once, globally, in `App.jsx`, so it's identical whether someone's
  on the customer front end, the Admin Panel, or Narr Studio.
- Bumped `CACHE_VERSION` in `public/sw.js` (v4 → v5) and added a comment explaining why
  this matters: the browser only detects a service-worker update by diffing this file's
  raw bytes, so **any deploy meant to show this banner to already-open sessions must bump
  this version string** — otherwise the deploy still reaches everyone on their next
  normal open, just without the banner for people already using it. This specific bump
  is what makes today's whole batch of changes (this session) actually trigger the
  banner for anyone who has the app open right now.

**Verified:** `npx vite build` and `npx eslint` both clean.

**Not done / worth knowing for next time:** the banner is plain English, matching the
rest of the Admin Panel/Narr Studio (neither uses the customer-facing i18n system) — it
will also appear on the customer front end (Home), which does have translations, so it's
the one un-translated string there if that's ever noticed. Also worth remembering going
forward: **any future deploy that should prompt already-open sessions needs a
`CACHE_VERSION` bump in `public/sw.js`** — otherwise this specific banner just won't
appear for them, even though the deploy still reaches everyone else fine.

---

## 2026-08-19 (no-op translate) — Skip the Groq call entirely when target language is the same as the imported master (English)
Scope: `src/components/admin/TranslationPanel.jsx` only.

Enda's example: importing the English master for a tour he's writing both the English
and Dutch versions of himself — the Dutch version genuinely needs translating, but the
English version doesn't, since the import already IS the English master script (this
app's whole workflow starts from an English original — see `CLAUDE_CHANGELOG.md`
history and `AGENTS`/project notes on the narration workflow). Previously "Translate &
Load" always called `translateScript` regardless of the chosen target language, even
when it was English — burning a real Groq call, real quota/time, and carrying a small
but real risk of the model subtly rewording text that was already exactly right, for a
translation that was never actually needed.

Added `isNoOpTranslation` (`targetLanguage === 'English'`): when true, "Translate & Load"
(now labelled "Load (already English)" in that state) calls `onTranslated(importedText)`
directly and returns immediately — no network call, no Groq API key even required for
this path. A small note appears under the button explaining why, so it's clear this
isn't silently skipping something it shouldn't. Every other target language is
completely unaffected — still goes through `translateScript` exactly as before.

**Verified:** `npx vite build` and `npx eslint` both clean.

**Not done / worth knowing for next time:** this assumes the imported file is always the
English master, which matches how every tour in this app is actually built — there's no
concept anywhere in the codebase of a non-English source import. If that ever changes
(importing an already-non-English source script), this specific check would need to
become a real "source language" selector instead of the current English-only assumption.

---

## 2026-08-19 (audit, corrected) — API key prompt upgraded from dismissable to a real hard lock, both keys required
Scope: `src/components/admin/ApiKeysDialog.jsx`, `src/components/admin/BackendShell.jsx`.

Correction to the entry directly below this one. That version made the key prompt
dismissable, reasoned from a wrong assumption — that a "walk/hike-only narrator" might
exist and genuinely never need a TTS/Groq key. Enda corrected this directly: there's no
such role. Every narrator works across all three tour types, so every narrator needs
both keys eventually regardless of what they're working on right this moment. He also
confirmed it should be a hard lock, and that both keys are required, not just one.

Rebuilt on that basis:
- `ApiKeysDialog` now takes a `required` prop. When true: the X close button is hidden,
  and clicking outside or pressing Escape are both suppressed (`onPointerDownOutside` /
  `onEscapeKeyDown` on the underlying Radix content, checked directly — this is a real
  dismiss-proof lock, not just hiding the visible close affordances). Save also stays
  disabled until BOTH fields actually have something typed into them — a single key no
  longer satisfies it.
- `BackendShell` computes `needsApiKeySetup` from BOTH fields (`!google_tts_api_key ||
  !groq_api_key`), not "neither" — genuinely requires both, not just one. While true, the
  main content area renders a plain "add your keys to continue" placeholder instead of
  the real tour list/editor (belt-and-braces: the modal's overlay already blocks
  interaction with it, but there's no reason to have it silently sitting there either).
  A brief loading state covers the moment before we even know the answer, so the real
  content never flashes on screen before potentially locking straight back up.
- Wired `onSaved` from `ApiKeysDialog` back to a `reload()` on `BackendShell`'s own
  separate key-status check, so a successful save unlocks immediately — without this,
  the dialog and the lock check are two independent hook instances that wouldn't
  otherwise know about each other's state.

**Worth knowing:** this is a genuine hard lock — while it's showing, the modal's overlay
and Radix's focus trap mean nothing behind it is reachable, including Logout and Front
End in the header. The only way out is entering both keys (or, if the initial load
itself fails, the existing "Retry loading" button inside the dialog — that part still
works exactly as before). If that turns out to be a problem in practice — someone
genuinely stuck without a key handy and no way to even log out — worth revisiting
whether Logout specifically should stay reachable as a deliberate, narrow exception.

**Verified:** `npx vite build` and `npx eslint` (on every file touched this session)
both come back clean.

---

## 2026-08-19 (audit, cont'd) — Narrators had no way to actually set their own key; forced one-time prompt added; real cause of the Translate 500 found and fixed (Groq model decommissioned)
Scope: `base44/functions/translateScript/entry.ts`, `src/components/admin/BackendShell.jsx`,
`src/components/admin/TranslationPanel.jsx`, `src/components/admin/NarrationTtsEditor.jsx`,
`src/lib/utils.js` (new `getFnErrorMessage` helper).

Follow-up to the API key audit above, from three things Enda asked for directly.

**1. Confirmed per-person key isolation, found the narrator side was actually broken.**
`manageApiKeys`/`translateScript`/`generateTts` already never fall back to a shared or
admin key — each requires and uses only the caller's own saved key, checked directly.
But the "API Keys" button in the header (`BackendShell.jsx`) was `{isAdmin && ...}` —
real narrators (not admins wearing the Narr hat) never saw it at all, even though
`manageApiKeys` and the TTS/Translate error messages ("Add your own key under 'API
Keys'...") both assume they can. A plain narrator had no way to ever open that dialog.
Fixed by showing the button to everyone in the backend shell, admin or narrator.

**2. Added the one-time prompt Enda asked for.** `BackendShell` now checks, once per
login, whether the signed-in admin/narrator has neither key saved yet, and if so opens
the API Keys dialog for them automatically — so they're asked to set their own key up
front instead of only discovering it's missing when a feature fails. Left dismissable,
not a hard lock: walk/hike tours use no audio at all, so a walk/hike-only narrator may
genuinely never need either key, and this is meant as a prompt, not a requirement.
Because it only re-triggers when both keys are still genuinely empty, it naturally never
asks again once either key has been saved — nothing extra needed to track "already
asked" long-term.

**3. Found the real cause of "Request failed with status code 500" on Translate.**
Traced it properly instead of guessing: `base44.functions.invoke()` is a bare
`axios.post()` under the hood (checked the actual SDK source in `node_modules`) — on
any non-2xx response, axios's own `.message` is always that generic string, never the
real reason from the response body (`err.response.data.error`). Every catch block in
`TranslationPanel.jsx` and `NarrationTtsEditor.jsx` was reading `err.message` directly,
so the true cause was always being hidden. Added `getFnErrorMessage()` in `src/lib/utils.js`
and switched both files to use it — errors now show the actual reason.

With that in place, the real reason was: Groq decommissioned `llama-3.3-70b-versatile`
(the model `translateScript` was calling) on 2026-08-16 — two days before Enda hit this.
Confirmed directly against Groq's current docs, not assumed: their live model list no
longer includes it, and their deprecations page lists it as shut down that date, with
`openai/gpt-oss-120b` or `qwen/qwen3.6-27b` as the named replacements. Switched to
`openai/gpt-oss-120b` — the larger of the two, since this call has to translate into
many different target languages (see `LANGUAGES`), where quality matters more than
raw speed.

**Verified:** `npx vite build` completes with no errors, twice (once after each group
of changes above).

**Not done / worth knowing for next time:**
- Not tested live against a real Groq key — Enda should re-try Translate & Load once
  this is deployed to confirm `openai/gpt-oss-120b` actually returns clean translations
  with `<break>` tags preserved (the prompt's rules were left exactly as they were).
- The `err.message`-hides-the-real-error pattern this fixed likely exists in other
  places that call `base44.functions.invoke()` too — only the two files actually
  involved in this bug report were swept and fixed. Worth a dedicated pass later to
  apply `getFnErrorMessage()` everywhere else the same pattern shows up, so no future
  bug report starts from a meaningless generic message again.
- The one-time key prompt fires once per login per browser tab (component mount), not
  once ever — logging out and back in will re-check, but that's deliberate: it re-asks
  exactly when the check ("do they have a key yet?") could have a different answer.

---

## 2026-08-19 (audit) — API key persistence audit: confirmed the server-side fix holds, found and closed one real remaining gap
Scope: `src/lib/useNarratorApiKeys.js`, `src/components/admin/ApiKeysDialog.jsx`.
No backend files changed.

Enda asked for an audit to make sure a narrator/admin's Google TTS /
Groq API keys can't get deleted by an app update, or by a
refresh/cookies-and-cache clear on their end.

**Confirmed still solid:** the 2026-08-18 fix that moved these keys
into the `AppUser` entity (server-side, keyed by the caller's own
email) is genuinely still in place and correctly wired — checked
directly, not assumed. Searched the whole codebase for every reference
to `google_tts_api_key`/`groq_api_key`: the only function that ever
writes them is `manageApiKeys`, and the only caller of that save path
is `ApiKeysDialog`. No sync/update function (`syncAppUsersFromWordPress`,
`ensureAppUserOnboarding`, `saveAppUserAdmin`) touches these two fields
or does a blind full-row overwrite — each only patches the specific
fields it owns. So neither a WordPress sync, an admin editing a user's
role, nor a normal app update/republish can wipe a saved key. (The one
way a key genuinely goes away is an admin explicitly deleting that
person's whole `AppUser` row via `deleteAppUserAdmin` — that's
intentional account removal, not the accidental loss being asked
about here.)

**Real gap found and fixed:** `ApiKeysDialog`'s Save button was never
gated on the initial load actually succeeding. If the GET to fetch a
person's existing keys failed for any reason — a network hiccup, or
(plausibly, given the ask) a refresh landing a moment before the
narrator/admin's session was fully re-established — the dialog showed
an error banner but still left both fields blank *and the Save button
fully clickable*. Since Save always sends both fields, clicking it in
that state would write two empty strings over whatever was actually
saved, silently deleting it. Reproduced this precisely by tracing the
exact state path (load fails → `keys` stays at its blank initial value
→ Save fires anyway), not guessed at.

Fixed by adding a `loadedOk` flag in `useNarratorApiKeys`, reset to
false at the start of every load attempt (including a retry) and only
set true right after a load has actually confirmed real values from
the server. `saveKeys` now refuses to run at all unless `loadedOk` is
true — enforced inside the hook itself, not just as a UI nicety, so it
can't be bypassed. `ApiKeysDialog` disables both key inputs and the
Save button until a load has actually succeeded, and on a load error
now shows a **Retry loading** button instead of a save action that
could destroy data.

**Verified:** `npx vite build` completes with no errors.

**Not done / worth knowing for next time:**
- Not tested live in the actual Base44 app — worth simulating a failed
  load (e.g. toggling the browser to offline right as the dialog
  opens) and confirming Save stays disabled, then going back online
  and confirming a normal load/save still works exactly as before.
- This only covers the two TTS/translation API keys. If any other
  per-user setting gets added later that follows this same
  load-then-save pattern, it should get the same `loadedOk`-style
  guard.

---

## 2026-08-19 (later) — Real, THIRD cause found: the preview box was hard-limited to 250 characters, unrelated to either earlier fix
Scope: `src/components/admin/TranslationPanel.jsx` only.

Enda reported the ampersand fix made no difference — tested this
directly and precisely rather than guess again: uploaded his actual
real BOR1 script file and ran the exact, current extraction code
against it. It worked completely correctly — all 637 words extracted,
ending exactly where his real document ends, no truncation anywhere
in the extraction itself. That confirmed the two earlier fixes (ZIP
Central Directory, bare-ampersand escaping) are both genuinely
working and weren't the cause of what he was still seeing.

Found the real, third, completely separate cause: `TranslationPanel.jsx`'s
own preview box had a hard-coded `.slice(0, 250)` — deliberately
showing only the first 250 characters (roughly 50 words, matching
exactly what was reported) with a single, easy-to-miss "…" as the
only sign there was more. Confirmed this was purely cosmetic, not
data loss — the actual Translate action already used the full,
untruncated text underneath, so nothing was ever being lost from
translation itself, only from what was visibly shown.

Removed the artificial cutoff — the preview now shows the complete
imported text, in the same already-scrollable box (given slightly
more height), so scrolling actually reveals more content this time
instead of hitting a wall a fixed slice put there on purpose. Checked
the rest of the codebase for the same slice pattern elsewhere — this
was the only instance.

Built and verified clean.

---

## 2026-08-19 — Real, second bug found in the same import feature: a bare "&" anywhere in the document silently truncated it
Scope: `src/lib/fileTextExtractor.js` only.

Enda's earlier fix (the ZIP Central Directory one) was confirmed still
correctly live — this was a genuinely different, second bug in the same
feature, not a recurrence. Reproduced it directly before writing any
fix: built a real, realistic test document containing an ordinary,
completely normal sentence with a bare "&" in it ("Fish & Chips") —
exactly the kind of thing that turns up constantly in real writing, tour
descriptions especially. That single character made the browser's
strict XML parser stop dead at that exact point and silently discard
every paragraph after it, confirmed with a direct test: 0 paragraphs
extracted, a parser error pointing at that exact line. This is the real
cause of "imports fine for a bit, then just stops, nothing more to
scroll to" — not a preview-box illusion this time, a genuine mid-
document parse failure.

Fixed by escaping any bare "&" in the extracted XML before parsing it —
carefully checked to only touch genuinely bare ones; anything already
correctly written (`&amp;`, `&#39;`, etc.) is left completely alone, so
nothing gets double-escaped into garbage. Verified this precisely: ran
the exact updated function, copied verbatim from the real file, against
the same realistic test document — all three paragraphs now come
through correctly, including the one with the ampersand, decoded back
to a normal "&" in the final text. Applied to both the `.docx` and
`.odt` extraction paths, since both were equally exposed to the same
issue. Also added a safety net for anything else that might still
break strict parsing — a clear error message pointing at re-saving as
plain `.txt`, instead of silently truncating.

Built and verified clean.

---

## 2026-08-18 (final pass) — The actual last 3 security scan findings, identified by exact function name and fixed
Scope: `base44/functions/getUserRole/entry.ts`,
`base44/functions/sessionEnd/entry.ts`,
`base44/functions/sessionHeartbeat/entry.ts`.

Earlier assessment of `getUserRole` as "legitimately safe, bootstrapping
function" was too generous — Base44's own scan description made the real
problem clear: it accepted *any* arbitrary email address, not necessarily
the caller's own, and returned whether that email had an elevated role.
That's a genuine information-disclosure issue — a way to check which
accounts are worth targeting, with no login of any kind required to ask.
`sessionEnd` and `sessionHeartbeat` had the same underlying flaw: an email
and device ID with nothing confirming either belonged to whoever was
actually asking, meaning anyone could end or reactivate any other
customer's session on any device.

Fixed all three the same way: they now require and verify a real
WordPress token, and only ever act on the email that token genuinely
belongs to — never an arbitrary caller-supplied value. Searched the
frontend for any current caller of any of these three and found none at
all, so this carries no risk of breaking an existing legitimate flow.

Combined with the two earlier passes today, this closes every item from
the original 12-issue scan: the identity-spoofing fix (7 functions), the
4 entity RLS restrictions, the secret-exposure correction, the XSS fix,
and now these final 3 — `generateTts`, `translateScript`, and
`routeWaypoints` were fixed in an earlier pass and confirmed still live
and correct; these three were the genuinely different, previously
unidentified functions actually behind the last 3 open findings.

Built and verified clean.

---

## 2026-08-18 (even later) — Fixed: previous security fix itself exposed a secret from the wrong location
Scope: `base44/shared/wpToken.ts` (rewritten again),
`base44/functions/getMembershipStatus/`, `getOwnedProductIds/`,
`getWalkCatalog/`, `manageApiKeys/`, `setTourLanguagePref/`,
`syncLibrary/`, `ensureAppUserOnboarding/` (all 7 updated).

A re-run of Base44's security scan surfaced a new Critical finding
directly caused by the previous entry's own fix: `Deno.env.get('WC_SITE_URL')`
was being called inside `wpToken.ts`, a shared module — not an actual
backend function file — which Base44 correctly flags as an exposed-
secret pattern regardless of whether the value itself ever actually
leaked anywhere.

Fixed by moving the secret read to where it belongs: every one of the
7 functions that calls the token-verification helpers now reads
`Deno.env.get('WC_SITE_URL')` itself, inside its own real function
file, and passes it in as a plain argument. The shared module no
longer touches `Deno.env` at all — confirmed directly, not assumed.

Also confirmed directly (not assumed) that the 4 entity RLS fixes and
the identity-spoofing fix from the previous entry are genuinely live
on GitHub right now — pulled the actual repository and checked both.
The remaining items in that same scan screenshot showing as still
open are very likely the scan reflecting a run from before this
delivery's predecessor had fully landed, not real unresolved problems
— worth re-running the scan fresh after this one lands to get an
accurate, current picture.

Built and verified clean.

---

## 2026-08-18 (later still) — Security scan findings: all addressed, verified end to end
Scope: `base44/shared/wpToken.ts` (rewritten), `base44/entities/ActiveSession.jsonc`,
`Device.jsonc`, `DeviceChallenge.jsonc`, `Narrator.jsonc` (+admin-only read RLS),
`base44/functions/getMembershipStatus/`, `getOwnedProductIds/`, `getWalkCatalog/`,
`manageApiKeys/`, `setTourLanguagePref/`, `syncLibrary/`, `ensureAppUserOnboarding/`
(token verification), `routeWaypoints/`, `generateTts/`, `translateScript/`
(added resolveActor check), `src/components/admin/DrivingTourWaypointEditor.jsx`,
`WalkEditor.jsx`, `NarrationTtsEditor.jsx`, `TranslationPanel.jsx` (send identity),
`src/lib/useNarratorApiKeys.js` (+getNarratorAuthPayload helper),
`src/pages/Login.jsx` (XSS fix).

Enda ran Base44's own security scan. Went through every finding individually,
verifying each directly rather than assuming the scanner's severity labels
were all equally real — some were, one category turned out to be a false
positive on closer inspection.

**Critical — identity spoofing / API key theft, genuinely serious.**
`getEmailFromToken` decoded a token's payload without ever checking the
token was real — anyone could hand-construct a fake token claiming to be
any customer or narrator's email, and every function using it would have
simply believed them. This directly threatened the API key storage built
earlier today: a forged token could have pulled someone else's saved
Google/Groq keys straight out of `manageApiKeys`. Found this in **7**
functions, not just the obvious ones. Fixed by adding real verification —
asking WordPress's own token-validation endpoint to confirm a token is
genuine before trusting anything in it — and applied consistently across
all 7. The old unverified decoder still exists, narrowly, only for
`wpLogin` reading a token immediately after WordPress itself just issued
it in that same request, where there's nothing to forge.

**Critical — 4 entities with no read restriction at all.** `ActiveSession`,
`Device`, `DeviceChallenge`, `Narrator` had no explicit read rule, which
on this platform apparently defaults to fully public. `DeviceChallenge`
was the most serious — it holds verification codes. All four locked to
admin-only read.

**High — "anyone can run this function," checked individually rather than
patched by list.** Cross-checked against the scanner's count: several
functions were already properly protected under two different auth helper
names (`isAppAdmin`, `resolveActor`) my first pass missed — false
positives, left alone. A few more (`wpLogin`, `getUserRole`, the device-
login functions) are legitimately meant to work before someone's
identified. The three that were genuinely open — `generateTts`,
`translateScript`, `routeWaypoints` — now require a real admin or narrator
identity, using the same `resolveActor` check already proven correct
elsewhere in this app. Updated all four frontend call sites (one of the
three functions is called from two places) to actually send that identity,
so narrators aren't locked out by a check that only expected an admin
session.

**Medium — XSS via unsanitized login error rendering, confirmed genuine.**
The login page's error message was rendered as raw HTML rather than plain
text — if any error message ever contained something script-like, it
would have actually executed in a customer's browser. Fixed by rendering
it as plain text, which is both the safe default and all an error message
ever actually needs. Swept the rest of the app for the same pattern — one
other instance exists, confirmed safe (standard chart-library code
generating CSS from a fixed developer config, never from user or server
input) and left untouched.

Built and verified clean; re-checked every fix individually afterward —
no leftover insecure token usage anywhere, all four entities carry valid
RLS, all three tool functions have the real check, every frontend call
site sends identity, and the XSS pattern is gone from Login.jsx with the
one other, unrelated instance confirmed safe.

---

## 2026-08-18 (later) — Google TTS / Groq API keys moved from browser-only storage to real, permanent server-side storage
Scope: `base44/entities/AppUser.jsonc` (+`google_tts_api_key`,
+`groq_api_key`), new `base44/functions/manageApiKeys/entry.ts`,
`src/lib/useNarratorApiKeys.js` (full rewrite), `src/components/admin/ApiKeysDialog.jsx`
(full rewrite).

Enda hit the real cost of the old design directly: his Google TTS key
showed empty despite having used it successfully before, and pasting
a fresh Groq key wasn't working either. Traced it to the actual
architecture — these keys were, by design, stored only in
`localStorage` in one specific browser, explicitly never touching the
server or any database record at all. Clearing that browser's site
data (which happened during earlier splash-screen troubleshooting)
silently wiped it, with no way to recover the original value from
anywhere — confirmed directly, not assumed: the key genuinely never
lived in the code or database at any point.

Rebuilt properly per Enda's explicit ask, not patched: keys now live
on the server, tied to whoever's account they belong to, via a new
function that identifies the caller the same dual-auth way everything
else in this app does — a real Base44 session for an admin, or a
narrator's own email+token for a narrator — and only ever reads or
writes that one caller's own record, never anyone else's. Read
directly from the same session data Narr.jsx itself already uses, so
no new props needed threading through the component tree just for
this.

The dialog itself needed a real rework too, not just a backend swap —
values now arrive asynchronously from a network call instead of being
instantly available from localStorage, so it shows a proper loading
state and correctly syncs the editable fields once the real saved
values actually arrive, rather than only ever capturing whatever was
there on the very first render. Description text updated to describe
what's actually true now — the old "stored only in this browser"
line was the root of the confusion and is gone.

Swept the codebase afterward and confirmed nothing else still
references the old localStorage keys directly.

Built and verified clean.

---

## 2026-08-18 — Real bug fixed: .docx/.odt script import was silently truncating some files
Scope: `src/lib/fileTextExtractor.js` only.

Enda reported a script import for BOR1a that looked cut short — and
crucially, tested it himself first: the scrollbar genuinely had
nothing further to reach, ruling out "it's just a small preview box"
before I even looked at the code.

Found a real, concrete bug in the hand-written ZIP-archive reader
this feature uses internally (`.docx` and `.odt` files are ZIP
archives containing XML underneath). It was trusting the compressed-
size field written in each entry's Local File Header — but some ZIP
writers, including some LibreOffice `.odt` exports, don't reliably
fill that field in; the real size only lives in a separate record
written later, and in the Central Directory (a table of contents at
the very end of the archive). Reading the unreliable field meant
grabbing however many bytes it claimed, silently producing a partial
read — exactly the "real beginning, cut off partway through, nothing
more to scroll to" symptom described.

Rewrote the reader to source the compressed size from the Central
Directory instead, which is always authoritative regardless of how an
entry was originally written — the same approach any correct ZIP
reader actually uses, rather than trusting the shortcut that broke.

Verified concretely, not just reasoned about: built an actual test
`.odt`-shaped file reproducing the exact quirk (Local File Header
size zeroed/wrong, real size only in the trailing descriptor and
Central Directory), ran both the old and new extraction code directly
against it in a real JS runtime. The old code failed outright on it;
the new code correctly extracted the complete 8,647-character test
document, all 40 paragraphs, ending exactly where the real content
actually ends.

Built and verified clean.

---

## 2026-08-17 (later) — "Add New Waypoint" panel now starts closed
Scope: `src/components/admin/DrivingTourWaypointEditor.jsx` only.

Enda's ask: opening this form should be a deliberate choice, not the
default state every time the waypoints tab loads. It was genuinely
defaulting to open (`useState(true)`) — a one-line fix to start
closed instead, same collapse/expand toggle already there, just not
sprung open automatically. Checked the regular Walk/Hike waypoint
editor for the same pattern — it doesn't build its add-waypoint UI
this way at all, so nothing else needed the same fix.

Built and verified clean.

---

## 2026-08-17 (later) — GPX/KML backup panel: real gap closed, narrators could reach it; buttons renamed "Back Up"
Scope: `src/components/admin/WalkEditor.jsx`,
`src/components/admin/DrivingTourExportPanel.jsx`.

Enda asked for this to be admin-only. Checked directly rather than
assume — unlike a couple of earlier "already restricted" checks this
week, this one genuinely wasn't: the Preview tab has no narrator
restriction on it at all (unlike the Route Path tab, which is removed
from the tab bar entirely for a narrator), and the export panel
rendered unconditionally whenever that tab was open. A narrator
working on their own translated clone could have reached and used
these buttons. Gated the panel itself specifically to admin — the map
preview and simulator on that same tab stay available to narrators,
since Enda's ask was about the backup files specifically, not the
whole tab.

Worth being precise about what this restriction actually is, rather
than overstate it: unlike the segment-number fix earlier this week,
this isn't a server-side write being blocked — generating a GPX/KML
here is a purely client-side action, built entirely from route data
the narrator's browser already has loaded to let them edit it in the
first place. Hiding the button removes the easy, obvious path to grab
a backup file; it doesn't add a new data boundary, since a narrator
editing a clone already has legitimate access to everything in it.

Also renamed every "Export" reference in this panel to "Back Up" —
heading, description text, status message, and all three buttons —
per Enda's request.

Built and verified clean.

---

## 2026-08-17 (later) — Driving tour waypoint "Description" field removed; stray "medium" pause button removed
Scope: `src/components/admin/DrivingTourWaypointEditor.jsx`,
`src/components/admin/NarrationTtsEditor.jsx`.

Two small admin-UI cleanups, per Enda's direct screenshot:

- **Waypoint Description field**: removed from both the add-new-
  waypoint form and the existing-waypoint edit panel in the driving
  tour editor — redundant, since Location Title already covers it.
  Checked first whether this field is used anywhere else before
  touching it: it's read by the customer-facing map popup and the
  tap-list on the walk detail page, so removing the input doesn't
  delete any existing data on older waypoints — those displays are
  already conditional on the field being present, so this fades out
  naturally as new waypoints stop populating it, rather than needing
  any data cleanup. Left the narrator's own read-only view of this
  field alone for the same reason — harmless, and it'll simply have
  nothing to show going forward.
- **Stray "medium" pause button**: removed from the Narration Script
  & TTS panel's "Insert pause" row — it used a different SSML syntax
  (`strength="medium"`) than the four clearly-labeled duration
  buttons next to it (0.5s/1s/2s/3s) and had no icon, standing out as
  an orphaned, unexplained word rather than a real option.

Built and verified clean.

---

## 2026-08-17 — "Choose GPX / FIT" now accepts an Activity file and a Waypoints file together, merged automatically
Scope: `src/components/admin/WalkEditor.jsx` only.

Direct follow-up to today's manual merge (Ride with GPS attempt, then
a chat-based merge as a workaround) — Enda asked for the actual fix:
select both eTrex files at once, in the admin panel itself, no
external tool or manual step needed ever again.

Restructured `handleGpxImport` to accept one or two files instead of
always exactly one. With two files, their track points and waypoints
are combined in memory before anything else happens — everything
after that point (sequence sorting, segment ID building, elevation
fetching, applying the result to the form) is the exact same code
that already ran for a single file, completely unchanged, so this
carries zero new risk to the existing single-file import path. FIT
files are unaffected — still exactly one at a time, since they need
a different binary parser entirely and can't be combined with a GPX
in the same pass; selecting a FIT alongside anything else now shows a
clear message explaining that, rather than silently doing the wrong
thing.

The file picker itself now allows selecting two files (Ctrl/Cmd-click
both in the file dialog), with the description text updated to
explain this directly, since it's not an obvious capability of a
plain file input otherwise.

Built and verified clean.

---

## 2026-08-16 (later) — Road-routing 502 fixed at the cause, plus a real Retry button
Scope: `base44/functions/routeWaypoints/entry.ts`,
`src/components/admin/WalkEditor.jsx`.

Enda's 124-point GPX import hit "Road routing failed — 502" twice in
a row, falling back to straight lines connecting waypoints in import
order rather than a real route. Confirmed his data was never at risk
either time — the fallback only ever affects the trail LINE, the
waypoints themselves were untouched.

Traced the actual cause: the routing service is a free, public OSRM
demo server, not a dedicated paid one, and the code fires off several
batched requests to it back-to-back with no pause between them — this
tour needed about 5 separate calls. That's exactly the request shape
that trips a shared public server's own rate limiting, which fits two
consecutive failures far better than one-off bad luck. Added a short
pause between successive batches (not just the retry backoff that
already existed within a single batch) specifically to avoid
triggering that.

Also added a genuine "Retry routing" button next to the GPX import
control — re-runs road routing on whatever waypoints are already
loaded in the editor, without needing to re-import the GPX file from
scratch if this happens again in the future.

Built and verified clean.

---

## 2026-08-16 — Major finding: translation corrections likely never reached real customers at all — fixed in both places
Scope: new `base44/functions/getTranslationOverrides/entry.ts`,
`src/components/admin/TranslationsManager.jsx`,
`src/lib/i18n/LanguageContext.jsx`.

Started from Enda's German narrator reporting that a saved
translation appeared to "flip back to English" immediately after
saving. Traced precisely: the save itself was genuinely working —
`saveTranslation` already correctly used `asServiceRole`, the write
was real. The bug was in what happens immediately after: the reload
that refreshes the screen to show the result used a *direct*
client-side `base44.entities.Translation.list()` call — the one place
in this whole narrator-editing flow that hadn't been routed through a
dedicated backend function, the same reason every other piece of
narrator functionality in this app needed one in the first place (a
narrator has no genuine Base44 login session at all). Her save landed
correctly in the database; the very next thing that happened, showing
her the result, likely failed silently and fell back to the
uncorrected baseline — making a working save look like it had done
nothing.

**Checked further and found the identical pattern in the live,
customer-facing app itself** — `LanguageContext.jsx`'s own
`loadOverrides`, the function responsible for showing every narrator's
corrections to real customers, used the exact same direct client call,
wrapped in a silent catch that would swallow any failure with zero
indication anything was wrong. Regular customers don't have a genuine
Base44 session either, for the same underlying reason. This raises a
real possibility worth being direct about: corrections narrators have
saved — not just today's German work, potentially the existing Dutch
and Czech corrections too — may never have actually reached a real
customer's screen, despite being genuinely saved and genuinely
correct in the database the whole time.

Fixed at the root, not patched per-symptom: one new function,
`getTranslationOverrides`, using `asServiceRole` so it works
regardless of who's asking — reused in both places (the narrator's own
editing tool, and the live app every customer actually uses). Swept
the rest of the codebase directly afterward and confirmed these were
the only two places this specific pattern existed anywhere.

Built and verified clean.

---

## 2026-08-15 (later) — Route Path (GPS) map editor performance fix
Scope: `src/components/admin/TrailPathMapEditor.jsx`.

Enda reported the Route Path (GPS) editor on the real "BOR" (Battle of the
Rivers) tour "zooms in extremely slow, if at all" — not missing, just
unusable. Root cause: the editor rendered one full Leaflet `<Marker>` (a
DOM-based `L.divIcon`) per trail point, and BOR's imported route has 4,809
trail points. Leaflet has to reposition every mounted marker on every
zoom/pan animation frame, so at that count zooming became effectively
unusable.

Fix: added a `POINT_MARKER_MIN_ZOOM = 15` constant and a new `PointMarkers`
sub-component (using `useMap`/`useMapEvents` from react-leaflet) that only
mounts point markers once zoomed to street level or closer, and only for
points inside the current viewport (padded 30% so they don't pop in/out
right at the edge while panning). Replaced the old unconditional
`{trailPath.map(...)}` marker block with `<PointMarkers .../>`, and added a
UI hint in the stats footer (shown when `trailPath.length > 500`) explaining
why points appear only once zoomed in.

Confirmed no functionality was lost: Add mode's click-to-insert, Delete
mode's box-select, and Cut mode's segment-break are all position/geometry
based (not marker-based), so all three still work fully zoomed out. Only
per-point drag and per-point click-to-delete now require zooming in past
level 15 — a direct, intentional tradeoff to fix the reported bug.

Verified: `npm run build` clean (exit 0); `npm run lint` shows the same
pre-existing 18-error baseline as before this change (all
`unused-imports/no-unused-imports`, none in this file). Not yet visually
verified against the live BOR tour in Base44 — Enda to confirm after
redeploy.

## 2026-08-15 — GPX/KML export locked to Admin only
Scope: `src/components/admin/WalkEditor.jsx` (one line).

Enda flagged that the "Export Driving Audio Tour" panel (GPX/KML download
buttons, `DrivingTourExportPanel.jsx`) must never be reachable by any user —
GPX/KML are for internal route editing and final tour production only. It was
rendering for both Admin and Narrator roles in the Preview tab with no gate at
all. Confirmed `generateGpx`/`generateKml`/`downloadTextFile`
(`src/lib/routeExport.js`) are pure client-side — no backend function is
involved (checked `base44/functions/` for anything gpx/kml/export-related:
none exists), so there's no separate server endpoint to lock down; the only
fix needed was the UI gate. Wrapped `<DrivingTourExportPanel>` in
`{!isNarrator && (...)}`, matching the same admin-only pattern used for speed
and pricing fields in the Phase 1 work above.

Not yet done: build/lint verification for this change, and pushing to
Base44 — Enda still needs to redeploy per the earlier per-file force-deploy
workaround once this is confirmed.

## 2026-08-14 (later same day) — Phase 1: real backend access control, ownership, and speed lock-down for Walk
Scope: implements the Phase 1 plan Enda approved off the Simulator audit below
(access control + ownership + speed security first; the per-segment
"completely edited" simulator-unlock gate and the break-tag/audio-timing
feature are deferred to Phase 2, pending the audio model — see Enda's two
mid-planning clarifications, captured but not acted on yet).

**The core problem fixed:** every Admin/Narrator rule discussed anywhere in
this app (who can open which tour, who can set speed, one-clone-at-a-time)
was UI-only — the Base44 SDK client runs `requiresAuth: false`, Narrator
"sessions" are just a password-checked token in `sessionStorage` never
attached to the SDK, and `Walk` had no `rls` block, so every `entities.Walk.*`
call a Narrator's browser made went out unauthenticated and unrestricted.

New files:
- `base44/shared/backendActor.ts` — `resolveActor(base44, body)` shared by
  every Walk function below. Reuses `isAppAdmin()` (native + promoted admins)
  for the admin path; for Narr Studio sessions, looks up `AppUser` by the
  claimed `email` and validates that row's own `narr_session_token` +
  `narr_session_expires_at` (never a global token scan). Returns
  `{kind:'admin'}` / `{kind:'narrator', email}` / `null`. This is the real
  security boundary for `Walk` now — `Walk.jsonc`'s new `rls` block (below) is
  a backstop only.
- `base44/functions/getWalksForBackend/entry.ts` — admin gets the full list
  unrestricted; narrator gets cloneable masters trimmed to
  `id,code,name,tour_category,region` (no script/waypoint/trail data for
  tours they don't own) plus their own clone(s) in full.
- `base44/functions/saveWalkForBackend/entry.ts` — admin write is
  unrestricted. Narrator write is rejected unless the target is their own
  clone (ownership re-checked server-side against a freshly-fetched copy,
  never the client's). Narrator payload is whitelisted: top-level
  `name`/`description`/`safety_notes`/`finished`/`waypoints`/`segment_scripts`
  only — everything else (region, difficulty, distances, GPS, code, pricing,
  `default_driving_speed_kmh`, `avg_segment_speed_kmh`, etc.) is silently
  dropped, not just hidden in the UI. `waypoints[]` merge is index-based
  (narrators can't reorder/add/remove today) and only takes narration/audio
  sub-fields from the client — `lat`/`lng`/`waypoint_role`/
  `avg_segment_speed_kmh` always come from the server. `segment_scripts[]`
  merge lets a narrator move `draft`↔`finalized` only — `status:'accepted'`
  and `finished_audio_url` stay admin-only.
- `base44/functions/cloneWalkForBackend/entry.ts` — re-derives `clone_of`,
  `assigned_narrator_email`, `finished:false`, `approved:false` server-side.
  Enforces, server-side: can't clone a clone; a narrator can't start a new
  clone (of anything) while they have one with `finished:false` in progress —
  scoped per-narrator, not per-master (matches Enda's clarification that a
  different narrator can clone the same master concurrently); target language
  isn't already published for this master. Admins exempt from the one-clone
  limit.
- `base44/functions/deleteWalkForBackend/entry.ts` — admin actor only.

Changed files:
- `base44/entities/Walk.jsonc` — added an `rls` block (read/create/update/
  delete, `user_condition:{role:"admin"}}`), same shape as `AppUser.jsonc`.
  Backstop only (see above) — deliberately not the primary gate, since it
  doesn't recognize "promoted" admins (native role `user`, `AppUser.role`
  `admin`), which is why real enforcement lives in the functions instead.
- `src/components/admin/BackendShell.jsx` — every direct
  `base44.entities.Walk.*` call replaced with `base44.functions.invoke(...)`
  against the four functions above. Fixed the one-clone unlock timing:
  `myActiveClones` now filters on `!w.finished` (was `!(w.finished &&
  w.approved)`) — per Enda, the lock releases the moment a narrator marks
  their clone finished, not only once an admin has also approved it. Added a
  `view === 'walks' && isAdmin` guard around `WalkAdminList` (UI backstop
  only — the real boundary is the functions rejecting a narrator actor).
- `src/components/admin/WalkEditor.jsx` — gated the Details tab to
  `!isNarrator` for every structural/admin field: Route Type, Route/Tour
  Code, GPX Import, Region/Difficulty, free-sample toggle, Main Interests,
  Distance/Duration/Elevation, Default Average Driving Speed, Starting Point
  GPS, Pricing & Purchase. Name/Description/Safety Notes stay editable by
  both roles (the actual translated content). Threaded a new
  `defaultDrivingSpeedKmh={form.default_driving_speed_kmh}` prop into
  `<DrivingTourWaypointEditor>`.
- `src/components/admin/DrivingTourWaypointEditor.jsx` — fixed a dead
  default: `defaultSpeed` now reads the new `defaultDrivingSpeedKmh` prop
  (`tourCategory === 'WBT' ? 3.5 : (defaultDrivingSpeedKmh || 50)`) instead of
  always hardcoding `50` regardless of what an Admin set on the Details tab.
  (The per-waypoint `avg_segment_speed_kmh` field itself was already
  correctly admin-only here — that part of the earlier audit finding was
  already fine.)
- `src/components/admin/TourSimulator.jsx` — removed the Auto-Speed toggle
  and the manual speed controls (preset buttons + free-text input) entirely;
  this was the actively-bypassable hole the audit flagged. Speed is now
  always computed, never user-set: WBT fixed at 3.5 km/h; DDV starts from
  `default_driving_speed_kmh` (falling back to 50 only if an Admin hasn't set
  one) and auto-advances through each segment's own `avg_segment_speed_kmh`
  as the marker reaches it, via the existing `speedZones` logic. Replaced the
  removed controls with a plain read-only speed readout. Left the unrelated
  1×/2×/5×/10× "Simulation Speed" playback multiplier untouched.

Verified: `npm run build` (clean), `npm run lint` (18 pre-existing errors,
all in files untouched by this change, confirmed identical via `git stash`
diff — zero new lint errors introduced), `npm run typecheck` (net 4 *fewer*
errors than baseline, zero new ones — this project's `tsc` pass is a weak
signal generally, since `jsconfig.json`'s `include` doesn't cover most
`.jsx` files and most existing errors are a generic `children`-prop typing
issue unrelated to any of this). No Base44 staging environment available in
this session to run the functions live — manual QA against the 6-scenario
matrix in the approved plan (native admin, promoted admin, narrator,
admin-wearing-Narr-hat, direct-SDK-bypass, anonymous) is still outstanding
and should happen before this ships.

Deferred to Phase 2 (not started): the per-segment "completely edited →
simulator unlocks" gate, and the break-tag/audio-duration-vs-simulator-speed
sync feature — both depend on resolving which audio model is actually live
(continuous per-segment track vs. today's per-waypoint geofence clips).

## 2026-08-14 — Simulator function: full audit, no code changed
Scope: audit only. Read in full: `TourSimulator.jsx`, `TourSimulatorMap.jsx`,
`SegmentScriptEditor.jsx`, `SegmentScriptManager.jsx`, `ScriptTimingPanel.jsx`,
`NarrationTtsEditor.jsx`, `AudioTriggerFields.jsx`, `DrivingTourWaypointEditor.jsx`,
`WalkEditor.jsx`, `WalkAdminList.jsx`, `BackendShell.jsx`, `AdminStartScreen.jsx`,
`Admin.jsx`, `Narr.jsx`, `AuthContext.jsx`, `base44Client.js`, `app-params.js`,
`narrationUtils.js`, `ttsParser.js`, plus the `Walk`/`User`/`AppUser`/`Narrator`
entity schemas and the `narrLogin`/`getUserRole` backend functions.

Enda asked for a breakdown of dead ends / non-functioning / not-gated-properly
issues in the Simulator, checked against a specific spec: Admin+Narrator-only
access, segment must be "completely edited" before its simulator is available, a
Narrator restricted to the WalkAbout/Driving tour they're working on, fixed
non-editable 3.5 km/h walking speed for WBT, Admin-set non-Narrator-editable
per-segment driving speed for DDV, and break-tag duration editing so a segment's
audio finishes exactly when the simulator reaches the segment's end. Full writeup
left at `SIMULATOR_AUDIT_2026-08-14.md` in the repo root (also sent to Enda
directly) — not duplicated here in full, just the headline findings so a future
session doesn't have to re-derive them:

- **Biggest finding: enforcement gap predates the Simulator.** `base44Client.js`
  creates the SDK with `requiresAuth: false`; Admins get a real Base44 session via
  native login, but Narrators (`Narr.jsx` / `narrLogin`) only get a bespoke
  `narr_session_token` in `sessionStorage` that's never attached to the SDK client
  — so every `entities.Walk.*` call a Narrator triggers goes out **unauthenticated**.
  `Walk.jsonc` has no `rls` block at all (unlike `AppUser.jsonc`, which does). Net
  effect: literally every role/ownership check anywhere in this app (not just the
  Simulator) is UI-only today — a client calling the public SDK directly bypasses
  all of it. Adding `isNarrator` checks inside `TourSimulator.jsx` alone would be
  cosmetic, not real enforcement, unless this is fixed first (either give Narrators
  a real authenticated identity + add `rls` to `Walk`, or route Walk writes through
  a backend function that checks `narr_session_token` server-side).
- `TourSimulator`/`TourSimulatorMap` currently take **no `userRole` prop at all** —
  no role-based gating is possible in them as written today. Reachability is
  narrowed upstream (only admin/narrator ever reach `WalkEditor`; Simulator only
  renders for WBT/DDV), and Narrator-ownership is *mostly* inherited for free since
  Narrators today only ever work inside their own translation clone — but
  `WalkAdminList.jsx`'s `onEdit` path to `WalkEditor` has none of the
  narrator-must-own-a-clone check that `BackendShell`'s `onContinueTour` has (currently
  unreachable by narrators via the UI since they're never shown the "Manage Tours"
  button, so latent rather than live).
- **No "segment completely edited → simulator available" gate exists anywhere.**
  `TourSimulator` only checks `trailPath.length >= 2`; `segment_scripts[].status`
  (draft/finalized/accepted) is tracked but never used to gate simulator
  availability, only which buttons `SegmentScriptEditor` shows.
- **Speed lock-down isn't implemented and is actively bypassable.** The Simulator
  has its own independent, unrestricted speed control (Auto-Speed toggle off →
  preset buttons `[3, 3.5, 4]` for WBT / `[30, 50, 80]` for DDV → plus an unbounded
  free-text field) available to either role — this overrides the correctly-locked
  `avg_segment_speed_kmh` (which *is* properly admin-only inside
  `DrivingTourWaypointEditor.jsx`). Also found: `default_driving_speed_kmh` (Details
  tab) has no narrator gate and is dead code — `DrivingTourWaypointEditor.jsx`
  hardcodes its own default (`WBT ? 3.5 : 50`) and never reads that field at all.
- **Break-tag ↔ simulator-speed sync (audio finishing exactly at segment end) is
  essentially unbuilt, and it's structural, not a small gap.** Two disconnected
  audio models exist: per-waypoint (`wp.audio_clip_url`, geofence-triggered) is
  what `DrivingTourPlayer.jsx` actually plays live; per-segment (`segment_scripts[]`
  → combined → break-tag-edited → draft TTS → simulator-tested → accepted →
  `finished_audio_url` uploaded for ElevenLabs) is what the Simulator's
  `SegmentScriptEditor` is built around. Grepped `src/`: `segment_scripts` /
  `finished_audio_url` / `final_audio_url` / `combined_audio_url` are referenced
  nowhere outside the admin editors except `offlineStorage.jsx` (bundled for
  offline caching only) — **no live player ever plays segment-level audio**, so
  today's "accepted, finished" segment audio is never actually heard by a customer.
  Separately, the Simulator's own `<audio>` element only plays per-waypoint clips on
  geofence entry — it has no awareness of `segment_scripts` — so there's no code
  path today where segment audio plays alongside the moving marker for a live
  finish-time comparison. `ScriptTimingPanel`'s travel-vs-narration numbers are a
  static WPM-formula estimate, not a measurement of real generated audio, and
  aren't tied to an actual simulator run.
- Smaller items in the full writeup: "Jump to location" only supports
  `primary_start` (no segment-end equivalent); Auto-Speed toggle state isn't
  persisted; `AudioTriggerFields` (radius/bearing/trigger-once) has no role
  restriction; `getUserRole/entry.ts` is dead code, never called, and checks a role
  value (`narrator`) that the `User` entity's own schema doesn't allow (harmless —
  `AppUser.role` is the one actually used).

No files changed. Enda is deciding what to action from the full writeup before
anything gets built.

---

## 2026-08-13 (later same day) — Offline-save safety requirement, complete: banner, Start gate for all 3 tour types, and reset-on-remove
Scope: `src/components/walks/WalkDetail.jsx`, `src/lib/i18n/index.js`
(+4 keys: `detail.offlineWarning`, `detail.offlineThankYou`,
`detail.startWalk`, `player.mustSaveFirst`). Driving tours' own Start
button (`DrivingTourPlayer.jsx`) was already fixed in an earlier
session and is unchanged here — this entry completes the same
requirement for Walk/Hike and WalkAbout tours, which didn't have it
yet on this particular copy of the code.

Full requirement, built together as one consistent piece rather than
layered separately: a legal/safety compliance banner shows every time
an owned tour is opened (warning if not saved offline, a thank-you if
it is); Walk/Hike and WalkAbout tours now have a real "Start Walk"
button gating the map, live progress, and waypoint list, disabled
until the tour is saved — closing the gap where the banner alone
could simply be scrolled past with nothing actually stopping tour use.

Also handles the case Enda raised directly: removing a downloaded
tour to free up phone storage, then wanting to redo it later. Checked
this specifically — `isDownloaded` is already reactive (confirmed via
the offline hook's own sync event), so the moment a tour is removed
via "My Library," this screen picks that up immediately. Added one
more piece for full correctness: if someone removes the offline copy
while this exact tour is still open and already started, the gate
now re-locks immediately rather than only re-checking the next time
the screen happens to be opened fresh — re-downloading later
genuinely goes through the same Start gate again, not a one-time
unlock that persists after removal.

Built and verified clean; checked specifically for leftover duplicate
declarations after consolidating changes from several separate
pending pieces into one file.

---

## 2026-08-13 (later same day) — Driving tours: "Start Tour" now genuinely blocked until saved for offline use
Scope: `src/components/walks/DrivingTourPlayer.jsx`,
`src/lib/i18n/index.js` (+1 key: `player.mustSaveFirst`).

Escalation of the compliance banner from the previous entry — Enda
wanted it made impossible to actually start a tour without having
saved it offline first, not just a visible reminder.

Driving tours have a real, explicit "Start Tour" action, so that's
genuinely disabled now (not just visually greyed out — the click
handler itself won't fire) until the tour has been saved for offline
use, with a clear message explaining why sitting right above the
button, not just a hover tooltip that wouldn't help on a phone.
Fixed a real JSX nesting mistake introduced while restructuring this
button's wrapper for the new message — caught before shipping, since
the build wouldn't have compiled clean otherwise.

**Honest finding, not a fix:** Walk/Hike and WalkAbout tours have no
equivalent "start" action to gate at all — checked directly, their
GPS progress tracking already begins passively the moment the screen
opens, with no button involved. The one control that looked similar
(the crosshair "follow my location" icon) turned out to just be a
map-recentering convenience, not something that starts anything.
Rather than force a fake gate onto something that isn't really
"starting," left these two tour types covered by the existing
non-dismissible banner from the previous entry, which already
satisfies the "shown every time" requirement for them — there's
simply no further moment to block beyond that.

Built and verified clean.

---

## 2026-08-13 (later same day) — "Continue Working" renamed to "Audio Still Needed"
Scope: `src/components/admin/AdminStartScreen.jsx` only.

Small follow-up to the previous two entries. Enda's original label
suggestion ("Driving Tours — Audio Still Needed") was correct for the
section's scope *before* the immediately preceding fix, but would
have been wrong immediately after it — that same conversation
expanded this section to cover all 3 tour types, not driving tours
only. Flagged that mismatch rather than apply the now-stale wording,
and used the accurate half instead: "Audio Still Needed," with no
tour-type qualifier, since it genuinely covers all of them now.

Also investigated Enda's pushback question for this screen directly
rather than guess: confirmed no per-file audio rejection mechanism
exists anywhere in the upload code. But also confirmed this section
is admin-only — narrators never see it, checked via the actual render
path — so whoever uploads through this specific screen is Enda
himself, not a narrator whose work would need routing back to them.
Where that actually matters — a narrator's audio inside their own
translated clone — the existing whole-clone pushback system (built
earlier) already covers it correctly with no new feature needed,
since a clone is always tied to the narrator who owns it. Nothing
built from this — reported back for Enda's decision on whether a
narrower, per-file version is worth building on top of that.

Built and verified clean.

---

## 2026-08-13 (later same day) — Admin Tools button subtitles overflowing their card edges — a shared cause
Scope: `src/components/admin/AdminStartScreen.jsx` only.

Enda spotted the "Manage Users" and "Disputes" subtitle text spilling
past their button's edge. Traced to the shared `Button` component
itself: its base style includes `whitespace-nowrap`, which every
child text inherits by default — refusing to wrap onto a second line
and overflowing outward instead of staying inside the card. Both
visibly-broken buttons happened to have the two longest subtitles;
the other three (Dashboard, Manage Tours, Translations) had shorter
text that happened to still fit on one line by luck, not because they
were actually built any differently — same latent risk in all five.

Fixed all five together rather than patch just the two currently
visible — each button's text now explicitly allows wrapping again,
overriding the inherited no-wrap, and can properly shrink to fit its
actual card width instead of pushing past it. Checked for this same
unguarded pattern elsewhere in the admin screens — these five were
the only instances.

Built and verified clean.

---

## 2026-08-13 (later same day) — "GPX Ready" dashboard stat and the entire "community walk" concept removed
Scope: `base44/entities/Walk.jsonc` (removed `walk_category`,
`contributor_name` fields entirely), `src/components/admin/WalkEditor.jsx`,
`src/components/admin/WalksDashboard.jsx`, `src/components/walks/WalkDetail.jsx`,
`src/lib/i18n/index.js` (removed 2 orphaned keys, fixed a 3rd stale one).

Two things, audited fully before touching either:

**"GPX Ready" dashboard stat** — confirmed dead, not just unused: it
counted walks with a value in the exact field the customer GPX
download used, and that whole feature (both the customer button and
the admin upload box that could even set this field) was already
removed. Nothing could ever change this number again going forward.
Removed the stat entirely.

**"Community walk" concept — removed completely, per Enda's decision
not to accept externally-contributed tours.** Searched the whole
codebase for every reference before removing anything (`community`,
`contributor`, `walk_category` specifically, since the word search
alone would have missed a couple of spots). Found it in 5 real
places — the entity schema, the admin dashboard's default badge
logic, the dashboard's per-walk contributor line (a second, separate
spot the first pass initially missed, caught on a follow-up sweep),
and the customer-facing "Community Walk / Contributed by" badge on
the tour detail page — all removed. Also ruled out 4 false-positive
matches from the initial search: "OpenStreetMap contributors" is
required map-attribution text under OpenStreetMap's own license,
completely unrelated to this feature, and was correctly left alone.

Confirmed before removing: `walk_category` had no admin UI to ever
set it to "community" in the first place — it always defaulted to
"official" with nothing in the editor to change it — so this had been
fully dead code the entire time, not a working feature being retired.

**Also fixed, spotted while auditing this same area, directly related
to the GPX removal:** the default safety-notes text shown to
customers still said "Download the GPX file and load it into a
navigation app before departure" — stale advice referencing a feature
that no longer exists. Replaced with a reference to "Save for
Offline," the actual current mechanism.

Built and verified clean; re-swept after the fixes to confirm nothing
was missed.

---

## 2026-08-13 (later same day) — Waypoint popup labels: internal code no longer shown to customers
Scope: `src/components/map/WalkDetailMap.jsx` only.

Enda flagged the waypoint code (e.g. "BOR1a-PS") showing alongside
the plain landmark name in the tap-to-see popup — both in the admin's
own "Map Preview" panel (explicitly captioned "this is how the walk
will appear to users") and on the real customer-facing map.

Traced both to the same single shared component — `AdminPreviewMap`
and the real `WalkDetail` customer page both render through
`WalkDetailMap.jsx` — so one fix here correctly covers both places at
once. The popup now shows only the plain name; the internal code
(`segment_id`) is only used as a fallback if a waypoint somehow has no
name set at all, never shown alongside a real one.

Deliberately did not touch the admin's actual hands-on editing map —
a separate component from this one — where the code stays visible,
exactly as it should for someone actively identifying and working on
specific waypoints.

Built and verified clean.

---

## 2026-08-13 (later same day) — Re-applied the mobile header wrap fix — yesterday's zip was never actually pushed
Scope: `src/pages/Home.jsx` only.

Enda reported the same header overlap from yesterday still happening.
Checked the live code directly before touching anything: it still had
the pre-fix `flex items-center justify-between` (no wrap), confirming
the `mobile-header-wrap-fix-2026-08-12.zip` sent yesterday was never
applied — not a regression, not a new bug, just a zip that didn't make
it into the repo. Re-applied the identical fix fresh against today's
code: header can wrap onto multiple lines instead of forcing an
overlap when everything doesn't fit on one.

Built and verified clean.

---

## 2026-08-13 — Splash screen: zoom locked (scoped to just this screen), title and Enter button sized up slightly
Scope: `src/components/onboarding/SplashScreen.jsx` only.

Root cause of the Android "zoomed into a tiny corner" mystery from
yesterday, confirmed directly: pinch-zoom was never disabled on this
page at all, and something (an actual 1-year-old, in this case) had
pinched it and gotten it stuck zoomed in — Chrome remembered that
zoom level for the site across reloads. Not a code bug; the code was
correct the whole time.

Fixed by locking zoom specifically while the splash screen is showing
— not app-wide, which would be a real accessibility downside for
anyone who wants to zoom elsewhere in the app. Done the same way the
existing scroll-lock already works: temporarily changes the page's
zoom setting on mount, puts it back to normal the moment the splash
closes. Same technique already proven in this file, just applied to
one more setting.

Also bumped the title (now `clamp(1.75rem, 7vw, 3rem)`, up from
`clamp(1.5rem, 6vw, 2.5rem)`) and the Enter button (`text-lg py-4`, up
from `text-base py-3.5`) slightly larger, per request now that normal
zoom is restored. Re-verified the title still can't overflow on any
real phone width — checked mathematically against the same range as
the original fix (320–430px), comfortable margin at every size, plus
the existing wrap-to-two-lines fallback still in place regardless.

Built and verified clean.

---

## 2026-08-12 (later same day) — Splash screen: fixed on iPhone by Enda, broke Android — one specific technique was the cause
Scope: `src/components/onboarding/SplashScreen.jsx` only.

Enda made his own iOS fixes to this file directly (safe-area-inset
padding for notch/dynamic-island phones, image centering, a scroll
lock) — the iPhone result looked correct, but Android stopped
rendering the splash screen at all afterward.

Traced the actual diff line by line rather than guess broadly. One
specific addition stood out: setting `document.body`'s CSS position
to `fixed` (with `width: 100%`) while the splash is up. This is a
real, well-documented fix — but specifically for one iOS Safari bug
(background content bouncing/scrolling behind a fixed overlay). It
is not a general cross-platform technique, and locking the body this
way is a known, documented source of content rendering off-screen or
disappearing entirely on Android Chrome, because Android handles the
viewport and scroll position differently while the body is fixed —
matching exactly what Enda saw.

Fixed by scoping that specific technique to iOS only (detected via
user agent), while every platform still gets the simple, safe
`overflow: hidden` scroll lock that doesn't carry this risk. Also
removed two smaller, unnecessary additions that weren't needed for
the intended fix and added risk without benefit: `touch-none` (blocks
all touch gestures on the element, unrelated to the scroll-bounce bug
it was likely intended to help with) and `transform-gpu` on the image
(a GPU-acceleration hint with no clear purpose here). Everything
genuinely useful from Enda's own changes — safe-area padding on both
title and button, image centering — was kept as-is.

Built and verified clean.

---

## 2026-08-12 (later same day) — Narr password re-entry removed entirely, replaced with a real session token — supersedes the previous entry's dialog fix
Scope: `base44/entities/AppUser.jsonc` (+`narr_session_token`,
+`narr_session_expires_at`), `base44/functions/narrLogin/entry.ts`,
`base44/functions/saveTranslation/entry.ts`, `src/pages/Narr.jsx`,
`src/components/admin/TranslationsManager.jsx` (simplified back down —
the password-prompt-dialog added in the previous entry is now gone
entirely, no longer needed).

Enda's explicit call, after the password dialog from the previous
entry still felt unnecessary: once logged into Narr Studio, that
should be enough — no separate re-confirmation for saving a
translation. Flagged the real tradeoff first (removing the password
check entirely would mean saveTranslation trusting a plain client-side
claim of identity, forgeable by anyone with browser dev tools open,
no actual password needed) — landed on the proper middle ground
instead of either extreme.

How it actually works now: `narrLogin` — which already genuinely
verifies the real password at login — now also issues a random,
unguessable session token at that same moment, stored on the AppUser
record with a 12-hour expiry, and returned to the client. Narr.jsx
keeps that token in the session it already holds. Every subsequent
narrator action (saving/reverting a translation) sends that token
instead of the password; `saveTranslation` checks it against what's
stored server-side and confirms it hasn't expired. The password itself
is still genuinely checked — once, at login, for real — never
bypassed; what's eliminated is asking for it again for the rest of
that same login.

Net effect: a narrator logs into Narr Studio once, and every save
after that just works, with no prompts, no re-entry, nothing to
notice or miss — while a stolen or guessed email address alone still
can't be used to save anything without the real token that only comes
from an actual successful login.

Built and verified clean.

---

## 2026-08-12 (later same day) — Narrator "Enter your Narr password" fixed — was a discoverability problem, not broken auth logic
Scope: `src/components/admin/TranslationsManager.jsx` only.

Enda reported narrators being asked for their password "every time"
in the Translations tool and never being able to save. Traced this
carefully before touching anything, including checking whether this
connected to today's earlier RTL/language work — confirmed it didn't;
nothing touched today reaches this file, this auth flow, or Narr.jsx's
login logic. Also confirmed the underlying design is sound and
deliberately secure: a narrator's session intentionally never stores
their actual password after login (only email, name, role) — so
re-confirming it specifically for making a content change is a real,
intentional security choice, not an oversight to remove.

The actual problem: the password field asking for that confirmation
sat quietly near the top of a page that's mostly a long scrolling list
of translation keys — genuinely easy to scroll past without ever
noticing, especially since nothing pointed a narrator at it directly;
clicking Save just produced a toast saying "enter your password" with
no indication of where.

Fixed the discoverability, not the security model: clicking Save (or
Revert) with no password on file now pops up an actual dialog asking
for it right at that exact moment, submits the pending save the
instant it's confirmed, and doesn't ask again for the rest of that
visit — same one-time-per-visit behavior as before, just impossible to
miss instead of hidden in a box you had to go find.

Built and verified clean.

---

## 2026-08-12 (later same day) — Temporary on-screen debug console added, for capturing phone errors without USB/remote debugging
Scope: new `src/components/DebugConsoleOverlay.jsx`, `src/App.jsx`
(+2 lines wiring it in).

Base44 asked Enda for browser console logs from his phone to
investigate the splash screen issue. Real remote debugging on his
specific phone (a Redmi/MIUI device) turned out to require signing
into a Xiaomi account first — a genuine manufacturer security measure
on USB debugging, not a mistake on his end, but a real hurdle for a
one-off diagnostic.

Built a much simpler alternative: a small on-screen console that
mirrors what the browser's own DevTools Console would show, directly
on the phone's screen — no cable, no computer, no account. Only ever
appears when `?debug=1` is added to the web address; does nothing at
all otherwise, so it can never show up for a real customer by
accident. Captures `console.log`/`warn`/`error` calls and uncaught
errors/promise rejections, shown in a small floating panel a tester
can screenshot directly.

Safe by design: every capture is wrapped so a bug in the debug tool
itself can never be the thing that breaks the real page underneath
it.

Built and verified clean. To use: visit the app with `?debug=1`
appended to the address (e.g. `https://app.magicalcrete.com/?debug=1`),
reproduce the issue, tap the bug icon in the bottom-right corner if
the panel isn't already open, and screenshot what's shown.

---

## 2026-08-12 (later same day) — Waypoint tap instructions reworded — was implying a link to the progress bar that doesn't exist
Scope: `src/lib/i18n/index.js` (English text for `detail.tapInstructions`
only — this key hasn't been translated into Dutch/Czech yet).

Enda noticed the progress bar showing a percentage while zero
waypoint circles were tapped, and rightly questioned whether these two
things were supposed to be connected. Checked directly: they never
were — the progress bar calculates entirely from live GPS position,
the tap circles are a separate, manual system, with no code linking
them at all. They just happen to sit on the same screen, which is
what created the impression they were one feature.

Decision: keep them genuinely separate (not merge them into one
system), but stop the wording implying a connection that isn't there.
The tap instructions now explicitly say what they're actually for —
confirming landmarks for the lose-the-trail safety case — and
explicitly state they're separate from the progress bar and don't
affect it, rather than leaving that to be assumed incorrectly.

Built and verified clean.

---

## 2026-08-12 (later same day) — Customer-facing "Download GPX" removed entirely, per Enda's decision
Scope: deleted `src/components/offline/DownloadWalkButton.jsx`,
`src/components/walks/WalkDetail.jsx` (removed the button + import),
`src/components/admin/WalkEditor.jsx` (removed the now-pointless
"Customer GPX Download" upload box that only ever fed this button,
plus its now-unused state and icon imports).

Enda's explicit call: "Save for Offline" already gives customers full
offline use inside the app, and he doesn't want anyone able to walk
away with a standalone GPX file usable in a completely different app
— reasonable, since that's the one thing nothing in the app's own
offline system can protect against once it's out the door.

Deliberately did NOT touch: the admin's own separate "Export" tool
(GPX/KML download for Enda's own use — loading a route into a Garmin
or similar) — that's an admin-only feature, unrelated to what
customers can reach, confirmed still fully intact and untouched. Also
left the `gpx_file_uri`/`gpx_filename`/`gpx_url` fields on the Walk
entity alone rather than removing them — they're simply unused now,
not worth the extra risk of an entity change for a pure cleanup with
no functional benefit.

Built and verified clean.

---

## 2026-08-12 (later same day) — UI and narration language pickers stacked vertically, not side by side
Scope: `src/pages/Home.jsx`, `src/components/ui/LanguagePicker.jsx`,
`src/components/ui/NarrationLanguagePicker.jsx`.

Direct consequence of the previous entry: making the narration picker
show its "Narration:" label made it visibly wider, and that was
enough to push an already-crowded header over the edge — the title
and tagline started wrapping and visually overlapping the language
dropdown on Enda's screen. Per his own suggestion: the two language
controls are now stacked one above the other instead of sitting side
by side, which keeps the same total content but in a much narrower
horizontal footprint. Gave them a shared, consistent width (wide
enough to comfortably fit the longest realistic content — "Match UI
(Portuguese)" — without truncating) so the stack reads as one
deliberate pair, not two mismatched boxes.

Built and verified clean.

---

## 2026-08-12 (later same day) — Narration picker now clearly labeled — was reading as an unexplained duplicate language picker
Scope: `src/components/ui/NarrationLanguagePicker.jsx` only.

Enda's reaction to seeing the UI language picker and narration
picker side by side, both looking nearly identical: fair confusion —
the narration one had no visible text saying what it actually
controls, just a small headphone icon next to a value. The label
"Narration" already existed as text, in all three languages, but was
only ever used as an invisible screen-reader label — never actually
shown on screen.

Made it visible: the picker now reads "🎙 Narration: Match UI
(English)" instead of just "Match UI (English)" — same visible-prefix
pattern already used on the tour-type dropdown ("Change: Change tour
type: ..."), so it reads at a glance as "this is about the spoken
tour audio," not "why is there a second one of these."

The functionality itself is unchanged and was deliberately kept, not
removed — this is what makes it possible for a customer with, say, a
Czech UI to hear German narration if Czech narration isn't published
for a given tour yet, exactly the case Enda specifically asked for
earlier. Only the labeling was the actual problem.

Also re-applied the native-language-name fix from earlier today (the
"Match UI (Italiano)" not "Match UI (Italian)" one) — this file had
reverted to the English-name lookup, so folding it back in here
rather than leaving it to regress again silently.

Built and verified clean.

---

## 2026-08-12 (later same day) — The real cause of the dropdown clipping: it was rendering behind the map, not actually cut off
Scope: `src/components/ui/select.jsx` only.

Enda's own diagnosis, and it was sharper than the previous entry's
fix: the earlier height-clipping bug was real and worth fixing, but
it wasn't the whole story. He noticed the *actual* pattern — longer
labels like "Walking/Hiking Tour" push the header to wrap onto a
second line, which pushes the map down and gives the dropdown enough
room to fit entirely within the header's own space. Shorter labels
like "Driving Tour" don't force that wrap, so the dropdown has to
extend down over the map area to show its full list — and that's
exactly when it disappeared, because it was rendering *underneath*
the map, not actually missing anything.

Confirmed directly: Leaflet (the map library) ships with its own
built-in z-index values ranging from roughly 200 up to 1000 for its
various layers and on-screen controls. The dropdown had `z-50` —
lower than all of it. Any time the dropdown needed to visually overlap
the map, it was guaranteed to lose. Fixed by raising it to `z-[9999]`,
comfortably clear of anything Leaflet uses and confirmed (checked
directly) higher than everything else in the app except two
deliberately full-screen blocking modals that would never be open
alongside a dropdown at the same time anyway.

Built and verified clean.

---

## 2026-08-12 (later same day) — Real bug found and fixed: the shared dropdown component was clipping its own list
Scope: `src/components/ui/select.jsx` (the shared dropdown primitive
used everywhere — language picker, narration picker, tour type, and
admin dropdowns, 15 files total), `src/pages/Home.jsx` (tour-type
list reordering).

Enda noticed "Driving Tour" vanishing from the tour-type dropdown
whenever "Walkabout" was selected. Traced this to a genuine bug in
the shared dropdown component itself, not the tour-type list's own
logic (which correctly lists all three regardless of selection) —
one CSS line was forcing the dropdown's visible list to be exactly as
tall as the tiny trigger button itself (~32px), clipping anything
that didn't fit in that sliver, rather than sizing to fit its actual
contents. Since this is the one shared `Select` component nearly the
whole app uses, this had the potential to be quietly clipping other,
longer dropdowns too, not just this one — fixed at the source rather
than patched around it in one place.

Also implemented Enda's reordering request: whichever tour type is
currently selected now always shows at the top of the list, with the
other two below it — all three still genuinely present and correct,
just reordered for visibility, not filtered.

Built and verified clean.

---

## 2026-08-12 (later same day) — "My Library" badge was showing the wrong number entirely
Scope: `src/pages/Home.jsx` only.

Enda caught this by testing on a fresh account with nothing purchased
— the badge on "My Library" showed "1" with nothing actually in it.
Root cause: when My Library was rebuilt earlier today to show
everything *owned* rather than just everything *downloaded*, the
badge count itself was never updated to match — it was still counting
`getAllOfflineWalks()` (whatever's saved locally in this browser's
storage, left over from earlier testing sessions), a completely
different, unrelated number from what the page it's attached to
actually shows.

Fixed: the badge now counts the exact same thing the page displays —
owned tours, computed with the identical filter MyWalks.jsx uses,
from the same already-loaded catalogue data — so this pair can't ever
disagree with each other again. Also swapped the icon from a Wi-Fi/
offline symbol (leftover from when this button meant "downloaded") to
a plain library icon matching what the button now actually represents,
and removed the offline-walks hook entirely from this file since
nothing in it needed that data anymore.

Built and verified clean; confirmed no other leftover references to
the old offline-count logic remain in this file.

---

## 2026-08-12 (later same day) — Fixed: the pushback lock never released once a narrator actually fixed it
Scope: `src/components/admin/BackendShell.jsx`,
`src/components/admin/AdminStartScreen.jsx`.

Real bug in the previous entry, caught before it was even installed:
`pushback_reason` stays set on a clone until the admin actually
re-publishes it (deliberately, so the row keeps showing what was
wrong). But the lock-out check was reading that same field to decide
whether a pushback was still "pending" — so a narrator who fixed the
correction and sent it back for review stayed locked out of their
other work indefinitely, waiting on the admin to get around to
reviewing it. That's not "fixes can't wait," that's a new bottleneck.

Fixed: the lock now checks whether the narrator's own part is
actually done (`pushback_reason` set but not yet marked finished) —
the moment they tick finished and resubmit it, the lock releases
immediately, regardless of whether the admin has looked at it yet.
Also fixed the status badge, which previously could only ever say
"Needs correction" for a pushed-back clone forever — it now correctly
shows "Correction sent for review" once resubmitted, distinct from
still being worked on.

Built and verified clean.

---

## 2026-08-12 (later same day) — Pushback now takes priority over whatever the narrator was already working on
Scope: `src/components/admin/BackendShell.jsx`,
`src/components/admin/AdminStartScreen.jsx`.

Real gap Enda caught in the previous entry: pushback can land on a
*different* tour than the one a narrator currently has in progress —
it comes from the admin, not from the narrator's own queue, so it
doesn't go through the one-clone-limit that would normally stop a
second thing from becoming active. Someone could end up with an
ordinary in-progress translation *and* an urgent, already-published,
already-purchased pushback sitting active at the same time, with
nothing forcing them to deal with the urgent one first.

Fixed: a pending pushback now blocks a narrator from opening
*anything else* — checked both where it needs to be checked, not just
one. The open-tour action itself refuses to open a different clone
while a pushback is pending, with a clear message naming the tour
that actually needs attention. And the "My translation in progress"
list reflects this before they even try clicking — the non-priority
clone visibly greys out with "On hold — urgent fix pending" rather
than only failing after a click. The pushed-back clone itself stays
fully open the whole time, obviously — this only blocks switching
away from it to something else.

Built and verified clean.

---

## 2026-08-12 (later same day) — Admin can push a published translation back to its narrator for correction
Scope: `base44/entities/Walk.jsonc` (+`pushback_reason`),
`src/components/admin/WalkAdminList.jsx`,
`src/components/admin/BackendShell.jsx`,
`src/components/admin/AdminStartScreen.jsx`.

New feature, admin-only. On the Manage Tours screen, any published
translation clone (in any language) now has a "push back" button next
to it — admin writes a reason (spelling error, wrong translation,
whatever it is), and the tour is immediately unpublished and reopened
for that narrator to fix, with the reason shown prominently on their
clone in the Narr Studio (a red "Needs correction" banner with the
actual feedback text, not just a status change they'd have to guess
the reason for).

**"Prevented from doing anything further until it's fixed" needed no
new blocking logic at all** — deliberately built to ride on the
one-clone-in-progress limit from earlier today rather than duplicate
it: pushing a clone back sets it to unpublished + unfinished, which
is exactly the state that limit already treats as "an active clone in
progress." The narrator's "Clone a tour" section disappears the same
way it would for any other unfinished translation, and the underlying
clone action is blocked server-side the same way — both already
verified against a pushed-back clone specifically, not assumed.

Also added a language badge to the Manage Tours list — clone rows
previously had no visible way to tell which language they were, which
would have made finding the right one to push back needlessly hard.

Re-publishing a corrected clone clears the pushback reason
automatically, since a fresh publish confirms the fix was accepted.

Built and verified clean.

---

## 2026-08-12 (later same day) — Corrected: the "unpublished" clone rule, per Enda's follow-up
Scope: `src/components/admin/BackendShell.jsx`,
`src/components/admin/AdminStartScreen.jsx`,
`src/components/admin/CloneTourDialog.jsx`.

Enda corrected the previous entry's assumption — the actual rule is
the reverse of what was built: **masters are cloneable regardless of
their own publish status** (a narrator can translate a tour that
isn't live yet); the "unpublished only" restriction applies to the
**target language**, not the master — a narrator must never be able
to clone a tour into a language that already has a finished,
published version of it, since that's duplicate work.

Fixed properly, in both places, not just one: `cloneableTours` no
longer filters by the master's own `approved` status at all. Added a
per-master lookup of which languages already have a finished,
published clone, and wired it through to the language picker in
`CloneTourDialog` — an already-published language for that specific
tour never even appears as an option. Also blocked server-side in
`handleCloneTour`, same defense-in-depth pattern as the one-clone-limit
rule from the previous entry — so this can't be bypassed even if the
dialog's own filtering is ever stale.

The one-clone-in-progress limit and the master-tour-open guard from
the previous entry were correct as originally understood and are
unchanged here.

Built and verified clean.

---

## 2026-08-12 (later same day) — Narrator clone workflow: one-at-a-time limit, master-tour guard, active-only view
Scope: `src/components/admin/BackendShell.jsx`,
`src/components/admin/AdminStartScreen.jsx`.

Three rules Enda asked for, audited against the actual current code
first rather than assumed:

1. **Narrators must never open a master tour, only a clone.** Checked
   this carefully — the current UI already never gives a narrator a
   button that opens a master (only "Clone" on masters, only "Open"
   on their own clones), so this wasn't actively broken. But there was
   no code-level check stopping it either — just the absence of a
   button, not a real guard. Added an explicit check on the actual
   open-tour handler: a narrator opening a walk that isn't a clone
   (`clone_of` unset) is now blocked with a clear message, not just
   prevented by there happening to be no button for it.

2. **Only one translation clone in progress at a time, per narrator.**
   Wasn't enforced at all before — a narrator could clone multiple
   tours simultaneously. Now blocked in two places, not just one: the
   "Clone a tour to translate" list disappears (replaced with a clear
   "finish your current one first" message, not a misleading "no
   tours available") the moment a narrator has any unfinished clone,
   and the actual clone action itself is blocked server-side too, not
   just hidden in the UI — so this can't be bypassed by, say, an old
   cached page still showing the button.

3. **Narrator's own clone list now shows active work only** — the
   one interpretation here I made a judgment call on rather than
   found stated outright, flagging clearly: "My translation clones"
   now hides anything already finished *and* published, since at that
   point it's a live public tour, not something the narrator still
   needs to manage. Renamed the heading to "My translation in
   progress" and added a short explanation so it's clear why
   something disappears from the list after publishing, rather than
   looking like it vanished. If this isn't what "should see
   unpublished only" meant, easy to adjust — flagging the assumption
   rather than silently guessing.

None of this touches the admin side (an unrestricted admin wearing
the Narr hat still sees and can manage everything, published or not
— they're the one doing the reviewing).

Built and verified clean.

---

## 2026-08-12 (later same day) — "My Library" rebuilt to show everything owned, not just what's downloaded
Scope: `src/pages/MyWalks.jsx` (full rewrite), `src/lib/i18n/index.js`
(English text for `home.myLibrary`, `mywalks.title`,
`mywalks.emptyTitle`, `mywalks.emptyHint`, `mywalks.offlineNote`).

Enda's own follow-up caught something real in the "Downloaded Walks"
rename from earlier today: that page only ever showed walks already
saved for offline — not everything a customer actually owns. His
concern is a legitimate business risk, not just a wording nitpick — a
customer who can't easily see what they already bought could end up
buying it a second time, leading straight into a refund conversation.

Rebuilt the page properly rather than just re-wording it again. It
now fetches the same live catalogue Home.jsx uses (same React Query
cache key, so the two screens can't ever disagree with each other),
filtered down to everything the customer actually owns — purchased or
free sample, regardless of download status. Each entry shows its real
offline state: the existing "downloaded" badge if it's already saved,
or a direct one-tap "Save for Offline" button (reusing the same
component and progress behavior as everywhere else in the app) if
it isn't — so a customer can both confirm what they own and manage
offline access from the one screen, no need to go hunting through the
main browse list.

Renamed the button back to "My Library" (from "Downloaded Walks",
which was correct for the old, narrower version of this page but not
for this one) — and this actually **fixed** an inconsistency from
earlier today's rename, rather than create a new one: Dutch and Czech
already said "My Library" from before, so English matching it again
means nothing needs a narrator correction pass this time.

Built and verified clean.

---

## 2026-08-12 (later same day) — "My Library" button renamed to match its actual destination; offline note reworded
Scope: `src/lib/i18n/index.js` only (English text for `home.myLibrary`
and `mywalks.offlineNote`).

Enda flagged the offline note as misleading — "These walks are saved
on your device and work without internet" reads like it happens
automatically. Traced it precisely: the page only ever lists walks
already saved via "Save for Offline," so the sentence was technically
true for what's shown, but the button leading there was labeled "My
Library" while the page itself is titled "My Downloaded Walks" — that
mismatch was very likely the real source of the confusion, not just
the sentence itself. Fixed both together: the button now says
"Downloaded Walks," matching the page it actually opens, and the note
now reads "You saved these walks for offline use — they'll work
without an internet connection," past tense, describing something the
customer did rather than something that happens on its own.

**Known gap, not fixed:** Dutch and Czech already had "My Library"
translated (as "Mijn bibliotheek" / "Moje knihovna") from earlier
work. Only changed the English source text here — didn't guess at new
Dutch/Czech wording myself, since that's exactly the kind of stiff,
non-native phrasing Enda's narrator process exists to avoid. Those two
languages will show the old "Library" wording until a narrator
corrects them via the Translations tool, same as any other update to
existing text.

Built and verified clean.

---

## 2026-08-12 — "Change tour type" replaced with a dropdown, bypassing an unresolved dialog rendering bug
Scope: `src/pages/Home.jsx` only.

Enda hit a real bug: clicking "Change tour type" opened the category
dialog, but it rendered as a collapsed, unusable narrow sliver instead
of a proper centered card — full-page dimmed overlay, nothing
clickable, category never actually changed. Traced this together at
length (screenshots, DevTools inspection, computed styles) — confirmed
it wasn't the day's RTL work (the only lines touched there are
RTL-only and inert in English, verified against the exact commit
diff), and confirmed the dialog's own CSS classes were structurally
correct. Found one real, reproducible clue — it rendered correctly
with DevTools open (narrower effective viewport) and broke at the
full browser width — but couldn't pin down the exact root cause of
that discrepancy from the code alone, and ruled out page-level
horizontal overflow as the explanation (no horizontal scrollbar
present).

Rather than keep chasing an elusive, hard-to-reproduce-remotely CSS
positioning bug in a fixed-position centered dialog, replaced it
outright per Enda's own suggestion: a plain dropdown, using the same
`Select` primitive already proven working elsewhere (language picker,
narration picker) — no fixed-position overlay math involved at all,
so the same class of bug structurally can't recur here. Entries pull
from the same `TOUR_CATEGORIES` list and the same translation keys
(`tour.WHT.label` etc.) as before, so this correctly shows in
whichever language the customer has picked, same as everything else.

`TourCategoryDialog.jsx` and `TourCategoryPicker.jsx` are now both
fully unreferenced anywhere in the app (checked directly) — left in
place rather than deleted, since removal wasn't explicitly asked for
this time; flagging as dead code for whenever a cleanup pass happens.

Built and verified clean.

---

## 2026-08-11 (later same day) — Manage Tours now shows Published/Draft status
Scope: `src/components/admin/WalkAdminList.jsx` only.

Enda flagged the Manage Tours list had no way to tell whether a tour
was actually published or still a draft. Checked directly — confirmed,
the `approved` field was never referenced anywhere in that screen at
all. Added a clear badge next to each tour's other details: red
"Draft — not visible to customers" or neutral "Published". Not yet a
toggle button (kept to exactly what was asked — visibility, not a new
control) — worth adding if he wants one-click publish/unpublish from
this list too. Built and verified clean.

Note: this repo, at the time of this entry, does not yet have the
"RTL layout retrofit" or "show password" changes applied from earlier
today's session — those are still pending application on Enda's end.
This entry was made directly against the actual current live state to
avoid layering a fix on top of code that isn't deployed yet.

---

## 2026-08-11 (later same day) — "Show password" toggle added to both login screens
Scope: `src/pages/Login.jsx`, `src/pages/Narr.jsx`, `src/lib/i18n/index.js`
(+2 keys: `login.showPassword`, `login.hidePassword`).

Anoushka request. Added an eye-icon toggle to reveal/hide the typed
password, on both the customer WordPress login and the narrator
backend login (Narr.jsx) — wasn't sure which one she meant, so did
both rather than guess wrong. Customer-facing one uses `t()` like
everything else from today's sweep; the narrator one is plain English
text, matching the "backend stays English" rule Enda set today. Built
and verified clean.

---

## 2026-08-11 (later same day) — Splash title: added wrap-to-two-lines safety net, per Base44 support
Scope: `src/components/onboarding/SplashScreen.jsx` only.

The earlier `clamp(1.5rem, 8vw, 2.75rem)` fix was calculated to fit
comfortably (checked mathematically against a realistic phone-width
range) but still clipped on Enda's actual device. Base44 support
confirmed the served code genuinely matched the editor throughout
that whole debugging session — ruling out a stale deploy/cache issue
after a long investigation (Cloudflare DNS/proxy setup was checked
and ruled out too, along with the `.base44.app` direct link showing
the identical result). Real device font rendering evidently produces
a wider result than the reference font used to check the math.

Applied Base44's exact recommended fix: reduced to
`clamp(1.25rem, 6vw, 2.75rem)` and added `break-words` with wrapping
allowed, so the title can now fold to two lines rather than clip if
it's ever still too wide for a given device/font combination — a
genuine safety net rather than another single-point guess. Built and
verified clean.

---

## 2026-08-11 (later same day) — Splash title fixed: was overflowing off the right edge of real phone screens
Scope: `src/components/onboarding/SplashScreen.jsx` only.

The "Explore Crete" title rendered fine in a desktop preview but ran
off the right edge on Enda's actual phone (screenshot showed only
"Explore Cr" visible). Root cause of the mismatch: the preview I'd
rendered earlier tested the text against the *image's* raw pixel
resolution (896px), not a real phone's much narrower CSS viewport
width (~360–430px) — a fixed 36px font size that looked proportionate
against 896px is far too large against ~400px, which is what
actually happened on-device.

Fixed properly rather than just guessing a smaller fixed number:
font-size is now `clamp(1.5rem, 8vw, 2.75rem)` — scales in direct
proportion to whatever the real viewport width is on whatever device
it renders on, instead of a static guess. Verified by calculation
across the realistic phone width range (320–430px): fits with 64–85px
of margin on each side at every size tested, never overflows. Also
dropped the unnecessary `tracking-wide` letter-spacing, which was
adding avoidable extra width for no visual benefit at this size.

Not touched, flagged instead: a Facebook Messenger-style chat bubble
visible in the top-left of Enda's screenshot isn't part of this
component or anything Claude built — likely a separate script/plugin
injected elsewhere on the page. Left alone pending Enda's input on
what it actually is.

---

## 2026-08-11 (later same day) — Splash screen rebuilt with the new image and real HTML text
Scope: new `public/splash-background.jpg` (Enda's replacement photo,
converted from the 2.1MB PNG he supplied down to a 296KB optimized
JPEG — same visual quality, much faster first load on mobile),
new `src/components/onboarding/SplashScreen.jsx`, `src/pages/Home.jsx`
(re-added the import/state/render block removed in the last entry),
`src/lib/i18n/index.js` (restored the `splash.enter` key — same
English/Dutch/Czech values as before removal, so no re-translation
needed).

This replaces the splash screen removed earlier today. Exactly the
design discussed then: the new background photo has no text baked
into the pixels — the "Explore Crete" title is now real, live HTML,
pulled from `t('app.title')` so it can never go stale on a rename
again, in blue lettering with a soft top gradient + text shadow for
contrast against the sky, sitting in the open space the photo was
deliberately composed to leave for it. Rendered a pixel preview of
the actual composed result before considering this done — text is
clearly readable, doesn't overlap the backpack/gear composition below.

Built and verified the image is actually present in the production
`dist/` output, not just referenced.

---

## 2026-08-11 (later same day) — Splash screen removed entirely
Scope: `src/pages/Home.jsx`, deleted
`src/components/onboarding/SplashScreen.jsx`,
`src/lib/i18n/index.js` (removed the now-orphaned `splash.enter` key
from all three languages that had it — en, nl, cs).

The splash image had "MAGICAL CRETE WALKING APP" baked directly into
the picture as pixels (not real text), so it couldn't pick up the
app's current name and rendered badly across different phone shapes.
The original source image couldn't be located (checked Base44's own
media library too). Rather than leave a stopgap in place, removed
the screen entirely per instruction — the app now goes straight from
login to the tour list, no splash step. Confirmed zero remaining
references anywhere (`SplashScreen`, `showSplash`, `splash_seen`,
`splash.enter`) before considering this done. Built and verified
clean.

If a splash screen is wanted again later, it needs a background image
with no text baked in and the title rendered as real HTML/CSS on top
— exactly the design discussed earlier, just not built today.

---

## 2026-08-11 (later same day) — Full i18n audit: every customer-facing string now routes through the translation system
Scope: `src/lib/i18n/index.js` (+103 new keys, 90→193 total), and every
file listed below rewired to use `t()` instead of hardcoded English.

Context: the admin/narrator "translate our labels" list is driven
entirely by `Object.keys(translations.en)` — so any hardcoded string
in the app was invisible to that list and could never be translated,
with no error or warning anywhere. Enda had twice found untranslated
labels by accident and asked for a full sweep, not another patch.

Went through every customer-facing page and component individually,
file by file, checking for any JSX text, placeholder, title/aria
attribute, or toast/error message not wired to `t()`. Real, confirmed
gaps found and fixed:

- **`Login.jsx` — the actual first screen every visitor sees — had
  zero translation wiring at all.** Every string on it (labels,
  placeholders, the "Sign In" button, the error fallback, the
  "Create your Free Magical Crete Account" link) was hardcoded.
- `MyWalks.jsx`, `About.jsx`, `Contact.jsx` — same issue, 100%
  hardcoded (About/Contact are the pages Claude built directly
  earlier today — didn't wire i18n into them at the time, caught and
  fixed as part of this sweep).
- `PageNotFound.jsx` — customer-visible parts only (left the
  admin-only debug hint in English, not customer-facing).
- `WalkDetail.jsx` — the single biggest gap: safety notes heading and
  default fallback text, "About this walk", "Community Walk",
  waypoint list heading/instructions, "Reset progress", the
  reached/not-reached toggle titles, "You were last here", the
  Start/Stop role badge labels for driving tours (previously a
  separate hardcoded object, not reusing the existing wpType keys),
  elevation tooltips, and the raw (untranslated) difficulty badge —
  WalkCard already correctly translated difficulty, WalkDetail didn't.
- `DrivingModeNotice.jsx` — the whole driving-tour safety card.
- `WalkProgressBar.jsx`, `DrivingTourPlayer.jsx` (status labels,
  Start/Pause/Stop/Resume, trigger counter).
- `DownloadButton.jsx` ("Save for Offline" + all its states),
  `DownloadWalkButton.jsx` ("Download GPX" + all its states).
- `OfflineWalksBanner.jsx` (the "Offline mode —" prefix),
  `UpdateInProgressModal.jsx`, `InstallPrompt.jsx`.

Confirmed already correct, no changes needed: WalkPaywall, BuyButton,
WalkCard, WalkList, TourCategoryPicker, TourCategoryDialog,
NarrationLanguagePicker, LanguagePicker, OfflineBadge, Home.jsx,
SplashScreen.jsx.

Two deliberate exclusions, flagged to Enda for confirmation rather
than silently skipped: `TourDebugLog.jsx` (a technical GPS/trigger
diagnostic view — raw coordinates and technical terms, judged not
really "UI" in the normal sense) and `UserNotRegisteredError.jsx`
(confirmed dead code — not imported or reachable from anywhere, so it
genuinely cannot be shown to anyone).

Built and verified clean. Final sweep re-grepped every touched file
afterward to confirm no hardcoded strings remained.

---

## 2026-08-11 (later same day) — Optional description field added to 9 entities
Scope: `base44/entities/ActiveSession.jsonc`, `Device.jsonc`,
`DeviceChallenge.jsonc`, `Dispute.jsonc`, `Membership.jsonc`,
`Narrator.jsonc`, `Purchase.jsonc`, `Translation.jsonc`, `AppUser.jsonc`.

Per instruction: added an optional `description` string field (max
1000 characters) to each of these 9 entities. Checked each one first
for an existing description/summary/content/body/text/bio/about field
before adding — none had one, so all 9 got the field. Not added to
any `required` array (genuinely optional); RLS blocks on the entities
that have them (Dispute, Membership, Purchase, Translation, AppUser)
left untouched. Built and verified clean.

---

## 2026-08-11 — Public About and Contact pages (built directly by Claude, not routed through Base44)
Scope: new `src/pages/About.jsx`, new `src/pages/Contact.jsx`,
`src/pages.config.js` (registered both), `src/App.jsx` (login-gate
exemption), `src/pages/Login.jsx` (footer links), `src/pages/Home.jsx`
(footer links).

Added two public info pages per an external requirement (h1 heading +
150+ words on About describing what the app does/who it's for/who
builds it; h1 + at least one contact method on Contact). Word count
verified at 206.

The real work was making them genuinely reachable without an account —
the app otherwise shows nothing but the login screen to anyone not
signed in. Added `/about` and `/contact` to the same login-gate
exemption `/admin` and `/narr` already use in `App.jsx`, so these two
paths render for logged-out visitors too. Linked from a small footer
on `Login.jsx` (the actual public entry point) and a matching one on
`Home.jsx` for logged-in users.

Contact email used is `enda@magicalcrete.com` — the only address
already present anywhere in the codebase; no dedicated support/info
address existed to reuse. Flagged to Enda as a placeholder, swap-out
is a one-line change if he wants a different address.

Built and verified directly (fresh clone, real `npm run build`, h1
count checked, word count checked) — not delegated to Base44 this
time, per explicit instruction to make the change directly.

---

## 2026-08-06 — First real piece of payment integration: Creem webhook receiver
Scope: new `base44/functions/creemWebhook/entry.ts`,
`base44/entities/Walk.jsonc` (+`creem_product_id`),
`base44/entities/AppUser.jsonc` (+`purchased_walk_ids`).

Enda started setting up a Creem (Merchant of Record) account and hit
their "New Webhook" dialog asking for an Endpoint URL — this didn't
exist yet, so built it now rather than leave him stuck.

**What this function does:** receives Creem's notification the moment
a payment succeeds, verifies it's genuinely from Creem (not spoofed),
works out which walk was bought and who bought it, and records that
purchase — the actual mechanism that makes "buy a tour → it appears in
your library" work, discussed several times earlier but never built
until now.

**Signature verification — the security-critical part, actually
tested, not assumed:** Creem signs every webhook with HMAC-SHA256 over
the raw request body, sent in a `creem-signature` header — confirmed
directly from Creem's own documentation
(docs.creem.io/learn/webhooks/verify-webhook-requests). Extracted the
verification logic and ran it in Node against Creem's own published
reference implementation with a fixed test payload — produced an
identical signature. This is the piece that stops anyone else from
being able to fake a "payment succeeded" event and unlock a walk for
free, so it mattered to actually prove this rather than assume it.

**What's genuinely uncertain and flagged as such:** the exact field
names for reading the customer's email and product ID out of the
webhook body (`checkout.customer.email`, `checkout.product.id`, etc.)
are a best-effort reading of Creem's general webhook shape — I could
not find a full real example payload to confirm against. Worth
checking against an actual test webhook from Creem's dashboard once
one's been sent, and adjusting field names if they don't match.

**What Enda needs to do, none of which I can do for him:**
1. Add a `creem_product_id` to each Walk that should be purchasable,
   matching the product ID Creem assigns when he creates that product
   in their dashboard.
2. Find this function's actual public URL in Base44's own interface
   (I don't have certainty of Base44's exact URL format for an
   externally-callable function — needs finding there, not guessed
   here) and paste it into Creem's "Endpoint URL" field.
3. Set a `CREEM_WEBHOOK_SECRET` environment variable in Base44,
   copying the webhook secret Creem shows after the webhook is
   created.

**Still not built at all — a separate, later task:** the actual "Buy"
button / WooCommerce catalog pointing at Creem checkout links, and the
front-end access-gating logic that would actually check
`purchased_walk_ids` before letting someone download a paid walk. This
entry only covers the receiving/recording half of the pipeline.

**Verified:** the entity schema changes build cleanly
(`npx vite build`, both `.jsonc` files confirmed valid JSON). The
function's logic (everything except Deno-specific globals, which a
plain TypeScript checker can't know about) type-checked with zero
errors. The signature verification was tested directly, as described
above — not just compiled, actually run and confirmed correct.

---

## 2026-08-06 — Added real "install to home screen" guidance — nothing did this before
Scope: new `src/components/InstallPrompt.jsx`, `src/pages/Home.jsx`.

Enda's first real test customer logged in successfully on Android but
never got a home-screen icon. Not a bug and not the phone — no
browser on any platform ever creates a home-screen icon automatically
just from someone opening and using a site; it's a deliberate
security protection everywhere, always requires an explicit tap. The
app had never told anyone this option even existed.

**Added:** a small dismissible banner, shown on the main app screen
(after login, splash, and any onboarding steps are done), that
actually helps:
- **Android/Chrome:** captures the browser's own native install
  prompt and shows a proper "Add to Home Screen" button — tapping it
  triggers the real install dialog directly, no hunting through menus.
- **iOS Safari:** Apple provides no equivalent way to trigger this
  from code at all, so shows plain instructions instead ("Tap Share,
  then Add to Home Screen").
- Hides itself entirely once the app is already running installed
  (detected via `display-mode: standalone`), and stays dismissed
  (saved to this device) once someone closes it.

**Verified:** `npx vite build` completes with no errors.

**Not tested:** haven't been able to confirm the actual install
prompt fires correctly on a real Android device or that the iOS
instructions render correctly on real Safari — only confirmed the
logic and conditions compile correctly. Worth Enda checking both on
his next round of testing, iOS especially since that's specifically
on his list for the next test.

---

## 2026-08-06 — Admin Panel Logout button did nothing visible
Scope: `src/pages/Admin.jsx`.

Enda reported clicking Logout in the Admin Panel appeared to just not
work. Real bug: the button called `base44.auth.logout()` but never
did anything after — no redirect, no page reload — so even if the
session was actually being cleared, the screen stayed showing the
exact same Admin Panel with no visible change, indistinguishable from
the button simply failing.

**Fix:** logout now redirects to the front end (`Home`) afterward, so
there's a visible, confirmable result.

**Important caveat for Enda specifically, not a further bug:** because
he's also logged into the Base44 dashboard itself (as project owner),
that session is separate from this Admin Panel's own login check —
logging out here won't clear it, so clicking back into Admin
immediately afterward may still let him straight in with no login
screen. That's expected given his persistent dashboard session, not a
sign the fix didn't work. Testing logout properly requires an
incognito window, which never had that dashboard session to begin
with.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-05 — Full audit: every trigger for the old registration form found and fixed
Scope: `src/pages/Home.jsx`.

Enda asked for a full check that nothing else could still trigger the
old in-app registration form. Searched every reference to
`RegistrationForm`, `registration_complete`, and `registrationComplete`
across the whole codebase, plus every page touching the `AppUser`
entity at all.

**Found and fixed a second real bug in the process, not just
confirmed the first fix:** `UsersManager.jsx` (Enda's "invite a new
admin/narrator" tool) creates that person's `AppUser` record ahead of
time, with their role already set — but with no `user_id`, since they
haven't logged in yet. The previous entry's fix only looked up records
by `user_id`, so a newly invited admin/narrator's first login would
never find that pre-made record, and would create a second, separate
one with no role at all — silently locking them out of the Admin
Panel with no visible error explaining why.

**Fix:** `checkRegistration` now also checks by email (lower-cased, to
avoid a case mismatch between the invite and however WordPress
returns the address) for an existing record with no `user_id` yet,
before assuming someone is a genuinely new person. If found, it links
the two up (sets the `user_id`, marks complete) instead of creating a
duplicate — preserving whatever role Enda originally assigned.

**Confirmed clean, no changes needed:**
- `RegistrationForm.jsx` itself is only ever imported by `Home.jsx` —
  no other page can trigger it.
- `Admin.jsx` also reads from `AppUser`, but only for a simple
  read-only role check — no gating, no form, unrelated to this bug.
- No other file in the app touches the `AppUser` entity at all.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-05 — Real fix for the double-registration bug — previous fix silently failed
Scope: `src/pages/Home.jsx`, `base44/entities/AppUser.jsonc`.

The previous entry's fix (auto-completing registration instead of
showing the old in-app form) looked correct but didn't actually work —
Enda still saw the old form. Root cause: the `AppUser` database entity
required `first_name` and `last_name` to be present on every record,
but the auto-create code never provided them (the app doesn't collect
those anymore — WordPress does). Every auto-create attempt was
silently failing validation and falling into the `catch` block, which
only logged to the browser console — invisible during normal use, so
the fallback (the old form) kept reappearing with no visible error to
explain why.

**Fix, two parts:**
1. `AppUser.jsonc` — removed `first_name`/`last_name` from the
   entity's required fields. The app no longer collects them itself,
   so requiring them at the database level was actively breaking the
   auto-completion this entity change was supposed to enable.
2. `Home.jsx` — the auto-create now also best-effort fills in a name
   from whatever WordPress's login response provides
   (`full_name`/`display_name`, split on the first space), but never
   requires it — if nothing's available, it just creates the record
   with blank name fields rather than failing.

**Verified:** `npx vite build` completes with no errors. Confirmed
`AppUser.jsonc` is still valid JSON after removing the required
fields.

---

## 2026-08-05 — Fixed the real "double registration" bug — app no longer asks twice
Scope: `src/pages/Home.jsx`.

**The actual bug, finally identified:** Enda kept landing on the app's
own "Welcome to Explore Crete — Create your account to get started"
screen after registering through the new WordPress form. I initially
(wrongly) explained this away as "your own pre-existing account
still being logged in somewhere" — that was incorrect. The real cause:
`Home.jsx` has always shown that screen (`RegistrationForm.jsx`) after
*any* first login where the person's `AppUser` record doesn't have
`registration_complete: true` — brand new account or not. Switching
which WordPress plugin collects registration info (tonight's whole
saga) never touched this separate app-side gate, so every new
customer would always hit it regardless — a genuine, real duplication
that was never actually fixed until now, only worked around by
changing where the WordPress-side form lived.

**Fix:** since WordPress registration (Ultimate Member) now properly
collects name, date of birth, gender, and privacy consent, this
second in-app step is redundant. `checkRegistration` in `Home.jsx` now
auto-creates (or auto-updates) the person's `AppUser` record as
already complete on their first login, instead of asking them to fill
in a form again. No visible screen, no re-entering anything — login
via WordPress is now the one and only registration step a customer
ever sees.

`RegistrationForm.jsx` itself is left in place, unused in the normal
flow, only as a fallback if the automatic `AppUser` creation ever
fails (e.g. a network error) — better than leaving someone stuck with
nothing at all in that edge case.

**Verified:** `npx vite build` completes with no errors. Traced the
loading-state logic to confirm the old form can never flash on screen
even briefly during a normal successful login — `isLoading` stays
true until the auto-completion finishes.

---

## 2026-08-05 — App's "Create Account" link now points at the new Ultimate Member registration page
Scope: `src/pages/Login.jsx`.

Following the switch from "User Registration & Membership" to
Ultimate Member (previous entries): the "Create your Free Magical
Crete Account" link, temporarily pointed at the plain native
`wp-login.php?action=register` fallback, now points at
`https://magicalcrete.com/register/` — the new Ultimate Member
registration page, built and tested tonight (3x clean logout/login
cycles, Confirm Password field fixed to use the actual predefined
field type, Privacy Policy toggle enabled, reCAPTCHA v2 added).

**Verified:** `npx vite build` completes with no errors.

**Not verified by me:** Enda still needs to do one full real test
registration through this new page end-to-end (fill in every field,
tick privacy policy, pass the captcha, submit, confirm the account is
created and can log in) before fully trusting it — that hadn't been
confirmed as of this entry.

---

## 2026-08-05 — "User Registration & Membership" plugin abandoned, reverted to native WP registration
Scope: `src/pages/Login.jsx`.

After an extensive troubleshooting session (Loginizer captcha
conflicts, a plugin-created duplicate "My Account" page, and finally
a persistent "already logged in" phantom-session bug that survived
even fully disabling the caching plugin), Enda decided to remove
the "User Registration & Membership" plugin entirely rather than
keep chasing it.

**App-side change:** the "Create your Free Magical Crete Account"
link, which had been updated to point at the plugin's custom
`/create-account/` page, is reverted back to WordPress's own native
`wp-login.php?action=register` — the same fallback used right at the
very start of this whole saga, proven reliable throughout tonight
(no captcha issues, no session bugs) even though it's visually plain.

**Not done — needs a decision on a fresh day, not tonight:**
- The custom fields work (First Name, Last Name, Date of Birth,
  Gender with three options, linked Privacy Policy checkbox) built
  inside that plugin is now moot since the plugin is being removed.
  If Enda wants those fields collected at registration again (e.g.
  for the quarterly birthday raffle idea), that needs a different
  plugin or approach — not attempted again tonight given how this one
  went.
- The root cause of the phantom "already logged in" bug was never
  actually identified — it survived a full SpeedyCache deactivation,
  so it likely wasn't caching after all. Could be a cookie
  domain/path mismatch, a conflict with another active plugin, or a
  bug specific to that plugin's session handling. Worth a fresh
  investigation only if Enda revisits building this out, not urgent
  now that the plugin itself is gone.
- Login itself (`wp-login.php`, no custom plugin) remains fully
  functional throughout all of this — never actually broken.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-05 — App's "Create Account" link updated to the new dedicated page
Scope: `src/pages/Login.jsx`.

Following the WordPress registration-form work: `/my-account` is now
going to hold the Login form only. The app's own login screen's
"Create your Free Magical Crete Account" link previously pointed at
`/my-account` (which made sense when that page had the registration
form) — updated to point at the new dedicated
`https://magicalcrete.com/create-account/` page instead, which now
holds the actual registration form.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-05 — Removed the dead "Membership Code" field and its backend
Scope: `src/components/onboarding/RegistrationForm.jsx`; deleted
`base44/functions/verifyMembershipKey/`.

The in-app "Complete Registration" form had an optional "Membership
Code" field referencing "your WooCommerce order" — checked against a
`verifyMembershipKey` backend function tied to the old Key
Manager/voucher plugin, which is being deactivated as part of the
move to the new WordPress-based system. Enda confirmed this field is
now meaningless — removed the field from the UI, the verification
step in the submit handler, and the now-unused `verifyMembershipKey`
backend function entirely (confirmed nothing else called it first).

Also flagged, not touched: this form still submits a plaintext
`password` field into the `AppUser` database record — likely a
leftover from before WordPress became the actual source of truth for
login credentials. Not removed in this pass since Enda didn't ask
about it and nothing currently reads it elsewhere, but worth a look
before this goes properly live.

**Longer-term plan discussed, not yet built:** Enda wants the
remaining fields on this form (first/last name, date of birth, gender)
collected during WordPress registration instead, so new users only
fill in one form, not two. That's a WordPress-side change (a plugin
to add custom fields to the registration page) — recommended "User
Registration for Elementor Forms" given he's already on Elementor Pro,
since it visually builds registration forms and maps fields (including
custom ones) to WordPress user data. Once that's live and actually
collecting this info, this whole in-app `RegistrationForm.jsx` step
can likely be removed entirely — flagging that as the natural next
step for a future session once the WordPress side is built.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-05 — Splash screen was silently sending real customers to Base44's own login
Scope: `src/components/onboarding/SplashScreen.jsx`.

Enda asked how many login/registration screens exist and why users
seemed to hit an extra unexpected one (the earlier "(Copy)" Base44
branded screen with "Continue with Google", previously suspected to be
a Base44 domain-routing problem).

**Real cause, found by checking the code:** the splash screen's
"Enter" button called `base44.auth.isAuthenticated()` /
`base44.auth.redirectToLogin()` — Base44's own separate native login
system. That's a leftover from before the WordPress-based login
replaced it; nothing else in the customer-facing app (`Home.jsx`,
`App.jsx`) touches `base44.auth` at all anymore. By the time this
screen can even render, `App.jsx` has already confirmed the user is
logged in via WordPress — this check was redundant at best, and since
customers never actually have a Base44-native session, it was always
false, silently redirecting real logged-in customers to Base44's own
generic hosted login page. This is almost certainly what the earlier
"(Copy)" screen actually was — not a Base44-side domain
misconfiguration as first suspected.

**Fix:** removed the check entirely — the button now just dismisses
the splash screen and continues, no auth check needed since one
already happened upstream.

**Full screen inventory given to Enda, for reference:**
1. WordPress's own registration page — creates login credentials
   (email/password). The one real account-creation step.
2. The app's own Login screen — signs in with those credentials.
3. The splash "Enter" screen — not meant to be a login step, just an
   intro image+button; the bug above made it act like one.
4. `RegistrationForm.jsx` ("Complete Registration") — not a second
   account; collects profile info (name, DOB, gender, optional
   membership code) that WordPress's registration doesn't ask for,
   needed for the app's own `AppUser` record.

Enda's fair pushback: even though it's technically "create login" then
"add profile info" rather than two accounts, it still feels like
registering twice. Flagged as an open decision — folding those fields
into the WordPress registration page instead (removing this second
form) is possible but touches both systems, and needs Enda's call
rather than a guess.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-05 — "My Recorded Walks" confirmed disabled, dead files removed
Scope: deleted `src/pages/MyRecordedWalks.jsx`,
`src/components/recorded/WalkRecorder.jsx`,
`src/components/recorded/RecordedWalkCard.jsx` (folder now gone too).

Enda asked whether this feature (letting users record and submit
their own walks — he'd decided to scrap it entirely, too messy) was
actually disabled. Checked `src/pages.config.js`, which lists every
page the app actually registers as a route: only `Admin`, `Home`,
`MyWalks`. `MyRecordedWalks` isn't in that list at all — there's no
URL that reaches it, and nothing links to it from anywhere else in
the app. It was already fully disabled, not just hidden.

The three files themselves were still sitting in the codebase unused
though — removed them, same as the membership cleanup earlier.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-05 — Login strapline changed
Scope: `src/pages/Login.jsx`, `public/manifest.json`.

"Walking tours & driving audio guides" → "Walking, Hiking, WalkAbout,
Driving" on the login screen. Also aligned the PWA description text
in `manifest.json` (same wording, different context — a full sentence
used in browser install prompts, not a UI strapline) to match the
same four categories.

**Verified:** `npx vite build` completes with no errors;
`manifest.json` confirmed still valid JSON.

---

## 2026-08-05 — Removed two dead components from an old membership system
Scope: deleted `src/components/membership/WandererUpsellSplash.jsx` and
`src/components/membership/MembershipCodeEntry.jsx` (folder is now
gone too, since it was the only thing in it).

Both were leftovers from an earlier voucher/tier-based membership
approach (WandererUpsellSplash referenced old "Explorer/Pathfinder/
Wayfinder" tiers; MembershipCodeEntry was for entering a voucher
code) — neither was imported or rendered anywhere in the live app, so
no user could ever have reached either screen. Confirmed via search
before deleting each one. Fits with the account/membership system
being rebuilt from scratch on WordPress now, rather than the old
code/voucher approach.

**Verified:** `npx vite build` completes with no errors after both
removals — confirms nothing else depended on either file.

---

## 2026-08-05 — Real logo on the login screen, plus one more sweep
Scope: `src/pages/Login.jsx`, `src/components/membership/WandererUpsellSplash.jsx`.

- The sign-in screen had the same generic Mountain icon placeholder as
  the other spots fixed earlier — swapped for the real logo.
- Per the standing instruction to check every occurrence: also found
  and fixed the same pattern on the membership upsell splash screen
  ("Unlock More of Crete").
- Registration screen was already fixed in an earlier entry — nothing
  further needed there.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-03 — Walk/Hike waypoint editor: "Save and Download GPX" button
Scope: Walk/Hike tours only (route_type = 'walk'). Driving tours and
WalkAbout tours are untouched — they already have their own export panel.

**What changed:**
- `src/lib/routeExport.js` — added a new function `generateWalkGpx(walk)`.
  This is separate from the existing `generateGpx(walk)`, which is built
  for driving audio tours and writes driving-only fields (waypoint_role,
  segment_title, avg_segment_speed_kmh). `generateWalkGpx` writes the
  fields a plain walk/hike waypoint actually has: type, name,
  description, elevation, image_url. Waypoint `<name>` in the GPX is set
  to the waypoint's segment_id (e.g. "MXR3") so the file round-trips
  correctly with the app's existing GPX importer. The admin's free-text
  name/description/type/photo are also written into `<mc:...>` extension
  tags so nothing is lost, even though the importer doesn't read those
  back in yet.
- `src/components/admin/WalkEditor.jsx`:
  - Imported `generateWalkGpx`.
  - `handleSave` now returns `true`/`false` so callers can tell whether
    the save actually went through (previously returned nothing).
  - Added `handleSaveAndDownloadGpx`: calls `handleSave()`, and only if
    that succeeds, builds a GPX from the current form state and
    downloads it via the existing `downloadTextFile` helper. Filename:
    `[Route name]-updated-[YYYY-MM-DD].gpx` (route name is sanitised —
    slashes/colons etc. stripped — since those aren't valid in
    filenames).
  - Added `downloadingGpx` state for the button's loading spinner.
  - Passed `onSaveAndDownload={handleSaveAndDownloadGpx}` and
    `downloadingGpx` down into `<WaypointEditor>` (walk/hike branch
    only, not the driving tour branch).
- `src/components/admin/WaypointEditor.jsx`:
  - Renamed the yellow button from "Save Walk" to "Save Waypoint" — no
    behaviour change, it still saves the whole tour (all waypoints),
    the label was just misleading.
  - Added a new outlined "Save and Download GPX" button directly below
    it, wired to the new `onSaveAndDownload` prop, with its own
    loading spinner via `downloadingGpx`.

**Why:** Enda wanted a way to export a full backup GPX of the amended
route (all waypoint edits — names, descriptions, added/deleted points)
after working on a walk/hike in the waypoint editor, without it being
mixed up with the driving-tour GPX export which serves a different
purpose and data shape.

**Verified:** `npx vite build` completes with no errors after these
changes.

**Not done / worth knowing for next time:**
- The existing GPX importer doesn't read the new `<mc:label>` /
  `<mc:type>` / `<mc:imageUrl>` extension tags back in — only `<name>`
  (→ segment_id) and `<desc>` (→ description) round-trip today. If a
  future task wants full re-import of an exported GPX, the importer in
  `WalkEditor.jsx` (`handleGpxImport`) would need updating to read
  those extension tags too.
- Have not tested this in the actual Base44/browser environment (no
  Base44 dev server available here) — only confirmed it builds
  cleanly. Enda should test the button in the live app before relying
  on it.

---

## 2026-08-04 — GPX Builder: mode toggle buttons were completely non-functional
Scope: `waypoint-gpx-builder.html`.

Enda reported he couldn't find the Primary/Secondary role option at
all after downloading the tool. Real bug, not user error — a "Step 1
— What are you building?" section with two toggle buttons (Walk/Hike
vs WalkAbout/Driving Tour) existed in the HTML, but:
1. **No click handler was ever wired up on either button** — clicking
   "WalkAbout / Driving Tour" did nothing at all, so the tool silently
   stayed in Walk/Hike mode no matter what was clicked.
2. **No CSS existed for the buttons either** — they'd have rendered as
   two plain, unstyled default browser buttons with no visual
   indication anything was selectable or selected, easy to miss
   entirely.

**Fix:**
- Added real click handlers on both buttons, routed through a single
  `setTourMode()` function so every place that can change mode (button
  click, loading a file, resuming an autosaved session, clearing) stays
  visually in sync with each other.
- Added proper styling — a clear two-option toggle card layout with an
  obvious highlighted/bordered "active" state, matching the tool's
  existing visual style.

**Verified:** confirmed via `node --check` the script is syntactically
valid, and traced every place the mode gets set to confirm each one
now goes through the same function that also updates the button
styling — no path left where the stored mode and the visible buttons
could disagree.

---

## 2026-08-04 — API keys corrected: browser-local storage, not the database
Scope: `src/lib/useNarratorApiKeys.js`,
`src/components/admin/ApiKeysDialog.jsx`,
`base44/entities/AppUser.jsonc`. Corrects the previous entry below.

Enda showed screenshots of his existing VoiceScript and TTS Studio
tools — each stores its API key only in that browser's localStorage
("Stored only in this browser"), never on a server. He wants Explore
Crete's key handling to match that exactly. The version built in the
previous entry stored keys on each narrator's `AppUser` database
record instead — same "each narrator's own key" outcome, but the
wrong storage location.

**Fix:**
- `useNarratorApiKeys.js` rewritten to read/write
  `localStorage` directly (two keys:
  `explore_crete_google_tts_api_key`, `explore_crete_groq_api_key`).
  No network call, no database record, synchronous.
- `ApiKeysDialog.jsx` simplified to match — instant save, "No key
  saved yet" status text mirroring the reference apps' wording.
- Removed the `google_tts_api_key`/`groq_api_key` fields from the
  `AppUser` entity added in the previous entry — no longer used, keys
  never touch the database at all now.
- The backend functions (`generateTts`, `translateScript`) are
  unchanged from the previous entry — they already just accept
  whatever `apiKey` the browser sends per request and were never
  storing anything themselves, so no further change was needed there.

**Trade-off worth knowing:** because the key lives only in that one
browser, a narrator who switches computers or clears their browser
data will need to re-enter it — same behaviour as VoiceScript/TTS
Studio already have, not a new limitation introduced here.

**Verified:** `npx vite build` completes with no errors. Confirmed
`AppUser.jsonc` is still valid JSON after removing the two fields.

---

## 2026-08-04 — Per-narrator API keys for TTS/translation (was actually shared, now isn't)
Scope: `base44/entities/AppUser.jsonc`,
`base44/functions/generateTts/entry.ts`,
`base44/functions/translateScript/entry.ts`, new
`src/lib/useNarratorApiKeys.js`, new
`src/components/admin/ApiKeysDialog.jsx`, `src/pages/Admin.jsx`,
`NarrationTtsEditor.jsx`, `TranslationPanel.jsx`.

Enda explained his intended design: each narrator uses their own
Google TTS and Groq API keys (he's already provisioned them), so
quota and any overage cost stays personal to each narrator rather
than being pooled onto one shared key that he'd have to bankroll.

**Checked the actual code — it didn't match.** Both
`generateTts` and `translateScript` were reading one single key each
from a server-side environment variable (`GOOGLE_TTS_API_KEY`,
`GROQ_API_KEY`), shared by every narrator, every time. That's exactly
the pooled-quota situation Enda said he specifically wanted to avoid.

**Fix:**
- Added `google_tts_api_key` and `groq_api_key` fields to the
  `AppUser` entity — each narrator's own keys, stored on their own
  account.
- New **"API Keys"** button in the Admin Panel header (visible to
  admin and narrator roles alike) opens a small dialog where each
  person pastes in their own two keys, saved to their own account only.
- Both backend functions now *require* a key passed in from the
  caller — no shared fallback key at all, matching "everyone has their
  own key, no exceptions." A missing key returns a clear, specific
  error ("No Google TTS API key found for your account. Add your own
  key under 'API Keys'...") instead of a generic failure.
- `NarrationTtsEditor.jsx` and `TranslationPanel.jsx` both fetch the
  logged-in narrator's own keys once (cached for the session via
  `useNarratorApiKeys`) and pass them into every call. Both also check
  up front and show the same clear message before even attempting a
  request if the narrator hasn't set their key yet, rather than
  failing partway through.

**Verified:** `npx vite build` completes with no errors.

**Not done:** haven't tested this against a real Google/Groq key end
to end — only confirmed the wiring compiles and the logic is
consistent (key required, no fallback, clear error when missing).
Worth a narrator trying it with their real keys once this is live.

---

## 2026-08-04 — GPX Builder: WalkAbout/Driving Tour role labeling, plus two real app import bugs found and fixed
Scope: `waypoint-gpx-builder.html`,
`src/components/admin/DrivingTourWaypointEditor.jsx`.

Enda is using the standalone builder tool for an upcoming WalkAbout
test and asked for the ability to label a point Primary or Secondary.

**Builder tool changes:**
- Added a "Tour type" selector (Step 2): Walk/Hike (unchanged, default)
  or WalkAbout/Driving Tour (new). Switches what Step 3 shows per
  waypoint: Walk/Hike keeps Type+Label; WalkAbout/Driving Tour instead
  shows a **Role** dropdown — Primary-Start / Primary-Stop / Secondary
  — using the exact same three roles and terminology as the app's own
  admin editor, with help text explaining what each one means (mirrors
  what Enda described: Primary-Start is the only one walkers ever see;
  Primary-Stop and Secondary are admin/narrator-only, but Secondary's
  audio still plays for walkers).
- Re-loading a file that already has role tags (e.g. one saved earlier
  in this tool) auto-switches the tool to WalkAbout/Driving Tour mode.
  Tour mode is saved as part of the autosaved progress too.
- Output: WalkAbout/Driving Tour mode writes `<mc:role>` instead of
  `<mc:type>`/`<mc:label>` per waypoint; `<desc>` is written the same
  way in both modes.

**Two real bugs found in the app itself while wiring this up, both
fixed — not just tool-side:**
1. `DrivingTourWaypointEditor.jsx`'s GPX import never read `<desc>`
   at all — every imported waypoint's description was hardcoded blank,
   silently discarding any description text in the file regardless of
   source. This would have made the builder tool's description field
   pointless for WalkAbouts even before today's role changes.
2. The importer had no way to receive an explicit role — it could only
   guess primary_start vs secondary from the waypoint's `<name>`
   matching a specific pattern (`XXX##a` or a `-PS` suffix), with
   every non-matching point forced to secondary and primary_stop only
   ever settable by hand afterward. Added support for an explicit
   `<mc:role>` tag that, when present, is trusted directly over the
   name-guessing — this is what the builder tool's new Role dropdown
   now relies on. Plain Garmin Explore exports (no such tag) behave
   exactly as before.

**Verified:** `npx vite build` completes with no errors. Extracted the
app's own import-parsing logic and tested it in Node directly against
a file built the same way the tool now generates one — description
and all three roles (primary_start, secondary, primary_stop) came
back correctly for every point.

---

## 2026-08-04 — Multi-photo waypoints (up to 5), added to WalkAbout/Driving Tours, extended for Walk/Hike
Scope: new `src/lib/waypointImages.js`; changes to
`WaypointEditor.jsx`, `DrivingTourWaypointEditor.jsx`,
`WalkDetail.jsx`, `routeExport.js`, `WalkEditor.jsx`.

**What changed:**
- Added a shared helper file (`waypointImages.js`) used by every
  waypoint editor and the front end, so photo handling behaves
  identically everywhere instead of being reimplemented three times:
  `compressImage` (same 1200px/JPEG-85% compression as before, just no
  longer duplicated), `MAX_WAYPOINT_IMAGES = 5`, and
  `getWaypointImages(waypoint)` — reads photos as an array whether a
  waypoint was saved under the new `image_urls` array field or the old
  single `image_url` field, so nothing already saved breaks.
- **Walk/Hike waypoints** (`WaypointEditor.jsx`): went from 1 photo to
  up to 5, with a proper thumbnail gallery (add/remove individually)
  in both the "add new key point" form and existing waypoints.
- **WalkAbout/Driving Tour waypoints** (`DrivingTourWaypointEditor.jsx`):
  had **no photo support at all** before this — added the same 5-photo
  gallery to the full admin editing view, and a read-only photo
  display (no upload controls) to the simplified narrator view.
- **Front end** (`WalkDetail.jsx`): the "Key Points"/"Tour Stops" list
  now shows a gallery of every photo a waypoint has, not just one —
  works for both tour types.
- **GPX round-trip for Walk/Hike** (`routeExport.js`,
  `WalkEditor.jsx`): "Save and Download GPX" now writes one
  `<mc:imageUrl>` tag per photo instead of just one, and re-importing
  such a file reads all of them back (capped at 5) — same round-trip
  capability as before, just no longer limited to a single photo.
  WalkAbout/Driving Tour photos are admin-upload-only, same as before
  this change — they were never part of the GPX import/export for
  those tour types and still aren't.

**Verified:** `npx vite build` completes with no errors. Tested the
full multi-image GPX export → re-import round trip directly in Node
(3 images survive intact), and confirmed `getWaypointImages` correctly
reads both old single-photo waypoints and new multi-photo ones.

---

## 2026-08-04 — WalkAbout/Driving Tour route line now follows real roads, not straight lines
Scope: `src/components/admin/DrivingTourWaypointEditor.jsx`,
`src/components/admin/WalkEditor.jsx`.

**The bug:** Enda's Garmin Explore GPX exports can include a real
road-following route (a `<trk>` or `<rte>`), but the importer for
WalkAbouts/Driving Tours only ever read the sparse named `<wpt>`
points — the actual track was silently discarded every time, even
when present. So the map line always just connected waypoints with
straight lines, regardless of what streets existed between them. This
is the same category of problem as the Walk/Hike straight-line bug
fixed earlier, but a different root cause: that one was route data
getting overwritten after import; this one never imported the route
data in the first place.

**Fix:**
- Added `parseGpxTrail()` — reads the file's `<trkpt>`/`<rtept>`
  points (falling back to `<wpt>` only if the file truly has no track
  at all), same fallback order the Walk/Hike importer already uses.
- `handleGpxImport` now imports the road-following line into
  `trail_path` in addition to the named waypoints into `waypoints` —
  two separate things, wired through a new `onTrailPathChange` prop
  threaded from `WalkEditor.jsx`.
- The import result message now tells the admin which happened: "route
  line follows the recorded track" vs a warning that no track was
  found and the line is a straight-line fallback, with a pointer to
  the manual Trail tab if they need to trace it by hand.

**Second instance of the same bug, also fixed:** found an existing
"Test Location X in Simulator" button (a per-location testing dialog
I'd missed in the first audit pass) that built its own straight line
directly between a location's waypoints, ignoring the tour's real
trail line entirely — meaning even after the import fix above, this
dialog would still show a straight line. Added
`sliceTrailForLocation()`, which cuts out just that location's real
stretch of the trail (nearest-point matching against `trail_path`,
same approach as the "Jump to location" feature added earlier), and
wired the tour's `trail_path` into this component so it has something
to slice from. Falls back to the old straight-line behaviour only if
there's genuinely no trail data (e.g. an older tour not yet
re-imported).

**Not retroactive:** existing WalkAbouts/Driving Tours already in the
system won't get a road-following line automatically — this only
takes effect on the next GPX import for each tour. Older tours will
need re-importing (with an annotated file, same caution as the
Walk/Hike version of this issue — a plain re-import wipes descriptions
unless the file already has them).

**Verified:** `npx vite build` completes with no errors. Tested
`parseGpxTrail` and `sliceTrailForLocation` directly in Node against
constructed sample data — correctly picks up a real track when
present, falls back correctly when absent, and slices the right
stretch of a longer trail for two adjacent locations.

---

## 2026-08-04 — Primary/secondary waypoint visibility, audited end to end
Scope: `src/components/walks/DrivingTourPlayer.jsx` (one small fix);
everything else in this entry was checked and confirmed already
correct, not changed.

Traced the full chain for WalkAbout and Driving Tours (both share the
same waypoint role system: primary_start / primary_stop / secondary)
against Enda's rule: secondary and primary-end points must be visible
to narrators/admins, must still trigger their audio for real users,
but must never be visible to a real user.

**Confirmed already correct, no changes:**
- Admin/narrator waypoint editor (`DrivingTourWaypointEditor.jsx`)
  shows every waypoint regardless of role — correct, they need to see
  everything.
- User-facing "Key Points" list (`WalkDetail.jsx`) and the user-facing
  map markers (`WalkDetailMap.jsx`) both already filter to
  `primary_start` only — secondary and primary_stop points are already
  invisible to real users on both surfaces.
- The live, real-world audio-trigger engine
  (`DrivingTourPlayer.jsx`'s `evaluateTriggers`) checks every waypoint
  with `trigger_audio` enabled, with no role filter at all — so a
  secondary waypoint's audio already does fire correctly for a real
  user entering its geofence, exactly as required.
- `ScriptTimingPanel.jsx`'s per-location duration calculation already
  uses a `primary_stop` (or the next `primary_start`) as the segment's
  end boundary — matches "the primary end point is needed to determine
  the length of the audio."

**One small leak found and fixed:** the "triggered waypoints" progress
bar on the real user's live tour screen (`DrivingTourPlayer.jsx`) had
a hover tooltip (`title` attribute) showing each waypoint's internal
`segment_id`/name — including secondary and primary-stop ones that are
supposed to stay invisible. Removed the tooltip; the progress bar
itself (a row of small dots/bars showing how many of the tour's audio
points have fired) stays, just without exposing internal naming.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — Confirmed already correct: car icon, per-tour jump, trigger radius
No code changes — checking these off the audit above after Enda asked
about them directly.

- **Red car icon for driving tours**: already correct.
  `TourSimulator.jsx`'s `isWalkingTour = form.tour_category !== 'DDV'`
  already distinguishes on `tour_category` (WBT vs DDV), not the
  shared backend `route_type` both use — so `TourSimulatorMap.jsx`'s
  `moverIcon` already renders `RED_CAR_SVG` (red) for DDV tours.
- **"Jump to location" for driving tours**: the feature added earlier
  today isn't restricted to WalkAbouts — `TourSimulator.jsx` is shared
  by both WBT and DDV, so it already works for driving tours too, no
  change needed.
- **Editable audio trigger radius**: already exists —
  `AudioTriggerFields.jsx` has a "Trigger Radius (m)" number input per
  waypoint (10–2000m, default 30m), and it's also drag-adjustable
  directly on the simulator map (`TourSimulatorMap.jsx`). Relevant to
  Enda's note about GPS trouble in Rethymno's old town — admins can
  already widen the radius on individual problem waypoints there.

---

## 2026-08-04 — WalkAbout module audit: fixed 5 real bugs, added the missing "jump to location" capability
Scope: `src/components/admin/DrivingTourWaypointEditor.jsx`,
`TourSimulator.jsx`, `ScriptTimingPanel.jsx`, `SegmentScriptManager.jsx`,
`NarrationTtsEditor.jsx`. Full audit against Enda's detailed
description of the intended WalkAbout narrator/admin workflow.

**What was already there and working correctly (confirmed, not
touched):**
- Build & Play button for iterative script/audio creation
  (`NarrationTtsEditor.jsx`) — already exists.
- The simulator already shows a walking-man icon (not a car) for
  WalkAbouts, only shows a car for Driving Tours
  (`TourSimulatorMap.jsx`'s `moverIcon`).
- Per-location timing comparison (travel time vs narration time,
  comfortable/close/overrun status, visual bar) already exists in
  `ScriptTimingPanel.jsx`.
- The finalize → accept → export script + audio to admin → admin
  uploads the ElevenLabs/FishAudio MP3 workflow already exists and
  matches what Enda described, in `SegmentScriptEditor.jsx`.

**Bugs found and fixed:**
1. **Walking speed defaulted to 3 km/h, not the specified 3.5 km/h** —
   found in three places that all needed the same fix:
   `DrivingTourWaypointEditor.jsx` (new waypoint / GPX import default),
   `TourSimulator.jsx` (simulator's starting speed), and
   `ScriptTimingPanel.jsx` (silently fell back to 50 km/h — a driving
   speed — for any WalkAbout waypoint without an explicit speed set,
   because it never even knew which tour category it was looking at;
   it now receives that and defaults to 3.5 km/h for WBT).
2. **Speed control always said "Driving Speed" with 30/50/80 presets**,
   even on a WalkAbout — meaningless for someone on foot. Now shows
   "Walking Speed (km/h)" with 3/3.5/4 presets for WBT, unchanged for
   driving tours.
3. **Simulator description text always said "Drive a virtual marker"**
   — now says "Walk" for WalkAbouts.
4. **Combined segment scripts inserted 1-second breaks between
   waypoints, not the specified 0.5s standard** (`SegmentScriptManager.jsx`).
5. **The audio-building tool's saved audio disappeared from view**
   once segments were parsed, and there were no on-screen instructions
   for how to go back and amend it — the exact confusion Enda reported.
   The "Current saved audio" player now stays visible at all times once
   something's been built, with plain instructions: edit the script,
   Parse & Generate, Build & Play again — no need to leave the screen.

**New capability added — not a bug fix, a real gap:** Enda was explicit
that testing one location's audio must not require playing through the
whole WalkAbout first. That capability didn't exist at all — the
simulator always started from the very beginning of the trail with no
way to skip ahead. Added a "Jump to location" control right above the
playback buttons: pick any location from a dropdown (built from the
same primary-start waypoints `ScriptTimingPanel` already uses), click
Jump, and the simulated walker starts right there — every waypoint
before it is marked as already-triggered so earlier audio doesn't
fire again, then Play tests just that location.

**Verified:** `npx vite build` completes with no errors after every
change. Logic for the jump feature was reasoned through carefully
(cumulative distance via nearest trail_path point, matching the same
approach `ScriptTimingPanel` already uses) but not tested against a
real WalkAbout's data — worth Enda trying it on his test walk.

**Flagged, not changed — needs Enda's judgement, not a default I
should silently pick:** every audio trigger's geofence radius
(`trigger_radius_m`) defaults to 30m regardless of tour type. Enda
specifically noted narrow streets and high buildings make Crete's GPS
worse for WalkAbouts. Whether 30m is too large (risk of an adjacent
street's audio triggering early) or too small (risk of GPS drift in
narrow streets missing the trigger entirely) is a real-world judgement
call I can't make from here — flagging it rather than guessing a
"fixed" number.

---

## 2026-08-04 — Walks panel heading now matches the selected tour type
Scope: `src/lib/tourCategories.js`, `src/components/walks/WalkList.jsx`,
`src/pages/Home.jsx`.

Heading always said "All Walks" / "X of Y trails" regardless of
which tour type was selected via "Change tour type" — showed the
same wording for WalkAbouts and Driving Tours too.

**Fix:** added a `pluralLabel` per category in `tourCategories.js`
("Walks" / "WalkAbouts" — capital A intentional, per Enda — /
"Tours"). `Home.jsx` now passes the selected category code down to
`WalkList`, which builds the heading and count from it: "All Walks" /
"X of Y Walks", "All WalkAbouts" / "X of Y WalkAbouts", "All Tours" /
"X of Y Tours" — the count itself already reflected the real number
in the system, only the wording was static.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — Reached-waypoint ticks now clear themselves between separate walks
Scope: `src/components/walks/WalkDetail.jsx`. Follows on from the
reached-waypoint tracking feature above.

Anoushka's QA feedback: repeat walkers (flower enthusiasts especially,
who might do the same walk 3-4 times a month) need a clean slate each
time — the ticked/greyed waypoints from a previous walk shouldn't
carry over.

**Considered and rejected:** clearing on app close. Rejected because
a phone call or app-switch mid-hike also "closes" the app briefly, and
that would wipe a walker's progress while they're still mid-route —
the opposite of what this feature is for.

**What was built instead:** the saved progress now carries a
timestamp. If a walk is reopened more than 18 hours after the last
tick, it's treated as a new attempt and starts empty — old data is
discarded automatically. 18 hours is generous enough to cover even a
very long single day-hike without accidentally clearing mid-walk, but
guarantees anyone repeating the walk another day gets a genuinely
clean start. The manual "Reset progress" link from the original
feature is still there too, for anyone who wants to clear it
immediately rather than wait.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — Admin button gating, re-applied correctly
Scope: `src/pages/Home.jsx`.

Re-applies the previous entry's intent, this time only using what's
actually confirmed to work:
- Enda found his `AppUser` record had no `role` set at all — that's
  why the first attempt failed for him too. He's since set it to
  `admin` himself in Base44's Data section, and confirmed the button
  now needs the `AppUser` lookup to work at all — verified indirectly:
  the front end already correctly skips his registration screen (which
  depends on that same `AppUser.filter({ user_id: user.id })` lookup
  succeeding), so the lookup mechanism itself is sound.
- The check now ONLY reads `appUsers[0].role` — the broken
  `user.role === 'admin'` check (which assumed Base44-native auth
  fields that don't exist under the WordPress login) has been dropped
  entirely, not just bypassed.

**⚠️ Before trusting this:** Anoushka and any narrator accounts also
need an `AppUser` record with `role` set to `admin` or `narrator` —
otherwise they'll lose the Admin button the same way Enda did. Worth
Enda checking each staff account's `AppUser.role` field is actually
set before this goes live to anyone but him.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — REVERTED: Admin button gating locked Enda out
Scope: `src/pages/Home.jsx`. Undoes the previous entry below.

**What happened:** the previous change (gating the Admin button behind
an admin/narrator check) broke immediately — Enda logged in as an
actual admin and the button was gone for him too, even after logging
out and back in.

**Root cause — my mistake:** I copied `Admin.jsx`'s role-check logic
into `Home.jsx` without checking that the two pages use **two
completely different login systems**:
- `Admin.jsx` checks `base44.auth.me()` — Base44's own native login.
- `Home.jsx` uses `useAuth()` from `AuthContext.jsx` — a WordPress-
  based JWT login (`wpLogin`), added as part of migrating away from
  Base44's native auth. The user object this produces is just
  `{ id, email, full_name, display_name, username }` — **it has no
  `role` field at all.**

So `user.role === 'admin'` was checking a field that doesn't exist on
this login path, and just silently evaluated false for everyone,
including real admins. It fell back to checking an `AppUser` record's
`role` field, which may not be set up the same way under the WordPress
login — not something I verified before shipping it. Classic case of
assuming two similar-looking pieces of code shared a data shape they
didn't.

**Fix applied:** reverted `Home.jsx` back to always showing the Admin
button, exactly as it was before that change — nobody is locked out.
The original problem (regular walkers seeing an Admin button they
have no use for) is back too, but that's a cosmetic annoyance, not a
lockout — far better to have that than risk this again.

**Properly fixing the original cosmetic issue needs answers first,
not another guess:**
1. Does Enda's account actually have an `AppUser` record, and does its
   `role` field say "admin"? (This can only be checked by looking at
   the actual Base44 data — not something visible from this repo.)
2. Is the WordPress JWT `user.id` used to look up that `AppUser`
   record (`user_id: user.id`) reliably the same value the `AppUser`
   record itself is keyed on? If the two authentication systems don't
   share user IDs consistently, this lookup could silently fail even
   with a correctly-configured `AppUser` record.

Do not re-attempt gating this button by guessing again — confirm both
of those with Enda (or by inspecting the live Base44 data) first.

**Verified:** `npx vite build` completes with no errors after the
revert.

---

## 2026-08-04 — "Admin" button hidden from regular users
Scope: `src/pages/Home.jsx`.

The Admin button in the front-end header was showing to every logged-
in user, not just staff — Enda pointed out it would confuse regular
walkers, none of whom have any reason to see it.

**Fix:** added the same admin/narrator check `Admin.jsx` itself
already uses to decide who's allowed in (Base44's own `role ===
'admin'`, or an `AppUser` record with `role` of `admin`/`narrator`).
The button now only renders for staff. Reused the `AppUser` lookup
Home.jsx was already doing for registration status, rather than adding
a second network call.

Enda, Anoushka, and any narrator accounts still see the button as
normal — this only hides it from ordinary walker accounts.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — Route line was being destroyed on every waypoint edit
Scope: `src/components/admin/WalkEditor.jsx` (Walk/Hike only).

**Enda's report:** the preview map draws a straight line between two
points instead of following the actual track/road.

**Cause — real bug, not a display setting:** the route line on the
map comes from `trail_path`, a dense set of GPS points recorded on
the ground (from the eTrex), separate from the sparse named
`waypoints`. But every time waypoints were edited (add, delete, rename,
add a description — anything), the code was overwriting `trail_path`
with just straight lines between the current waypoints, throwing away
the real recorded curve. This wasn't something I introduced this
session — it was already in the code, just never surfaced until a
walk with waypoints far enough apart to make the straight-line cutting
visible.

**Fix:** waypoint edits now only update the waypoint markers.
`trail_path` (the line itself) is left alone — it's only ever set at
GPX import, or by the dedicated trail-path map editor tool elsewhere
in the same screen. Editing the waypoint list can no longer touch it.

**⚠️ Already-affected walks — need Enda's attention, not something I
can fix in code:** this bug has been live the whole time, so **any
walk that's already had a waypoint added/deleted/edited may have
already lost its real track line**, replaced with straight segments.
The only way to restore it is to re-import that walk's GPX — but
re-importing replaces the whole waypoint list wholesale, which would
also wipe out any descriptions typed in since the last import, unless
the file being re-imported already has those descriptions baked in via
the `<mc:type>`/`<mc:label>`/`<desc>` tags (i.e. a file from "Save and
Download GPX", or one built with `waypoint-gpx-builder.html` — not a
plain fresh Garmin export). Enda needs to check each walk himself and
decide the safest source file to re-import per walk; this isn't
something to fix by re-running an import blindly.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — Reached-waypoint tracking, for getting lost on long routes
Scope: `src/components/walks/WalkDetail.jsx` (Walk/Hike only, not
driving tours).

Anoushka's QA feedback: some routes have 50-60 waypoints, and a walker
who loses the trail in unfamiliar mountain terrain has no way to tell
which point they last recognised. Enda suggested two options —
auto-highlight the last point reached, or a tick-box that greys out
passed points. Implemented both together, since Crete's mountain GPS
is known to be unreliable (per Enda's own earlier notes on why this
app is Crete-specific) — manual ticking works with zero signal,
automatic detection is a convenience layered on top when GPS does
work.

**What changed:**
- Each waypoint in the "Key Points" list now has a tappable circle.
  Tapping it marks that point "reached" — greys it out, strikes
  through its name, shows a checkmark.
- Whichever reached waypoint is furthest along the route gets a
  distinct blue highlight and a "You were last here" badge — this is
  the point a lost walker should be able to find their way back to.
- If the device has GPS, any waypoint the walker's actual location
  comes within ~60m of gets ticked automatically. This only ever adds
  ticks, never removes one — a manual tap always wins over GPS, so an
  inaccurate GPS reading can't undo a walker's own correction.
- Progress is saved to the device (not the server) per walk, so it
  survives closing and reopening the app mid-walk. A small "Reset
  progress" link appears once anything's been ticked.
- Driving tours are untouched — they navigate by audio, this feature
  only applies to Walk/Hike.

**Bug caught and fixed before shipping:** my first pass put the new
`useState`/`useEffect` hooks after the existing `if (!walk) return
null;` early-return line. That breaks React's rule that hooks must run
in the same order on every render — moved the early return to after
all hooks are declared instead.

**Verified:** `npx vite build` completes with no errors.

**Not done:** not tested on an actual phone with real GPS movement —
only confirmed it builds and the logic reads correctly. Worth Enda
walking a short real route with it once live to confirm the ~60m
proximity feels right (too tight and it won't trigger on a winding
mountain path; too loose and adjacent waypoints could tick together).

---

## 2026-08-04 — "WHT Change" renamed to "Change tour type"
Scope: `src/pages/Home.jsx`.

The 3-letter tour category code (e.g. "WHT") plus "Change" was too
cryptic — Enda said even he had to click it to remember what it did.
Replaced with a plain "Change tour type" label (shortened to "Change"
on small phone screens, full text on larger ones). Code no longer
shown on the button at all.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — Payment/purchase gating: architecture clarified, on hold
No code changed this entry — flagging a decision for future sessions.

Following on from the "My Library has no purchase check" finding above:
Enda clarified the intended architecture. He's choosing between Paddle
and Creamie as Merchant of Record this week (meetings with both). Key
point either way: **the app itself should not build its own purchase/
entitlement system.** The MoR handles sales and pricing entirely on
their end — the app's job is just to link out to whichever MoR's
checkout for that product. No internal "purchases" table/flag to
maintain, no in-app pricing logic to keep in sync.

This also fits what's already in `/areas/payment-processor.md`
(persistent memory, not this repo): 15-minute expiring download links,
no persistent "owns this" state, voucher system being scrapped.
Suggests the eventual flow is closer to: user clicks Buy → sent to
Paddle/Creamie checkout → on success, some kind of redirect or webhook
back → app hands over a short-lived download link — rather than a
login-gated permanent library entry.

**Do not build a purchase/entitlement system in this codebase** until
Enda has picked Paddle or Creamie — the exact mechanics (checkout
links, webhook format, how success gets communicated back to the app)
are provider-specific and unknown until then. `membership.js`'s
current pricing rules (€15/walk, €75/year, 5 free samples, 6
free/year for members) are also known to be **outdated** — he'd
already decided on a different pricing model in an earlier session
(app free with 5 included, €24.99/product except €12.50 for plain
walking tours, €75/year membership with 25% discount, no voucher
codes) which was never implemented in code. Don't treat
`membership.js` as current truth for pricing without checking with
him first.

---

## 2026-08-03 — "My Library" was empty because the real Download button was never placed anywhere
Scope: `src/components/walks/WalkDetail.jsx`,
`src/components/walks/DownloadButton.jsx`, `src/pages/MyWalks.jsx`.

**Enda's report:** "My Library" shows "No walks downloaded yet — tap
Download on any walk" but no such button exists anywhere he can find.

**Cause:** two entirely separate components both dealt with
"downloading" a walk:
- `DownloadWalkButton` (in `offline/`) — downloads the raw GPX file
  to the visitor's computer. This one WAS on screen (in `WalkDetail`),
  and has nothing to do with "My Library".
- `DownloadButton` (in `walks/`) — the one that actually calls
  `useOfflineWalks().downloadWalk()` to save a walk into "My Library"
  for offline use. Fully built and working, but never imported or
  rendered anywhere in the app — dead code with no way for any user,
  not just Enda, to ever reach it. This is why "My Library" could
  never contain anything.

**Fix:**
- `WalkDetail.jsx` now renders both buttons side by side — save to
  My Library, and separately download the raw GPX file.
- Renamed the My-Library button's label from the ambiguous "Download"
  to "Save for Offline" (and its saved-state label from "Downloaded"
  to "Saved Offline"), so it reads clearly next to "Download GPX".
- Updated the "My Library" empty-state text to match the real button
  wording ("tap 'Save for Offline'...").

**Verified:** `npx vite build` completes with no errors.

**Not done:** haven't tested the actual save/remove/offline-viewing
flow live — only confirmed the button is now present and wired to the
existing `downloadWalk`/`removeWalk`/`isDownloaded` functions, which
were already implemented and presumably already tested when they were
first written (just never reachable). Worth Enda trying a full
save → close app → reopen offline cycle once live.

---

## 2026-08-03 — GPX Builder: fixed wrong route name auto-fill
Scope: `waypoint-gpx-builder.html`.

**Bug:** loading a plain Garmin Explore export auto-filled the Route
Name box with "MRX25" — a waypoint's own code, not a route name.
Cause: the "pick up an existing route name" check searched the whole
document for any `<name>` tag and grabbed the first one it found,
which on a plain export is just whichever waypoint happens to come
first in the file — not a real route name at all.

**Fix:** now only looks for a route name inside a proper `<metadata>`
block, which is where this tool (and the app's own GPX export) always
puts it. A plain Garmin export has no `<metadata>` block, so the
Route Name box now correctly starts blank, ready for Enda to type the
real name — only auto-fills when re-loading a file that was already
named by this tool or the app.

**Verified:** tested both cases directly in Node — a plain export
(no metadata) → blank; a re-loaded file with a real `<metadata><name>`
→ correctly picked up.

---

## 2026-08-03 — Standalone Waypoint GPX Builder tool
New file: `waypoint-gpx-builder.html` (project root). Not part of the
app itself — a separate, self-contained tool Enda runs on his own
computer by just double-clicking it (opens in any browser, no
install, no internet needed, works completely offline).

**Why:** replaces the manual `waypoint-notes-template.gpx` approach
from earlier (hand-editing raw XML tags) — Enda wanted something that
does the merging for him instead of him having to get the tags right
by hand every time, since that's slow and easy to get wrong at volume
(he mentioned ~8 walks already waiting to be imported).

**How it works:**
1. Enda loads the plain GPX he already exports from Garmin Explore
   (just raw points, no descriptions).
2. The tool shows one card per waypoint, in the same order the app
   itself would sort them into, with plain form fields: Description,
   Type (dropdown — same fixed list as `WAYPOINT_TYPES` in
   `WaypointEditor.jsx`, kept in sync by hand, noted in a comment),
   and an optional Label.
3. "Download finished GPX" produces a file in exactly the format the
   app's importer expects — same `<name>`/`<desc>`/`<mc:type>`/
   `<mc:label>` tags as `generateWalkGpx` in `routeExport.js` and the
   updated `handleGpxImport`. That file imports straight into Explore
   Crete, fully described, elevation still auto-filled by the app on
   import as always.
- Progress autosaves in the browser as he types (keyed by the route
  name he enters), so closing the tab mid-way doesn't lose work. Also
  supports re-loading a file it made earlier (or one exported by the
  app itself) to keep editing it.
- Warns before closing the tab if there are still blank descriptions.

**Verified:** extracted the core parse/build logic and round-trip
tested it in Node against a sample matching Enda's real Garmin export
(including the "MRX25" vs "MXR..." naming inconsistency already
present in his data) — parses, sorts, fills in notes, generates GPX,
and re-parses correctly, matching what the app's own importer expects.
Not tested inside an actual browser or against the live app import —
worth Enda trying one small file through the full round trip first.

---

## 2026-08-03 — Elevation Gain also now recalculates on every Save
Scope: `src/components/admin/WalkEditor.jsx` (Walk/Hike tours only).
Follows directly from the Distance fix above.

Enda decided Elevation Gain needs the same automatic fix as Distance,
since walkers with health/physical conditions rely on it to judge
whether a route is safe for them — leaving it stale after an edit
isn't acceptable the way it might be for other fields.

**What changed:** `handleSave` now refetches real elevation heights
for the current trail line (same Open Topo Data service used at
import) and recalculates Elevation Gain fresh, every time Save is
clicked. Unlike Distance, this needs a network call — heights aren't
stored anywhere between saves. If that call fails, the save still goes
through with the previous figure (doesn't block the admin's work), but
they get a clear warning afterwards: "Saved, but Elevation Gain could
not be re-checked... please check it manually before this route goes
live." On-screen Elevation Gain field updates to match after a
successful recalculation, same as Distance.

**Trade-off, accepted deliberately:** Save is now slightly slower on
Walk/Hike tours (one extra network round-trip). Judged worth it given
the safety reasoning above.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-03 — Distance now recalculates automatically on every Save
Scope: `src/components/admin/WalkEditor.jsx` (Walk/Hike tours only).

**The bug:** Plakias Koules Walk showed 46.6 km because of a rogue
waypoint in the GPX. Enda removed that waypoint — the GPX export and
the map preview both updated correctly, but the Distance number stayed
wrong. Root cause: Distance was only ever calculated once, at the
moment a GPX file gets imported. Any edit after that (adding/removing
a waypoint, fixing a bad point, re-routing) changes the route but
never re-runs that calculation, so whatever number was set at import
just sits there, right or wrong, forever.

**Fix:** `handleSave` now recalculates Distance fresh from the current
trail line every time Save is clicked (Walk/Hike tours only — driving
tours untouched). Pure distance math from the waypoints' coordinates,
no network call, so it's fast and can't fail. The on-screen Distance
field also updates to match right after a successful save, not just
what gets sent to the server.

**Verified:** `npx vite build` completes with no errors.

**Flagged, not fixed — needs a decision:**
Elevation Gain has the exact same staleness risk (also only ever
calculated once, at import) but I did **not** make it auto-recalculate
too, because doing so isn't free the way distance is: unlike distance,
Elevation Gain needs a height value for every point on the trail, and
those heights aren't stored anywhere in the route data — they only
ever existed briefly during import, fetched from an external elevation
service (Open Topo Data), then discarded. Recalculating it on every
save would mean firing that same network request to Open Topo Data
every single time Save is clicked, which would make Save noticeably
slower, and would leave the elevation figure blank or wrong if that
external service is ever briefly down. Wanted to flag that trade-off
rather than decide it for him. If Enda wants Elevation Gain kept in
sync the same way, this is the natural next step: /areas/explore-
crete-app.md and this changelog both need updating once decided.

---

## 2026-08-03 — Full sweep for old app name / generic logo
Enda asked that from now on, any text or logo change request means
checking for and fixing every occurrence, not just the one spot shown.
Did a full search of the codebase for the old name and the generic
icon-box pattern and found two more spots that hadn't been caught:

- `src/components/onboarding/RegistrationForm.jsx` — still said
  "Welcome to Crete Walking Trails" (old app name), and had the same
  generic MapPin-in-a-box brand icon. Both fixed: text now "Welcome to
  Explore Crete", icon now the real logo.
- `src/components/walks/TourCategoryPicker.jsx` — the "Choose Your
  Tour Type" screen had the same generic MapPin brand-icon box above
  its heading. Fixed to the real logo. Left the *other* MapPin/
  Footprints/Car icons on this screen alone — those are functional,
  one per tour category (Walk/Hike, WalkAbout, Driving), not branding.
- Confirmed `index.html` and `manifest.json`'s `name`/`short_name`
  already said "Explore Crete" — no change needed there.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-03 — "All Walks" heading + real logo on the walks panel
Scope: `src/components/walks/WalkList.jsx`.

- Heading changed from "Walks list" to "All Walks" (Anoushka's
  feedback — "Walks list" read wrong).
- The amber mountain-icon box next to that heading was replaced with
  the real Explore Crete logo (same file already added to `public/`
  for the main header).

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-03 — PWA install icon swapped, splash screen checked
Scope: `public/manifest.json`, `public/icon-192.png` and
`public/icon-512.png` (new files).

- The PWA install icon (what shows on someone's home screen after
  they install the app) was pointing at an old generic image hosted
  on Base44's media server. Generated proper square versions of the
  real logo (192×192 and 512×512, logo centred on a transparent
  square canvas so it isn't stretched — the source logo isn't square)
  and pointed `manifest.json` at those local files instead.
- Checked the splash screen (`SplashScreen.jsx`) — it turned out not
  to contain the small logo icon at all. It's a full-screen background
  photo (a different, unrelated image), so there was nothing there to
  swap. Left as-is.

**Verified:** `npx vite build` completes with no errors. Confirmed
`manifest.json` is still valid JSON after the edit.

---

## 2026-08-03 — Real logo in the header
Scope: `src/pages/Home.jsx`, `public/explore-crete-logo.png` (new file).

The small icon next to "Explore Crete" was a generic map-pin icon, not
the actual logo. Added the real logo image to `public/` and swapped
it in.

**Not done:** the same generic icon/logo may still appear elsewhere
(splash screen, PWA home-screen icon in `manifest.json`) — only the
main header was reported and fixed this time.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-03 — Walks list heading, Free/Paid toggle
Scope: `src/components/walks/WalkList.jsx` (front end),
`src/pages/Admin.jsx` + `src/components/admin/WalkAdminList.jsx`
(admin).

- Front end: "Crete Walks" renamed to "Walks list", small subtitle
  "Purchase to add to your library" added underneath the trail count.
- Scrolling: the list already had a proper scrolling panel
  (`ScrollArea`) — no change needed, it will kick in on its own once
  the list is taller than the panel (already true once there are more
  than ~4-5 walks). Did not add pagination — scrolling was already
  built and working, just not yet visible with only 2 walks on screen.
- Admin Tours list: added a **Free / Paid** toggle button on each row
  (admin only). Flips the walk's `is_sample_walk` flag directly via
  `Walk.update`, no need to open the full editor. "Free" makes the
  walk free to every user (not just members) — matches the "free
  Christmas walk" use case Enda described. `is_member_included` (free
  only to paying annual members) is a separate flag, unchanged, still
  only editable inside the full editor's General tab if ever needed.

**Verified:** `npx vite build` completes with no errors.

**Not done — flagged, not fixed:**
- Enda spotted "Plakias Koules Walk" showing 46.6 km when it's
  actually about 5 km. Checked the display code — it just shows
  `walk.distance_km` exactly as stored, no conversion or calculation
  bug in the display. This means the wrong number is sitting in that
  walk's own data, not a code bug. 46.6 vs the real ~5 km looks a lot
  like a decimal point in the wrong place (4.66 vs 46.6) — worth
  checking whether that's what happened. Fix: open that walk in the
  Admin Panel → Edit → General tab → correct the Distance field →
  Save. No code change involved; I don't have direct access to the
  live database to fix the value myself.

---

## 2026-08-03 — Front end: Refresh button, renamed heading
Scope: `src/pages/Home.jsx`, `src/components/walks/WalkList.jsx`.

- Renamed the front-end header from "Crete Walking Trails" to
  "Explore Crete".
- Added a bright blue "Refresh" button next to "Filters" in the
  "Crete Walks" panel — reloads the walk list from the server on
  demand, same purpose as the Admin Panel Refresh button added
  earlier today. Wired to react-query's `refetch`, which this page
  already had available (`useQuery` on `['walks']`) — no new fetching
  logic needed, just exposed the existing refetch/isFetching to the
  UI.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-03 — Bright blue styling for three buttons
Scope: `src/components/admin/WaypointEditor.jsx`,
`src/components/admin/WalkAdminList.jsx`.

Enda said the three buttons added earlier today were too hard to spot.
Changed all three to solid bright blue (`bg-blue-600`, white text):
- "Add waypoint before..." (waypoint editor)
- "Save and Download GPX" (waypoint editor)
- "Refresh" (Tours list)

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-03 — Tours list: stop trusting the browser's guess, add Refresh
Scope: Admin Panel → Tours list (`src/pages/Admin.jsx`,
`src/components/admin/WalkAdminList.jsx`).

**The problem Enda hit:** he deleted a walk, the list updated to show
one fewer. He then imported a new tour. The old page reappeared with
3 tours — including the one he'd just deleted. Going back showed 2
again.

**Cause:** the walk list was only ever fetched from the server once,
right when the Admin page first loads. After that, every action
(delete, save) just edited what was already sitting in the browser —
it never checked back with the server to confirm. If the server took
even a moment to actually finish a delete, the browser's local guess
and the server's real state could disagree, and reloading the page
would show whichever one happened to be true at that instant.

**What changed:**
- `handleDelete` in `Admin.jsx` now re-fetches the real list from the
  server straight after a delete, instead of just removing that one
  item from the browser's copy.
- Added a `refreshWalks()` function and wired a **Refresh** button
  onto the Tours list (top right, next to "Tours"). Clicking it
  re-fetches the list from the server on demand, so at any point Enda
  can check what's actually saved rather than relying on the state of
  a tab that's been open a while.

**Why:** gives an honest, checkable answer to "is this actually saved"
instead of the app silently trusting its own memory of what it did.

**Verified:** `npx vite build` completes with no errors.

**Not done / worth knowing for next time:**
- Not tested live — same caveat as prior entries, needs a real check
  in the Base44 app. Worth deleting a tour, immediately hitting
  Refresh, and confirming it's actually gone.
- This doesn't fix any underlying delay on Base44's side (if there is
  one) — it just makes sure the app always shows the truth instead of
  a guess, and gives Enda a way to check on demand.
- Same pattern (local-only state, no re-fetch) exists for `handleSave`
  and `handleMarkChecked` in `Admin.jsx` — not touched this session
  since they weren't reported as a problem, but worth keeping in mind
  if similar confusion turns up around saving or marking tours checked.

---

## 2026-08-03 — Import now reads back name/type/label from an annotated GPX
Scope: Walk/Hike tours only, GPX import (`handleGpxImport` in
`WalkEditor.jsx`).

**What changed:**
- The walk/hike branch of the waypoint importer now reads three optional
  extension tags — `<mc:type>`, `<mc:label>`, `<mc:imageUrl>` — from each
  `<wpt>`, in addition to the `<name>` (→ segment_id) and `<desc>` (→
  description) it already read. If a tag is missing, the old default is
  used, so importing a plain Garmin Explore file (no extensions) behaves
  exactly as before — no regression.
- This closes the gap flagged in the previous entry: a GPX exported by
  "Save and Download GPX" (or hand-annotated using the new template, see
  below) now imports back in with type/name/description already filled
  in, instead of every waypoint defaulting to type "landmark" with a
  blank name.
- Added `waypoint-notes-template.gpx` at the project root — a template
  Enda fills in from his notes before importing, so a route's waypoints
  arrive fully described in one import instead of being edited one by
  one afterwards in the app. Elevation is still left for the app to fill
  in automatically on import, same as today.

**Why:** Enda wants to write up waypoint notes/descriptions ahead of
time and import them in one go, rather than opening each waypoint in
the app and typing them in individually.

**Verified:** `npx vite build` completes with no errors. Confirmed the
template file itself is valid XML and its extension tags parse as
expected (checked with a standalone XML parser, not the live app).

**Not done / worth knowing for next time:**
- Still not tested inside the actual Base44/browser environment — only
  confirmed the build compiles and the template's XML is well-formed.
  Enda should test one real import before trusting it for a live tour.
- The driving-tour and WalkAbout importers are untouched — this only
  affects plain Walk/Hike tours.

---

## 2026-08-03 — Initial pull
- Cloned the repo fresh from GitHub (public repo, pulled via git clone).
- No code changes made yet. This changelog file was created as the
  first step of this session, per Enda's request to track all changes
  going forward.
