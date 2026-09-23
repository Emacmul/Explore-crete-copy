// Configuration & helpers for device-based login protection.
// This module is shared across backend functions and must stay client-safe:
// it must NOT import "base44:runtime" or any "npm:" specifier — those resolve
// only inside the backend function runtime, so secret values are passed in
// by the calling functions instead.
import { getTokenIatFromToken } from "./wpToken.ts";

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

// Records (or re-activates) the session row for one login. tokenIat is the `iat` claim of
// the exact WordPress JWT this login minted (audit U1/U2, 2026-09-23): stamping it on the
// row makes the row belong to that one login "generation", so an older token still lying
// around elsewhere can no longer ride on it — a newer login by the same account leaves
// the old token permanently mismatched against the row.
export async function upsertSession(svc: any, email: string, deviceId: string, tokenIat: number | null) {
  const existing = await svc.entities.ActiveSession.filter({ user_email: email, device_id: deviceId });
  const now = isoNow();
  if (existing[0]) {
    await svc.entities.ActiveSession.update(existing[0].id, { active: true, heartbeat_at: now, token_issued_at: tokenIat });
  } else {
    await svc.entities.ActiveSession.create({ user_email: email, device_id: deviceId, active: true, heartbeat_at: now, token_issued_at: tokenIat });
  }
}

// CUSTOMER logins only (staff are deliberately exempt from the one-device rule): ends
// every session row this account still has on OTHER devices at the moment of this login.
// Without this, another device's stale row (active=true but unattended for hours) stayed
// "active" forever, so the older WordPress token still sitting in that other browser
// kept passing the session-revocation check even after this newer login took over the
// account — the exact hole audit U2 called out.
export async function deactivateOtherSessions(svc: any, email: string, keepDeviceId: string) {
  const rows = await svc.entities.ActiveSession.filter({ user_email: email });
  for (const s of rows) {
    if (s.device_id !== keepDeviceId && s.active === true) {
      await svc.entities.ActiveSession.update(s.id, { active: false });
    }
  }
}

// ---- Session-revocation check for token-authenticated reads ----
// (audit N5, 2026-09-23; reworked the same day for U1 + U2.)
//
// A session row only counts when it is BOTH still active AND belongs to the same login
// generation as the caller's own token — the row's token_issued_at must equal the token's
// own `iat` claim. That binds content access to the exact login that earned it, instead
// of to the email:
//  - a token whose session was ended (forceLogoutAdmin, or the customer's own logout)
//    stays revoked even after ANOTHER device for the same email logs back in, because
//    that new login stamps a NEW iat onto the row — the old token no longer matches
//    (audit U2: validity is never inferred from someone else's active row);
//  - a caller with NO session rows at all IS revoked, fail closed. Every real login
//    through this app creates a row, so a valid WordPress token with no row was never
//    issued through the app's login flow — e.g. minted directly against WordPress's own
//    token endpoint to sidestep the device challenge and one-device lock entirely.
//
// Still deliberately NOT heartbeat-based: a session left open by closing the app (no
// explicit logout) must keep working when the customer returns hours later, so only an
// EXPLICIT flip (their own logout, or an admin force-logout) — or a newer login of the
// same account on another device — revokes; never heartbeat staleness.
//
// Rows created before token_issued_at existed have no stamp; while such a row is active
// it can't be tied to a generation, so any genuine token for that email still matches it.
// That is a one-time legacy bridge for customers already logged in at deploy time — the
// account's very next login stamps the row and closes the window for good, and an
// explicit logout or force-logout flips the row inactive in the meantime, as always.
export async function isSessionRevoked(svc: any, email: string, token: string): Promise<boolean> {
  const iat = getTokenIatFromToken(token);
  const list = await svc.entities.ActiveSession.filter({ user_email: email });
  if (!Array.isArray(list) || list.length === 0) return true; // fail closed — see above
  return !list.some((s: any) =>
    s.active === true && (s.token_issued_at == null || s.token_issued_at === iat));
}