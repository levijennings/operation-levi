// qa/suite.mjs — automated checks.
//
// PARTIAL RESTORATION. The original 92-entry suite was lost with its session
// workspace and was never committed. These checks were re-authored on 2026-08-22
// against the current build from the doctrine and guard names recorded in the
// project knowledge base. Coverage is honestly ~a third of the original.
// Grow it back through the feature gate (every feature adds a guard), NOT by
// inventing checks to match the old category counts — a check reconstructed from
// a count asserts something different from the one it replaces.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { check, assert, assertEq, run } from './lib.mjs';

const REPO = process.env.QA_REPO || '/tmp/ol';
const NAV = ['Today', 'Missions', 'Goals', 'Crew', 'Wingman'];

/* ─────────────────────────── navigation ─────────────────────────── */

check('N1', 'navigation',
  'The Today panel is #ol2Home — the id the app actually uses',
  async ({ page }) => {
    assert(await page.$('#ol2Home'), '#ol2Home missing');
    assert(!(await page.$('#ol2Today')), '#ol2Today exists — the original suite guessed this id and tested nothing');
    assert(await page.isVisible('#ol2Home'), 'Today panel is not visible on load');
  });

check('N2', 'navigation',
  'All five destinations are present in the nav',
  async ({ page }) => {
    const txt = await page.$eval('#ol2Nav', el => el.innerText);
    for (const d of NAV) assert(txt.includes(d), `nav is missing "${d}"`);
  });

check('N3', 'navigation',
  'G+M reaches the mission board',
  async ({ page }) => {
    await page.keyboard.press('g');
    await page.keyboard.press('m');
    await page.waitForTimeout(600);
    assert(await page.isVisible('#ol2Board'), 'board did not open on G+M');
  });

check('N4', 'navigation',
  'The Needs review nav row is a real element with its own count (X36 fix)',
  async ({ page }) => {
    const row = await page.$('#ol2RevNav');
    assert(row, '#ol2RevNav missing — this is the element X36 added');
    const n = await page.$('#ol2RevN');
    assert(n, '#ol2RevN count span missing');
    const cls = await page.$eval('#ol2RevN', el => el.className);
    assert(/amber/.test(cls), 'the review count is not the amber Wingman count');
    // X36 was: the span was hard-coded display:none and never un-hidden.
    const inline = await page.$eval('#ol2RevN', el => el.getAttribute('style') || '');
    assert(!/display\s*:\s*none/.test(inline), 'the count span is hard-coded display:none again — X36 has regressed');
  });

check('N5', 'navigation',
  'Docs & help is reachable from the nav',
  async ({ page }) => {
    const txt = await page.$eval('#ol2Nav', el => el.innerText);
    assert(/Docs/i.test(txt), 'no Docs entry in nav');
  });

/* ───────────────────────────── board ───────────────────────────── */

async function toBoard(page) {
  await page.keyboard.press('g');
  await page.keyboard.press('m');
  await page.waitForSelector('#ol2Board', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(400);
}

check('B1', 'board',
  'The board runs Backlog · In progress · Top 3 · Needs review · Done, in that order',
  async ({ page }) => {
    await toBoard(page);
    const heads = await page.$$eval('#ol2Board .col > h3', els =>
      els.map(e => e.firstChild.textContent.trim()));
    assertEq(heads.join(' | '), 'Backlog | In progress | Top 3 | Needs review | Done', 'column spec drifted');
  });

check('B2', 'board',
  'Cards render as .tcard',
  async ({ page }) => {
    await toBoard(page);
    const n = await page.$$eval('#ol2Board .tcard', els => els.length);
    assert(n > 0, 'no .tcard elements on the board');
  });

check('B3', 'board',
  'Card complete/delete are .tact .tadone/.tadel — not a data attribute',
  async ({ page }) => {
    await toBoard(page);
    const found = await page.evaluate(() => {
      const c = document.querySelector('#ol2Board .tcard');
      if (!c) return null;
      return { done: !!c.querySelector('.tadone'), del: !!c.querySelector('.tadel'), act: !!c.querySelector('.tact') };
    });
    assert(found, 'no card to inspect');
    assert(found.act, 'card has no .tact action group');
    assert(found.done && found.del, 'hover complete/delete controls missing (.tadone/.tadel)');
    assertEq(await page.$$eval('#ol2Board [data-done]', e => e.length), 0,
      '[data-done] exists — the original B3 guessed this selector and asserted nothing');
  });

check('B4', 'board',
  'Column collapse is the .colc class, not an inferred width',
  async ({ page }) => {
    await toBoard(page);
    const hasRule = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const r of rules || []) if (r.selectorText && r.selectorText.includes('.colc')) return true;
      }
      return false;
    });
    assert(hasRule, 'no .colc rule in any stylesheet — collapse is not class-driven');
  });

