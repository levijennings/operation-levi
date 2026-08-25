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

/* ─────────────────────── events (Preflight F6) ─────────────────────── */

// The emitter is deliberately on window. A module-scoped emitter cannot be
// reached from page.evaluate(), which is how this codebase has repeatedly
// produced guards that pass while testing nothing.

check('EV1', 'events',
  'The event emitter exists and stays silent when there is no workspace to write to',
  async ({ page }) => {
    const r = await page.evaluate(() => {
      if (typeof window.lpEvent !== 'function') return 'MISSING';
      window.__rows = [];
      window._lpSb = { from(){ return { insert(row){ window.__rows.push(row); return Promise.resolve({}); } }; } };
      window._lpWs = null;                       // signed out / local-only
      try { window.lpEvent('task.created', {}, 'x'); } catch (e) { return 'threw:' + e.message; }
      return window.__rows.length === 0 ? 'silent' : 'wrote with no workspace';
    });
    assertEq(r, 'silent', 'emitter misbehaved without a workspace');
  });

check('EV2', 'events',
  'An emitted event carries workspace, name, card, source and an idempotency id',
  async ({ page }) => {
    const r = await page.evaluate(() => {
      window.__rows = [];
      window._lpSb = { from(t){ return { insert(row){ window.__rows.push({ t, row }); return Promise.resolve({}); } }; } };
      window._lpWs = '00000000-0000-0000-0000-000000000001';
      window._lpUser = { id: null, name: 'Levi' };
      window.lpEvent('task.routed', { to: 'wingman' }, 'card-9');
      const n = window.__rows.length;
      for (let i = 0; i < 4; i++) window.lpEvent('task.routed', { to: 'wingman' }, 'card-9');
      const after = window.__rows.length;
      const r0 = window.__rows[0];
      return { n, after, tbl: r0 && r0.t, name: r0 && r0.row.name, card: r0 && r0.row.card_id,
               ws: !!(r0 && r0.row.workspace_id), src: r0 && r0.row.source,
               id: !!(r0 && r0.row.client_event_id) };
    });
    assertEq(r.tbl, 'app_events', 'wrong table');
    assertEq(r.name, 'task.routed', 'wrong event name');
    assertEq(r.card, 'card-9', 'card id not carried');
    assert(r.ws && r.src === 'client' && r.id, `row shape wrong: ${JSON.stringify(r)}`);
    assertEq(r.after, 1, 'the 2s suppression let a render loop through — counts would inflate');
  });

check('EV3', 'events',
  'Capturing a task through the real control logs task.created',
  async ({ page }) => {
    // Drives C -> type -> Continue -> Confirm. Does NOT call newItemBase or
    // capConfirm directly; both are module-scoped and calling them from
    // evaluate() would assert nothing.
    await page.evaluate(() => {
      window.__rows = [];
      window._lpSb = { from(t){ return { insert(row){ window.__rows.push({ t, row }); return Promise.resolve({}); } }; } };
      window._lpWs = '00000000-0000-0000-0000-000000000001';
      window._lpUser = { id: null, name: 'Levi' };
    });
    await page.keyboard.press('c');
    await page.waitForSelector('#ol2capTa', { state: 'visible', timeout: 8000 });
    await page.fill('#ol2capTa', 'QA guard: draft a one-page memo');
    await page.click('#ol2capCont');
    await page.waitForTimeout(1600);             // /api/structure 404s locally -> capParseLocal
    await page.click('#ol2capConfirm');
    await page.waitForTimeout(1400);
    const ev = await page.evaluate(() =>
      (window.__rows || []).map(r => r.row).find(r => r.name === 'task.created') || null);
    assert(ev, 'capturing a task logged no task.created event');
    assert(ev.card_id, 'task.created carries no card id');
    assertEq(ev.props.via, 'typed', 'capture source not recorded as typed');
  });

/* ───────────── real deliverables (F1/F2) and the phone bar (#12) ───────────── */

