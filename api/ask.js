// Levi's Projects — "Ask Wingman" help chat. Answers questions strictly from the
// in-app knowledge base (docs.json), so the docs and the help answers can never drift.
// POST { question } -> { answer }
// Env: ANTHROPIC_API_KEY. Auth: signed-in Supabase JWT via _guard.js.
var guard = require('./_guard.js');
var DOCS = require('../docs.json');

module.exports = async (req, res) => {
  var user = await guard(req, res);
  if (!user) return;
  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(503).json({ error: 'no_key' }); return; }

  var body = req.body; if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  var q = String(body.question || '').slice(0, 1000).trim();
  if (!q) { res.status(400).json({ error: 'empty' }); return; }

  var corpus = DOCS.sections.map(function (s) { return '## [' + s.group + '] ' + s.title + '\n' + s.body; }).join('\n\n');
  var sys = "You are Wingman, the AI first officer inside Levi's Projects, answering a question about how the app works. "
    + "Answer ONLY from the documentation below. If the docs don't cover it, say so in one sentence and suggest the closest documented thing. "
    + "Voice: clipped, confident, helpful. 2-5 sentences, plain text, no markdown headers.\n\nDOCUMENTATION\n" + corpus;

  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_SUMMARY_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 400, system: sys, messages: [{ role: 'user', content: q }] })
    });
    var j = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'anthropic', detail: (j && j.error && j.error.message) || ('HTTP ' + r.status) }); return; }
    res.status(200).json({ answer: (j.content && j.content[0] && j.content[0].text) ? j.content[0].text.trim() : '' });
  } catch (e) { res.status(502).json({ error: 'fetch', detail: String((e && e.message) || e) }); }
};
