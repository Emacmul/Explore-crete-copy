import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();

  if (user?.role !== 'admin') {
    return Response.json(
      { error: 'Forbidden' },
      { status: 403 }
    );
  }

  const { walkId } = await req.json();

  if (!walkId) {
    return Response.json(
      { error: 'walkId required' },
      { status: 400 }
    );
  }

  const walks = await base44.asServiceRole.entities.Walk.filter({
    id: walkId,
  });

  const walk = walks[0];

  if (!walk) {
    return Response.json(
      { error: 'Walk not found' },
      { status: 404 }
    );
  }

  const appUsers =
    await base44.asServiceRole.entities.AppUser.list(
      '-created_date',
      2000
    );

  const recipients = appUsers.filter(
    u =>
      u.email &&
      u.registration_complete &&
      u.is_member === true
  );

  if (recipients.length === 0) {
    return Response.json({
      sent: 0,
      message: 'No members found',
    });
  }

  const statsLine = [
    walk.distance_km
      ? `${walk.distance_km} km`
      : null,

    walk.duration_hours
      ? `${walk.duration_hours}h`
      : null,

    walk.difficulty
      ? walk.difficulty.charAt(0).toUpperCase() +
        walk.difficulty.slice(1)
      : null,

    walk.region || null,
  ]
    .filter(Boolean)
    .join(' · ');

  let sent = 0;
  let failed = 0;

  for (const appUser of recipients) {
    const firstName =
      appUser.first_name || 'Walker';

    const body = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1f2937;">
        
        <div style="background:linear-gradient(135deg,#1d4ed8,#1e40af);padding:32px 24px;border-radius:16px 16px 0 0;text-align:center;">
          <p style="color:#bfdbfe;margin:0 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:1px;">
            Magical Crete Walking Trails
          </p>

          <h1 style="color:white;margin:0;font-size:22px;">
            New Walk Available 🥾
          </h1>
        </div>

        <div style="background:white;padding:24px;border:1px solid #e5e7eb;border-top:none;">
          
          <p style="color:#6b7280;">
            Hi ${firstName},
          </p>

          <p>
            A new walk is now available as part of your Magical Crete membership.
          </p>

          <div style="background:#f8fafc;border-radius:12px;padding:20px;margin:20px 0;border-left:4px solid #1d4ed8;">
            
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">
              ${walk.code || 'New Walk'}
            </p>

            <h2 style="margin:0 0 8px;font-size:20px;color:#1f2937;">
              ${walk.name}
            </h2>

            ${
              statsLine
                ? `<p style="margin:0 0 12px;color:#6b7280;font-size:14px;">${statsLine}</p>`
                : ''
            }

            ${
              walk.description
                ? `<p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">${walk.description.substring(0, 200)}${walk.description.length > 200 ? '…' : ''}</p>`
                : ''
            }
          </div>

          <p>
            Log into your Magical Crete account and claim your copy of this walk.
          </p>

          <p>
            Your membership includes six new walks each year.
          </p>

          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />

          <p style="color:#9ca3af;font-size:12px;text-align:center;">
            You're receiving this because you're a Magical Crete member.<br/>
            Magical Crete Walking Trails
          </p>

        </div>
      </div>
    `;

    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: appUser.email,
        subject: `New Walk Available: ${walk.name} 🥾`,
        body,
        from_name: 'Magical Crete Walking Trails',
      });

      sent++;
    } catch {
      failed++;
    }
  }

  await base44.asServiceRole.entities.Walk.update(
    walkId,
    {
      announced_at: new Date().toISOString(),
    }
  );

  return Response.json({
    sent,
    failed,
    total: recipients.length,
  });
});