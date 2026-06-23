// Operation Levi 2.0 — Phase 4 send endpoint (email via Resend).
// Vercel serverless function. The send key never reaches the browser.
// Nothing is sent unless the client POSTs here after an explicit human confirm in the UI.
// Env: RESEND_API_KEY (required), RESEND_FROM (optional, default onboarding@resend.dev —
//      set to a verified sender on your own domain, e.g. "Levi <levi@dvlmnt.com>"),
//      RUN_SHARED_SECRET (optional extra guard — if set, requests must send a matching x-ol-key header).
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  // Same-origin guard: only our own site / its Vercel deployments may call this.
  var origin = req.headers.origin || req.headers.referer || '';
  if (origin && !/^https?:\/\/(www\.)?levisprojects\.com|\.vercel\.app/i.test(origin)) {
    res.status(403).json({ error: 'origin' }); return;
  }
  // Optional shared secret.
  var secret = process.env.RUN_SHARED_SECRET;
  if (secret && req.headers['x-ol-key'] !== secret) { res.status(403).json({ error: 'auth' }); return; }

  var key = process.env.RESEND_API_KEY;
  if (!key) { res.status(503).json({ error: 'no_key' }); return; }
  var from = process.env.RESEND_FROM || 'onboarding@resend.dev';

  var body = req.body;
  if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  var to = body.to, subject = body.subject || '(no subject)', html = body.html, text = body.text, cc = body.cc;
  if (!to) { res.status(400).json({ error: 'no_to' }); return; }

  var payload = { from: from, to: Array.isArray(to) ? to : [to], subject: subject };
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (cc) payload.cc = Array.isArray(cc) ? cc : (String(cc).trim() ? [cc] : undefined);

  try {
    var r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { res.status(502).json({ error: 'resend', detail: (j && (j.message || j.error)) || ('HTTP ' + r.status) }); return; }
    res.status(200).json({ id: (j && j.id) || null, sent: true });
  } catch (e) {
    res.status(502).json({ error: 'fetch', detail: String((e && e.message) || e) });
  }
};
