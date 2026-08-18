// Shared request guard for all /api/* endpoints.
// Replaces the old bypassable origin-regex + optional shared-secret scheme with:
//   1. POST-only.
//   2. Strict origin allowlist (exact-host parse, not substring regex). Requests
//      with no Origin/Referer are allowed past this step ONLY because step 3
//      still requires a valid signed-in user token — the origin check is
//      defense-in-depth, not the gate.
//   3. REQUIRED Supabase JWT: the client must send Authorization: Bearer <access_token>
//      from its signed-in session. Verified server-side against Supabase Auth.
// Env: SUPABASE_URL / SUPABASE_ANON_KEY optional overrides (defaults are the
// project's public values — the anon key already ships in the client HTML).
var SUPABASE_URL = process.env.SUPABASE_URL || 'https://jtrqhihdjbhzbavsknht.supabase.co';
var SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0cnFoaWhkamJoemJhdnNrbmh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NDU1MjcsImV4cCI6MjA5MjUyMTUyN30.4knBxgbJgiyNH-nm-XdmOJxTURRxuyHH9_HxxjaUdmI';

var ALLOWED_HOSTS = ['levisprojects.com', 'www.levisprojects.com', 'localhost', '127.0.0.1'];

function originAllowed(origin) {
  if (!origin) return true; // non-browser callers still hit the JWT wall below
  try {
    var host = new URL(origin).hostname.toLowerCase();
    if (ALLOWED_HOSTS.indexOf(host) !== -1) return true;
    // Vercel preview/branch deployments of THIS project only.
    if (/^operation-levi[a-z0-9-]*\.vercel\.app$/.test(host)) return true;
    return false;
  } catch (e) { return false; }
}

// Returns the authenticated Supabase user object, or null after having
// already written the error response.
module.exports = async function guard(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return null; }

  var origin = req.headers.origin || req.headers.referer || '';
  if (!originAllowed(origin)) { res.status(403).json({ error: 'origin' }); return null; }

  var auth = req.headers.authorization || '';
  var m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) { res.status(401).json({ error: 'auth', detail: 'Sign in required.' }); return null; }

  try {
    var r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: 'Bearer ' + m[1] }
    });
    if (!r.ok) { res.status(401).json({ error: 'auth', detail: 'Session expired — sign in again.' }); return null; }
    var user = await r.json();
    if (!user || !user.id) { res.status(401).json({ error: 'auth' }); return null; }
    return user;
  } catch (e) {
    res.status(502).json({ error: 'auth_check', detail: String((e && e.message) || e) });
    return null;
  }
};
