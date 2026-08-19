// Levi's Projects — Wingman's trip planner (Phase 4: Travel).
// Takes a trip (where / when / why) plus the user's travel profile from Wingman's Memory,
// researches the route with live web search, and returns a structured plan: flight options,
// lodging, ground transport, a day-by-day itinerary, and an exact "to book" list with the
// right loyalty numbers attached for whoever does the booking.
//
// Wingman never books and never pays — the output is a decision-ready brief for Levi or his EA.
//
// POST { trip:{origin,destination,depart,return,purpose,notes}, profile:{...} } -> plan JSON
// Env: ANTHROPIC_API_KEY (required), ANTHROPIC_TRIP_MODEL (optional). Auth: Supabase JWT via _guard.js.
var guard = require('./_guard.js');

function s(v, n) { return String(v == null ? '' : v).slice(0, n || 200); }

module.exports = async (req, res) => {
  var user = await guard(req, res);
  if (!user) return;

  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(503).json({ error: 'no_key' }); return; }

  var body = req.body; if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  var t = body.trip || {};
  var destination = s(t.destination, 160).trim();
  if (!destination) { res.status(400).json({ error: 'no_destination' }); return; }

  var trip = {
    origin: s(t.origin, 120).trim(),
    destination: destination,
    depart: /^\d{4}-\d{2}-\d{2}$/.test(t.depart || '') ? t.depart : '',
    ret: /^\d{4}-\d{2}-\d{2}$/.test(t.ret || t['return'] || '') ? (t.ret || t['return']) : '',
    purpose: s(t.purpose, 400).trim(),
    notes: s(t.notes, 800).trim()
  };

  // Travel profile — preferences only. Payment details are never accepted or stored.
  var p = body.profile || {};
  var profile = {
    homeAirport: s(p.homeAirport, 80),
    airlines: s(p.airlines, 200),
    airlineLoyalty: s(p.airlineLoyalty, 200),
    cabin: s(p.cabin, 80),
    seat: s(p.seat, 80),
    rentalCar: s(p.rentalCar, 160),
    rentalLoyalty: s(p.rentalLoyalty, 160),
    hotels: s(p.hotels, 200),
    hotelLoyalty: s(p.hotelLoyalty, 200),
    carService: s(p.carService, 200),
    rules: s(p.rules, 800)
  };

  var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

  var sys = "You are Wingman, the AI first officer inside Levi's Projects, planning a business trip. "
    + "You have a web_search tool — USE IT to ground the plan in current reality: which airlines actually fly the route and roughly when, typical current fare ranges, which neighborhoods/hotels suit the trip's purpose, and what ground transport actually exists at the destination. Prefer concrete named findings over generalities. "
    + "You do NOT book anything and you never handle payment. Your output is a decision-ready brief that Levi or his assistant executes. "
    + "Honour the TRAVEL PROFILE: preferred airlines, cabin and seat, rental car and hotel programs, preferred car service, and any standing rules (they outrank your own preferences). "
    + "When you name a flight option, be explicit that schedules and fares must be confirmed at booking time — never state a fare as though it is locked. "
    + "Today is " + today + " (America/Los_Angeles). "
    + "Return ONLY a JSON object, no prose around it, exactly this shape:\n"
    + '{"headline":"<one sentence: the shape of the trip>",'
    + '"flights":[{"leg":"<Outbound Tue Sep 15 | Return Thu Sep 17>","options":[{"airline":"","route":"<PDX → SFO, nonstop>","timing":"<morning departure, ~2h05m>","fare":"<approx range, to confirm>","why":"<why this one fits his prefs>"}]}],'
    + '"lodging":[{"name":"","area":"","why":"","rate":"<approx, to confirm>"}],'
    + '"ground":[{"mode":"<rental car | car service | transit>","detail":"","cost":"<approx>"}],'
    + '"itinerary":[{"day":"<Tue Sep 15>","items":["<what happens>"]}],'
    + '"toBook":[{"what":"<Book outbound flight>","details":"<exactly what to book>","who":"<you|EA>","loyalty":"<the loyalty number to apply, or empty>"}],'
    + '"questions":["<the single most useful thing you still need from Levi, if any>"],'
    + '"sources":["<url actually used>"]}\n'
    + "Rules: 2-3 flight options per leg, max. Lodging max 3. toBook must be executable without further research — include airline, rough time, hotel name, and the loyalty number from the profile where one applies. "
    + "If the profile has no loyalty number for something, leave loyalty empty rather than inventing one. Never invent a confirmation number, a price you did not find, or a flight that does not exist.";

  var u = "TRIP\n" + JSON.stringify(trip, null, 1) + "\n\nTRAVEL PROFILE\n" + JSON.stringify(profile, null, 1)
    + "\n\nResearch the route now, then return the JSON plan.";

  var mdl = process.env.ANTHROPIC_TRIP_MODEL || process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: mdl, max_tokens: 4000, system: sys,
        messages: [{ role: 'user', content: u }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }]
      })
    });
    var j = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'anthropic', detail: (j && j.error && j.error.message) || ('HTTP ' + r.status) }); return; }

    var text = (j.content || []).filter(function (b) { return b && b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
    var searches = (j.content || []).filter(function (b) { return b && (b.type === 'web_search_tool_result' || b.type === 'server_tool_use'); }).length;

    var plan = null;
    try { var m = text.match(/\{[\s\S]*\}/); plan = JSON.parse(m ? m[0] : text); } catch (e) {}
    if (!plan) { res.status(200).json({ error: 'unparsed', raw: text.slice(0, 4000), searches: searches }); return; }

    // ── Server-side shaping: keep the response predictable for the UI ──
    function arr(v, n) { return (Array.isArray(v) ? v : []).slice(0, n); }
    var out = {
      headline: s(plan.headline, 400),
      flights: arr(plan.flights, 4).map(function (f) {
        return {
          leg: s(f && f.leg, 120),
          options: arr(f && f.options, 3).map(function (o) {
            return { airline: s(o && o.airline, 80), route: s(o && o.route, 160), timing: s(o && o.timing, 160), fare: s(o && o.fare, 80), why: s(o && o.why, 240) };
          })
        };
      }),
      lodging: arr(plan.lodging, 3).map(function (l) { return { name: s(l && l.name, 120), area: s(l && l.area, 120), why: s(l && l.why, 240), rate: s(l && l.rate, 80) }; }),
      ground: arr(plan.ground, 4).map(function (g) { return { mode: s(g && g.mode, 80), detail: s(g && g.detail, 240), cost: s(g && g.cost, 80) }; }),
      itinerary: arr(plan.itinerary, 14).map(function (d) { return { day: s(d && d.day, 80), items: arr(d && d.items, 8).map(function (x) { return s(x, 240); }) }; }),
      toBook: arr(plan.toBook, 12).map(function (b) {
        return { what: s(b && b.what, 160), details: s(b && b.details, 400), who: (b && b.who === 'EA') ? 'EA' : 'you', loyalty: s(b && b.loyalty, 120) };
      }),
      questions: arr(plan.questions, 3).map(function (q) { return s(q, 300); }),
      sources: arr(plan.sources, 8).map(function (x) { return s(x, 300); }).filter(function (x) { return /^https?:\/\//i.test(x); }),
      searches: searches,
      model: mdl,
      trip: trip
    };
    res.status(200).json(out);
  } catch (e) { res.status(502).json({ error: 'fetch', detail: String((e && e.message) || e) }); }
};
