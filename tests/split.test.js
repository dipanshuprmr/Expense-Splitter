'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  largestRemainder, splitEqual, splitExact, splitPercent, splitShares, computeSplit,
} = require('../src/split');

const rejects = (fn, code) => assert.throws(fn, (e) => e.code === code, `expected error code ${code}`);
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

describe('split: equal', () => {
  test('UT-S01 divides evenly when possible', () => {
    assert.deepEqual(splitEqual(9000, ['a', 'b', 'c']), { a: 3000, b: 3000, c: 3000 });
  });

  test('UT-S02 Rs 100 across 3 people: leftover paisa goes to first id, total preserved', () => {
    const r = splitEqual(10000, ['a', 'b', 'c']);
    assert.deepEqual(r, { a: 3334, b: 3333, c: 3333 });
    assert.equal(sum(r), 10000);
  });

  test('UT-S03 leftover assignment is deterministic regardless of input order', () => {
    assert.deepEqual(splitEqual(10000, ['c', 'a', 'b']), { a: 3334, b: 3333, c: 3333 });
  });

  test('UT-S04 one paisa among three people: only one person gets it', () => {
    assert.deepEqual(splitEqual(1, ['a', 'b', 'c']), { a: 1, b: 0, c: 0 });
  });

  test('UT-S05 single participant bears the whole amount', () => {
    assert.deepEqual(splitEqual(12345, ['solo']), { solo: 12345 });
  });

  test('UT-S06 rejects empty, duplicate and non-array participant lists', () => {
    rejects(() => splitEqual(100, []), 'NO_PARTICIPANTS');
    rejects(() => splitEqual(100, undefined), 'NO_PARTICIPANTS');
    rejects(() => splitEqual(100, 'abc'), 'NO_PARTICIPANTS');
    rejects(() => splitEqual(100, ['a', 'a']), 'DUPLICATE_PARTICIPANT');
  });
});

describe('split: exact', () => {
  test('UT-S07 accepts amounts that add up to the total', () => {
    assert.deepEqual(splitExact(10000, { a: '40', b: '35.50', c: 24.5 }), { a: 4000, b: 3550, c: 2450 });
  });

  test('UT-S08 rejects amounts that do not add up (too low and too high)', () => {
    rejects(() => splitExact(10000, { a: 40, b: 40 }), 'SPLIT_SUM_MISMATCH');
    rejects(() => splitExact(10000, { a: 60, b: 60 }), 'SPLIT_SUM_MISMATCH');
  });

  test('UT-S09 rejects zero, negative or garbage per-person amounts', () => {
    rejects(() => splitExact(10000, { a: 100, b: 0 }), 'INVALID_AMOUNT');
    rejects(() => splitExact(10000, { a: 150, b: -50 }), 'INVALID_AMOUNT');
    rejects(() => splitExact(10000, { a: 'abc' }), 'INVALID_AMOUNT');
  });

  test('UT-S10 rejects empty or non-object input', () => {
    rejects(() => splitExact(10000, {}), 'NO_PARTICIPANTS');
    rejects(() => splitExact(10000, null), 'NO_PARTICIPANTS');
    rejects(() => splitExact(10000, [1, 2]), 'NO_PARTICIPANTS');
  });
});

