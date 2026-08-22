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