check('AT1', 'board',
  'Wingman guesses what a task produces, and the guess is marked as a guess',
  async ({ page }) => {
    // lpInferAssetType is module-scoped, so drive capture and then read the value
    // off the real control on the task detail.
    await page.keyboard.press('c');
    await page.waitForSelector('#ol2capTa', { state: 'visible', timeout: 8000 });
    await page.fill('#ol2capTa', 'Build the 2027 budget spreadsheet with quarterly projections');
    await page.click('#ol2capCont');
    await page.waitForTimeout(1600);
    await page.click('#ol2capConfirm');
    await page.waitForTimeout(1500);
    await page.keyboard.press('g'); await page.keyboard.press('m');
    await page.waitForSelector('#ol2Board .tcard', { timeout: 8000 });
    const opened = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#ol2Board .tcard')]
        .find(e => /budget spreadsheet/i.test(e.innerText));
      if (!el) return false; el.click(); return true;
    });
    assert(opened, 'the captured task is not on the board');
    await page.waitForSelector('#edAsset', { timeout: 8000 });
    const r = await page.evaluate(() => ({
      value: document.getElementById('edAsset').value,
      guessChip: /GUESS/.test(document.body.innerText)
    }));
    assertEq(r.value, 'spreadsheet', 'a task about a budget spreadsheet was not classified as one');
    assert(r.guessChip, 'the inferred type is not marked as a guess');
  });

check('F2A', 'board',
  'A markdown draft becomes a real .docx whose contents are the draft — not just a well-named empty file',
  async ({ page }) => {
    const r = await page.evaluate(async () => {
      const card = { id: 'probe-doc', title: 'Garage lighting brief', assetType: 'document',
        documents: [], aiArtifact: { content: '# Spec\n\n- 5000K daylight\n- Dimmable\n\nSix bulbs total.' } };
      let grabbed = null;
      window._lpSb = { storage: { from(){ return { async upload(path, file){
        grabbed = { path, size: file.size, type: file.type, text: await file.text() };
        return { error: null }; } }; } } };
      window._lpWs = '00000000-0000-0000-0000-000000000001';
      window.lpProduceFile(card);
      await new Promise(r => setTimeout(r, 300));
      return grabbed;
    });
    assert(r, 'nothing was uploaded');
    assert(/\.docx$/.test(r.path), `stored under the wrong name: ${r.path}`);
    assert(r.size > 800, `file is suspiciously small: ${r.size} bytes`);
    assertEq(r.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'wrong mime type');
    // The zip is store-only, so the document XML sits verbatim in the bytes.
    // Checking the file EXISTS is not checking it says anything — an earlier
    // version of this guard survived a mutation that dropped the title.
    assert(r.text.includes('word/document.xml'), 'the archive has no Word document part');
    assert(r.text.includes('Garage lighting brief'), 'the task title is missing from the document');
    assert(r.text.includes('5000K daylight'), "the draft's own content is missing from the document");
    assert(r.text.includes('Six bulbs total.'), 'the draft body did not make it into the document');
  });

check('F2B', 'board',
  'A markdown table becomes a real .xlsx, and a draft with no table is refused rather than shipped empty',
  async ({ page }) => {
    const r = await page.evaluate(() => {
      const mk = (content) => ({ id: 'p', title: 'Budget', assetType: 'spreadsheet',
        documents: [], aiArtifact: { content } });
      const seen = [];
      window._lpSb = { storage: { from(){ return { upload(path, file){ seen.push({ path, size: file.size });
        return Promise.resolve({ error: null }); } }; } } };
      window._lpWs = '00000000-0000-0000-0000-000000000001';
      window.lpProduceFile(mk('| Item | Qty |\n|---|---|\n| Bulbs | 6 |\n| Spares | 2 |'));
      const withTable = seen.length;
      const prose = mk('Just some prose with no table in it at all.');
      window.lpProduceFile(prose);
      return { withTable, afterProse: seen.length, proseDocs: prose.documents.length };
    });
    assertEq(r.withTable, 1, 'a table draft did not produce a spreadsheet');
    assertEq(r.afterProse, 1, 'a draft with no table produced a spreadsheet anyway — it would be empty');
    assertEq(r.proseDocs, 0, 'an empty spreadsheet was attached to the card');
  });

