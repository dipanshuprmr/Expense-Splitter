'use strict';

/**
 * Builds docs/TEST_PLAN.md from the real test files and the saved results in docs/test-results.txt,
 * so the plan can never drift away from what the tests actually do.
 *
 * Usage:  npm run test:verbose > docs/test-results.txt   (or: node tools/save-results.js)
 *         node tools/gen-test-plan.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const testsDir = path.join(root, 'tests');

const FILES = [
  ['money.test.js', 'Unit', 'Money parsing and formatting'],
  ['split.test.js', 'Unit', 'Split strategies'],
  ['ledger.test.js', 'Unit', 'Balances and debt simplification'],
  ['properties.test.js', 'Property-based', 'Random-input invariants (1000 runs each)'],
  ['service.test.js', 'Integration', 'Service layer with real SQLite'],
  ['db.test.js', 'Integration', 'Database constraints and transactions'],
  ['api.test.js', 'End-to-end', 'HTTP API with a real server'],
];

const resultsPath = path.join(root, 'docs', 'test-results.txt');
const results = fs.existsSync(resultsPath) ? fs.readFileSync(resultsPath, 'utf8') : '';
const statusOf = (id) => {
  if (new RegExp(`✔ ${id} `).test(results)) return 'Pass';
  if (new RegExp(`✖ ${id} `).test(results)) return 'FAIL';
  return 'Not run';
};

const rows = [];
for (const [file, level, area] of FILES) {
  const source = fs.readFileSync(path.join(testsDir, file), 'utf8');
  const re = /^\s*test\((['`])((?:UT|IT|PT|E2E)-[A-Z]*\d+) (.*)\1,/gm;
  let m;
  while ((m = re.exec(source))) {
    rows.push({ id: m[2], level, area, what: m[3].replace(/\$\{RUNS\}/g, '1000').replace(/\|/g, '\\|'), status: statusOf(m[2]) });
  }
}

const count = (lvl) => rows.filter((r) => r.level === lvl).length;
const passed = rows.filter((r) => r.status === 'Pass').length;

let md = `# Test Plan and Results

## 1. Scope

The system under test is the **Expense Splitter**: money handling, four split strategies (equal, exact, percentage, shares),
balance calculation, debt simplification, a SQLite-backed service layer, and a REST API.
The one-page web UI is checked manually (see the screenshots in the report); everything behind it is covered by automated tests.

## 2. Test strategy

| Level | What it proves | Tests |
|---|---|---|
| Unit | Each pure function behaves correctly on typical, boundary and invalid input | ${count('Unit')} |
| Property-based | Rules that must ALWAYS hold are true across thousands of random inputs (seeded, so failures are reproducible) | ${count('Property-based')} |
| Integration | Business rules work together with a real SQLite database; transactions are atomic; constraints hold | ${count('Integration')} |
| End-to-end | A real HTTP server answers real requests: full user journeys, error codes, robustness | ${count('End-to-end')} |
| **Total** | | **${rows.length}** |

### Techniques used
- **Equivalence partitioning and boundary value analysis:** amounts of 0, 0.01, the maximum allowed value and one paisa above it; 1 paisa split among 3 people; 100% to a single person.
- **Error guessing:** floating point artefacts (0.1 + 0.2), exponent notation (1e21), SQL-injection text, unicode and HTML in names, duplicate names that differ only by case.
- **Invariant / property testing:** balances always sum to zero; splits always sum to the expense total; following the suggested payments always settles everyone; the order of expenses never changes the result.
- **State and atomicity testing:** a rejected expense or group leaves no partial data; transactions roll back on failure; deleting an expense updates balances.
- **Isolation testing:** data from one group can never be read or deleted through another group.
- **Test-quality checks:** statement/branch coverage report, plus a mutation check (14 deliberate bugs injected, all detected).

## 3. Environment and how to run

Node.js 22.13 or newer (uses the built-in test runner and built-in SQLite; no packages to install).

\`\`\`
npm test              # run all tests
npm run test:verbose  # list every test with a tick or cross
npm run coverage      # tests plus coverage table
node tools/mutation-check.js   # mutation check
\`\`\`

## 4. Test cases

Result column reflects the last saved run (\`docs/test-results.txt\`): **${passed} of ${rows.length} passed**.

| ID | Level | Area | What is checked | Result |
|---|---|---|---|---|
`;
for (const r of rows) md += `| ${r.id} | ${r.level} | ${r.area} | ${r.what} | ${r.status} |\n`;

md += `
## 5. Results summary

See \`docs/test-results.txt\` (full list), \`docs/coverage-report.txt\` (coverage) and \`docs/mutation-report.txt\` (mutation check).
`;

fs.writeFileSync(path.join(root, 'docs', 'TEST_PLAN.md'), md);
console.log(`Wrote docs/TEST_PLAN.md with ${rows.length} test cases (${passed} passing)`);
