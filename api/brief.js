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
  // "Awaiting your approval" has to mean exactly what the Today tile and the review
  // lane mean, or the brief contradicts the app on Levi's own screen. This previously
  // also swept in anything carrying a drafted artifact — including tasks already marked
  // done — which is how it reported 8 drafts against a real 3.
  var review = items.filter(function (c) { return c.status === 'review'; });
  // Drafted but never filed into review. Still worth surfacing, but it is a different
  // thing from work waiting on a decision, so it gets its own figure.
  var draftedNotFiled = open.filter(function (c) { return c.status !== 'review' && c.aiArtifact && c.aiArtifact.content && c.aiStatus === 'drafted'; });
  var byPerson = {};
  open.forEach(function (c) {
    (c.assignees && c.assignees.length ? c.assignees : [c.responsible || '—']).forEach(function (p) {
      if (!p) return; byPerson[p] = (byPerson[p] || 0) + 1;
    });
  });
  var goals = ((blob && blob.goals) || []).slice(0, 6).map(function (g) {
    var linked = items.filter(function (c) { return (c.goalIds || []).indexOf(g.id) >= 0; });
    var doneL = linked.filter(function (c) { return c.status === 'done'; });
    var pct = linked.length ? Math.round(doneL.length / linked.length * 100) : 0;
    // Where the calendar says you should be, so "behind" is measured, not guessed.
    var expected = null;
    if (g.targetDate) {
      try {
        var yr = (g.targetDate || '').slice(0, 4);
        var st = new Date(yr + '-01-01T00:00:00').getTime(), tg = new Date(g.targetDate + 'T00:00:00').getTime();
        if (tg > st) expected = Math.max(0, Math.min(100, Math.round((Date.now() - st) / (tg - st) * 100)));
      } catch (e) {}
    }
    return {
      title: g.title, targetDate: g.targetDate || '', updates: (g.updates || []).length,
      linkedTasks: linked.length, linkedDone: doneL.length, percentFulfilled: pct,
      percentExpectedByNow: expected,
      evidence: linked.length ? 'measured from linked work'
        : 'NO WORK IS LINKED TO THIS GOAL — there is no evidence of progress either way'
    };
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
    counts: { open: open.length, overdue: overdue.length, dueToday: dueToday.length, needsReview: review.length, draftedNotFiled: draftedNotFiled.length },
    urgent: { total: overdue.length + dueToday.length, showing: top.length, items: top },
    awaitingApproval: { total: review.length, showing: Math.min(review.length, 8), items: review.slice(0, 8).map(function (c) { return { title: c.title, deliverable: c.deliverable || '' }; }) },
    crew: byPerson,
    goals: goals,
    alerts: alerts.slice(0, 4)
  };
}

// Every figure Levi is allowed to read in the narrative, pre-written. The model may
// only state a count by copying one of these verbatim — it never does its own arithmetic,
// which is how the brief came to claim "four overdue" and "eight drafts" against a real
// 7 and 2 (and contradicted itself in the same paragraph).
function figurePhrases(c) {
  return {
    overdue: c.overdue + (c.overdue === 1 ? ' overdue task' : ' overdue tasks'),
    dueToday: c.dueToday + ' due today',
    needsReview: c.needsReview + (c.needsReview === 1 ? ' draft awaiting your approval' : ' drafts awaiting your approval'),
    draftedNotFiled: c.draftedNotFiled + (c.draftedNotFiled === 1 ? ' draft not yet filed for review' : ' drafts not yet filed for review'),
    open: c.open + ' open'
  };
}
// Pulls every number out of the prose, in digits or words, so we can prove each one was allowed.
var NUMWORDS = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
  eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17,
  eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40, fifty:50 };
