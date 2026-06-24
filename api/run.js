// Operation Levi 2.0 — Phase 3 execution endpoint.
// Vercel serverless function. Calls the Claude API server-side; the key never reaches the browser.
// Env: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional, default claude-opus-4-8),
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

  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(503).json({ error: 'no_key' }); return; }

  var body = req.body;
  if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  var card = body.card || {}, skill = body.skill || null, template = body.template || null,
      context = body.context || null, preferences = body.preferences || [], model = body.model;
  var previousDraft = body.previousDraft || '', instruction = (body.instruction || '').trim();

  var sys = "You are the execution assistant inside Operation Levi, a task app for the company dvlmnt. "
    + "Produce a high-quality first DRAFT for the task below. Do NOT send, publish, or take any action — output the draft only. "
    + "Follow the SKILL instructions, use the TEMPLATE structure if given, match the BRAND / CONTEXT (voice, terms, sensitivities), and honour the PREFERENCES. "
    + "If a CURRENT DRAFT and a REVISION are provided, revise that draft to satisfy the revision while preserving everything else, and output the full revised draft only. "
    + "If something essential is missing, make a reasonable assumption and note it briefly at the end under 'Assumptions'.";

  var u = "TASK CARD\n" + JSON.stringify({ title: card.title, notes: card.notes, dueDate: card.dueDate, category: card.category, assignees: card.assignees }, null, 2) + "\n\n";
  if (skill) u += "SKILL (how to do it)\n" + (skill.name ? ('# ' + skill.name + '\n') : '') + (skill.whenToUse ? ('When to use: ' + skill.whenToUse + '\n') : '') + (skill.body || '') + (skill.outputFormat ? ('\nOutput format: ' + skill.outputFormat) : '') + (skill.example ? ('\n\nExample output:\n' + skill.example) : '') + "\n\n";
  if (template) u += "TEMPLATE (structure to follow)\n" + (template.body || '') + "\n\n";
  if (context) u += "BRAND / CONTEXT\n" + JSON.stringify(context, null, 2) + "\n\n";
  if (preferences && preferences.length) u += "PREFERENCES\n" + preferences.map(function (p) { return '- ' + (p.key || '') + ': ' + (p.value || ''); }).join('\n') + "\n\n";
  if (instruction) {
    u += "CURRENT DRAFT\n" + previousDraft + "\n\n";
    u += "REVISION REQUESTED\n" + instruction + "\n\n";
    u += "Apply the revision to the draft above, keep everything else intact, and output the full revised draft only.";
  } else {
    u += "Write the draft now.";
  }

  var mdl = model || process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: mdl, max_tokens: 2000, system: sys, messages: [{ role: 'user', content: u }] })
    });
    var j = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'anthropic', detail: (j && j.error && j.error.message) || ('HTTP ' + r.status) }); return; }
    var text = (j.content && j.content[0] && j.content[0].text) ? j.content[0].text : '';
    res.status(200).json({ draft: text, model: mdl });
  } catch (e) {
    res.status(502).json({ error: 'fetch', detail: String((e && e.message) || e) });
  }
};
