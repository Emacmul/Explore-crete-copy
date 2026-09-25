import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { verifyEmailFromToken } from "../../shared/wpToken.ts";
import { isSessionRevoked } from "../../shared/deviceAuth.ts";
import { isWalkPublic } from "../../shared/walkPublish.ts";
import { DEFAULT_SAFETY_NOTES } from "../../shared/defaultSafetyNotes.ts";

// Per Enda (follow-up 184): "Before You Set Off" (safety_notes) is exactly the kind of
// thing people scroll past without reading — until something goes wrong, and then the
// hassle starts. Every time a customer taps Confirm on that section, this writes a
// permanent, timestamped record that they saw it — snapshotting the EXACT text shown at
// that moment (safety_notes_snapshot), so a later edit to the tour's safety notes can
// never be mistaken for what this specific customer actually confirmed reading.
//
// Same identification pattern as sessionHeartbeat/getWalkCatalog: real customers log in
// through WordPress only and never have a Base44 session, so the caller is identified from
// their WordPress-issued token, not trusted from the request body directly.
//
// This is called every time someone taps Confirm — including a walk they've confirmed
// before (Enda: asked for again every time, not just once) — so multiple rows per
// person/walk are expected and normal, not a bug.
//
// SERVER-AUTHORITATIVE CONTENT (2026-09-25 review, "safety record can be falsified"):
// the caller supplies only WHICH tour they confirmed (the stable family id) and which
// narration language they were reading. Everything the record actually stores about the
// tour — its code, its name, and the exact safety-notes text — is read from the database
// here. A hand-crafted request can no longer forge an empty or invented "confirmed text":
// the snapshot is always the text the database holds for the language record the catalogue
// itself would serve (the clone matching the caller's language, else the original — the
// same resolution rule getWalkCatalog uses), and an unknown walk id is rejected outright.
export default async function (req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { token, walk_id, active_lang, device_id } = body;
    if (!walk_id) {
      return Response.json({ error: "walk_id is required" }, { status: 400 });
    }

    const email = await verifyEmailFromToken(token, Deno.env.get('WC_SITE_URL'));
    if (!email) {
      return Response.json({ error: "Not authorized" }, { status: 403 });
    }

    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    // Session-revocation gate (2026-09-24 review, "revoked sessions"): a WordPress token
    // stays valid after this account's app session was ended (force-logout or an explicit
    // logout) — a revoked session must not keep writing confirmations. Fails closed, the
    // same way the read paths (syncLibrary, getMembershipStatus) already do.
    if (await isSessionRevoked(svc, email, token)) {
      return Response.json({ error: "Not authorized" }, { status: 403 });
    }

    // Resolve the real tour family from the database. `walk_id` is the stable family id
    // (the original's id — see getWalkCatalog); if a caller passes a clone's own id by
    // mistake or design, resolve up to the original so the record still keys on the
    // family. An id that matches no record at all is rejected — there is no tour to have
    // confirmed anything about.
    let original = await svc.entities.Walk.get(String(walk_id)).catch(() => null);
    if (original && original.clone_of) {
      original = await svc.entities.Walk.get(String(original.clone_of)).catch(() => null);
    }
    if (!original) {
      return Response.json({ error: "Unknown walk" }, { status: 400 });
    }

    // The language record the catalogue would actually have SERVED this caller — same
    // eligibility rule and same priority order as getWalkCatalog (2026-09-25 review,
    // "the log could snapshot an unpublished clone"): a clone only counts when it is
    // BOTH finished and published, an unfinished/unpublished clone was never shown to
    // any customer and must never be snapshotted as "the text they confirmed". Priority:
    // the finished+published clone matching the caller's language, else the published
    // original, else the first other finished+published clone alphabetically. Nothing
    // eligible at all -> the customer cannot have been shown this tour in that language,
    // so there is nothing genuine to confirm and the request is rejected.
    const clones = await svc.entities.Walk.filter({ clone_of: original.id });
    const lang = String(active_lang || 'English');
    const eligible = (Array.isArray(clones) ? clones : []).filter((c: any) => c && c.finished === true && isWalkPublic(c));
    const otherPublished = [...eligible].sort((a: any, b: any) =>
      String(a.target_language || '').localeCompare(String(b.target_language || '')));
    const active =
      eligible.find((c: any) => c.target_language === lang) ||
      (isWalkPublic(original) ? original : null) ||
      otherPublished[0] ||
      null;
    if (!active) {
      return Response.json({ error: "This tour is not published in that language." }, { status: 400 });
    }

    await svc.entities.SafetyConfirmation.create({
      buyer_email: email,
      walk_id: original.id,
      walk_code: active.code || original.code || '',
      walk_name: active.name || original.name || '',
      // When the record still has a blank Safety Notes field, the customer's screen fell
      // back to the shared default safety text (see src/lib/defaultSafetyNotes.js) — so
      // THAT is what they actually read and confirmed, and that is what gets snapshotted,
      // never an empty string.
      safety_notes_snapshot: active.safety_notes || DEFAULT_SAFETY_NOTES,
      confirmed_at: new Date().toISOString(),
      device_id: device_id || '',
    });

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}