// SECURITY (audit re-check, 2026-09-09 — finding U-01): this used to be the app's ONLY
// login path — a plain password check that handed back a full working session, with no
// device check and no one-session limit. On 2026-09-09 the app itself was switched over to
// loginWithDeviceCheck / verifyDeviceCode instead (see src/lib/AuthContext.jsx), which DO
// enforce both. But this function stayed live and publicly callable under its own URL the
// whole time — Base44 functions are open HTTP endpoints regardless of which frontend screen
// calls them — so anyone who knew this function's name could call it directly and get a
// full session while completely skipping the new device check and one-session lock, making
// that protection pointless. Disabled here (not deleted) so the file — and this note — stay
// easy to find if it's ever needed again; every request gets refused before it touches
// WordPress or does anything else.
Deno.serve(async (_req) => {
  return Response.json(
    { error: 'This sign-in method has been retired. Please sign in through the app.' },
    { status: 410 }
  );
});