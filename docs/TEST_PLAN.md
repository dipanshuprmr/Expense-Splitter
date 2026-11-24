# Test Plan and Results

## 1. Scope

The system under test is the **Expense Splitter**: money handling, four split strategies (equal, exact, percentage, shares),
balance calculation, debt simplification, a SQLite-backed service layer, and a REST API.
The one-page web UI is checked manually (see the screenshots in the report); everything behind it is covered by automated tests.

## 2. Test strategy

| Level | What it proves | Tests |
|---|---|---|
| Unit | Each pure function behaves correctly on typical, boundary and invalid input | 53 |
| Property-based | Rules that must ALWAYS hold are true across thousands of random inputs (seeded, so failures are reproducible) | 9 |
| Integration | Business rules work together with a real SQLite database; transactions are atomic; constraints hold | 29 |
| End-to-end | A real HTTP server answers real requests: full user journeys, error codes, robustness | 25 |
| **Total** | | **116** |

### Techniques used
- **Equivalence partitioning and boundary value analysis:** amounts of 0, 0.01, the maximum allowed value and one paisa above it; 1 paisa split among 3 people; 100% to a single person.
- **Error guessing:** floating point artefacts (0.1 + 0.2), exponent notation (1e21), SQL-injection text, unicode and HTML in names, duplicate names that differ only by case.
- **Invariant / property testing:** balances always sum to zero; splits always sum to the expense total; following the suggested payments always settles everyone; the order of expenses never changes the result.
- **State and atomicity testing:** a rejected expense or group leaves no partial data; transactions roll back on failure; deleting an expense updates balances.
- **Isolation testing:** data from one group can never be read or deleted through another group.
- **Test-quality checks:** statement/branch coverage report, plus a mutation check (14 deliberate bugs injected, all detected).

## 3. Environment and how to run

Node.js 22.13 or newer (uses the built-in test runner and built-in SQLite; no packages to install).

```
npm test              # run all tests
npm run test:verbose  # list every test with a tick or cross
npm run coverage      # tests plus coverage table
node tools/mutation-check.js   # mutation check
```

## 4. Test cases

Result column reflects the last saved run (`docs/test-results.txt`): **116 of 116 passed**.