check('F2C', 'board',
  'The file lands on the card so the existing download control can reach it',
  async ({ page }) => {
    const r = await page.evaluate(async () => {
      const card = { id: 'p2', title: 'Memo', assetType: 'document', documents: [],
        aiArtifact: { content: 'Body text.' } };
      window._lpSb = { storage: { from(){ return { upload(p, f){ return Promise.resolve({ error: null }); } }; } } };
      window._lpWs = 'ws1';
      window.lpProduceFile(card);
      // The attach runs when the upload promise resolves, so wait for it rather
      // than reading the array on the same tick.
      await new Promise(r => setTimeout(r, 300));
      const d = card.documents[0] || {};
      return { n: card.documents.length, name: d.name, gen: d.generated, hasSize: d.size > 0 };
    });
    assertEq(r.n, 1, 'nothing attached to the card');
    assertEq(r.name, 'memo.docx', 'attachment is not named from the task');
    assert(r.gen === true, 'the attachment is not marked as generated');
    assert(r.hasSize, 'the attachment has no size');
  });

check('NAV1', 'mobile',
  'The phone bar holds five slots and never scrolls sideways',
  async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ol2Home', { timeout: 15000 });
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const nav = document.querySelector('#ol2Nav');
      const side = document.querySelector('.ol2 .side');
      const shown = [...nav.querySelectorAll('a')].filter(a => a.offsetParent !== null);
      return {
        count: shown.length,
        labels: shown.map(a => a.textContent.trim().replace(/\s+/g, ' ')),
        overflow: nav.scrollWidth - nav.clientWidth,
        // PR #32 made the WRAPPER scrollable as a stopgap. Decision #12 replaced
        // the stopgap with five real slots, so the wrapper must not scroll either
        // — measuring only the nav would let the old behaviour come back unseen.
        sideOverflow: side ? side.scrollWidth - side.clientWidth : -1,
        sideOverflowX: side ? getComputedStyle(side).overflowX : '',
        hasMore: !!document.getElementById('ol2NavMore')
      };
    });
    await page.close();
    assert(r.hasMore, 'no More entry on the phone bar');
    assert(r.count <= 5, `the bar shows ${r.count} items: ${r.labels.join(' / ')}`);
    assert(r.overflow <= 2, `the bar overflows by ${r.overflow}px — items are unreachable`);
    assert(r.sideOverflow <= 2, `the bar wrapper overflows by ${r.sideOverflow}px`);
    assert(r.sideOverflowX !== 'auto' && r.sideOverflowX !== 'scroll',
      `the bar wrapper is still horizontally scrollable (overflow-x:${r.sideOverflowX}) — that is the PR #32 stopgap, not a fix`);
    const joined = r.labels.join(' ').toLowerCase();
    for (const gone of ['goals', 'crew', 'settings'])
      assert(!joined.includes(gone), `${gone} is still taking a bar slot — it belongs in More`);
  });

check('NAV2', 'mobile',
  'More opens a sheet holding everything the bar cannot',
  async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ol2Home', { timeout: 15000 });
    await page.waitForTimeout(700);
    await page.click('#ol2NavMore');
    await page.waitForSelector('#ol2More', { timeout: 5000 });
    const txt = await page.evaluate(() => document.getElementById('ol2More').innerText.toLowerCase());
    for (const want of ['goals', 'crew', 'docs', 'settings', 'travel'])
      assert(txt.includes(want), `More is missing ${want}`);
    await page.click('#ol2More .mshc');
    const gone = await page.evaluate(() => !document.getElementById('ol2More'));
    await page.close();
    assert(gone, 'the More sheet does not close');
  });

