import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';
import { resolveActiveVersion } from '../../shared/publishedTours.ts';

// Admin listing of every published version, grouped PER (family, language) pair — the
// data behind the versions panel (published-versions plan). For each pair it returns
// the full version history (newest first) plus the pair's RESOLVED active version as
// the shared resolver computes it — so the panel shows exactly what the serving path
// would serve, including the deterministic tie-break result if an interrupted action
// ever left more than one active (which is also flagged as an anomaly to repair).
// Version content is deliberately excluded — the panel needs metadata, not megabytes.
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor || actor.kind !== 'admin') {
      return Response.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const svc = base44.asServiceRole;
    const all = await svc.entities.PublishedTour.list('-published_at', 1000);
    const rows = Array.isArray(all) ? all : [];

    const grouped = new Map(); // `${family_id}||${language}` -> { family_code, versions: [] }
    for (const row of rows) {
      const key = `${row.family_id}||${row.language}`;
      if (!grouped.has(key)) grouped.set(key, { family_id: row.family_id, family_code: row.family_code || '', language: row.language, versions: [] });
      const entry: any = grouped.get(key).versions.find((v: any) => v.id === row.id);
      if (entry) continue; // defensive: never list a row twice
      grouped.get(key).versions.push({
        id: row.id,
        version_number: row.version_number,
        status: row.status,
        status_changed_at: row.status_changed_at,
        published_at: row.published_at,
        published_by_email: row.published_by_email,
        source_walk_id: row.source_walk_id,
      });
    }

    const pairs = [];
    for (const pair of grouped.values()) {
      const versions = pair.versions.sort((a: any, b: any) => (b.version_number || 0) - (a.version_number || 0));
      const { version, anomaly, active_count } = await resolveActiveVersion(svc, pair.family_id, pair.language);
      pairs.push({
        family_id: pair.family_id,
        family_code: pair.family_code,
        language: pair.language,
        versions,
        resolved_active: version ? { id: version.id, version_number: version.version_number, status_changed_at: version.status_changed_at } : null,
        active_count,
        anomaly,
      });
    }

    return Response.json({ ok: true, total_versions: rows.length, pairs });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}