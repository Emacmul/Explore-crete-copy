import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { secrets } from "base44:runtime";
import {
  DEVICE_LIMIT, MAX_ATTEMPTS, LOCKOUT_MIN,
  isoNow, isoPlusMinutes, findDevice, listDevicesForUser, getActiveSessionForUser, upsertSession, fetchWpToken,
} from "../../shared/deviceAuth.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { email, password, device_id, code, device_label } = body;

    if (!email || !password || !device_id || !code) {
      return Response.json({ error: "Email, password, device_id and code are required" }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const siteUrl = secrets.get("WC_SITE_URL");

    // Find the newest pending challenge for this email+device.
    const challenges = await svc.entities.DeviceChallenge.filter({ user_email: email, device_id, status: "pending" });
    const challenge = challenges.sort((a: any, b: any) =>
      new Date(b.created_date).getTime() - new Date(a.created_date).getTime()
    )[0];

    if (!challenge) {
      return Response.json({ error: "No active verification code for this device. Please start sign-in again." }, { status: 400 });
    }

    // Lockout check.
    if (challenge.locked_until && new Date(challenge.locked_until).getTime() > Date.now()) {
      return Response.json({ error: "Too many incorrect attempts. Please wait 15 minutes and try again." }, { status: 429 });
    }

    // Expiry check.
    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      await svc.entities.DeviceChallenge.update(challenge.id, { status: "expired" });
      return Response.json({ error: "This code has expired. Please start sign-in again." }, { status: 410 });
    }

    // Code comparison.
    if (String(challenge.code) !== String(code)) {
      const nextAttempts = (challenge.attempts || 0) + 1;
      if (nextAttempts >= MAX_ATTEMPTS) {
        await svc.entities.DeviceChallenge.update(challenge.id, {
          attempts: nextAttempts,
          locked_until: isoPlusMinutes(LOCKOUT_MIN),
          status: "locked",
        });
        return Response.json({ error: "Too many incorrect attempts. Please wait 15 minutes and try again." }, { status: 429 });
      }
      await svc.entities.DeviceChallenge.update(challenge.id, { attempts: nextAttempts });
      const remaining = MAX_ATTEMPTS - nextAttempts;
      return Response.json(
        { error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.` },
        { status: 400 }
      );
    }

    // Code correct — re-validate credentials to mint a fresh token.
    let wpData;
    try {
      wpData = await fetchWpToken(email, password, siteUrl);
    } catch (err: any) {
      return Response.json({ error: err.message || "Invalid email or password" }, { status: 401 });
    }

    // Re-check concurrent session right before completing (another device may have logged in meanwhile).
    const activeSession = await getActiveSessionForUser(svc, email);
    if (activeSession && activeSession.device_id !== device_id) {
      // Leave the challenge pending so the user can retry once the other session ends.
      return Response.json(
        { error: "This account is already in use on another device. Please sign out there and try again." },
        { status: 409 }
      );
    }

    await svc.entities.DeviceChallenge.update(challenge.id, { status: "verified" });

    // Register the device, evicting the oldest if at/over the limit.
    const devices = await listDevicesForUser(svc, email);
    const existing = devices.find((d: any) => d.device_id === device_id);
    if (!existing) {
      if (devices.length >= DEVICE_LIMIT) {
        const oldest = devices[0];
        await svc.entities.Device.delete(oldest.id);
        const oldSessions = await svc.entities.ActiveSession.filter({ user_email: email, device_id: oldest.device_id });
        for (const s of oldSessions) {
          await svc.entities.ActiveSession.delete(s.id);
        }
      }
      await svc.entities.Device.create({
        user_email: email,
        device_id,
        device_label: device_label || null,
        first_seen: isoNow(),
        last_used: isoNow(),
      });
    } else {
      await svc.entities.Device.update(existing.id, { last_used: isoNow(), device_label: device_label || existing.device_label });
    }

    // Activate the session.
    await upsertSession(svc, email, device_id);

    return Response.json({ status: "ok", token: wpData.token, user: wpData.user });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}