/* ──────────────── one constructor, one cron (Aug 22 decisions) ──────────────── */

check('C1', 'board',
  'Capture builds its card through newItemBase — there is only one card constructor',
  async ({ page }) => {
    const src = await readFile(join(REPO, 'index.html'), 'utf8');
    // The inline literal that used to live in capConfirm is gone.
    assert(!/id:'v'\+Date\.now\(\)\.toString\(36\), type:'task'/.test(src),
      'capConfirm is building a card object inline again — two constructors will drift apart');
    assert(/var it=newItemBase\(capDraft\.title/.test(src),
      'capConfirm no longer calls newItemBase');
    // And the card it produces still carries what the constructor guarantees.
    await page.evaluate(() => {
      window.__rows = [];
      window._lpSb = { from(t){ return { insert(row){ window.__rows.push({ t, row }); return Promise.resolve({}); } }; } };
      window._lpWs = '00000000-0000-0000-0000-000000000001';
      window._lpUser = { id: null, name: 'Levi' };
    });
    await page.keyboard.press('c');
    await page.waitForSelector('#ol2capTa', { state: 'visible', timeout: 8000 });
    await page.fill('#ol2capTa', 'C1 guard: draft a one-page memo');
    await page.click('#ol2capCont');
    await page.waitForTimeout(1600);
    await page.click('#ol2capConfirm');
    await page.waitForTimeout(1400);
    const ev = await page.evaluate(() =>
      (window.__rows || []).map(r => r.row).filter(r => r.name === 'task.created'));
    assertEq(ev.length, 1,
      `capture logged ${ev.length} task.created events — one constructor should mean exactly one`);
  });

check('CR1', 'foundation',
  'The brief fires daily at both candidate UTC hours so 06:30 Pacific holds year-round',
  async () => {
    const v = JSON.parse(await readFile(join(REPO, 'vercel.json'), 'utf8'));
    const scheds = (v.crons || []).filter(c => c.path === '/api/brief').map(c => c.schedule).sort();
    assertEq(scheds.join(' | '), '30 13 * * * | 30 14 * * *',
      'the brief no longer fires at both candidate hours — it will drift an hour off daylight time');
    for (const s of scheds) assert(/^\d+ \d+ \* \* \*$/.test(s), `${s} is not a daily schedule`);
  });

check('CR2', 'foundation',
  'Exactly one of those firings gets through: at the wrong local hour the cron skips, at the right one it proceeds',
  async () => {
    // Behavioural, not textual. The first version of this guard only looked for
    // the presence of CRON_SKIP_LOCAL_GATE and friends — and survived a mutation
    // that turned the gate's condition into `if (false)`, which would send the
    // brief twice a day. Invoke the handler for real instead.
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const guardPath = req.resolve(join(REPO, 'api/_guard.js'));
    req.cache[guardPath] = { id: guardPath, filename: guardPath, loaded: true,
      exports: async () => null };
    const saved = { ...process.env };
    const prevFetch = global.fetch;
    let reachedWork = false;
    global.fetch = async () => { reachedWork = true; throw new Error('past the gate'); };
    const mkRes = () => { const r = { code: 0, body: null,
      setHeader(){}, status(c){ r.code = c; return r; }, json(b){ r.body = b; return r; } }; return r; };
    try {
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
      process.env.ANTHROPIC_API_KEY = 'x';
      process.env.CRON_SECRET = 'secret';
      delete process.env.CRON_SKIP_LOCAL_GATE;
      process.env.CRON_LOCAL_TZ = 'America/Los_Angeles';
      const brief = req(join(REPO, 'api/brief.js'));
      const cronReq = { method: 'GET', headers: { authorization: 'Bearer secret' } };

      // A time that is definitely NOT now in that zone: skip, and say why.
      const nowLocal = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles',
        hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      const wrong = nowLocal === '03:17' ? '04:18' : '03:17';
      process.env.CRON_LOCAL_HHMM = wrong;
      reachedWork = false;
      const r1 = mkRes(); await brief(cronReq, r1);
      assert(r1.body && r1.body.skipped === true,
        `at the wrong local hour the cron did not skip: ${JSON.stringify(r1.body)}`);
      assertEq(r1.body.reason, 'not_local_send_time', 'skip did not say why');
      assertEq(reachedWork, false, 'the cron did work before the gate decided');

      // The current local time: the gate must let it through.
      process.env.CRON_LOCAL_HHMM = nowLocal;
      reachedWork = false;
      const r2 = mkRes(); await brief(cronReq, r2);
      assert(!(r2.body && r2.body.skipped),
        'at the right local hour the cron skipped anyway — the brief would never send');
      assertEq(reachedWork, true, 'the cron did not proceed to do its work at the right hour');
    } finally {
      global.fetch = prevFetch;
      for (const k of ['SUPABASE_SERVICE_ROLE_KEY','ANTHROPIC_API_KEY','CRON_SECRET','CRON_LOCAL_HHMM','CRON_LOCAL_TZ','CRON_SKIP_LOCAL_GATE']) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  });

/* ─────────────── readability & conversation (Levi, Aug 22) ─────────────── */

async function openATask(page){
  await page.keyboard.press('g'); await page.keyboard.press('m');
  await page.waitForSelector('#ol2Board .tcard', { timeout: 8000 });
  await page.click('#ol2Board .tcard');
  await page.waitForSelector('#edNotes', { timeout: 8000 });
}

check('NG1', 'forms',
  'A long note is fully visible — the notes box grows instead of clipping at three lines',
  async ({ page }) => {
    await openATask(page);
    const r = await page.evaluate(() => {
      const en = document.getElementById('edNotes');
      en.value = Array.from({ length: 14 }, (_, i) => 'Line ' + (i + 1) + ': a sentence long enough to matter.').join('\n');
      en.dispatchEvent(new Event('input', { bubbles: true }));
      return { h: en.clientHeight, scroll: en.scrollHeight };
    });
    assert(r.scroll <= r.h + 3, `note is clipped: ${r.scroll}px of content in a ${r.h}px box`);
    assert(r.h > 200, `box is only ${r.h}px — it did not grow past the old 88px floor`);
  });

check('NG2', 'forms',
  'The notes box keeps growing as more is typed',
  async ({ page }) => {
    await openATask(page);
    const r = await page.evaluate(() => {
      const en = document.getElementById('edNotes');
      en.value = 'one line';
      en.dispatchEvent(new Event('input', { bubbles: true }));
      const before = en.clientHeight;
      en.value += '\n' + Array.from({ length: 10 }, (_, i) => 'added line ' + i).join('\n');
      en.dispatchEvent(new Event('input', { bubbles: true }));
      return { before, after: en.clientHeight, scroll: en.scrollHeight };
    });
    assert(r.after > r.before, `height did not change: ${r.before} -> ${r.after}`);
    assert(r.scroll <= r.after + 3, 'content still overflows after growing');
  });

check('AK1', 'wingman',
  'Ask Wingman keeps the conversation on screen instead of overwriting the last answer',
  async ({ page, origin }) => {
    await page.route('**/api/ask', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ answer: 'stub answer ' + Date.now() })
    }));
    await page.evaluate(() => { try { localStorage.removeItem('lpAskThread'); } catch (e) {} window._lpAsk = null; window._lpWs = null; });
    await page.locator('#ol2Nav').getByText('Docs', { exact: false }).first().click();
    await page.waitForSelector('#ol2AskIn', { timeout: 8000 });
    await page.fill('#ol2AskIn', 'first question about the review lane');
    await page.click('#ol2AskBtn'); await page.waitForTimeout(700);
    await page.fill('#ol2AskIn', 'second question about phones');
    await page.click('#ol2AskBtn'); await page.waitForTimeout(700);
    const seen = await page.evaluate(() => (document.getElementById('ol2AskOut') || {}).innerText || '');
    assert(/review lane/i.test(seen), 'the first question is gone — the answer box was overwritten');
    assert(/phones/i.test(seen), 'the second question is not on screen');
  });

