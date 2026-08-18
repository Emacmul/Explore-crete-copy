// Decodes the WordPress-issued JWT the app's client already holds (the token from wpLogin,
// stored client-side in localStorage) and returns the lowercased user email — WITHOUT
// calling Base44's own auth session, which real customers never have (they log in through
// WordPress only). This is the same identification syncLibrary already uses.
//
// SECURITY: this alone does NOT verify the token is genuine — it only reads whatever the
// payload claims, the same way opening an unsealed envelope and reading whatever's written
// inside tells you nothing about who really wrote it. Anyone can hand-construct a
// JWT-shaped string with any email they like in the payload; this function would decode it
// exactly the same as a real one. Never call this directly to decide who a request is from
// — use verifyEmailFromToken below, which actually confirms the token with WordPress
// before trusting anything in it. This raw decoder still has one legitimate, narrow use:
// wpLogin.js — reading a token immediately after WordPress itself just issued it in that
// same request, where there's nothing to forge since it never left the server.
export function getEmailFromToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let payload;
  try {
    payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
  const email = payload?.data?.user?.email || payload?.email || payload?.user_email;
  return email ? String(email).toLowerCase().trim() : null;
}

// The real, secure version — confirms a token is genuinely valid by asking WordPress
// itself, via the JWT Auth plugin's own standard validation endpoint, before trusting
// anything about who it claims to be. This is what closes the actual vulnerability: without
// this check, anyone could construct a fake token claiming to be any customer or narrator's
// email and every backend function would have simply believed them — including, critically,
// pulling someone else's saved Google/Groq API keys out of manageApiKeys. Costs one extra
// network call to WordPress per request; that's the correct tradeoff for genuine identity
// verification, not a shortcut worth avoiding.
//
// `siteUrl` is passed in rather than read here directly — this file is a shared module,
// not a backend function file, and secrets should only ever be read from within an actual
// function's own entry point. Every caller reads Deno.env.get('WC_SITE_URL') itself and
// passes it through.
export async function verifyEmailFromToken(token, siteUrl) {
  if (!token || !siteUrl) return null; // no site to verify against — fail closed

  try {
    const res = await fetch(`${siteUrl}/wp-json/jwt-auth/v1/token/validate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return null; // WordPress rejected it — forged, expired, or tampered
  } catch {
    return null; // couldn't reach WordPress to confirm — fail closed rather than trust blindly
  }

  // Only now, after WordPress itself has confirmed the token is real, is it safe to read
  // who it belongs to.
  return getEmailFromToken(token);
}

// For callers that need more than just the email out of the payload (a WordPress numeric
// user ID, expiry, etc.) — confirms the token is genuine the same way verifyEmailFromToken
// does, so the rest of the payload can then be safely decoded and trusted afterward. Same
// siteUrl-passed-in reasoning as above.
export async function isTokenGenuine(token, siteUrl) {
  if (!token || !siteUrl) return false;
  try {
    const res = await fetch(`${siteUrl}/wp-json/jwt-auth/v1/token/validate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