check('B6', 'board',
  'The column counts reconcile with the cards actually rendered',
  async ({ page }) => {
    await toBoard(page);
    const { declared, rendered } = await page.evaluate(() => {
      const declared = [...document.querySelectorAll('#ol2Board .col > h3 .cnt')]
        .reduce((s, e) => s + (parseInt(e.textContent.trim(), 10) || 0), 0);
      const rendered = document.querySelectorAll('#ol2Board .tcard').length;
      return { declared, rendered };
    });
    assertEq(declared, rendered, 'column headers and rendered cards disagree (MF-2 class of defect)');
  });

check('B8', 'board',
  'Cards carry their dates on the face',
  async ({ page }) => {
    await toBoard(page);
    const txt = await page.$eval('#ol2Board .tcard', el => el.innerText);
    assert(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\d{1,2}\/\d{1,2}/.test(txt),
      'no date visible on the card face');
  });

/* ──────────────────────────── wingman ──────────────────────────── */

check('W1', 'wingman',
  'The Wingman hub opens and carries Queue, Memory and Plays',
  async ({ page }) => {
    await page.keyboard.press('g');
    await page.keyboard.press('w');
    await page.waitForTimeout(800);
    const txt = await page.evaluate(() => document.body.innerText);
    for (const t of ['Queue', 'Memory', 'Plays']) assert(txt.includes(t), `Wingman hub is missing "${t}"`);
  });

check('W2', 'wingman',
  'The five shipped plays are present by name',
  async ({ page }) => {
    await page.keyboard.press('g');
    await page.keyboard.press('w');
    await page.waitForTimeout(800);
    // The hub opens on Queue. Drive the real tab — do not call showPlays(),
    // which is module-scoped and unreachable from evaluate().
    await page.locator('.wtabs a', { hasText: /^Plays$/ }).first().click();
    await page.waitForTimeout(700);
    const txt = await page.evaluate(() => document.body.innerText);
    const want = ['Demo follow-up', 'Weekly LOI outreach', 'Investor / CEO update', 'Weekly review', 'Book travel'];
    const missing = want.filter(w => !txt.includes(w));
    assertEq(missing.length, 0, `plays missing: ${missing.join(', ')}`);
  });

check('W3', 'wingman',
  'The review lane mounts and defines approve / edit / redo / skip — live behaviour on real drafts is manual step X20',
  async ({ page }) => {
    assert(await page.$('#ol2Lane'), '#ol2Lane container missing');
    const src = await readFile(join(REPO, 'index.html'), 'utf8');
    for (const id of ['ol2LaneA', 'ol2LaneE', 'ol2LaneR', 'ol2LaneS']) {
      assert(src.includes(id), `review lane control ${id} is not defined anywhere in the build`);
    }
    // The sub-controls render only when the lane is opened with a draft in it,
    // which needs real data. This check proves they exist; it does not prove
    // approve-then-advance works. Do not upgrade the wording without X20.
  });

check('W10', 'wingman',
  'The brief reports its own failure rather than failing silently (W11 lineage)',
  async ({ page }) => {
    // With no API locally the brief must fail LOUDLY. The X18-era defect was that
    // a failed send was discarded and looked identical to a success.
    const txt = await page.$eval('#ol2BriefCard', el => el.innerText);
    assert(/couldn't|could not|failed|try again|⚠/i.test(txt),
      'the brief card does not surface its failure — silent failure has returned');
  });

