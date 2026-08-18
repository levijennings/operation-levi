// Levi's Projects — Wingman's executive brief.
// Two callers:
//   1. Vercel Cron (vercel.json, 6:30am PT daily) — authenticated by CRON_SECRET.
//      Generates the brief and EMAILS it to every workspace admin (via Resend).
//   2. A signed-in user (Brief view "Generate now") — authenticated by Supabase JWT.
//      Returns the brief as JSON for in-app display; ?send=1 also emails it to the caller.
// Env: ANTHROPIC_API_KEY (required), SUPABASE_SERVICE_ROLE_KEY (required — already set for
//      the retired gmail flow), RESEND_API_KEY/RESEND_FROM (for email), CRON_SECRET
//      (required for the scheduled path), ANTHROPIC_SUMMARY_MODEL (optional).
var guard = require('./_guard.js');

var SUPABASE_URL = process.env.SUPABASE_URL || 'https://jtrqhihdjbhzbavsknht.supabase.co';

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

async function sb(path, serviceKey) {
  var r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: serviceKey, authorization: 'Bearer ' + serviceKey }
  });
  if (!r.ok) throw new Error('supabase ' + path.split('?')[0] + ' HTTP ' + r.status);
  return r.json();
}

function todayInPT() {
  // en-CA gives YYYY-MM-DD directly
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

function assemble(rows, blob) {
  var today = todayInPT();
  var items = rows.map(function (r) { return r.card || {}; }).filter(function (c) { return c && c.title; });
  var open = items.filter(function (c) { return c.status !== 'done' && c.type !== 'habit'; });
  var overdue = open.filter(function (c) { return c.dueDate && c.dueDate < today; });
  var dueToday = open.filter(function (c) { return c.dueDate === today; });
  var review = items.filter(function (c) { return c.status === 'review' || (c.aiArtifact && c.aiArtifact.content && c.aiStatus === 'drafted'); });
  var byPerson = {};
  open.forEach(function (c) {
    (c.assignees && c.assignees.length ? c.assignees : [c.responsible || '—']).forEach(function (p) {
      if (!p) return; byPerson[p] = (byPerson[p] || 0) + 1;
    });
  });
  var goals = ((blob && blob.goals) || []).slice(0, 6).map(function (g) {
    return { title: g.title, forecast: g.forecastDate || '', updates: (g.updates || []).length };
  });
  var top = overdue.concat(dueToday).slice(0, 12).map(function (c) {
    return { title: c.title, due: c.dueDate, cat: c.category, deliverable: c.deliverable || '', owner: (c.assignees && c.assignees[0]) || c.responsible || '' };
  });
  // ── 5c alert rules: the graphs raise their hand inside the brief ──
  var alerts = [];
  var odBy = {};
  overdue.forEach(function (c) {
    (c.assignees && c.assignees.length ? c.assignees : [c.responsible]).forEach(function (p) { if (p) odBy[p] = (odBy[p] || 0) + 1; });
  });
  Object.keys(odBy).forEach(function (p) { if (odBy[p] >= 3) alerts.push(p + ' is carrying ' + odBy[p] + ' overdue tasks — suggest rebalancing or a deadline reset'); });
  if (review.length >= 5) alerts.push(review.length + ' Wingman drafts are sitting unreviewed — drafting is ahead of decisions');
  // intake vs completed, last 3 whole weeks (createdAt tracking began Aug 2026)
  try {
    var now = Date.now(), wk = 7 * 86400000, worse = 0;
    for (var wI = 1; wI <= 3; wI++) {
      var ws = now - wI * wk, we = now - (wI - 1) * wk;
      var madeN = items.filter(function (c) { return c.createdAt && c.createdAt >= ws && c.createdAt < we; }).length;
      var doneN = items.filter(function (c) { if (!c.completedAt) return false; var d = new Date(String(c.completedAt).slice(0, 10) + 'T00:00:00Z').getTime(); return d >= ws && d < we; }).length;
      if (madeN > doneN && madeN > 0) worse++;
    }
    if (worse === 3) alerts.push('More work has come in than gone out for 3 straight weeks — the team is falling behind');
  } catch (e) {}
  // goal pace: >20 points behind a linear run-rate to the target date
  ((blob && blob.goals) || []).forEach(function (g) {
    if (!g || !g.targetDate || !g.id) return;
    var linked = items.filter(function (c) { return (c.goalIds || []).indexOf(g.id) >= 0; });
    if (linked.length < 2) return;
    var doneL = linked.filter(function (c) { return c.status === 'done'; }).length;
    var pct = Math.round(doneL / linked.length * 100);
    try {
      var yr = new Date(g.targetDate + 'T00:00:00Z').getUTCFullYear();
      var st = Date.UTC(yr, 0, 1), tg = new Date(g.targetDate + 'T00:00:00Z').getTime();
      if (tg > st) {
        var exp = Math.max(0, Math.min(100, Math.round((Date.now() - st) / (tg - st) * 100)));
        if (pct < exp - 20) alerts.push('Goal "' + g.title + '" is ' + (exp - pct) + ' points behind pace for ' + g.targetDate + ' — cut scope, move the date, or push');
      }
    } catch (e) {}
  });
  return {
    date: today,
    counts: { open: open.length, overdue: overdue.length, dueToday: dueToday.length, needsReview: review.length },
    urgent: top,
    awaitingApproval: review.slice(0, 8).map(function (c) { return { title: c.title, deliverable: c.deliverable || '' }; }),
    crew: byPerson,
    goals: goals,
    alerts: alerts.slice(0, 4)
  };
}

async function writeNarrative(data, key) {
  var mdl = process.env.ANTHROPIC_SUMMARY_MODEL || 'claude-haiku-4-5-20251001';
  var sys = "You are Wingman, the AI first officer inside Levi's Projects. Write the morning executive brief for Levi. "
    + "Voice: clipped, confident, zero filler — a trusted first officer, not a chatbot. Second person. "
    + "Structure: one headline sentence naming the single most needle-moving thing today; then 2-4 short sentences covering what you flag from overdue/due items, drafts awaiting approval, and crew load; close with one sentence on goal pace if goal data exists. "
    + "ALERTS in the data are pre-computed warnings from the analytics — if any are present, weave the most important one in plainly; they exist so nobody quietly falls behind. "
    + "Never invent tasks or numbers — use only the data given. Under 120 words. No markdown headers, no bullet lists, no emoji.";
  var r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: mdl, max_tokens: 350, system: sys, messages: [{ role: 'user', content: 'BRIEF DATA\n' + JSON.stringify(data, null, 1) + '\n\nWrite the brief now.' }] })
  });
  var j = await r.json();
  if (!r.ok) throw new Error('anthropic: ' + ((j && j.error && j.error.message) || r.status));
  return (j.content && j.content[0] && j.content[0].text) ? j.content[0].text.trim() : '';
}