| ID | Level | Area | What is checked | Result |
|---|---|---|---|---|
| UT-M01 | Unit | Money parsing and formatting | converts whole and decimal rupee numbers | Pass |
| UT-M02 | Unit | Money parsing and formatting | avoids floating point drift and refuses float arithmetic artefacts | Pass |
| UT-M03 | Unit | Money parsing and formatting | accepts numeric strings, trims whitespace, allows trailing zeros | Pass |
| UT-M04 | Unit | Money parsing and formatting | rejects zero and negative amounts | Pass |
| UT-M05 | Unit | Money parsing and formatting | rejects non-numeric input | Pass |
| UT-M06 | Unit | Money parsing and formatting | rejects more than two decimal places | Pass |
| UT-M07 | Unit | Money parsing and formatting | enforces the maximum amount boundary | Pass |
| UT-M08 | Unit | Money parsing and formatting | allowZero option permits zero only | Pass |
| UT-M09 | Unit | Money parsing and formatting | fromMinor renders paise as a decimal string | Pass |
| UT-M10 | Unit | Money parsing and formatting | formatINR uses Indian digit grouping | Pass |
| UT-S01 | Unit | Split strategies | divides evenly when possible | Pass |
| UT-S02 | Unit | Split strategies | Rs 100 across 3 people: leftover paisa goes to first id, total preserved | Pass |
| UT-S03 | Unit | Split strategies | leftover assignment is deterministic regardless of input order | Pass |
| UT-S04 | Unit | Split strategies | one paisa among three people: only one person gets it | Pass |
| UT-S05 | Unit | Split strategies | single participant bears the whole amount | Pass |
| UT-S06 | Unit | Split strategies | rejects empty, duplicate and non-array participant lists | Pass |
| UT-S07 | Unit | Split strategies | accepts amounts that add up to the total | Pass |
| UT-S08 | Unit | Split strategies | rejects amounts that do not add up (too low and too high) | Pass |
| UT-S09 | Unit | Split strategies | rejects zero, negative or garbage per-person amounts | Pass |
| UT-S10 | Unit | Split strategies | rejects empty or non-object input | Pass |
| UT-S11 | Unit | Split strategies | splits 50/30/20 exactly | Pass |
| UT-S12 | Unit | Split strategies | accepts decimal percentages that sum to 100 and preserves the total | Pass |
| UT-S13 | Unit | Split strategies | rejects percentages that do not sum to exactly 100 | Pass |
| UT-S14 | Unit | Split strategies | rejects zero, negative, non-numeric and over-precise percentages | Pass |
| UT-S15 | Unit | Split strategies | 100 percent to a single person | Pass |
| UT-S16 | Unit | Split strategies | one paisa split 50/50 goes to the lowest id | Pass |
| UT-S17 | Unit | Split strategies | splits proportionally (2:3 of Rs 10) | Pass |
| UT-S18 | Unit | Split strategies | distributes remainders so the total is preserved (1:1:1 of Rs 1) | Pass |
| UT-S19 | Unit | Split strategies | rejects zero, negative, fractional and string shares | Pass |
| UT-S20 | Unit | Split strategies | a very lopsided ratio still sums correctly | Pass |
| UT-S21 | Unit | Split strategies | computeSplit routes to the right strategy | Pass |
| UT-S22 | Unit | Split strategies | rejects an unknown split type | Pass |
| UT-S24 | Unit | Split strategies | leftover paisa goes to the person with the LARGEST fractional remainder (shares 1:2 of Rs 1) | Pass |
| UT-S25 | Unit | Split strategies | largest remainder rule also applies to percentages (33.33% / 66.67% of Rs 1) | Pass |
| UT-S23 | Unit | Split strategies | largestRemainder keeps exact total for an awkward weight mix | Pass |
| UT-L01 | Unit | Balances and debt simplification | no expenses means everyone is at zero | Pass |
| UT-L02 | Unit | Balances and debt simplification | payer is credited the total and debited their own share | Pass |
| UT-L03 | Unit | Balances and debt simplification | payer who is not part of the split is simply owed the full amount | Pass |
| UT-L04 | Unit | Balances and debt simplification | several expenses accumulate and can cancel each other out | Pass |
| UT-L05 | Unit | Balances and debt simplification | a settlement reduces the debtor debt and the creditor credit | Pass |
| UT-L06 | Unit | Balances and debt simplification | a full settlement brings both balances to zero | Pass |
| UT-L07 | Unit | Balances and debt simplification | overpaying a settlement flips the direction of the debt | Pass |
| UT-L08 | Unit | Balances and debt simplification | balances always sum to zero | Pass |
| UT-L09 | Unit | Balances and debt simplification | nothing to settle returns an empty list | Pass |
| UT-L10 | Unit | Balances and debt simplification | two people produce one payment | Pass |
| UT-L11 | Unit | Balances and debt simplification | chain A->B->C collapses into one direct payment A->C | Pass |
| UT-L12 | Unit | Balances and debt simplification | several debtors paying one creditor | Pass |
| UT-L13 | Unit | Balances and debt simplification | one debtor paying several creditors | Pass |
| UT-L14 | Unit | Balances and debt simplification | never needs more than (people with a balance - 1) payments | Pass |
| UT-L15 | Unit | Balances and debt simplification | applying the payments settles every balance exactly | Pass |
| UT-L16 | Unit | Balances and debt simplification | does not modify its input | Pass |
| UT-L17 | Unit | Balances and debt simplification | result is deterministic when amounts tie | Pass |
| UT-L18 | Unit | Balances and debt simplification | all payments are positive and nobody pays themselves | Pass |
| PT-01 | Property-based | Random-input invariants (1000 runs each) | equal split always adds up to the total and differs by at most 1 paisa (1000 runs) | Pass |
| PT-02 | Property-based | Random-input invariants (1000 runs each) | share split always adds up to the total and never goes negative (1000 runs) | Pass |
| PT-03 | Property-based | Random-input invariants (1000 runs each) | percentage split always adds up to the total (1000 runs) | Pass |
| PT-04 | Property-based | Random-input invariants (1000 runs each) | exact split built from a random partition is accepted unchanged (1000 runs) | Pass |
| PT-05 | Property-based | Random-input invariants (1000 runs each) | fromMinor then toMinor returns the original value (1000 runs) | Pass |
| PT-06 | Property-based | Random-input invariants (1000 runs each) | balances always sum to exactly zero (1000 runs) | Pass |
| PT-07 | Property-based | Random-input invariants (1000 runs each) | following the simplified payments settles every balance (1000 runs) | Pass |
| PT-08 | Property-based | Random-input invariants (1000 runs each) | simplified payments never exceed (people with a balance - 1) (1000 runs) | Pass |
| PT-09 | Property-based | Random-input invariants (1000 runs each) | the order of expenses does not change the final balances (1000 runs) | Pass |
| IT-G01 | Integration | Service layer with real SQLite | creates a group with members | Pass |
| IT-G02 | Integration | Service layer with real SQLite | creates a group with no members and trims/collapses whitespace in names | Pass |
| IT-G03 | Integration | Service layer with real SQLite | rejects missing, blank and oversized group names | Pass |
| IT-G04 | Integration | Service layer with real SQLite | rejects duplicate member names (case-insensitive) at creation and later | Pass |
| IT-G05 | Integration | Service layer with real SQLite | allows the same member name in different groups | Pass |
| IT-G06 | Integration | Service layer with real SQLite | failed group creation leaves nothing behind (atomic) | Pass |
| IT-G07 | Integration | Service layer with real SQLite | getGroup reports not found and invalid ids | Pass |
| IT-G08 | Integration | Service layer with real SQLite | adding a member works and the new member can be used in expenses | Pass |
| IT-E01 | Integration | Service layer with real SQLite | equal split defaults to every member and stores shares in paise | Pass |
| IT-E02 | Integration | Service layer with real SQLite | equal split among a chosen subset only | Pass |
| IT-E03 | Integration | Service layer with real SQLite | exact, percent and shares splits are stored correctly | Pass |
| IT-E04 | Integration | Service layer with real SQLite | rejects invalid amounts | Pass |
| IT-E05 | Integration | Service layer with real SQLite | rejects missing or blank description | Pass |
| IT-E06 | Integration | Service layer with real SQLite | rejects a payer or participant who is not in the group | Pass |
| IT-E07 | Integration | Service layer with real SQLite | rejects missing payer, bad split type and bad category | Pass |
| IT-E08 | Integration | Service layer with real SQLite | rejects empty participants and missing splits maps | Pass |
| IT-E09 | Integration | Service layer with real SQLite | a rejected expense leaves no partial data behind (atomic) | Pass |
| IT-E10 | Integration | Service layer with real SQLite | deleting an expense removes it and its effect on balances | Pass |
| IT-E11 | Integration | Service layer with real SQLite | an expense cannot be read or deleted through a different group | Pass |
| IT-B01 | Integration | Service layer with real SQLite | balances for a new group are all zero with nothing to settle | Pass |
| IT-B02 | Integration | Service layer with real SQLite | balances and suggested payments after one expense | Pass |
| IT-B03 | Integration | Service layer with real SQLite | settling every suggested payment clears all balances | Pass |
| IT-B04 | Integration | Service layer with real SQLite | balances always sum to zero even with awkward rounding | Pass |
| IT-B05 | Integration | Service layer with real SQLite | rejects self settlement, outsiders, bad ids and bad amounts | Pass |
| IT-B06 | Integration | Service layer with real SQLite | settlements are listed with formatted amounts | Pass |
| IT-D01 | Integration | Database constraints and transactions | transaction commits when the callback succeeds and returns its value | Pass |
| IT-D02 | Integration | Database constraints and transactions | transaction rolls back every change when the callback throws | Pass |
| IT-D03 | Integration | Database constraints and transactions | database constraints reject bad data even if the service layer is bypassed | Pass |
| IT-D04 | Integration | Database constraints and transactions | deleting a group cascades to its members, expenses and splits | Pass |
| E2E-A01 | End-to-end | HTTP API with a real server | health check responds ok | Pass |
| E2E-A02 | End-to-end | HTTP API with a real server | meta lists split types and categories | Pass |
| E2E-A03 | End-to-end | HTTP API with a real server | the web page is served at / | Pass |
| E2E-A04 | End-to-end | HTTP API with a real server | unknown endpoints return 404, wrong methods return 405 | Pass |
| E2E-G01 | End-to-end | HTTP API with a real server | create a group returns 201 with members and ids | Pass |
| E2E-G02 | End-to-end | HTTP API with a real server | create a group with bad input returns 400 with an error code | Pass |
| E2E-G03 | End-to-end | HTTP API with a real server | fetching a missing group returns 404, a malformed id returns 400 | Pass |
| E2E-G04 | End-to-end | HTTP API with a real server | malformed JSON and non-object bodies are rejected with 400 | Pass |
| E2E-G05 | End-to-end | HTTP API with a real server | oversized request bodies are rejected with 413 | Pass |
| E2E-G06 | End-to-end | HTTP API with a real server | add a member, and reject a duplicate with 400 | Pass |
| E2E-G07 | End-to-end | HTTP API with a real server | SQL-injection style text is stored as plain text and does not break anything | Pass |
| E2E-E01 | End-to-end | HTTP API with a real server | Rs 100 split equally between 3 people gives 33.34 / 33.33 / 33.33 | Pass |
| E2E-E02 | End-to-end | HTTP API with a real server | all four split types work through the API | Pass |
| E2E-E03 | End-to-end | HTTP API with a real server | invalid expenses return 400 with specific error codes | Pass |
| E2E-E04 | End-to-end | HTTP API with a real server | expense in a group that does not exist returns 404 | Pass |
| E2E-E05 | End-to-end | HTTP API with a real server | delete an expense, then deleting it again returns 404 | Pass |
| E2E-E06 | End-to-end | HTTP API with a real server | an expense belonging to another group cannot be deleted via this group | Pass |
| E2E-B01 | End-to-end | HTTP API with a real server | add expenses, read balances, settle, and end at zero | Pass |
| E2E-B02 | End-to-end | HTTP API with a real server | the classic chain: A paid for B, B paid for C, so A and C settle directly | Pass |
| E2E-B03 | End-to-end | HTTP API with a real server | settlement validation: self, outsider and bad amount | Pass |
| E2E-B04 | End-to-end | HTTP API with a real server | deleting an expense updates balances immediately | Pass |
| E2E-X01 | End-to-end | HTTP API with a real server | an unexpected internal error returns a generic 500 and leaks no details | Pass |
| E2E-R01 | End-to-end | HTTP API with a real server | 50 expenses added at the same time are all stored and balances still sum to zero | Pass |
| E2E-R02 | End-to-end | HTTP API with a real server | two groups are completely independent | Pass |
| E2E-R03 | End-to-end | HTTP API with a real server | special characters and unicode in names round-trip safely | Pass |

## 5. Results summary

See `docs/test-results.txt` (full list), `docs/coverage-report.txt` (coverage) and `docs/mutation-report.txt` (mutation check).
