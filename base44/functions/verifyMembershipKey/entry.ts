import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();

  if (!user) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const { membershipKey } = await req.json();

  if (!membershipKey || typeof membershipKey !== 'string') {
    return Response.json(
      { error: 'Missing membershipKey' },
      { status: 400 }
    );
  }

  const siteUrl = Deno.env.get('WC_SITE_URL');
  const consumerKey = Deno.env.get('WC_CONSUMER_KEY');
  const consumerSecret = Deno.env.get('WC_CONSUMER_SECRET');

  const normalizedKey = membershipKey.trim().toUpperCase();

  const validateUrl =
    `${siteUrl}/?wckm-api=validate_key&key=${encodeURIComponent(normalizedKey)}`;

  const response = await fetch(validateUrl, {
    headers: {
      Authorization: `Basic ${btoa(
        `${consumerKey}:${consumerSecret}`
      )}`,
    },
  });

  const text = await response.text();

  console.log(
    'WCKM API status:',
    response.status,
    '| response:',
    text
  );

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    return Response.json(
      {
        valid: false,
        error: 'Unexpected response from server'
      },
      { status: 502 }
    );
  }

  if (!data.success) {
    return Response.json({
      valid: false,
      isMember: false,
      error: data.error || 'invalid_key'
    });
  }

  return Response.json({
    valid: true,
    isMember: true
  });
});