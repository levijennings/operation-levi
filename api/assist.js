// Levi's Projects — lightweight AI helper endpoint for briefs, per-item chat,
// and quick actions (breakdown / brief / risks / next). Replaces the old
// browser-direct Anthropic path (which required a user-pasted API key in
// localStorage). Server-side key; caller must be a signed-in user (see _guard.js).
// POST { prompt, system?, max_tokens? } -> { text }
var guard = require('./_guard.js');

module.exports = async (req, res) => {
  var user = await guard(req, res);
  if (!user) return;

  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(503).json({ error: 'no_key' }); return; }

  var body = req.body; if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  var prompt = String(body.prompt || '').slice(0, 24000);
  if (!prompt.trim()) { res.status(400).json({ error: 'empty' }); return; }
  var system = String(body.system || '').slice(0, 4000);
  var maxTokens = Math.min(Math.max(parseInt(body.max_tokens, 10) || 500, 50), 1500);
  var mdl = process.env.ANTHROPIC_SUMMARY_MODEL || 'claude-haiku-4-5-20251001';

  try {
    var payload = { model: mdl, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
    if (system) payload.system = system;
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var j = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'anthropic', detail: (j && j.error && j.error.message) || ('HTTP ' + r.status) }); return; }
    var text = (j.content && j.content[0] && j.content[0].text) ? j.content[0].text : '';
    res.status(200).json({ text: text });
  } catch (e) { res.status(502).json({ error: 'fetch', detail: String((e && e.message) || e) }); }
};
