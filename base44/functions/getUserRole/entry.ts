import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { verifyEmailFromToken } from '../../shared/wpToken.ts';

/**
 * Looks up whether a given email address belongs to a Base44 "User" record
 * with an elevated role (admin or narrator).
 *
 * Regular customers log in through WordPress and never get a Base44-native
 * session, so the app has no way to check Base44's own User table from the
 * browser — that table is never public, and client-side entity access only
 * works for the currently-signed-in Base44 user (which, for a WordPress
 * visitor, doesn't exist). Admin/narrator roles are assigned by hand inside
 * Base44's own "Users" panel, so this function is the only bridge between
 * "who just logged in via WordPress" and "what Base44 role, if any, do they
 * have" — it runs with the service role (elevated, backend-only permissions)
 * to read the User table, and returns nothing but the role itself.
 *
 * Deliberately returns only { role } — never the full User record — so a
 * WordPress login can never pull back anything more sensitive than that.
 *
 * SECURITY: only ever checks the role for the email a genuine WordPress
 * token actually belongs to — never an arbitrary email passed in the
 * request. Without this, anyone could ask "what role does X have" for any
 * email they typed in, with no login of their own required — a way to scout
 * which accounts are worth targeting, not something that needs a real
 * WordPress session to do.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { token } = body;

    const email = await verifyEmailFromToken(token, Deno.env.get('WC_SITE_URL'));
    if (!email) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Service role: no Base44 user session exists for WordPress-authenticated
    // visitors, so this must run with elevated backend permissions.
    const matches = await base44.asServiceRole.entities.User.filter({ email });

    const match = Array.isArray(matches) ? matches[0] : null;
    const role = (match && (match.role === 'admin' || match.role === 'narrator'))
      ? match.role
      : null;

    return Response.json({ role });
  } catch (error) {
    // Fail closed: on any error, report no elevated role rather than risk
    // granting one.
    return Response.json({ role: null, error: error.message }, { status: 200 });
  }
});
