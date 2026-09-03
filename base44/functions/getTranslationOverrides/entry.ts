import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Fetches every Translation override, for the admin/narrator editing tool to display
// current values against. Exists specifically because a narrator has no genuine Base44
// login session (they authenticate through their own email+password/token system, not
// Base44's own login) — a direct client-side `base44.entities.Translation.list()` call
// depends on having that real session to work reliably, the same reason every other piece
// of narrator-facing functionality in this app routes through a dedicated function using
// asServiceRole instead. This was the one place that hadn't been, which is exactly why a
// narrator's save appeared to work (saveTranslation already correctly used asServiceRole)
// but the very next reload silently failed to show it back to her, making it look like the
// save itself hadn't taken.
//
// No extra restriction needed beyond just being reachable — Translation's own RLS already
// allows public read (the live customer-facing app relies on that same openness to show
// corrected translations to everyone), so this just serves the same already-public data
// through a path that actually works for a narrator's session too.
//
// The 1000-row cap this used to have was a real bug, not a safe default: Enda hit it head-on
// (2026-09-03) once enough languages had been auto-translated to push the Translation table
// past 2,000 rows (confirmed live in Base44's own data browser: "Translation (2,129)"). Because
// the query is sorted by most-recently-updated first, everything past row 1000 just silently
// vanished from what this tool could show — nothing was actually deleted, but languages
// translated further back (yesterday's Portuguese, Spanish, German, French, Czech, Dutch)
// dropped off the visible list entirely the moment enough NEWER rows (this morning's Greek,
// Polish, Romanian, Hungarian, Russian) pushed them past the cutoff, and looked exactly like
// freshly-untranslated languages even though the real data was untouched in the database the
// whole time. 199 keys × every UI language this app supports comfortably exceeds 1000 — the
// cap was always going to bite eventually, it just took this many languages being done to
// surface it. Raised generously past any realistic total (199 keys wouldn't hit this even at
// 100 languages) rather than tuned to just barely cover today's count, so this doesn't quietly
// resurface again the next time a few more languages get finished.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const list = await base44.asServiceRole.entities.Translation.list('-updated_date', 20000);
    return Response.json({ translations: list || [] });
  } catch (error) {
 
    return Response.json({ error: error.message }, { status: 500 });
  }
}