// Dates are legitimate prose ("since June 26th", "by Q4") and must not be read as claims.
var MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
function stripDates(text) {
  return String(text || '')
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(new RegExp('(' + MONTHS + ')\\.?\\s+\\d{1,2}(st|nd|rd|th)?', 'gi'), ' ')
    .replace(new RegExp('\\d{1,2}(st|nd|rd|th)?\\s+(' + MONTHS + ')', 'gi'), ' ')
    .replace(/\bq[1-4]\b/gi, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\s*(am|pm)?/gi, ' ');
}
function numbersIn(text) {
  var t = stripDates(text), out = [];
  t.replace(/\d+(?:\.\d+)?%?/g, function (m) { out.push(m.replace('%','')); return m; });
  t.toLowerCase().replace(/[a-z]+/g, function (w) { if (NUMWORDS[w] != null) out.push(String(NUMWORDS[w])); return w; });
  return out.map(Number).filter(function (n) { return !isNaN(n); });
}
// Anything that legitimately appears in the data the model was handed.
function allowedNumbers(data) {
  var set = {};
  (function walk(v, key) {
    if (v == null) return;
    // The brief's own date must not license its digits as claimable figures — this is
    // how "2026-08-18" quietly made 8 and 18 look like supported counts.
    if (key === 'date' || key === 'due' || key === 'dueDate' || key === 'targetDate') return;
    if (typeof v === 'number') { set[v] = 1; return; }
    if (typeof v === 'string') { (stripDates(v).match(/\d+/g) || []).forEach(function (d) { set[Number(d)] = 1; }); return; }
    if (Array.isArray(v)) { v.forEach(function (x) { walk(x, key); }); return; }
    if (typeof v === 'object') { Object.keys(v).forEach(function (k) { walk(v[k], k); }); }
  })(data, '');
  return set;
}
function unsupportedNumbers(text, data) {
  var allowed = allowedNumbers(data);
  return numbersIn(text).filter(function (n) { return !allowed[n]; });
}
// If the model cannot be trusted with prose, Levi still gets a correct brief.
function deterministicNarrative(data) {
  var f = figurePhrases(data.counts), bits = [];
  if (data.counts.overdue) bits.push('You are carrying ' + f.overdue + '.');
  if (data.counts.needsReview) bits.push(f.needsReview.charAt(0).toUpperCase() + f.needsReview.slice(1) + '.');
  if (data.counts.dueToday) bits.push(f.dueToday.charAt(0).toUpperCase() + f.dueToday.slice(1) + '.');
  if (!bits.length) bits.push('Nothing overdue and nothing waiting on your approval.');
  if (data.alerts && data.alerts.length) bits.push(data.alerts[0] + '.');
  return bits.join(' ');
}

async function writeNarrative(data, key) {
  var mdl = process.env.ANTHROPIC_SUMMARY_MODEL || 'claude-haiku-4-5-20251001';
  var sys = "You are Wingman, the AI first officer inside Levi's Projects. Write the morning executive brief for Levi. "
    + "Voice: clipped, confident, zero filler — a trusted first officer, not a chatbot. Second person. "
    + "Structure: one headline sentence naming the single most needle-moving thing today; then 2-4 short sentences covering what you flag from overdue/due items, drafts awaiting approval, and crew load; close with one sentence on goal pace if goal data exists. "
    + "ALERTS in the data are pre-computed warnings from the analytics — if any are present, weave the most important one in plainly; they exist so nobody quietly falls behind. "
    + "NUMBERS: you may not count, add, estimate or infer any figure. A FIGURES block is supplied with every count already written out. "
    + "If you want to state a quantity, copy the matching phrase from FIGURES exactly. Any number not in FIGURES is forbidden — including counting the entries of a list yourself, which are truncated samples and carry their real size in the 'total' field. "
    + "You may always refer to quantities qualitatively instead ('a few', 'most of the crew') or name the specific items. "
    + "GOALS: state only the measured position. A goal whose evidence field says no work is linked has no progress data at all — say that plainly ('nothing is linked to Orbital yet, so it cannot track itself') rather than implying it is on course. Never say a goal is 'on track', 'tracking to', or 'on pace' unless percentFulfilled is at or above percentExpectedByNow. "
    + "Open with the single action Levi should take first today, not a summary of the pile. "
    + "Never invent tasks. Under 120 words. No markdown headers, no bullet lists, no emoji.";
  var figures = figurePhrases(data.counts);
  var baseUser = 'FIGURES — the only counts you may state, copied exactly:\n' + JSON.stringify(figures, null, 1)
    + '\n\nBRIEF DATA\n' + JSON.stringify(data, null, 1) + '\n\nWrite the brief now.';

  async function ask(user) {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: mdl, max_tokens: 350, system: sys, messages: [{ role: 'user', content: user }] })
    });
    var j = await r.json();
    if (!r.ok) throw new Error('anthropic: ' + ((j && j.error && j.error.message) || r.status));
    return (j.content && j.content[0] && j.content[0].text) ? j.content[0].text.trim() : '';
  }

  // Trust, then verify. Any number in the prose that appears nowhere in the data is a
  // fabrication; give it one corrective pass, then fall back to figures we computed ourselves.
  var text = await ask(baseUser);
  var badly = unsupportedNumbers(text, data);
  if (badly.length) {
    text = await ask(baseUser + '\n\nYour previous attempt stated ' + badly.join(', ')
      + ', which appear nowhere in the data. Rewrite it. State a count only by copying a FIGURES phrase verbatim, or describe the quantity in words instead.');
    badly = unsupportedNumbers(text, data);
  }
  if (badly.length) return deterministicNarrative(data);
  return text;
}

function briefEmailHtml(narrative, data) {
  var rows = ((data.urgent && data.urgent.items) || []).map(function (t) {
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

    res.status(200).json({ date: data.date, narrative: narrative, counts: data.counts, urgent: (data.urgent && data.urgent.items) || [], awaitingApproval: (data.awaitingApproval && data.awaitingApproval.items) || [], crew: data.crew, emailed: sends.map(function (s) { return { to: s.to, ok: !s.result.error, detail: s.result.error || undefined }; }), pushed: pushed || undefined });
  } catch (e) {
    res.status(502).json({ error: 'brief_failed', detail: String((e && e.message) || e) });
  }
};
