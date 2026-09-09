import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { secrets } from "base44:runtime";
import {
  CODE_EXPIRY_MIN, generateSixDigitCode, isoPlusMinutes, isoNow,
  findDevice, getActiveSessionForUser, upsertSession, sendDeviceCodeEmail, fetchWpToken,
} from "../../shared/deviceAuth.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { email: rawEmail, password, device_id, device_label } = body;

    if (!rawEmail || !password || !device_id) {
      return Response.json({ error: "Email, password and device_id are required" }, { status: 400 });
    }

    // Normalize for OUR OWN device/session records only (audit re-check, 2026-09-09 —
    // finding U-01). Matches the .toLowerCase().trim() convention already used everywhere
    // else in this app (purchaseRecorder.ts, membershipRecorder.ts, useOfflineWalks.jsx).
    // Without this, "Enda@x.com" and "enda@x.com" were treated as two different people for
    // the device limit and the one-session lock, so either could be sidestepped just by
    // varying how an email is capitalised between logins. The password check below still
    // gets the exact, as-typed email, unchanged, so this can't affect whether a correct
    // password is accepted.
    const email = String(rawEmail).toLowerCase().trim();

    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const siteUrl = secrets.get("WC_SITE_URL");

    // 1. Validate credentials against the WordPress JWT endpoint.
    let wpData;
    try {
      wpData = await fetchWpToken(rawEmail, password, siteUrl);
    } catch (err: any) {
      return Response.json({ error: err.message || "Invalid email or password" }, { status: 401 });
    }
    if (!wpData || !wpData.token) {
      return Response.json({ error: wpData?.error || "Invalid email or password" }, { status: 401 });
    }

    // Staff bypass: admins and narrators always work from desktop/laptop and are
    // exempt from the device challenge and concurrent-session lock.
    const staffRecords = await svc.entities.AppUser.filter({ email });
    if (staffRecords.length > 0 && (staffRecords[0].role === "admin" || staffRecords[0].role === "narrator")) {
      const existing = await findDevice(svc, email, device_id);
      if (existing) {
        await svc.entities.Device.update(existing.id, { last_used: isoNow(), device_label: device_label || existing.device_label });
      } else {
        await svc.entities.Device.create({ user_email: email, device_id, device_label: device_label || "Admin device", first_seen: isoNow(), last_used: isoNow() });
      }
      await upsertSession(svc, email, device_id);
      return Response.json({ status: "ok", token: wpData.token, user: wpData.user });
    }

    // 2. Concurrent session check: block if ANOTHER device already has an active session.
    const activeSession = await getActiveSessionForUser(svc, email);
    if (activeSession && activeSession.device_id !== device_id) {
      return Response.json(
        { error: "This account is already in use on another device. Please sign out there and try again." },
        { status: 409 }
      );
    }

    // 3. Known device? -> complete login immediately.
    const known = await findDevice(svc, email, device_id);
    if (known) {
      await svc.entities.Device.update(known.id, { last_used: isoNow(), device_label: device_label || known.device_label });
      await upsertSession(svc, email, device_id);
      return Response.json({ status: "ok", token: wpData.token, user: wpData.user });
    }

    // 4. Unknown device -> issue a one-time code and email it via WordPress.
    // Expire any prior pending challenge for this email+device so only the newest is valid.
    const prior = await svc.entities.DeviceChallenge.filter({ user_email: email, device_id, status: "pending" });
    for (const p of prior) {
      await svc.entities.DeviceChallenge.update(p.id, { status: "expired" });
    }

    const code = generateSixDigitCode();
    const expiresAt = isoPlusMinutes(CODE_EXPIRY_MIN);
    await svc.entities.DeviceChallenge.create({
      user_email: email,
      device_id,
      code,
      expires_at: expiresAt,
      attempts: 0,
      status: "pending",
    });

    let sent = false;
    try {
      sent = await sendDeviceCodeEmail(email, code, siteUrl, secrets.get("MC_DEVICE_CODE_SECRET"));
    } catch (e) {
      sent = false;
    }

    if (!sent) {
      return Response.json(
        { error: "We could not send the verification email right now. Please try again in a moment." },
        { status: 503 }
      );
    }

    return Response.json({ status: "challenge_required", expires_at: expiresAt });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}