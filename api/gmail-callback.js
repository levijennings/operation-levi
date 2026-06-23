// Operation Levi 2.0 — Phase 4 (Gmail): step 2 of OAuth.
// Google redirects here with ?code=...  We exchange it for a refresh token and store the
// refresh token server-side in Supabase (app_secrets table, service-role only). The token
// never reaches the browser. The connected address is stored too, for display.
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY,
//      SUPABASE_URL (optional; defaults to the operation-levi project).
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  var cid = process.env.GOOGLE_CLIENT_ID, csec = process.env.GOOGLE_CLIENT_SECRET;
  var supaUrl = process.env.SUPABASE_URL || 'https://jtrqhihdjbhzbavsknht.supabase.co';
  var supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  function page(title, msg, color) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.status(200).send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title>'
      + '<body style="font-family:system-ui,-apple-system,sans-serif;background:#0e0f13;color:#e9ecf2;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">'
      + '<div style="max-width:440px;text-align:center;padding:28px">'
      + '<div style="font-size:34px;margin-bottom:10px">' + (color || '✦') + '</div>'
      + '<h2 style="margin:0 0 10px;font-size:20px">' + title + '</h2>'
      + '<p style="color:#aab2c0;line-height:1.65;font-size:14px">' + msg + '</p>'
      + '<a href="/" style="display:inline-block;margin-top:14px;color:#5a9be0;text-decoration:none;font-weight:600">← Back to Operation Levi</a>'
      + '</div>');
  }
  if (!cid || !csec) { page('Gmail not configured', 'Add <b>GOOGLE_CLIENT_ID</b> and <b>GOOGLE_CLIENT_SECRET</b> in Vercel, then try again.', '⚙️'); return; }
  var url = new URL(req.url, 'https://' + (req.headers['x-forwarded-host'] || req.headers.host));
  var code = url.searchParams.get('code'), err = url.searchParams.get('error');
  if (err) { page('Connection cancelled', 'Google returned: ' + err, '⚠️'); return; }
  if (!code) { page('Missing code', 'No authorization code was returned by Google.', '⚠️'); return; }
  var redirect = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host) + '/api/gmail-callback';
  try {
    var tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: code, client_id: cid, client_secret: csec, redirect_uri: redirect, grant_type: 'authorization_code' })
    });
    var tj = await tr.json();
    if (!tr.ok || !tj.refresh_token) {
      page('Couldn’t connect', (tj.error_description || tj.error || 'No refresh token returned. Make sure consent was approved.') + ' If you connected before, revoke the app at myaccount.google.com/permissions and try again.', '⚠️');
      return;
    }
    if (!supaKey) { page('Almost there', 'Connected to Google, but <b>SUPABASE_SERVICE_ROLE_KEY</b> is not set in Vercel, so the token can’t be stored. Add it and reconnect.', '⚙️'); return; }
    // best-effort: fetch the connected address for display
    var addr = '';
    try {
      var pr = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { 'Authorization': 'Bearer ' + tj.access_token } });
      var pj = await pr.json(); addr = (pj && pj.emailAddress) || '';
    } catch (e) {}
    var rows = [
      { key: 'gmail_refresh_token', value: tj.refresh_token, updated_at: new Date().toISOString() },
      { key: 'gmail_address', value: addr, updated_at: new Date().toISOString() }
    ];
    var up = await fetch(supaUrl + '/rest/v1/app_secrets', {
      method: 'POST',
      headers: { 'apikey': supaKey, 'Authorization': 'Bearer ' + supaKey, 'content-type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(rows)
    });
    if (!up.ok) { var t = await up.text(); page('Storage error', 'Could not save the token: ' + t, '⚠️'); return; }
    page('Gmail connected', 'Operation Levi can now send email as <b>' + (addr || 'your account') + '</b>. You can close this tab and press <b>Confirm &amp; send</b>.', '✅');
  } catch (e) { page('Error', String((e && e.message) || e), '⚠️'); }
};
