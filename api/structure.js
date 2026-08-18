// Levi's Projects — Wingman capture structuring + decomposition.
// The heart of the Phase 3 vision: a raw spoken/typed sentence goes in; a structured
// card comes back with the deliverable type identified and the task decomposed into
// parts, each with a suggested owner (me / Wingman / a named person) and Wingman's
// own confidence that it could do that part.
// POST { text, people:[names], categories:[..], me } -> structured JSON (see shape below)
// Env: ANTHROPIC_API_KEY (required), ANTHROPIC_STRUCTURE_MODEL (optional).
var guard = require('./_guard.js');

var DELIVERABLES = ['Email', 'Document', 'Deck', 'Spreadsheet', 'Research brief', 'Plan', 'Design / asset', 'Code', 'Message', 'Decision', ''];

module.exports = async (req, res) => {
  var user = await guard(req, res);
  if (!user) return;

  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(503).json({ error: 'no_key' }); return; }

  var body = req.body; if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  var text = String(body.text || '').slice(0, 2000).trim();
  if (!text) { res.status(400).json({ error: 'empty' }); return; }
  var people = Array.isArray(body.people) ? body.people.slice(0, 30).map(String) : [];
  var categories = Array.isArray(body.categories) ? body.categories.slice(0, 10).map(String) : ['ACST', 'DVLMNT', 'Personal'];
  var me = String(body.me || 'Levi');
  var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

  var sys = "You are Wingman, the AI first officer inside Levi's Projects, structuring a captured task. "
    + "Wingman (you) can research online, write, summarize, draft emails/docs/plans, and prepare decks or tables — but CANNOT make phone calls, sign in to accounts, pay for things, or act in the physical world. "
    + "Return ONLY a JSON object, nothing else, exactly this shape:\n"
    + '{"title":"<clean imperative task title>","category":"<one of the given categories>","due":"<YYYY-MM-DD or empty>","owner":"<a given person name or empty>","deliverable":"<one of the given deliverable types or empty>","notes":"<any extra detail from the utterance, or empty>",'
    + '"parts":[{"title":"<part>","deliverable":"<type or empty>","suggestedOwner":"<me|Wingman|a given person name>","confidence":<0-100 integer: how likely YOU could complete this part well>,"reason":"<short>"}],'
    + '"clarify":"<the single most useful clarifying question, or empty>"}\n'
    + "Rules: today is " + today + " (America/Los_Angeles) — resolve relative dates from it. "
    + "Decompose into 2-5 parts ONLY when the task genuinely has separable steps with different owners or deliverables; for a simple single-step task return exactly one part mirroring the task. "
    + "suggestedOwner: 'Wingman' for parts you could do well (research, drafting, summarizing — confidence 70+); 'me' for judgment calls, approvals, conversations, and real-world actions; a named person only if the utterance implies them. "
    + "Every part that produces something gets a deliverable type. Do not invent people. Do not pad.";

  var u = 'UTTERANCE\n' + text + '\n\nCATEGORIES\n' + JSON.stringify(categories)
    + '\n\nPEOPLE\n' + JSON.stringify(people)
    + '\n\nDELIVERABLE TYPES\n' + JSON.stringify(DELIVERABLES.filter(Boolean))
    + '\n\nME\n' + me + '\n\nReturn the JSON now.';

  var mdl = process.env.ANTHROPIC_STRUCTURE_MODEL || 'claude-haiku-4-5-20251001';
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: mdl, max_tokens: 900, system: sys, messages: [{ role: 'user', content: u }] })
    });
    var j = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'anthropic', detail: (j && j.error && j.error.message) || ('HTTP ' + r.status) }); return; }
    var out = (j.content && j.content[0] && j.content[0].text) ? j.content[0].text : '';
    var parsed = null; try { var m = out.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : out); } catch (e) {}
    if (!parsed || !parsed.title) { res.status(200).json({ error: 'unparsed' }); return; }

    // Server-side sanitation: only known people/categories/deliverables survive.
    parsed.category = categories.indexOf(parsed.category) >= 0 ? parsed.category : categories[0];
    parsed.owner = people.indexOf(parsed.owner) >= 0 ? parsed.owner : '';
    parsed.deliverable = DELIVERABLES.indexOf(parsed.deliverable) >= 0 ? parsed.deliverable : '';
    parsed.due = /^\d{4}-\d{2}-\d{2}$/.test(parsed.due || '') ? parsed.due : '';
    parsed.notes = String(parsed.notes || '').slice(0, 1500);
    parsed.clarify = String(parsed.clarify || '').slice(0, 300);
    parsed.parts = (Array.isArray(parsed.parts) ? parsed.parts : []).slice(0, 5).map(function (p) {
      var owner = p.suggestedOwner === 'Wingman' ? 'Wingman' : (p.suggestedOwner === 'me' ? 'me' : (people.indexOf(p.suggestedOwner) >= 0 ? p.suggestedOwner : 'me'));
      return {
        title: String(p.title || '').slice(0, 200),
        deliverable: DELIVERABLES.indexOf(p.deliverable) >= 0 ? p.deliverable : '',
        suggestedOwner: owner,
        confidence: Math.max(0, Math.min(100, parseInt(p.confidence, 10) || 0)),
        reason: String(p.reason || '').slice(0, 200)
      };
    }).filter(function (p) { return p.title; });
    if (!parsed.parts.length) parsed.parts = [{ title: parsed.title, deliverable: parsed.deliverable, suggestedOwner: 'me', confidence: 0, reason: '' }];

    res.status(200).json(parsed);
  } catch (e) { res.status(502).json({ error: 'fetch', detail: String((e && e.message) || e) }); }
};
