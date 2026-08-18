// Operation Levi 2.0 — Phase 3 execution endpoint.
// Vercel serverless function. Calls the Claude API server-side; the key never reaches the browser.
// Env: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional, default claude-opus-4-8),
//      auth: signed-in Supabase JWT via api/_guard.js.
var guard = require('./_guard.js');

module.exports = async (req, res) => {
  var user = await guard(req, res);
  if (!user) return;

  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(503).json({ error: 'no_key' }); return; }

  var body = req.body;
  if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  var card = body.card || {}, skill = body.skill || null, template = body.template || null,
      context = body.context || null, preferences = body.preferences || [], model = body.model;
  var previousDraft = body.previousDraft || '', instruction = (body.instruction || '').trim();

  var sys = "You are the execution assistant inside Levi's Projects, a task app for the company dvlmnt. "
    + "Work in two parts and label them with markdown headings. First, '## Plan' — 3 to 6 concise bullet steps for how you'll complete the task. Then, '## Result' — actually DO the task and return the real output. "
    + "You have a web_search tool. USE IT for any task that needs current or external information: finding products/listings for sale, prices, availability, contact info, research, comparisons, current facts. Return concrete findings (names, prices, locations, dates) and cite sources with their URLs. "
    + "For writing tasks (emails, docs, posts), the Result is the finished draft. For research tasks, the Result is the gathered information laid out clearly (a table or list with links). "
    + "Do NOT send, publish, purchase, sign in, or take any real-world action — produce the result only so the user can review and act. "
    + "Follow the SKILL instructions, use the TEMPLATE structure if given, match the BRAND / CONTEXT (voice, terms, sensitivities), and honour the PREFERENCES. "
    + "If a CURRENT DRAFT and a REVISION are provided, revise that draft to satisfy the revision while preserving everything else, and output the full revised result only. "
    + "If something essential is missing, make a reasonable assumption and note it briefly at the end under 'Assumptions'. "
    + "If the task card specifies a DELIVERABLE type (Email, Document, Deck, Spreadsheet, Research brief, Plan, Design / asset, Code, Message, Decision), shape the Result as exactly that asset type: an Email gets a subject line and ready-to-send body; a Deck gets slide-by-slide content; a Spreadsheet gets a markdown table with headers ready to paste; a Research brief gets findings with sources; a Plan gets phased steps with owners and dates. The deliverable type wins over any conflicting format hint.";

  // Pull the chosen skill's REAL instructions if a catalog source is linked and the stored body is thin.
  if (skill && skill.source && (!skill.body || String(skill.body).trim().length < 40)) {
    var rawUrl = toRawSkillUrl(skill.source);
    if (rawUrl) {
      try {
        var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var to = ctl ? setTimeout(function () { ctl.abort(); }, 6000) : null;
        var sr = await fetch(rawUrl, ctl ? { signal: ctl.signal } : {});
        if (to) clearTimeout(to);
        if (sr.ok) { var md = await sr.text(); if (md && md.trim()) { skill.body = (skill.body ? skill.body + '\n\n' : '') + md.slice(0, 8000); skill.fetched = true; } }
      } catch (e) {}
    }
  }

  var u = "TASK CARD\n" + JSON.stringify({ title: card.title, notes: card.notes, dueDate: card.dueDate, category: card.category, assignees: card.assignees, deliverable: card.deliverable || undefined }, null, 2) + "\n\n";
  if (skill) u += "SKILL (how to do it)\n" + (skill.name ? ('# ' + skill.name + '\n') : '') + (skill.whenToUse ? ('When to use: ' + skill.whenToUse + '\n') : '') + (skill.body || '') + (skill.outputFormat ? ('\nOutput format: ' + skill.outputFormat) : '') + (skill.example ? ('\n\nExample output:\n' + skill.example) : '') + "\n\n";
  if (template) u += "TEMPLATE (structure to follow)\n" + (template.body || '') + "\n\n";
  if (context) u += "BRAND / CONTEXT\n" + JSON.stringify(context, null, 2) + "\n\n";
  if (preferences && preferences.length) u += "PREFERENCES\n" + preferences.map(function (p) { return '- ' + (p.key || '') + ': ' + (p.value || ''); }).join('\n') + "\n\n";
  if (instruction) {
    if (previousDraft) u += "CURRENT DRAFT\n" + previousDraft + "\n\n";
    u += "USER INSTRUCTION — HIGHEST AUTHORITY\n" + instruction + "\n\n";
    u += "The user's instruction above outranks the task card, the skill, and any current draft. "
      + "If it is a tweak to the current draft, apply it and output the full revised draft. "
      + "If it asks for something different or additional (a new list, new research, a different deliverable), do exactly that instead — do not restate or force-fit the old draft or the card's framing. Output only the deliverable.";
  } else {
    u += "Write the draft now.";
  }

  var mdl = model || process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: mdl, max_tokens: 4000, system: sys, messages: [{ role: 'user', content: u }], tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }] })
    });
    var j = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'anthropic', detail: (j && j.error && j.error.message) || ('HTTP ' + r.status) }); return; }
    var text = (j.content || []).filter(function (b) { return b && b.type === 'text' && b.text; }).map(function (b) { return b.text; }).join('\n').trim();
    var searches = (j.content || []).filter(function (b) { return b && (b.type === 'web_search_tool_result' || b.type === 'server_tool_use'); }).length;
    res.status(200).json({ draft: text, model: mdl, searched: searches > 0 });
  } catch (e) {
    res.status(502).json({ error: 'fetch', detail: String((e && e.message) || e) });
  }
};

// Convert a catalog skill URL (e.g. github.com/anthropics/skills/tree/main/skills/<name>)
// into the raw SKILL.md URL so we can pull the real instructions.
function toRawSkillUrl(src) {
  src = String(src || '');
  var m = src.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/);
  if (m) { return 'https://raw.githubusercontent.com/' + m[1] + '/' + m[2] + '/' + m[3] + '/' + m[4].replace(/\/$/, '') + '/SKILL.md'; }
  if (/raw\.githubusercontent\.com/.test(src) && /SKILL\.md$/i.test(src)) return src;
  return '';
}