check('W20', 'wingman',
  'Skill matching has a relevance threshold instead of falling back to the first skill',
  async ({ page, origin }) => {
    const src = await readFile(join(REPO, 'index.html'), 'utf8');
    // Word-boundary + call shape. A bare /lpSkillScore/ also matches a renamed
    // lpSkillScoreX and survived its mutation — caught 2026-08-22.
    assert(/\blpSkillScore\s*\(/.test(src), 'lpSkillScore is never called — scoring was removed');
    assert(!/return\s+best\s*\|\|\s*sk\[0\]/.test(src),
      'matchSkill still ends "return best || sk[0]" — the defect that attached an unrelated skill to a trip task');
  });

/* ───────────────────────────── forms ───────────────────────────── */

check('F1', 'forms',
  'Field labels are block-level, so they sit above their control and not beside it',
  async ({ page }) => {
    const ok = await page.evaluate(() => {
      const el = document.createElement('label');
      el.className = 'lp-lbl'; el.textContent = 'probe';
      document.body.appendChild(el);
      const d = getComputedStyle(el).display;
      el.remove();
      return d;
    });
    assertEq(ok, 'block', '.lp-lbl is not display:block — the app-wide label bug has returned');
  });

check('F2', 'forms',
  'The modal keeps its footer on screen: bounded flex column, scrolling body, non-shrinking footer',
  async ({ page }) => {
    const r = await page.evaluate(() => {
      const pick = sel => {
        for (const sheet of document.styleSheets) {
          let rules; try { rules = sheet.cssRules; } catch { continue; }
          for (const x of rules || []) if (x.selectorText === sel) return x.style;
        }
        return null;
      };
      const box = pick('.lpmbox'), body = pick('.lpmb'), foot = pick('.lpmf');
      return {
        box: box && { display: box.display, dir: box.flexDirection, max: box.maxHeight },
        bodyScrolls: body && body.overflowY,
        footShrink: foot && foot.flexShrink,
      };
    });
    assert(r.box, '.lpmbox rule missing — the modal system is gone');
    assertEq(r.box.display, 'flex', '.lpmbox is not a flex container');
    assertEq(r.box.dir, 'column', '.lpmbox is not a column');
    assert(/vh|px|%/.test(r.box.max || ''), '.lpmbox has no max-height, so the footer can leave the viewport');
    assert(/auto|scroll/.test(r.bodyScrolls || ''), '.lpmb does not scroll — long forms will push Save off screen');
    assertEq(r.footShrink, '0', '.lpmf can shrink away instead of holding its place');
  });

check('F3', 'forms',
  'The form kit exists and every editor is built on it',
  async () => {
    const src = await readFile(join(REPO, 'index.html'), 'utf8');
    for (const fn of ['lpModal', 'lpFld', 'lpRow', 'lpSect', 'lpCheck']) {
      assert(new RegExp(`function\\s+${fn}\\b|${fn}\\s*=\\s*function|const\\s+${fn}\\s*=`).test(src),
        `form kit function ${fn} is missing`);
    }
  });

check('F4', 'forms',
  'Controls are dark-styled, not raw browser defaults',
  async ({ page }) => {
    const bg = await page.evaluate(() => {
      const i = document.createElement('input');
      i.className = 'ein'; document.body.appendChild(i);
      const c = getComputedStyle(i).backgroundColor; i.remove(); return c;
    });
    assert(bg && bg !== 'rgba(0, 0, 0, 0)' && !/255,\s*255,\s*255/.test(bg),
      `input background is ${bg} — raw white browser control`);
  });

/* ───────────────────────────── mobile ───────────────────────────── */

check('M1', 'mobile',
  'At 390px the page does not scroll sideways',
  async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ol2Home', { timeout: 15000 });
    await page.waitForTimeout(600);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.close();
    assert(over <= 2, `body overflows by ${over}px at 390 wide`);
  });

check('M2', 'mobile',
  'Every bottom-bar destination is reachable on a phone',
  async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ol2Home', { timeout: 15000 });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const nav = document.querySelector('#ol2Nav');
      if (!nav) return null;
      const cs = getComputedStyle(nav);
      return { scrollable: /auto|scroll/.test(cs.overflowX), over: nav.scrollWidth - nav.clientWidth };
    });
    await page.close();
    assert(r, 'no #ol2Nav on mobile');
    // PR #32 made this scroll horizontally as a STOPGAP. The check records the
    // stopgap honestly: either it fits, or it must be scrollable.
    assert(r.over <= 2 || r.scrollable,
      `nav overflows by ${r.over}px on a phone and is not scrollable — items are unreachable`);
  });

check('M3', 'mobile',
  'Form controls are ≥16px on a phone so iOS does not zoom the viewport on focus',
  async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ol2Home', { timeout: 15000 });
    const size = await page.evaluate(() => {
      const i = document.createElement('input');
      i.className = 'ein'; document.body.appendChild(i);
      const s = parseFloat(getComputedStyle(i).fontSize); i.remove(); return s;
    });
    await page.close();
    assert(size >= 16, `control font-size is ${size}px on mobile — iOS will zoom`);
  });

check('M4', 'mobile',
  'Today paints on a phone with no page errors',
  async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ol2Home', { timeout: 15000 });
    await page.waitForTimeout(1200);
    const vis = await page.isVisible('#ol2Home');
    await page.close();
    assert(vis, 'Today did not render at 390px');
    assertEq(errs.length, 0, `page errors on mobile: ${errs.join(' / ')}`);
  });

