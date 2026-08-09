import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { isAppAdmin } from '../../shared/appUserAuth.ts';

// Scheduled sync (runs on a Base44 workflow, NOT WP-Cron): pulls every
// WordPress-registered user into AppUser as a plain "user" so admins can see the
// full customer list and promote people to Narr/Admin.
//
// Only CREATES rows for emails not already in AppUser. It never updates an
// existing row and never touches role — an already-promoted Narr/Admin is never
// reset to "user". Only email + first/last name come from WordPress; the legacy
// AppUser fields (date of birth, gender, password) are left unset, and
// newsletter_opted_in is set to false so a synced row never implies the person
// opted into marketing when we don't actually know.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    if (!(await isAppAdmin(base44))) {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const siteUrl = secrets.get('WC_SITE_URL');
    const secret = secrets.get('MC_DEVICE_CODE_SECRET');
    if (!siteUrl || !secret) {
      return Response.json(
        { error: 'Server not configured (WC_SITE_URL / MC_DEVICE_CODE_SECRET)' },
        { status: 500 }
      );
    }

    // 1. Pull every WP user from the custom REST endpoint (same plugin + secret the
    //    device-code email uses), paging until a page comes back short.
    const wpUsers = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${siteUrl}/wp-json/magicalcrete/v1/users?page=${page}&per_page=200`,
        { headers: { 'X-MC-Secret': secret } }
      );
      if (!res.ok) {
        return Response.json(
          { error: `WordPress users fetch failed (${res.status})` },
          { status: 502 }
        );
      }
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      wpUsers.push(...batch);
      if (batch.length < 200) break;
      page++;
    }

    // 2. Load existing AppUser emails once (lowercased) so we only create missing
    //    rows — never duplicate, never overwrite. (Cap is generous; revisit if the
    //    customer base ever grows past it.)
    const svc = base44.asServiceRole;
    const existing = await svc.entities.AppUser.filter({}, '-created_date', 5000);
    const existingEmails = new Set(
      (Array.isArray(existing) ? existing : [])
        .map((r) => String(r.email || '').toLowerCase().trim())
        .filter(Boolean)
    );

    // 3. Create a plain-"user" row for every WP registration we don't already have.
    let created = 0;
    for (const wp of wpUsers) {
      const email = String(wp.email || '').toLowerCase().trim();
      if (!email) continue;
      if (existingEmails.has(email)) continue;
      await svc.entities.AppUser.create({
        email,
        first_name: String(wp.first_name || '').trim(),
        last_name: String(wp.last_name || '').trim(),
        role: 'user',
        newsletter_opted_in: false,
      });
      existingEmails.add(email);
      created++;
    }

    return Response.json({ ok: true, wpTotal: wpUsers.length, created });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}