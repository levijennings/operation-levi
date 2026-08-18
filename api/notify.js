// Levi's Projects — assignment / invite notification email (via Resend).
// The template is built ENTIRELY server-side from structured fields, so a signed-in
// caller can trigger a notification but cannot inject arbitrary HTML or content shape.
// POST { kind:'assign'|'welcome', to, person, task?{title,due,notes,deliverable}, invite?{email,tempPassword,invitedBy} }
// Env: RESEND_API_KEY (required), RESEND_FROM. Auth: signed-in Supabase JWT via _guard.js.
var guard = require('./_guard.js');

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function wrap(preheader, inner) {
  return '<!doctype html><html><body style="margin:0;background:#F5F5F2;font-family:Inter,-apple-system,sans-serif">'
    + '<div style="display:none;max-height:0;overflow:hidden">' + esc(preheader) + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">'
    + '<table role="presentation" width="600" style="max-width:600px;width:100%" cellpadding="0" cellspacing="0">'
    + '<tr><td style="background:#0E0F12;border-radius:14px 14px 0 0;padding:18px 26px;color:#E9EAEE;font-weight:700;font-size:16px;letter-spacing:-.01em">levi\'s projects <span style="color:#C08428">&#9656;</span></td></tr>'
    + '<tr><td style="background:#ffffff;border:1px solid #E4E4E0;border-top:none;border-radius:0 0 14px 14px;padding:26px;color:#26272D;font-size:14px;line-height:1.6">' + inner + '</td></tr>'
    + '<tr><td style="padding:14px 8px;color:#9CA0A8;font-size:11px" align="center">Sent by Wingman &middot; levisprojects.com</td></tr>'
    + '</table></td></tr></table></body></html>';
}

module.exports = async (req, res) => {
  var user = await guard(req, res);
  if (!user) return;

  var key = process.env.RESEND_API_KEY;
  if (!key) { res.status(503).json({ error: 'no_key' }); return; }
  var from = process.env.RESEND_FROM || 'onboarding@resend.dev';

  var body = req.body; if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  var to = String(body.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { res.status(400).json({ error: 'bad_to' }); return; }
  var kind = body.kind === 'welcome' ? 'welcome' : 'assign';
  var subject, html, preheader;

  if (kind === 'welcome') {
    var inv = body.invite || {};
    subject = "You're on the crew — Levi's Projects";
    preheader = 'Your account is ready.';
    html = wrap(preheader,
      '<h2 style="margin:0 0 10px;font-size:19px">Welcome aboard' + (body.person ? ', ' + esc(body.person) : '') + '.</h2>'
      + '<p>' + esc(inv.invitedBy || 'Your admin') + ' added you to <b>Levi\'s Projects</b> — the team\'s goal and task system, with Wingman, an AI teammate that drafts and researches alongside you.</p>'
      + '<p style="margin:16px 0 6px"><b>Sign in:</b> <a href="https://www.levisprojects.com" style="color:#C08428">levisprojects.com</a></p>'
      + '<p style="margin:0 0 6px"><b>Email:</b> ' + esc(inv.email || to) + '</p>'
      + (inv.tempPassword ? ('<p style="margin:0 0 16px"><b>Temporary password:</b> <code style="background:#F4F4F5;padding:2px 8px;border-radius:6px">' + esc(inv.tempPassword) + '</code></p>'
      + '<p style="color:#5A5A5A;font-size:12.5px">Change it after your first sign-in (Settings).</p>') : ''));
  } else {
    var t = body.task || {};
    subject = 'New task for you: ' + String(t.title || 'Untitled').slice(0, 120);
    preheader = 'Assigned in Levi\'s Projects';
    html = wrap(preheader,
      '<h2 style="margin:0 0 10px;font-size:19px">' + esc(body.person || 'Hey') + ' — a task landed on your plate.</h2>'
      + '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#FAFAF8;border:1px solid #ECECE8;border-radius:10px;margin:8px 0 16px"><tr><td style="padding:14px 16px">'
      + '<div style="font-weight:700;font-size:15px">' + esc(t.title || 'Untitled') + '</div>'
      + (t.deliverable ? ('<div style="color:#5A5A5A;font-size:12px;margin-top:4px">Deliverable: ' + esc(t.deliverable) + '</div>') : '')
      + (t.due ? ('<div style="color:#5A5A5A;font-size:12px;margin-top:2px">Due: ' + esc(t.due) + '</div>') : '')
      + (t.notes ? ('<div style="color:#3a3a3a;font-size:12.5px;margin-top:8px;white-space:pre-wrap">' + esc(String(t.notes).slice(0, 800)) + '</div>') : '')
      + '</td></tr></table>'
      + '<p><a href="https://www.levisprojects.com" style="display:inline-block;background:#C08428;color:#141005;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:9px">Open Levi\'s Projects</a></p>');
  }

  try {
    var r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ from: from, to: [to], subject: subject, html: html })
    });
    var j = await r.json();
    if (!r.ok) {
      if (r.status === 403 || /verify/i.test((j && j.message) || '')) { res.status(403).json({ error: 'no_from', detail: j && j.message }); return; }
      res.status(502).json({ error: 'resend', detail: (j && j.message) || ('HTTP ' + r.status) }); return;
    }
    res.status(200).json({ id: j && j.id, sent: true });
  } catch (e) { res.status(502).json({ error: 'fetch', detail: String((e && e.message) || e) }); }
};
