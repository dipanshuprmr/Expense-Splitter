'use strict';

/**
 * Mini mutation test.
 * For each "mutant" we copy the project to a temp folder, deliberately break ONE line of source code,
 * and run the whole test suite. A good test suite FAILS on every mutant ("killed").
 * A mutant that still passes ("survived") points at a gap in the tests.
 *
 * Usage: node tools/mutation-check.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

const MUTANTS = [
  { id: 'M01', file: 'src/money.js', desc: 'allow zero amounts', find: 'if (minor === 0 && !allowZero)', replace: 'if (minor < 0 && !allowZero)' },
  { id: 'M02', file: 'src/money.js', desc: 'maximum amount off by one paisa', find: 'if (minor > MAX_MINOR)', replace: 'if (minor > MAX_MINOR + 1)' },
  { id: 'M03', file: 'src/money.js', desc: 'Indian digit grouping becomes 3-digit grouping', find: '(\\d{2})+(?!\\d)', replace: '(\\d{3})+(?!\\d)' },
  { id: 'M04', file: 'src/split.js', desc: 'leftover paise go to the smallest remainder instead of the largest', find: 'remainders.sort((a, b) => b.rem - a.rem', replace: 'remainders.sort((a, b) => a.rem - b.rem' },
  { id: 'M05', file: 'src/split.js', desc: 'percentages below 100 are accepted', find: 'if (sum !== 10000)', replace: 'if (sum > 10000)' },
  { id: 'M06', file: 'src/split.js', desc: 'exact amounts below the total are accepted', find: 'if (sum !== totalMinor)', replace: 'if (sum > totalMinor)' },
  { id: 'M07', file: 'src/split.js', desc: 'duplicate participants are not detected', find: 'if (seen.has(id))', replace: 'if (false)' },
  { id: 'M08', file: 'src/ledger.js', desc: 'settlement moves money in the wrong direction', find: 'balances[s.from] += s.amount;', replace: 'balances[s.from] -= s.amount;' },
  { id: 'M09', file: 'src/money.js', desc: 'negative sign is ignored when parsing amounts', find: "const negative = text.startsWith('-');", replace: 'const negative = false;' },
  { id: 'M10', file: 'src/ledger.js', desc: 'smallest creditor matched first instead of the largest', find: 'const byAmountThenId = (a, b) => b.amt - a.amt', replace: 'const byAmountThenId = (a, b) => a.amt - b.amt' },
  { id: 'M11', file: 'src/service.js', desc: 'payer is no longer checked to be a group member', find: 'if (!memberIds.has(paidBy))', replace: 'if (false && !memberIds.has(paidBy))' },
  { id: 'M12', file: 'src/service.js', desc: 'self settlement is no longer rejected by the service', find: 'if (from === to)', replace: 'if (false)' },
  { id: 'M13', file: 'src/service.js', desc: 'whitespace in names is not normalised', find: ".replace(/\\s+/g, ' ')", replace: '' },
  { id: 'M14', file: 'src/server.js', desc: 'request body size limit effectively removed', find: 'if (size > MAX_BODY_BYTES)', replace: 'if (size > MAX_BODY_BYTES * 1000)' },
];

function copyProject(dest) {
  for (const entry of ['src', 'tests', 'public', 'package.json']) {
    fs.cpSync(path.join(root, entry), path.join(dest, entry), { recursive: true });
  }
}

function runTests(cwd) {
  return spawnSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--test', 'tests/**/*.test.js'],
    { cwd, encoding: 'utf8', timeout: 60_000 },
  );
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-'));
let killed = 0;
const lines = [];

try {
  // sanity check: the unmodified project must pass, otherwise the results mean nothing
  const base = path.join(work, 'baseline');
  fs.mkdirSync(base);
  copyProject(base);
  const baseline = runTests(base);
  if (baseline.status !== 0) {
    console.error('Baseline tests fail, fix them before running mutation checks.');
    process.exit(1);
  }
  lines.push('Baseline (unmodified code): all tests pass');
  lines.push('');

  for (const m of MUTANTS) {
    const dir = path.join(work, m.id);
    fs.mkdirSync(dir);
    copyProject(dir);
    const target = path.join(dir, m.file);
    const original = fs.readFileSync(target, 'utf8');
    const occurrences = original.split(m.find).length - 1;
    if (occurrences !== 1) {
      lines.push(`${m.id}  SKIPPED (pattern found ${occurrences} times)  ${m.desc}`);
      continue;
    }
    fs.writeFileSync(target, original.replace(m.find, () => m.replace));
    const result = runTests(dir);
    const isKilled = result.status !== 0; // failing tests or a timeout both count as detected
    if (isKilled) killed++;
    lines.push(`${m.id}  ${isKilled ? 'KILLED  ' : 'SURVIVED'}  ${m.file.padEnd(15)} ${m.desc}`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

const total = MUTANTS.length;
lines.push('');
lines.push(`Mutation score: ${killed}/${total} mutants killed (${Math.round((killed / total) * 100)}%)`);
console.log(lines.join('\n'));
process.exit(killed === total ? 0 : 2);
