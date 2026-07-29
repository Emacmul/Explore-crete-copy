Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return Response.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const siteUrl = Deno.env.get("WC_SITE_URL");
    if (!siteUrl) {
      return Response.json({ error: 'Server not configured (WC_SITE_URL missing)' }, { status: 500 });
    }

    // Call the WordPress JWT Auth plugin endpoint
    const response = await fetch(`${siteUrl}/wp-json/jwt-auth/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      // tMeister JWT Auth returns errors as an array of objects
      const errorMsg = Array.isArray(data)
        ? data[0]?.message
        : data.message || 'Invalid email or password';
      return Response.json({ error: errorMsg }, { status: 401 });
    }

    // Decode the JWT payload to extract the WordPress user ID
    // (the token response doesn't include it directly)
    let userId = null;
    let userEmail = data.user_email || null;
    try {
      const parts = data.token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        userId = payload.data?.user?.id || payload.user_id || payload.sub || null;
        userEmail = userEmail || payload.data?.user?.email || payload.email || null;
      }
    } catch (_e) {
      // Token decode failed — continue without user_id (sync will fail gracefully)
    }

    return Response.json({
      token: data.token,
      user: {
        id: userId,
        email: userEmail,
        display_name: data.user_display_name || null,
        username: data.user_nicename || null
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});