function briefEmailHtml(narrative, data) {
  var rows = (data.urgent || []).map(function (t) {
    return '<tr><td style="padding:7px 0;border-bottom:1px solid #ECECE8;font-size:13px">' + esc(t.title)
      + (t.deliverable ? (' <span style="color:#9CA0A8;font-size:11px">· ' + esc(t.deliverable) + '</span>') : '')
      + '</td><td align="right" style="padding:7px 0;border-bottom:1px solid #ECECE8;color:#5A5A5A;font-size:12px;white-space:nowrap">' + esc(t.owner || '') + (t.due ? (' · ' + esc(t.due)) : '') + '</td></tr>';
  }).join('');
  return '<!doctype html><html><body style="margin:0;background:#F5F5F2;font-family:Inter,-apple-system,sans-serif">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">'
    + '<table role="presentation" width="600" style="max-width:600px;width:100%" cellpadding="0" cellspacing="0">'
    + '<tr><td style="background:#0E0F12;border-radius:14px 14px 0 0;padding:18px 26px;color:#E9EAEE;font-weight:700;font-size:16px">levi\'s projects <span style="color:#C08428">&#9656;</span>'
    + '<span style="float:right;color:#9EA1AB;font-weight:400;font-size:11px;letter-spacing:.14em">MORNING BRIEF · ' + esc(data.date) + '</span></td></tr>'
    + '<tr><td style="background:#ffffff;border:1px solid #E4E4E0;border-top:none;border-radius:0 0 14px 14px;padding:26px;color:#26272D;font-size:14px;line-height:1.65">'
    + '<p style="margin:0 0 18px;font-size:15px">' + esc(narrative).replace(/\n+/g, '</p><p style="margin:0 0 12px;font-size:15px">') + '</p>'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:6px 0 14px"><tr>'
    + '<td style="font-size:12px;color:#5A5A5A">Overdue <b style="color:#26272D;font-size:16px">' + data.counts.overdue + '</b></td>'
    + '<td style="font-size:12px;color:#5A5A5A">Due today <b style="color:#26272D;font-size:16px">' + data.counts.dueToday + '</b></td>'
    + '<td style="font-size:12px;color:#5A5A5A">Awaiting approval <b style="color:#26272D;font-size:16px">' + data.counts.needsReview + '</b></td>'
    + '<td style="font-size:12px;color:#5A5A5A">Open <b style="color:#26272D;font-size:16px">' + data.counts.open + '</b></td></tr></table>'
    + (rows ? ('<div style="font-size:11px;letter-spacing:.12em;color:#9CA0A8;margin:14px 0 4px">NEEDS ATTENTION</div><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%">' + rows + '</table>') : '')
    + '<p style="margin:20px 0 0"><a href="https://www.levisprojects.com" style="display:inline-block;background:#C08428;color:#141005;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:9px">Open the day</a></p>'
    + '</td></tr>'
    + '<tr><td style="padding:14px 8px;color:#9CA0A8;font-size:11px" align="center">Written by Wingman &middot; levisprojects.com</td></tr>'
    + '</table></td></tr></table></body></html>';
}