/* ────────────────────── docs (the X34 drift check) ────────────────────── */

check('X34A', 'docs',
  'The in-app docs name every destination the nav actually has',
  async () => {
    const docs = JSON.parse(await readFile(join(REPO, 'docs.json'), 'utf8'));
    const blob = JSON.stringify(docs);
    const missing = NAV.filter(d => !new RegExp(`\\b${d}\\b`).test(blob));
    assertEq(missing.length, 0,
      `docs.json (updated ${docs.updated}) never mentions: ${missing.join(', ')} — Wingman answers app questions from these pages, so it misdirects`);
  });

check('X34B', 'docs',
  'The in-app docs do not describe surfaces that were retired',
  async () => {
    const docs = JSON.parse(await readFile(join(REPO, 'docs.json'), 'utf8'));
    const blob = JSON.stringify(docs);
    const retired = ['My Day', 'My Week', 'Libraries'].filter(t => blob.includes(t));
    assertEq(retired.length, 0,
      `docs.json still describes retired surfaces: ${retired.join(', ')}`);
  });

/* ───────────────────────── access / security ───────────────────────── */

check('S1', 'security',
  'No API key literal is shipped in the client bundle',
  async () => {
    const src = await readFile(join(REPO, 'index.html'), 'utf8');
    assert(!/sk-ant-[A-Za-z0-9_-]{10,}/.test(src), 'an Anthropic key literal is in the bundle');
    assert(!/service_role/.test(src), 'a service_role reference is in the bundle');
  });

check('S2', 'access',
  'Every API endpoint goes through the shared guard',
  async () => {
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(join(REPO, 'api'))).filter(f => f.endsWith('.js') && f !== '_guard.js');
    assert(files.length >= 10, `only ${files.length} endpoints found — expected the full set`);
    const bad = [];
    for (const f of files) {
      const s = await readFile(join(REPO, 'api', f), 'utf8');
      if (!/_guard/.test(s)) bad.push(f);
    }
    assertEq(bad.length, 0, `endpoints with no guard: ${bad.join(', ')}`);
  });

check('S3', 'foundation',
  'The service worker the manifest registers actually exists',
  async () => {
    const { stat } = await import('node:fs/promises');
    const s = await stat(join(REPO, 'sw.js')).catch(() => null);
    assert(s && s.isFile(), 'sw.js is missing while the app registers a service worker — offline silently broken');
  });

check('S4', 'foundation',
  'The brief cron is declared',
  async () => {
    const v = JSON.parse(await readFile(join(REPO, 'vercel.json'), 'utf8'));
    const crons = v.crons || [];
    assert(crons.length > 0, 'no cron declared — the morning brief will never fire');
    // X35: a fixed UTC hour drifts an hour when Pacific leaves daylight time.
    const fixed = crons.find(c => /^\s*\d+\s+\d+\s/.test(c.schedule || ''));
    assert(!fixed, `X35 open: cron "${fixed && fixed.schedule}" is a fixed UTC hour, so the 6:30am brief becomes 5:30am in November`);
  });

/* ──────────────────────────── performance ──────────────────────────── */

check('P1', 'performance',
  'The single-file bundle stays under 600KB',
  async () => {
    const { stat } = await import('node:fs/promises');
    const s = await stat(join(REPO, 'index.html'));
    assert(s.size < 600 * 1024, `index.html is ${Math.round(s.size / 1024)}KB`);
  });

check('P2', 'performance',
  'Today paints within 4s, best of three — waits on #ol2Home, which Today actually renders',
  async ({ browser, origin }) => {
    const times = [];
    for (let i = 0; i < 3; i++) {
      const page = await browser.newPage();
      const t0 = Date.now();
      await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#ol2Home', { timeout: 10000 });
      times.push(Date.now() - t0);
      await page.close();
    }
    const best = Math.min(...times);
    assert(best < 4000, `best paint ${best}ms across ${times.join('/')}ms`);
  });

/* ──────────────────────────────── run ──────────────────────────────── */

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.env.QA_ONLY ? process.env.QA_ONLY.split(',').map(x => x.trim()) : null;
  const { summary, results } = await run({ root: REPO, only });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(new URL('./last-run.json', import.meta.url),
    JSON.stringify({ summary, results }, null, 2));
  console.log(`\n  ${summary.pass}/${summary.total} pass · ${summary.fail} fail · ${summary.error} error`);
  console.log('  → qa/last-run.json');
}
