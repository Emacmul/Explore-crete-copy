// Decodes the WordPress-issued JWT the app's client already holds (the token from wpLogin,
// stored client-side in localStorage) and returns the lowercased user email — WITHOUT
// calling Base44's own auth session, which real customers never have (they log in through
// WordPress only). This is the same identification syncLibrary already uses; the token's
// signature was already verified at login, so here we only read the payload to get the
// email. Used by every function that needs to know "which customer is calling".
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