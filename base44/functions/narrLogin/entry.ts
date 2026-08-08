import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * Narr Studio login.
 *
 * A Narr (narrator role) reaches the back end through the "Narr" button on the
 * front end, NOT through Base44's separate native sign-in that admins use.
 * This function validates the Narr's backend password, which an admin set for
 * them in the EditAppUser section — it is deliberately separate from the
 * WordPress password that gets them into the front end.
 *
 * Runs with the service role because the requesting browser has only a
 * WordPress session (no Base44 user), so it cannot read the AppUser table
 * directly. Returns only { ok, email, role, name } — never the password.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return Response.json({ ok: false, error: 'Email and password are required' }, { status: 400 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const matches = await base44.asServiceRole.entities.AppUser.filter({ email: normalizedEmail });
    const match = Array.isArray(matches) ? matches[0] : null;

    if (!match) {
      return Response.json({ ok: false, error: 'No account found for this email.' });
    }
    // An admin may also enter through the "Narr" button to wear the Narr hat; they
    // get the narrator workflow but without the narrator-only limits (see Narr.jsx +
    // BackendShell `unrestricted`). Their existing backend password is reused.
    if (match.role !== 'narrator' && match.role !== 'admin') {
      return Response.json({ ok: false, error: 'This account is not a Narr.' });
    }
    if (!match.password || String(match.password) !== String(password)) {
      return Response.json({ ok: false, error: 'Wrong password.' });
    }

    const name = `${match.first_name || ''} ${match.last_name || ''}`.trim();
    const isAdmin = match.role === 'admin';
    return Response.json({ ok: true, email: match.email, role: 'narrator', name, isAdmin });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 200 });
  }
});