check('AK2', 'wingman',
  'A follow-up question is sent with the earlier turns as context',
  async ({ page }) => {
    let lastBody = null;
    await page.route('**/api/ask', route => {
      try { lastBody = JSON.parse(route.request().postData() || '{}'); } catch (e) { lastBody = {}; }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ answer: 'stub' }) });
    });
    await page.evaluate(() => { try { localStorage.removeItem('lpAskThread'); } catch (e) {} window._lpAsk = null; window._lpWs = null; });
    await page.locator('#ol2Nav').getByText('Docs', { exact: false }).first().click();
    await page.waitForSelector('#ol2AskIn', { timeout: 8000 });
    await page.fill('#ol2AskIn', 'q one'); await page.click('#ol2AskBtn'); await page.waitForTimeout(700);
    await page.fill('#ol2AskIn', 'q two'); await page.click('#ol2AskBtn'); await page.waitForTimeout(700);
    assert(lastBody, 'no request captured');
    assert(Array.isArray(lastBody.history), 'the follow-up sent no history at all — Ask is still stateless');
    assertEq(lastBody.history.length, 2, 'the follow-up did not carry the previous exchange');
    assertEq(lastBody.history[0].role, 'user', 'history does not open with the user turn');
  });

check('AK4', 'wingman',
  'Signed in, a question is written to ask_turns so the conversation follows you to another device',
  async ({ page }) => {
    await page.route('**/api/ask', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ answer: 'stub answer' }) }));
    await page.evaluate(() => {
      window.__ins = []; window.__del = 0;
      window._lpSb = { from(tbl){ return {
        select(){ const q = { rows: [],
          eq(){ return q; }, order(){ return q; }, limit(){ return q; },
          then(ok){ ok({ data: q.rows, error: null }); return Promise.resolve(); } };
          return q; },
        insert(row){ window.__ins.push({ tbl, row }); return Promise.resolve({ error: null }); },
        delete(){ const d = { eq(){ return d; },
          then(ok){ window.__del++; ok({ error: null }); return Promise.resolve(); } }; return d; }
      }; } };
      window._lpWs = '00000000-0000-0000-0000-000000000001';
      window._lpUser = { id: '22222222-2222-2222-2222-222222222222', name: 'Levi' };
      window._lpAsk = null;
      try { localStorage.removeItem('lpAskThread'); } catch (e) {}
    });
    await page.locator('#ol2Nav').getByText('Docs', { exact: false }).first().click();
    await page.waitForSelector('#ol2AskIn', { timeout: 8000 });
    await page.fill('#ol2AskIn', 'does this reach my phone');
    await page.click('#ol2AskBtn');
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => ({
      // Filter to ask_turns: the same client also writes a wingman.asked row to
      // app_events, which is correct and must not be counted here.
      ins: window.__ins.filter(x => x.tbl === 'ask_turns')
             .map(x => ({ t: x.tbl, role: x.row.role, ws: !!x.row.workspace_id,
                          uid: !!x.row.user_id, c: String(x.row.content).slice(0, 24) })),
      events: window.__ins.filter(x => x.tbl === 'app_events').length,
      badge: (document.getElementById('ol2AskOut') || {}).innerText || ''
    }));
    assertEq(r.ins.length, 2, `expected the question and the answer to be written, got ${JSON.stringify(r.ins)}`);
    assertEq(r.ins[0].t, 'ask_turns', 'turns are not going to ask_turns');
    assertEq(r.ins[0].role, 'user', 'first written turn is not the question');
    assertEq(r.ins[1].role, 'assistant', 'second written turn is not the answer');
    assert(r.ins[0].ws && r.ins[0].uid, 'a turn was written without a workspace or user');
    assert(/follows you/i.test(r.badge), 'the UI does not tell the user the thread is synced');
    assertEq(r.events, 1, 'asking Wingman did not also emit its wingman.asked event');
  });

