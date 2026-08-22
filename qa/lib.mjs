// qa/lib.mjs — the harness.
//
// Design rules this harness exists to enforce (see README.md):
//   1. Every entry is EXECUTED. Nothing is green because it was believed to work.
//   2. Every check names what it PROVES, in plain language.
//   3. Guards are MUTATION-TESTED. Break the subject, confirm the check fails,
//      restore. A guard that passes while testing nothing is worse than none.
//
// Known trap, hit repeatedly: many app functions are module-scoped
// (lpToggleTop3, top3Ids, showHome, lpTravelEdit, persist, draftFor, lpNextStep,
// openReview, newItemBase, lpBackfillOrigins). page.evaluate() CANNOT reach them.
// A guard that calls one silently no-ops and passes vacuously. Drive the real
// control instead.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

export const CHROMIUM =
  process.env.QA_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

/** Serve a directory. Returns {origin, close}. Avoids depending on python3. */
export async function serve(root, port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      if (p === '/' ) p = '/index.html';
      const file = join(root, p);
      const s = await stat(file).catch(() => null);
      if (!s || !s.isFile()) { res.writeHead(404); return res.end('not found'); }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(500); res.end('err'); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  const { port: actual } = server.address();
  return {
    origin: `http://127.0.0.1:${actual}`,
    close: () => new Promise(r => server.close(r)),
  };
}

const registry = [];

/**
 * Register a check.
 * @param {string} id        stable id, e.g. 'N1'
 * @param {string} category  wingman|forms|travel|board|mobile|goals|foundation|
 *                           navigation|detail|crew|access|security|performance
 * @param {string} proves    what a PASS actually proves, in plain language
 * @param {(ctx)=>Promise<void>} fn  throws to fail
 */
export function check(id, category, proves, fn) {
  registry.push({ id, category, proves, fn });
}

export function registered() { return registry.slice(); }

export function assert(cond, msg) {
  if (!cond) { const e = new Error(msg || 'assertion failed'); e.qaFail = true; throw e; }
}

export function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    const e = new Error(`${msg || 'not equal'} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    e.qaFail = true; throw e;
  }
}

/** Open the app and wait until the Today panel has painted. */
export async function openApp(browser, origin, { width = 1280, height = 900 } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e).slice(0, 200)));
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ol2Home', { timeout: 15000 });
  await page.waitForTimeout(600);
  page.__errors = pageErrors;
  return page;
}

export async function run({ root, only = null, headless = true } = {}) {
  const server = await serve(root);
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless });
  const results = [];
  const started = new Date().toISOString();

  for (const c of registry) {
    if (only && !only.includes(c.category) && !only.includes(c.id)) continue;
    const t0 = Date.now();
    let page = null;
    try {
      page = await openApp(browser, server.origin);
      await c.fn({ page, origin: server.origin, browser });
      results.push({ ...c, fn: undefined, status: 'pass', ms: Date.now() - t0 });
      process.stdout.write(`  PASS  ${c.id.padEnd(5)} ${c.proves}\n`);
    } catch (err) {
      // A thrown assert() is a FAIL (the product disagreed with the check).
      // Anything else is an ERROR (the check itself broke) — never conflate them.
      const status = err && err.qaFail ? 'fail' : 'error';
      results.push({ ...c, fn: undefined, status, ms: Date.now() - t0, error: String(err.message).slice(0, 300) });
      process.stdout.write(`  ${status.toUpperCase().padEnd(5)} ${c.id.padEnd(5)} ${c.proves}\n         ↳ ${String(err.message).slice(0, 180)}\n`);
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  await browser.close();
  await server.close();

  const summary = {
    ranAt: started,
    finishedAt: new Date().toISOString(),
    total: results.length,
    pass: results.filter(r => r.status === 'pass').length,
    fail: results.filter(r => r.status === 'fail').length,
    error: results.filter(r => r.status === 'error').length,
  };
  return { summary, results };
}
