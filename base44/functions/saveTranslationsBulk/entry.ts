import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyPassword } from '../../shared/passwordHash.ts';

// Bulk-upserts many UI-string Translation overrides for ONE language in a single call.
// Exists for seedUiTranslations' "Auto-translate missing" pass in TranslationsManager.jsx,
// which can produce a hundred-plus translated strings at once — saving those one at a time
// through saveTranslation would mean a hundred-plus separate round trips for a single button
// click. Writes exactly the same Translation records, through the same asServiceRole path,
// that a narrator's own manual per-key correction (saveTranslation) would — a seeded string
// and a hand-corrected one are indistinguishable once saved, which is the point: seeding just
// gives a narrator something real to start correcting from instead of raw English.
//
// Auth mirrors saveTranslation exactly (admin via Base44 session, or narrator via
// email+narrToken/narrPassword) since this is the same write, just batched.
//
// Chunk size/pacing (per Enda, thinking ahead to several narrators auto-translating at
// once): Base44's own published limits are per-app, not per-narrator-clone — narrators
// share one app and one database here, they don't each get an isolated backend. Those
// limits (documented as roughly 140 creates/min, 100 updates/min, shared app-wide) are
// generous for normal narrator activity, but a burst tool like this — which used to fire
// 10 writes at once — is exactly the kind of spike that could stack up if two or three
// narrators happened to run "Auto-translate" in the same moment. Smaller chunks with a
// short pause between them spread the same total writes out over a bit more time instead
// of firing them all in one instant, at basically no cost to a seeding pass that already
// isn't time-critical.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { lang, entries, email, narrPassword, narrToken } = body || {};

    if (!lang || !entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length === 0) {
      return Response.json({ error: 'lang and a non-empty entries object are required' }, { status: 400 });
    }


    // --- authorize (identical to saveTranslation) ---
    let authorizedEmail = null;
    try {
      const me = await base44.auth.me();
      if (me && me.role === 'admin') authorizedEmail = me.email || null;
    } catch { /* no Base44 session — fall through to the narrator path */ }

    if (!authorizedEmail) {
      if (!email || (!narrPassword && !narrToken)) {
        return Response.json({ error: 'Not authorized' }, { status: 403 });
      }
      const normalized = String(email).trim().toLowerCase();
      const matches = await base44.asServiceRole.entities.AppUser.filter({ email: normalized });
      const u = Array.isArray(matches) ? matches[0] : null;
      if (!u || (u.role !== 'narrator' && u.role !== 'admin')) {
        return Response.json({ error: 'Not authorized' }, { status: 403 });
      }
      const tokenValid = narrToken && u.narr_session_token && String(u.narr_session_token) === String(narrToken)
        && u.narr_session_expires_at && new Date(u.narr_session_expires_at).getTime() > Date.now();
      // Passwords are now stored hashed (see passwordHash.ts / narrLogin.ts) — this
      // still verifies correctly against either a hashed or a not-yet-migrated
      // plain-text row, same as narrLogin itself.
      const passwordValid = !tokenValid && narrPassword && u.password && (await verifyPassword(String(narrPassword), String(u.password))).valid;
      if (!tokenValid && !passwordValid) {
        return Response.json({ error: 'Not authorized' }, { status: 403 });
      }
      authorizedEmail = u.email;
    }

    // --- upsert every (key, lang) pair ---
    const keys = Object.keys(entries).filter(k => typeof entries[k] === 'string' && entries[k].trim());
    const existing = await base44.asServiceRole.entities.Translation.filter({ lang });
    const byKey: Record<string, any> = {};
    for (const r of (Array.isArray(existing) ? existing : [])) {
      if (r && r.key) byKey[r.key] = r;
    }

    let saved = 0;
    const errors: { key: string; error: string }[] = [];
    // Chunked AND paced — writing dozens of records all at once is more likely to trip
    // Base44's own app-wide write limits (shared across every narrator, not per-clone —
    // see the comment above) than a few at a time with a short gap between batches, and
    // one failed write shouldn't take the rest of the batch down with it either way.
    const CHUNK = 5;
    for (let i = 0; i < keys.length; i += CHUNK) {
      const chunk = keys.slice(i, i + CHUNK);
      const results = await Promise.allSettled(chunk.map(async (key) => {
        const value = entries[key];
        const record = byKey[key];
        if (record) {
          await base44.asServiceRole.entities.Translation.update(record.id, { value, edited_by_email: authorizedEmail });
        } else {
          await base44.asServiceRole.entities.Translation.create({ key, lang, value, edited_by_email: authorizedEmail });
        }
      }));
      for (let j = 0; j < results.length; j++) {
        if (results[j].status === 'fulfilled') {
          saved++;
        } else {
          const reason: any = (results[j] as PromiseRejectedResult).reason;
          errors.push({ key: chunk[j], error: String(reason?.message || reason) });
        }
      }
      if (i + CHUNK < keys.length) await sleep(300);
    }

    return Response.json({ ok: true, saved, total: keys.length, errors });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