check('AK5', 'wingman',
  'Signed out, it says so instead of pretending to sync, and still keeps the thread locally',
  async ({ page }) => {
    await page.route('**/api/ask', route => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ answer: 'stub answer' }) }));
    await page.evaluate(() => {
      window._lpSb = null; window._lpWs = null; window._lpUser = null; window._lpAsk = null;
      try { localStorage.removeItem('lpAskThread'); } catch (e) {}
    });
    await page.locator('#ol2Nav').getByText('Docs', { exact: false }).first().click();
    await page.waitForSelector('#ol2AskIn', { timeout: 8000 });
    await page.fill('#ol2AskIn', 'offline question');
    await page.click('#ol2AskBtn');
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => ({
      badge: (document.getElementById('ol2AskOut') || {}).innerText || '',
      stored: (function(){ try { return JSON.parse(localStorage.getItem('lpAskThread') || '[]').length; }
                           catch(e){ return -1; } })()
    }));
    assert(/this device only/i.test(r.badge), 'signed out, the UI claims a sync that is not happening');
    assertEq(r.stored, 2, 'the thread was not kept locally when there was nowhere to sync it');
  });

check('AK3', 'wingman',
  'The server sanitises conversation history into a sequence the Messages API accepts',
  async () => {
    // Pure node. A malformed sequence makes Anthropic reject the whole request,
    // so a shorter valid history always beats a faithful invalid one.
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const guardPath = req.resolve(join(REPO, 'api/_guard.js'));
    req.cache[guardPath] = { id: guardPath, filename: guardPath, loaded: true,
      exports: async () => ({ id: 'u1' }) };
    const prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test';
    const prevFetch = global.fetch;
    let sent = null;
    global.fetch = async (_u, o) => { sent = JSON.parse(o.body);
      return { ok: true, json: async () => ({ content: [{ text: 'ok' }] }) }; };
    const ask = req(join(REPO, 'api/ask.js'));
    const mkRes = () => { const r = { code: 0, status(c){ r.code = c; return r; }, json(){ return r; } }; return r; };
    const roles = () => sent.messages.map(m => m.role).join(',');
    try {
      await ask({ body: { question: 'q', history: [
        { role: 'assistant', content: 'leading' },
        { role: 'user', content: 'a' }, { role: 'user', content: 'dupe' },
        { role: 'assistant', content: 'b' }, { role: 'user', content: 'dangling' }] } }, mkRes());
      assertEq(roles(), 'user,assistant,user', 'history was not normalised to a valid alternating sequence');
      await ask({ body: { question: 'q', history: 'nonsense' } }, mkRes());
      assertEq(roles(), 'user', 'a non-array history was not ignored safely');
      const many = Array.from({ length: 40 }, (_, i) =>
        [{ role: 'user', content: 'u' + i }, { role: 'assistant', content: 'a' + i }]).flat();
      await ask({ body: { question: 'q', history: many } }, mkRes());
      assert(sent.messages.length <= 13, `history is uncapped: ${sent.messages.length} messages`);
    } finally {
      global.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
    }
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
    // NOTE: this guard used to fail any fixed-hour UTC cron, because a lone one
    // drifts an hour when Pacific leaves daylight time (X35). That is now fixed
    // the other way round: TWO fixed-hour crons fire daily and a local-time gate
    // in api/brief.js lets exactly one through. Fixed hours are the design now,
    // so the old assertion would be asserting a belief we no longer hold.
    // CR1 and CR2 own the real contract.
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
