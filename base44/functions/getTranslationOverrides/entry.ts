import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
// Per Enda / Base44 support: retries a real 429 (pooled rate limit) with a short backoff —
// see withEntityRetry.ts's own header comment for the full reasoning.
import { wrapClientWithRetry } from '../../shared/withEntityRetry.ts';

// Fetches every Translation override, for the admin/narrator editing tool to display
// current values against. Exists specifically because a narrator has no genuine Base44
// login session (they authenticate through their own email+password/token system, not
// Base44's own login) — a direct client-side `base44.entities.Translation.list()` call
// depends on having that real session to work reliably, the same reason every other piece
// of narrator-facing functionality in this app routes through a dedicated function using
// asServiceRole instead. This was the one place that hadn't been, which is exactly why a
// narrator's save appeared to work (saveTranslation already correctly used asServiceRole)
// but the very next reload silently failed to show it back to her, making it look like
// the save itself hadn't taken.
//
// Security (2026-09-24 review, "public data leak" finding): this endpoint is deliberately
// unauthenticated — every customer's app loads UI overrides through it, with no Base44
// session of their own — so it must serve ONLY the public override fields
// (key/lang/value). The stored records also carry edited_by_email and internal
// description notes; those never leave the server through this path, so an anonymous
// caller can't harvest narrator/admin email addresses. The admin/narrator editing tool
// doesn't need them either (it displays only key/lang/value), and any genuine need for
// "who edited this" can go through an auth-checked admin function later.
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
    const base44 = wrapClientWithRetry(createClientFromRequest(req));
    const list = await base44.asServiceRole.entities.Translation.list('-updated_date', 20000);
    const translations = (list || []).map(r => ({
      id: r.id,
      key: r.key,
      lang: r.lang,
      value: r.value
    }));
    return Response.json({ translations });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}