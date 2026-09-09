// Support for the customer-login device-check system (see base44/shared/deviceAuth.ts and
// audit finding U-01, 2026-09-09 review). Two small, purely local helpers — nothing here
// talks to the server.

// A stable per-browser identifier, generated once and kept in localStorage. NOT tied to any
// account — it identifies "this browser", so it survives logging out and back in, and stays
// the same even if a different account signs in on the same browser later.
const DEVICE_ID_KEY = 'explore_crete_device_id';

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// A short, friendly label for the admin "Device Logins" panel (DeviceManager.jsx) — e.g.
// "Safari on iPhone". Best-effort only: the device is actually identified by its id above,
// this is purely so an admin looking at the list can recognise which device is which.
export function getDeviceLabel() {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent || '';

  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/CriOS\//.test(ua) || /Chrome\//.test(ua)) browser = 'Chrome';
  else if (/FxiOS\//.test(ua) || /Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  let os = 'device';
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X/.test(ua)) os = 'Mac';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';

  return `${browser} on ${os}`;
}
