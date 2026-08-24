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
  ['EV3', 'index.html', "lpEvent('task.created', {\n        via: it.source || 'unknown',\n        category: it.category || '',\n        has_deliverable: !!(it.deliverable && String(it.deliverable).trim()),\n        owner: it.responsible || '',\n        mode: capMode || ''\n      }, it.id);", '',
   'capturing a task stops being logged'],
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
