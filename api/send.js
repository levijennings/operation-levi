// Operation Levi 2.0 — Phase 4 send endpoint (email via the user's connected Gmail).
// Reads the stored refresh token (Supabase, service-role), exchanges it for a short-lived
// access token, and sends via the Gmail API as the connected account. Nothing is sent unless
// the client POSTs here after an explicit human confirm in the UI.
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY,
//      SUPABASE_URL (optional), RUN_SHARED_SECRET (optional guard vs x-ol-key header).
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  var origin = req.headers.origin || req.headers.referer || '';
  if (origin && !/^https?:\/\/(www\.)?levisprojects\.com|\.vercel\.app/i.test(origin)) {
    res.status(403).json({ error: 'origin' }); return;
  }
  var secret = process.env.RUN_SHARED_SECRET;
  if (secret && req.headers['x-ol-key'] !== secret) { res.status(403).json({ error: 'auth' }); return; }

  var cid = process.env.GOOGLE_CLIENT_ID, csec = process.env.GOOGLE_CLIENT_SECRET;
  var supaUrl = process.env.SUPABASE_URL || 'https://jtrqhihdjbhzbavsknht.supabase.co';
  var supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cid || !csec) { res.status(503).json({ error: 'no_config' }); return; }
  if (!supaKey) { res.status(503).json({ error: 'no_storage' }); return; }

  var body = req.body;
  if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  var to = body.to, subject = body.subject || '(no subject)', html = body.html, text = body.text, cc = body.cc;
  if (!to) { res.status(400).json({ error: 'no_to' }); return; }

  try {
    // 1) read stored refresh token
    var sr = await fetch(supaUrl + '/rest/v1/app_secrets?key=eq.gmail_refresh_token&select=value', {
      headers: { 'apikey': supaKey, 'Authorization': 'Bearer ' + supaKey }
    });
    var sj = await sr.json();
    if (!Array.isArray(sj) || !sj.length || !sj[0].value) { res.status(503).json({ error: 'no_gmail' }); return; }
    var refresh = sj[0].value;

    // 2) exchange for access token
    var tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cid, client_secret: csec, refresh_token: refresh, grant_type: 'refresh_token' })
    });
    var tj = await tr.json();
    if (!tr.ok || !tj.access_token) {
      res.status(502).json({ error: 'token', detail: (tj.error_description || tj.error || 'token refresh failed') });
      return;
    }

    // 3) build RFC 2822 MIME, base64url-encode, send
    var lines = [];
    lines.push('To: ' + to);
    if (cc && String(cc).trim()) lines.push('Cc: ' + cc);
    lines.push('Subject: ' + encodeHeader(subject));
    lines.push('MIME-Version: 1.0');
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    var b64body = Buffer.from(String(html || text || ''), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
    lines.push(b64body);
    var mime = lines.join('\r\n');
    var raw = Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    var gr = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + tj.access_token, 'content-type': 'application/json' },
      body: JSON.stringify({ raw: raw })
    });
    var gj = await gr.json();
    if (!gr.ok) { res.status(502).json({ error: 'gmail', detail: (gj && gj.error && gj.error.message) || ('HTTP ' + gr.status) }); return; }
    res.status(200).json({ id: gj.id || null, sent: true, via: 'gmail' });
  } catch (e) {
    res.status(502).json({ error: 'fetch', detail: String((e && e.message) || e) });
  }
};

// RFC 2047 encode a header value if it has non-ASCII characters
function encodeHeader(s) {
  s = String(s || '');
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}
