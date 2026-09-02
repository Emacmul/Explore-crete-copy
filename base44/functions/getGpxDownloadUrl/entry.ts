import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// Narrow, app-specific wrapper around Core.CreateFileSignedUrl: the ONLY thing this
// endpoint does is mint a short-lived download link for a single walk's private GPX
// file. It deliberately does NOT accept an arbitrary file_uri (that would be a generic
// one-to-one proxy that could sign any private file in storage). Instead it takes a
// walkId, resolves that walk as the service role, and signs only that walk's
// gpx_file_uri — so a logged-in customer can download their own route file without the
// restricted CreateFileSignedUrl integration ever being reachable from the browser.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const walkId = body?.walkId;
    if (!walkId) return Response.json({ error: 'walkId is required' }, { status: 400 });

    const walk = await base44.asServiceRole.entities.Walk.get(walkId);
    if (!walk || !walk.gpx_file_uri) {
      return Response.json({ signed_url: null });
    }

    const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: walk.gpx_file_uri,
    });
    return Response.json({ signed_url });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}