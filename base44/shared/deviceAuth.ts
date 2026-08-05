// Configuration & helpers for device-based login protection.
// This module is shared across backend functions and must stay client-safe:
// it must NOT import "base44:runtime" or any "npm:" specifier — those resolve
// only inside the backend function runtime, so secret values are passed in
// by the calling functions instead.

// ---- Configuration (tunable) ----
export const DEVICE_LIMIT = 2;            // max known devices per account
export const CODE_EXPIRY_MIN = 10;        // verification code lifetime
export const MAX_ATTEMPTS = 5;            // wrong codes before lockout
export const LOCKOUT_MIN = 15;             // lockout duration after MAX_ATTEMPTS
export const SESSION_TIMEOUT_MIN = 20;    // a session older than this (no heartbeat) is inactive

// ---- Time helpers ----
export function isoNow(): string {
  return new Date().toISOString();
}

export function isoPlusMinutes(min: number): string {
  return new Date(Date.now() + min * 60000).toISOString();
}

export function generateSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ---- WordPress JWT token fetch (shared by login + verify) ----
// siteUrl is passed in so this module stays free of runtime imports.
export async function fetchWpToken(email: string, password: string, siteUrl: string) {
  if (!siteUrl) throw new Error("Server not configured (WC_SITE_URL missing)");

  const response = await fetch(`${siteUrl}/wp-json/jwt-auth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMsg = Array.isArray(data)
      ? data[0]?.message
      : data.message || "Invalid email or password";
    const err = new Error(errorMsg || "Invalid email or password");
    // @ts-ignore custom prop
    err.statusCode = 401;
    throw err;
  }

  let userId = null;
  let userEmail = data.user_email || null;
  try {
    const parts = data.token.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      userId = payload.data?.user?.id || payload.user_id || payload.sub || null;
      userEmail = userEmail || payload.data?.user?.email || payload.email || null;
    }
  } catch (_e) {
    // token decode failed — continue without user_id
  }

  return {
    token: data.token,
    user: {
      id: userId,
      email: userEmail,
      display_name: data.user_display_name || null,
      username: data.user_nicename || null,
    },
  };
}

// ---- WordPress code-email endpoint ----
export async function sendDeviceCodeEmail(email: string, code: string, siteUrl: string, secret: string): Promise<boolean> {
  if (!siteUrl || !secret) throw new Error("Server not configured for device code email");

  const res = await fetch(`${siteUrl}/wp-json/magicalcrete/v1/device-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MC-Secret": secret },
    body: JSON.stringify({ email, code }),
  });
  return res.ok;
}

// ---- Device record helpers (operate on a service-role client) ----
export async function findDevice(svc: any, email: string, deviceId: string) {
  const list = await svc.entities.Device.filter({ user_email: email, device_id: deviceId });
  return list[0] || null;
}

// All known devices for a user, oldest first by last_used (first_seen fallback)
export async function listDevicesForUser(svc: any, email: string) {
  const list = await svc.entities.Device.filter({ user_email: email });
  return list.sort((a: any, b: any) => {
    const at = new Date(a.last_used || a.first_seen).getTime();
    const bt = new Date(b.last_used || b.first_seen).getTime();
    return at - bt;
  });
}

// Active session = a record with active=true AND heartbeat within the timeout
export async function getActiveSessionForUser(svc: any, email: string) {
  const list = await svc.entities.ActiveSession.filter({ user_email: email, active: true });
  const cutoff = Date.now() - SESSION_TIMEOUT_MIN * 60000;
  return list.find((s: any) => new Date(s.heartbeat_at).getTime() > cutoff) || null;
}

export async function upsertSession(svc: any, email: string, deviceId: string) {
  const existing = await svc.entities.ActiveSession.filter({ user_email: email, device_id: deviceId });
  const now = isoNow();
  if (existing[0]) {
    await svc.entities.ActiveSession.update(existing[0].id, { active: true, heartbeat_at: now });
  } else {
    await svc.entities.ActiveSession.create({ user_email: email, device_id: deviceId, active: true, heartbeat_at: now });
  }
}