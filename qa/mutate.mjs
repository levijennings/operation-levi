// qa/mutate.mjs — mutation testing.
//
// The rule this file enforces: a guard that passes while testing nothing is
// worse than no guard. So we BREAK the subject, confirm the guard goes red,
// and restore. Every mutation below was chosen to hit load-bearing code — a
// mutation that changes nothing proves nothing, and that mistake has been made
// here before (.lp-lbl was mutated after it had already stopped governing the
// rebuilt forms; the date key-exclusion was mutated when stripDates already
// covered it).

import { cp, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPO = process.env.QA_REPO || '/tmp/ol';

// [check id, file, find, replace, what breaking it should mean]
const MUTATIONS = [
  ['N4', 'index.html', 'id="ol2RevN"', 'id="ol2RevN_x"',
   'the amber needs-review count disappears (the X36 regression)'],
  ['B1', 'index.html', 'Needs review', 'Awaiting sign-off',
   'the board column spec drifts'],
  ['B3', 'index.html', 'tadone', 'ta-done',
   'the hover complete control is renamed out from under the guard'],
  ['F1', 'index.html', '.lp-lbl{display:block', '.lp-lbl{display:inline',
   'labels sit beside their controls again — the app-wide form bug'],
  ['F2', 'index.html', '.lpmb{padding:18px 22px 20px;overflow-y:auto', '.lpmb{padding:18px 22px 20px;overflow-y:visible',
   'long forms push Save off the bottom of the modal'],
  ['S2', 'api/run.js', '_guard', '_noguard',
   'an endpoint stops going through the shared guard'],
  ['W20', 'index.html', 'lpSkillScore(', 'lpSkillScoreX(',
   'skill scoring is removed and matching falls back to whatever is first'],
  ['X34A', 'docs.json', 'Missions', 'Projects',
   'the docs stop naming a destination the nav has'],
  ['EV1', 'index.html', 'window.lpEvent = lpEvent;', 'window.lpEventX = lpEvent;',
   'the event emitter stops being reachable at all'],
  ['EV2', 'index.html', "if(_lpEvSeen[key] && (now - _lpEvSeen[key]) < 2000) return;", '',
   'the render-loop suppression is removed and every count inflates'],
  ['EV3', 'index.html', "      lpEvent('task.created', {\n        via: it.source || 'unknown',", "      ({}) && ('task.created', {\n        via: it.source || 'unknown',",
   'card creation stops being logged at the single constructor'],
  ['NG1', 'index.html', "el.style.height = Math.max(el.scrollHeight + 2, 44) + 'px';", "el.style.height = '88px';",
   'the notes box goes back to clipping long notes'],
  ['NG2', 'index.html', "if(t && t.tagName === 'TEXTAREA' && (t.classList.contains('ein') || t.classList.contains('etxt'))) lpGrow(t);", '',
   'text areas stop growing as you type'],
  ['AK2', 'index.html', 'question:q, history:history', 'question:q, history:[]',
   'Ask Wingman goes back to sending no context'],
  ['AK3', 'api/ask.js', 'if (msgs.length && msgs[msgs.length - 1].role === role) return;  // no doubles', '',
   'the server stops collapsing consecutive same-role turns'],
  ['AK4', 'index.html', "var q = window._lpSb.from('ask_turns').insert({", "var q = ({}).x || (function(){return null})() || (window._lpSb.from('ask_turns'), {\n            insert: function(){ return null; } }).insert({",
   'turns stop being written to the server and the thread is device-local again'],
  ['AK5', 'index.html', "? 'Synced — this conversation follows you to your phone'\n                             : 'This device only — sign in to sync'", "? 'Synced' : 'Synced'",
   'the UI claims a sync it is not doing when signed out'],
  ['C1', 'index.html', 'var it=newItemBase(capDraft.title', "var it={id:'v'+Date.now().toString(36), type:'task'}; var _unused=(capDraft.title",
   'capture goes back to building its own card object'],
  ['CR1', 'vercel.json', '"schedule": "30 14 * * *"', '"schedule": "30 14 * * 1"',
   'the second firing stops being daily and the brief drifts again'],
  ['CR2', 'api/brief.js', "if (localNow !== want) {", "if (false) {",
   'the local-time gate stops skipping, so the brief sends twice a day'],
  ['AT1', 'index.html', "['spreadsheet', /\\b(spreadsheet|budget", "['spreadsheet', /\\b(zzzspreadsheet|zzzbudget",
   'the classifier stops recognising a spreadsheet task'],
  ['F2A', 'index.html', "blocks.unshift({ type:'h1', text: card.title || 'Untitled' });", '',
   'the document loses its title heading'],
  ['F2B', 'index.html', "if(rows.length < 2){ toast('The draft has no table in it", "if(false){ toast('The draft has no table in it",
   'a draft with no table produces an empty spreadsheet anyway'],
  ['F2C', 'index.html', "card.documents.push({ name:name, size:bytes.length", "card.documents.slice().push({ name:name, size:bytes.length",
   'the produced file never lands on the card'],
  ['NAV1', 'index.html', '.ol2 .nav a[data-v="settings"], .ol2 .nav a[data-v="docs"]{display:none}', '.ol2 .nav a[data-v="zz"]{display:none}',
   'Settings and Docs take phone bar slots again'],
  ['NAV2', 'index.html', "var mb=document.getElementById('ol2NavMore'); if(mb) mb.onclick", "var mb=null; if(mb) mb.onclick",
   'the More button stops opening its sheet'],
  // The old ".side gets overflow-x:auto" mutation was RETIRED here. Once NAV1
  // measures every slot's rect against the viewport, whether the wrapper happens
  // to be scrollable proves nothing — an overflowing bar is caught either way.
  // A mutation that cannot fail is as useless as a guard that cannot fail.
  ['MOB1', 'index.html', 'grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto', 'grid-template-columns:1fr;grid-template-rows:1fr auto',
   'the phone grid track goes back to min-content and the main column renders ~590px wide inside a 390px phone, clipping body text mid-sentence'],
  ['NAV1', 'index.html', '.ol2 .nav a{flex:1 1 0;min-width:0;gap:4px', '.nav a{flex:1 1 0;min-width:0;gap:4px',
   'the mobile bar rules drop below `.ol2 .nav a` on specificity and the five slots silently never apply'],
  ['NAV1', 'index.html', '.ol2 .newt{display:none}', '.ol2 .newt{margin:0 0 0 auto;min-height:44px;padding:0 13px;white-space:nowrap;font-size:12.5px;flex-shrink:0}',
   'the duplicate New task button returns to the bar and squeezes every slot label into unreadability'],
  ['EV4', 'index.html', "if(res && res.error){ st.failed++;", "if(false){ st.failed++;",
   'a rejected event goes back to being swallowed silently — the exact failure that hid an empty table for a day'],
  ['EV5', 'index.html', "        lpEvent('app.loaded', {", "        (function(){}) && ('app.loaded', {",
   'the heartbeat stops firing and an empty events table becomes ambiguous again'],
  ['EV6', 'index.html', "<h3>Activity recording</h3>", "<h3>Hidden</h3>",
   'Settings stops telling anyone whether their activity is actually being recorded'],
];

const out = [];
for (const [id, file, find, replace, meaning] of MUTATIONS) {
  const dir = await mkdtemp(join(tmpdir(), 'qamut-'));
  await cp(REPO, dir, { recursive: true });
  const target = join(dir, file);
  const src = await readFile(target, 'utf8');
  if (!src.includes(find)) {
    out.push({ id, verdict: 'DEAD MUTATION', note: `"${find}" not present in ${file} — the mutation would change nothing, so it proves nothing` });
    await rm(dir, { recursive: true, force: true });
    continue;
  }
  await writeFile(target, src.split(find).join(replace));
  let status = 'pass';
  try {
    const { stdout } = await run('node', ['qa/suite.mjs'], {
      env: { ...process.env, QA_REPO: dir, QA_ONLY: id }, maxBuffer: 8e6,
    });
    status = /\bFAIL\b|\bERROR\b/.test(stdout) ? 'red' : 'pass';
  } catch { status = 'red'; }
  await rm(dir, { recursive: true, force: true });
  out.push({
    id, verdict: status === 'red' ? 'KILLED' : 'SURVIVED',
    note: status === 'red' ? `guard catches it: ${meaning}` : `⚠ guard did NOT notice that ${meaning}`,
  });
}

for (const r of out) console.log(`${r.verdict.padEnd(15)} ${r.id.padEnd(6)} ${r.note}`);
const bad = out.filter(r => r.verdict !== 'KILLED');
console.log(`\n${out.length - bad.length}/${out.length} mutations killed`);
await writeFile(new URL('./mutation-run.json', import.meta.url), JSON.stringify(out, null, 2));
if (bad.length) process.exitCode = 1;
