// Operation Levi 2.0 — Phase 4 (Gmail): step 1 of OAuth.
// Redirects the user to Google's consent screen for the gmail.send scope.
// Env: GOOGLE_CLIENT_ID (required). The redirect URI is derived from the request host
//      and must be registered in the Google Cloud OAuth client (Authorized redirect URIs).
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  var cid = process.env.GOOGLE_CLIENT_ID;
  if (!cid) { res.status(503).send('Gmail not configured: set GOOGLE_CLIENT_ID in Vercel.'); return; }
  var host = req.headers['x-forwarded-host'] || req.headers.host;
  var redirect = 'https://' + host + '/api/gmail-callback';
  var p = new URLSearchParams({
    client_id: cid,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true'
  });
  res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString() });
  res.end();
};
