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
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const query: Record<string, unknown> = { login_at: { $gte: weekAgo.toISOString() } };
    if (body.status === "failed" || body.status === "success") {
      query.status = body.status;
    }

    // The options form returns a page object ({ items, ... }), never an array.
    const page = await base44.asServiceRole.entities.LoginLog.filter(query, {
      sort: "-created_date",
      limit: 500,
    });
    const rows: any[] = Array.isArray(page) ? page : (page.items || []);
    console.log("listLoginLogsAdmin query:", JSON.stringify(query));
    console.log("listLoginLogsAdmin page raw:", JSON.stringify(page)?.slice(0, 300));
    const dbg = await base44.asServiceRole.entities.LoginLog.filter({});
    console.log("listLoginLogsAdmin unfiltered count:", Array.isArray(dbg) ? dbg.length : JSON.stringify(dbg)?.slice(0, 200));
    const t1 = await base44.asServiceRole.entities.LoginLog.filter({ status: "success" });
    console.log("listLoginLogsAdmin statusOnly:", Array.isArray(t1) ? t1.length : "?");
    const t2 = await base44.asServiceRole.entities.LoginLog.filter({ created_date: { $gte: new Date("2000-01-01T00:00:00Z") } });
    console.log("listLoginLogsAdmin gte1970:", Array.isArray(t2) ? t2.length : "?");
    const t3 = await base44.asServiceRole.entities.LoginLog.filter({ login_at: { $gte: new Date("2000-01-01T00:00:00Z") } });
    console.log("listLoginLogsAdmin loginAt2000:", Array.isArray(t3) ? t3.length : "?");
    console.log("listLoginLogsAdmin seen dates:", JSON.stringify((Array.isArray(dbg) ? dbg : []).map((r: any) => ({ cd: r.created_date, la: r.login_at }))).slice(0, 400));

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