describe('split: percentage', () => {
  test('UT-S11 splits 50/30/20 exactly', () => {
    assert.deepEqual(splitPercent(10000, { a: 50, b: 30, c: 20 }), { a: 5000, b: 3000, c: 2000 });
  });

  test('UT-S12 accepts decimal percentages that sum to 100 and preserves the total', () => {
    const r = splitPercent(10001, { a: '33.33', b: '33.33', c: '33.34' });
    assert.equal(sum(r), 10001);
  });

  test('UT-S13 rejects percentages that do not sum to exactly 100', () => {
    rejects(() => splitPercent(10000, { a: '33.33', b: '33.33', c: '33.33' }), 'PERCENT_SUM_INVALID');
    rejects(() => splitPercent(10000, { a: 60, b: 50 }), 'PERCENT_SUM_INVALID');
    rejects(() => splitPercent(10000, { a: 99 }), 'PERCENT_SUM_INVALID');
  });

  test('UT-S14 rejects zero, negative, non-numeric and over-precise percentages', () => {
    rejects(() => splitPercent(10000, { a: 100, b: 0 }), 'INVALID_PERCENT');
    rejects(() => splitPercent(10000, { a: 150, b: -50 }), 'INVALID_PERCENT');
    rejects(() => splitPercent(10000, { a: 'half', b: 50 }), 'INVALID_PERCENT');
    rejects(() => splitPercent(10000, { a: '50.001', b: '49.999' }), 'INVALID_PERCENT');
  });

  test('UT-S15 100 percent to a single person', () => {
    assert.deepEqual(splitPercent(777, { a: 100 }), { a: 777 });
  });

  test('UT-S16 one paisa split 50/50 goes to the lowest id', () => {
    assert.deepEqual(splitPercent(1, { b: 50, a: 50 }), { a: 1, b: 0 });
  });
});

describe('split: shares', () => {
  test('UT-S17 splits proportionally (2:3 of Rs 10)', () => {
    assert.deepEqual(splitShares(1000, { a: 2, b: 3 }), { a: 400, b: 600 });
  });

  test('UT-S18 distributes remainders so the total is preserved (1:1:1 of Rs 1)', () => {
    const r = splitShares(100, { a: 1, b: 1, c: 1 });
    assert.equal(sum(r), 100);
    assert.deepEqual(r, { a: 34, b: 33, c: 33 });
  });

  test('UT-S19 rejects zero, negative, fractional and string shares', () => {
    rejects(() => splitShares(100, { a: 0, b: 1 }), 'INVALID_SHARES');
    rejects(() => splitShares(100, { a: -1, b: 1 }), 'INVALID_SHARES');
    rejects(() => splitShares(100, { a: 1.5, b: 1 }), 'INVALID_SHARES');
    rejects(() => splitShares(100, { a: '2', b: 1 }), 'INVALID_SHARES');
  });

  test('UT-S20 a very lopsided ratio still sums correctly', () => {
    const r = splitShares(999, { a: 1, b: 1000 });
    assert.equal(sum(r), 999);
  });
});

describe('split: dispatcher', () => {
  test('UT-S21 computeSplit routes to the right strategy', () => {
    assert.deepEqual(computeSplit('equal', 200, ['a', 'b']), { a: 100, b: 100 });
    assert.deepEqual(computeSplit('exact', 200, { a: 0.5, b: 1.5 }), { a: 50, b: 150 });
    assert.deepEqual(computeSplit('percent', 200, { a: 25, b: 75 }), { a: 50, b: 150 });
    assert.deepEqual(computeSplit('shares', 200, { a: 1, b: 3 }), { a: 50, b: 150 });
  });

  test('UT-S22 rejects an unknown split type', () => {
    rejects(() => computeSplit('random', 100, ['a']), 'INVALID_SPLIT_TYPE');
    rejects(() => computeSplit(undefined, 100, ['a']), 'INVALID_SPLIT_TYPE');
  });

  test('UT-S24 leftover paisa goes to the person with the LARGEST fractional remainder (shares 1:2 of Rs 1)', () => {
    // exact parts are 33.33 and 66.67 paise: the spare paisa must go to the 66.67 side
    assert.deepEqual(splitShares(100, { a: 1, b: 2 }), { a: 33, b: 67 });
  });

  test('UT-S25 largest remainder rule also applies to percentages (33.33% / 66.67% of Rs 1)', () => {
    assert.deepEqual(splitPercent(100, { a: '33.33', b: '66.67' }), { a: 33, b: 67 });
    // 3 paise at 90/10: exact 2.7 and 0.3, so the 2.7 side rounds up and the 0.3 side stays at 0
    assert.deepEqual(splitPercent(3, { a: 90, b: 10 }), { a: 3, b: 0 });
  });

  test('UT-S23 largestRemainder keeps exact total for an awkward weight mix', () => {
    const r = largestRemainder(10000, { a: 1, b: 2, c: 4, d: 7 });
    assert.equal(sum(r), 10000);
    for (const v of Object.values(r)) assert.ok(v >= 0);
  });
});
