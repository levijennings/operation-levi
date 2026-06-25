// Levi's Projects — task assessment endpoint.
// Returns JSON: how confident Claude is it can do the task, clarifying questions, and library suggestions.
// Env: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional), RUN_SHARED_SECRET (optional guard via x-ol-key).
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
  var task = body.task || {}; var libs = body.libraries || {};

  var sys = "You assess whether Claude (an AI assistant that can web-search, research, write, summarize, and draft, but CANNOT make phone calls, sign into accounts, make purchases, or take physical/real-world actions) can complete a task for the user. "
    + "Return ONLY a JSON object and nothing else, with exactly this shape: "
    + '{"confidence": <integer 0-100>, "reason": "<one short sentence>", "questions": ["<clarifying question>"], "suggest": {"skill": <name or null>, "template": <name or null>, "context": <name or null>}}. '
    + "confidence = how likely Claude can itself produce a useful result. High (75-100) for research, finding info/products online, writing, summarizing, planning, drafting. Low (<40) for tasks needing real-world action, sign-ins, payments, calls, or information only the user holds. "
    + "questions = empty array if you are confident and the task is clear; otherwise 1-3 specific questions that would unblock you. "
    + "suggest = choose the single most relevant entry from each provided library list by its EXACT name, or null if none fits.";
  var u = "TASK\n" + JSON.stringify({ title: task.title, notes: task.notes, category: task.category }, null, 2) + "\n\n"
    + "AVAILABLE LIBRARIES (names only)\n" + JSON.stringify({ skills: libs.skills || [], templates: libs.templates || [], context: libs.context || [] }, null, 2)
    + "\n\nReturn the JSON now.";

  var mdl = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: mdl, max_tokens: 700, system: sys, messages: [{ role: 'user', content: u }] })
    });
    var j = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'anthropic', detail: (j && j.error && j.error.message) || ('HTTP ' + r.status) }); return; }
    var text = (j.content && j.content[0] && j.content[0].text) ? j.content[0].text : '';
    var parsed = null; try { var m = text.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : text); } catch (e) {}
    if (!parsed) { res.status(200).json({ confidence: null, reason: 'Could not parse assessment.', questions: [], suggest: {} }); return; }
    res.status(200).json(parsed);
  } catch (e) { res.status(502).json({ error: 'fetch', detail: String((e && e.message) || e) }); }
};
