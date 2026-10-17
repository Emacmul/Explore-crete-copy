import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { isSuperAdmin } from "../../shared/appUserAuth.ts";

// Serves the Login Log screen (Admin Panel → Login Log, Super Admin only).
//
// The staff back end signs in with the backend password through narrLogin, which
// gives the browser a WordPress-side identity but NO Base44 session — so a direct
// entity read from LoginLogPanel gets silently blocked by RLS and the screen shows
// an empty log (2026-10-17, Enda's report: daily logins invisible). Same reason
// UsersManager/DisputesManager read through admin-scoped functions instead.
//
// Super-Admin gated (the Login Log itself is Super Admin only): resolveNarrSession
// inside isSuperAdmin checks body.email + body.narrToken against that exact
// AppUser row, and only role 'super_admin' passes.
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    if (!(await isSuperAdmin(base44, body))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }


    // Same window/filters the screen documents: last 7 days, newest first,
    // optionally narrowed to failed or successful attempts only. The window uses
    // login_at (the true server-stamped login time, present on every row incl.
    // backfilled ones) — created_date on backfilled rows is only the backfill
    // write time.
    //
    // QUIRK (found 2026-10-17, verified by in-function probes): in this function
    // runtime the query layer silently matches NOTHING when a $gte date value
    // carries a time-of-day component (Date objects and full ISO strings,
    // millisecond OR whole-second) — only a bare date "YYYY-MM-DD" compares
    // correctly. And passing ANY options object ({sort, limit, ...}) alongside
    // the $gte query ALSO returns nothing (the options path re-serializes the
    // threshold into the broken form). So: bare call, date-only threshold, and
    // the rows are ordered in code — trivial at this screen's scale (one week of
    // staff logins for a small team, well under the SDK's default page size).
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const query: Record<string, unknown> = { login_at: { $gte: weekAgo.toISOString().slice(0, 10) } };
    if (body.status === "failed" || body.status === "success") {
      query.status = body.status;
    }

    const rows: any[] = await base44.asServiceRole.entities.LoginLog.filter(query);
    rows.sort((a: any, b: any) =>
      String(b.login_at || b.created_date || "").localeCompare(String(a.login_at || a.created_date || ""))
    );

    return Response.json({
      logins: rows.map((l: any) => ({
        id: l.id,
        user_email: l.user_email,
        status: l.status,
        failure_reason: l.failure_reason,
        role: l.role,
        login_type: l.login_type,
        login_at: l.login_at,
        device_id: l.device_id,
        device_label: l.device_label,
        ip: l.ip,
        description: l.description,
        created_date: l.created_date,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}