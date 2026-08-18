// Levi's Projects — Wingman's library-seeding interview.
// A short guided conversation: Wingman asks ONE question at a time about the user's
// companies, projects, people, standing decisions, and writing voice, and files
// library entries incrementally as answers come in.
// POST { messages:[{role:'user'|'assistant', content}], wrap?:true, existing?:{context:[names], preferences:[names], skills:[names]} }
//   -> { reply, entries:[{collection:'context'|'preferences'|'skills'|'templates', record:{...}}] }
// Env: ANTHROPIC_API_KEY, ANTHROPIC_INTERVIEW_MODEL (optional). Auth: Supabase JWT via _guard.js.
var guard = require('./_guard.js');

var COLLECTIONS = ['context', 'preferences', 'skills', 'templates'];
var CTX_TYPES = ['client', 'project', 'person', 'decision', 'glossary', 'source'];

module.exports = async (req, res) => {
  var user = await guard(req, res);
  if (!user) return;
  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(503).json({ error: 'no_key' }); return; }

  var body = req.body; if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  var msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-24).map(function (m) {
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 2000) };
  }).filter(function (m) { return m.content; });
  var existing = body.existing || {};
  var wrap = !!body.wrap;

  var sys = "You are Wingman, the AI first officer inside Levi's Projects, interviewing the user to seed your knowledge library. "
    + "Your goal: capture the nouns and voice of their world so your future drafts sound informed. Cover, over the conversation: their companies/brands and what each does; key clients or partners; 3-5 key people and their roles; standing decisions or rules; and how they like their writing to sound. "
    + "Style: warm but clipped, ONE question per turn, build on what they just said, never re-ask something answered or already in EXISTING. "
    + "Return ONLY a JSON object each turn, exactly: "
    + '{"reply":"<your next question, or a short wrap-up if finishing>","entries":[{"collection":"context|preferences|skills|templates","record":{...}}]} '
    + "File an entry the moment an answer contains enough for one — do not wait. Record shapes: "
    + 'context: {"name":"","type":"client|project|person|decision|glossary|source","summary":"<one line>","details":"<fuller reference, can be empty>"} · '
    + 'preferences: {"key":"<e.g. Brand voice — DVLMNT>","value":"<the guidance>"} · '
    + 'skills: {"name":"","description":"<when to use>","body":"<how to do it, steps>"} · '
    + 'templates: {"name":"","description":"","format":"email|doc|slide","body":"<structure>"}. '
    + "Prefer context entries; only create skills/templates when the user describes a repeatable process or structure. Never invent facts the user did not state. "
    + (wrap ? "The user is finishing NOW: extract any remaining entries from the conversation, and make reply a 1-2 sentence sign-off summarizing what you filed. Ask no further questions. " : "")
    + "EXISTING (do not duplicate): " + JSON.stringify({ context: existing.context || [], preferences: existing.preferences || [], skills: existing.skills || [] }).slice(0, 2000);

  if (!msgs.length) msgs = [{ role: 'user', content: "I'm ready — start the interview." }];
  if (msgs[0].role === 'assistant') msgs.unshift({ role: 'user', content: "I'm ready — start the interview." });

  var mdl = process.env.ANTHROPIC_INTERVIEW_MODEL || 'claude-sonnet-4-5-20250929';
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: mdl, max_tokens: 1200, system: sys, messages: msgs })
    });
    var j = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'anthropic', detail: (j && j.error && j.error.message) || ('HTTP ' + r.status) }); return; }
    var text = (j.content && j.content[0] && j.content[0].text) ? j.content[0].text : '';
    var parsed = null; try { var m = text.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : text); } catch (e) {}
    if (!parsed || !parsed.reply) { res.status(200).json({ reply: "Sorry — say that again? (I lost the thread for a second.)", entries: [] }); return; }

    var entries = (Array.isArray(parsed.entries) ? parsed.entries : []).slice(0, 6).map(function (en) {
      if (!en || COLLECTIONS.indexOf(en.collection) < 0 || !en.record || !en.record.name && !en.record.key) return null;
      var rec = {};
      if (en.collection === 'context') {
        rec = { name: String(en.record.name || '').slice(0, 120), type: CTX_TYPES.indexOf(en.record.type) >= 0 ? en.record.type : 'glossary', summary: String(en.record.summary || '').slice(0, 400), details: String(en.record.details || '').slice(0, 3000), links: [], category: 'All' };
      } else if (en.collection === 'preferences') {
        rec = { key: String(en.record.key || en.record.name || '').slice(0, 120), value: String(en.record.value || '').slice(0, 2000), scope: 'global' }; rec.name = rec.key;
      } else if (en.collection === 'skills') {
        rec = { name: String(en.record.name || '').slice(0, 120), description: String(en.record.description || '').slice(0, 500), body: String(en.record.body || '').slice(0, 4000), category: 'All', tags: '' }; rec.whenToUse = rec.description;
      } else {
        rec = { name: String(en.record.name || '').slice(0, 120), description: String(en.record.description || '').slice(0, 500), format: String(en.record.format || '').slice(0, 40), body: String(en.record.body || '').slice(0, 4000), category: 'All' };
      }
      if (!rec.name) return null;
      return { collection: en.collection, record: rec };
    }).filter(Boolean);

    res.status(200).json({ reply: String(parsed.reply).slice(0, 1200), entries: entries });
  } catch (e) { res.status(502).json({ error: 'fetch', detail: String((e && e.message) || e) }); }
};