async function sendEmail(to, subject, html) {
  var key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: 'no_resend_key' };
  var from = process.env.RESEND_FROM || 'onboarding@resend.dev';
  var r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ from: from, to: [to], subject: subject, html: html })
  });
  var j = await r.json();
  return r.ok ? { id: j.id } : { error: (j && j.message) || ('HTTP ' + r.status) };
}

// ── Web Push (payload-less): VAPID-authenticated POST to each subscription endpoint.
//    No payload means no message encryption is needed; the service worker shows its
//    default "Wingman has something for you" notification and opens the app on tap. ──
var crypto = require('crypto');
function b64u(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function vapidJwt(audience) {
  var pemB64 = process.env.VAPID_PRIVATE_KEY;
  if (!pemB64) return null;
  var pem = Buffer.from(pemB64, 'base64').toString('utf8');
  var header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  var claims = b64u(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:levi@dvlmnt.com' }));
  var input = header + '.' + claims;
  var sig = crypto.sign('sha256', Buffer.from(input), { key: pem, dsaEncoding: 'ieee-p1363' });
  return input + '.' + b64u(sig);
}
var VAPID_PUBLIC = 'BFloQyryCH9eFadPwjsGze6bOuFWSdlJrGnpz1TFcgoWeajF-MfWsUngbNEIdBCXNQmH3TjieVU2Xp8hgaHDKPE';
async function sendPush(sub) {
  try {
    var endpoint = sub.endpoint;
    var aud = new URL(endpoint).origin;
    var jwt = vapidJwt(aud);
    if (!jwt) return { skipped: 'no_vapid_key' };
    var r = await fetch(endpoint, {
      method: 'POST',
      headers: { TTL: '3600', Authorization: 'vapid t=' + jwt + ', k=' + VAPID_PUBLIC, 'Content-Length': '0' }
    });
    if (r.status === 404 || r.status === 410) return { gone: true };
    return { ok: r.status >= 200 && r.status < 300, status: r.status };
  } catch (e) { return { error: String((e && e.message) || e) }; }
}
async function pushTo(serviceKey, userId) {
  // userId null => everyone subscribed
  var q = 'push_subscriptions?select=id,endpoint' + (userId ? ('&user_id=eq.' + userId) : '');
  var subs = [];
  try { subs = await sb(q, serviceKey); } catch (e) { return { error: e.message }; }
  var sent = 0, gone = [];
  for (var i = 0; i < subs.length; i++) {
    var out = await sendPush(subs[i]);
    if (out.ok) sent++;
    if (out.gone) gone.push(subs[i].id);
  }
  // prune dead subscriptions
  for (var g = 0; g < gone.length; g++) {
    try { await fetch(SUPABASE_URL + '/rest/v1/push_subscriptions?id=eq.' + gone[g], { method: 'DELETE', headers: { apikey: serviceKey, authorization: 'Bearer ' + serviceKey } }); } catch (e) {}
  }
  return { sent: sent, of: subs.length };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!serviceKey || !anthropicKey) { res.status(503).json({ error: 'not_configured' }); return; }

  // ── Auth: cron secret (scheduled) OR signed-in user (on demand) ──
  var isCron = false, userEmail = null, userId = null;
  var auth = req.headers.authorization || '';
  var cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === 'Bearer ' + cronSecret) {
    isCron = true;
  } else {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
    var user = await guard(req, res);
    if (!user) return;
    userEmail = user.email || null;
    userId = user.id || null;
  }

  try {
    // One workspace today; take the first.
    var workspaces = await sb('workspaces?select=id&limit=1', serviceKey);
    if (!workspaces.length) { res.status(200).json({ error: 'no_workspace' }); return; }
    var wsId = workspaces[0].id;

    var rows = await sb('tasks?select=card&workspace_id=eq.' + wsId, serviceKey);
    var blobRows = await sb('workspace_data?select=data&workspace_id=eq.' + wsId, serviceKey);
    var blob = (blobRows[0] && blobRows[0].data) || {};

    var data = assemble(rows, blob);
    var narrative = await writeNarrative(data, anthropicKey);
    var html = briefEmailHtml(narrative, data);
    var subject = 'Morning brief — ' + data.counts.overdue + ' overdue, ' + data.counts.dueToday + ' due today, ' + data.counts.needsReview + ' to approve';

    var sends = [];
    if (isCron) {
      // Email every admin of the workspace (their auth email).
      var members = await sb('workspace_members?select=user_id,role&workspace_id=eq.' + wsId + '&role=eq.admin', serviceKey);
      for (var i = 0; i < members.length; i++) {
        var u = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + members[i].user_id, {
          headers: { apikey: serviceKey, authorization: 'Bearer ' + serviceKey }
        }).then(function (r2) { return r2.ok ? r2.json() : null; }).catch(function () { return null; });
        if (u && u.email) sends.push({ to: u.email, result: await sendEmail(u.email, subject, html) });
      }
    } else if (String(req.query && req.query.send) === '1' && userEmail) {
      sends.push({ to: userEmail, result: await sendEmail(userEmail, subject, html) });
    }

    var pushed = null;
    if (isCron) pushed = await pushTo(serviceKey, null);
    else if (String(req.query && req.query.send) === '1' && userId) pushed = await pushTo(serviceKey, userId);

    res.status(200).json({ date: data.date, narrative: narrative, counts: data.counts, urgent: data.urgent, awaitingApproval: data.awaitingApproval, crew: data.crew, emailed: sends.map(function (s) { return { to: s.to, ok: !s.result.error, detail: s.result.error || undefined }; }), pushed: pushed || undefined });
  } catch (e) {
    res.status(502).json({ error: 'brief_failed', detail: String((e && e.message) || e) });
  }
};
