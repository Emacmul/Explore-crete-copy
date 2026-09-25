import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';
import { wrapClientWithRetry } from '../../shared/withEntityRetry.ts';
import { canonicalJson, hashRecord, sha256Hex } from '../../shared/publishedTours.ts';

// Full backup of every Walk record to the app's PRIVATE file storage (published-versions
// plan, step 0). Admins only. The repository is public and must never hold tour scripts,
// routes or audio links — the backup exists solely in private storage, and this function
// returns only a SUMMARY (counts, hashes, filename) with zero tour content.
//
// Restorability is verified, not assumed: immediately after upload, the stored file is
// read back from private storage (signed URL fetch), parsed, and compared
// record-by-record against a fresh live read — record count, every record's content
// hash, and the presence of every Walk-required field. A mismatch or an unreadable file
// fails the verification loudly instead of "success".
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = wrapClientWithRetry(createClientFromRequest(req));
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor || actor.kind !== 'admin') {
      return Response.json({ error: 'Admin access required.' }, { status: 403 });
    }
    const svc = base44.asServiceRole;

    const all = await svc.entities.Walk.list('-created_date', 1000);
    const rows = Array.isArray(all) ? all : [];
    if (rows.length === 0) {
      return Response.json({ error: 'No Walk records found to back up.' }, { status: 400 });
    }

    const perRecordHashes = await Promise.all(rows.map((w: any) => hashRecord(w)));
    const totalHash = await sha256Hex([...perRecordHashes].sort().join('\n'));

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `walk-backup-${stamp}.json`;
    const payload = JSON.stringify({
      exported_at: new Date().toISOString(),
      record_count: rows.length,
      total_sha256: totalHash,
      records: rows,
    }, null, 2);

    // Private storage — no public URL exists for this file, ever.
    const file = new File([new TextEncoder().encode(payload)], filename, { type: 'application/json' });
    const upload = await svc.integrations.Core.UploadPrivateFile({ file });
    const file_uri = upload.file_uri;

    // ---- Read-back verification: prove the stored file is complete and restorable ----
    let verified = false;
    let verifyDetail: any = null;
    try {
      const signed = await svc.integrations.Core.CreateFileSignedUrl({ file_uri, expires_in: 600 });
      const res = await fetch(signed.signed_url);
      if (!res.ok) throw new Error(`signed-url fetch returned ${res.status}`);
      const parsed = JSON.parse(await res.text());

      const live = await svc.entities.Walk.list('-created_date', 1000);
      const liveRows = Array.isArray(live) ? live : [];
      const liveHashes = new Map(await Promise.all(liveRows.map(async (w: any) => [w.id, await hashRecord(w)])));
      const missing: string[] = [];
      const mismatched: string[] = [];
      for (const r of (Array.isArray(parsed.records) ? parsed.records : [])) {
        const liveH = liveHashes.get(r.id);
        if (liveH === undefined) { missing.push(r.id); continue; }
        const fileH = await hashRecord(r);
        if (fileH !== liveH) mismatched.push(r.id);
      }
      const required = ['code', 'name', 'start_lat', 'start_lng', 'region', 'tour_category'];
      const shapeIssues = (Array.isArray(parsed.records) ? parsed.records : [])
        .filter((r: any) => required.some((f) => r[f] === undefined)).length;

      verified = parsed.record_count === liveRows.length
        && parsed.records.length === liveRows.length
        && missing.length === 0
        && mismatched.length === 0
        && shapeIssues === 0;
      verifyDetail = {
        read_back_records: (parsed.records || []).length,
        live_records: liveRows.length,
        missing_in_live: missing.length,
        content_mismatches: mismatched.length,
        records_missing_required_fields: shapeIssues,
      };
    } catch (verifyError) {
      verifyDetail = { error: String((verifyError as Error).message || verifyError) };
    }

    return Response.json({
      ok: verified,
      backup_file: filename,
      record_count: rows.length,
      family_count: rows.filter((w: any) => !w.clone_of).length,
      clone_count: rows.filter((w: any) => !!w.clone_of).length,
      total_sha256: totalHash,
      verified,
      verification: verifyDetail,
      // Only content-free metadata ever leaves this function.
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}