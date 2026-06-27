// Levi's Projects — short natural-language narrative for Goals and Pulse.
// POST { kind: 'goal'|'pulse', data: {...} }  ->  { text: "<one or two sentences>" }
// Mirrors api/assess.js. Env: ANTHROPIC_API_KEY (required), ANTHROPIC_SUMMARY_MODEL (optional),
// RUN_SHARED_SECRET (optional guard via x-ol-key). Callers degrade gracefully if this 503s.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  var origin = req.headers.origin || req.headers.referer || '';
  if (origin && !/^https?:\/\/(www\.)?levisprojects\.com|\.vercel\.app/i.test(origin)) { res.status(403).json({ error: 'origin' }); return; }
  var secret = process.env.RUN_SHARED_SECRET;
  if (secret && req.headers['x-ol-key'] !== secret) { res.status(403).json({ error: 'auth' }); return; }
  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(503).json({ error: 'no_key' }); return; }

  var body = req.body; if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  var kind = body.kind === 'pulse' ? 'pulse' : 'goal';
  var data = body.data || {};

  var sys, u;
  if (kind === 'goal') {
    sys = "You write a single, plain-language status line for one annual goal in a personal productivity app. "
      + "A goal is fulfilled only by completing the projects/tasks linked beneath it. "
      + "Write ONE sentence, max ~30 words, concrete and specific — name the critical-path task and any risk (overdue, stalled, behind pace). "
      + "No preamble, no quotes, no markdown — return just the sentence. Be honest and use ONLY the data provided; do not invent facts.";
    u = "GOAL DATA\n" + JSON.stringify(data, null, 2) + "\n\nWrite the status line now.";
  } else {
    sys = "You write a brief, plain-language insight headline summarizing someone's work this week in a productivity app. "
      + "1-2 sentences, max ~40 words. Lead with what matters most — momentum, overdue risk, or goal-fulfillment pace. "
      + "No preamble, no quotes, no markdown — return just the sentence(s). Be honest and use ONLY the data provided; do not invent facts.";
    u = "PULSE DATA\n" + JSON.stringify(data, null, 2) + "\n\nWrite the insight now.";
  }

  var mdl = process.env.ANTHROPIC_SUMMARY_MODEL || 'claude-haiku-4-5-20251001';
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: mdl, max_tokens: 160, system: sys, messages: [{ role: 'user', content: u }] })
    });
    var j = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'anthropic', detail: (j && j.error && j.error.message) || ('HTTP ' + r.status) }); return; }
    var text = (j.content && j.content[0] && j.content[0].text) ? String(j.content[0].text).trim() : '';
    res.status(200).json({ text: text });
  } catch (e) { res.status(502).json({ error: 'fetch', detail: String((e && e.message) || e) }); }
};
