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
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const list = await base44.asServiceRole.entities.Translation.list('-updated_date', 1000);
    return Response.json({ translations: list || [] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
