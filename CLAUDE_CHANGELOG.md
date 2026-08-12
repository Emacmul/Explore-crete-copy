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

---

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
