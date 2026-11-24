'use strict';

/**
 * Property-based tests: instead of hand-picked examples, generate thousands of random
 * inputs and check that rules which must ALWAYS hold really do hold.
 * A seeded generator is used so any failure is reproducible (same seed -> same inputs).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { toMinor, fromMinor, MAX_MINOR } = require('../src/money');
const { splitEqual, splitPercent, splitShares, splitExact } = require('../src/split');
const { calculateBalances, simplifyDebts } = require('../src/ledger');

const SEED = 20261125;
const RUNS = 1000;

// mulberry32: tiny, fast, deterministic PRNG
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const makeHelpers = (rng) => {
  const int = (min, max) => min + Math.floor(rng() * (max - min + 1));
  const ids = (n) => Array.from({ length: n }, (_, i) => `m${String(i).padStart(2, '0')}`);
  const sum = (o) => Object.values(o).reduce((x, y) => x + y, 0);
  return { int, ids, sum };
};

describe('properties: splitting', () => {
  test(`PT-01 equal split always adds up to the total and differs by at most 1 paisa (${RUNS} runs)`, () => {
    const rng = makeRng(SEED);
    const { int, ids, sum } = makeHelpers(rng);
    for (let i = 0; i < RUNS; i++) {
      const total = int(1, 100_000_000);
      const members = ids(int(1, 12));
      const parts = splitEqual(total, members);
      assert.equal(sum(parts), total, `total mismatch for ${total} / ${members.length}`);
      const values = Object.values(parts);
      assert.ok(Math.max(...values) - Math.min(...values) <= 1);
    }
  });

  test(`PT-02 share split always adds up to the total and never goes negative (${RUNS} runs)`, () => {
    const rng = makeRng(SEED + 1);
    const { int, ids, sum } = makeHelpers(rng);
    for (let i = 0; i < RUNS; i++) {
      const total = int(1, 100_000_000);
      const weights = {};
      for (const id of ids(int(1, 10))) weights[id] = int(1, 50);
      const parts = splitShares(total, weights);
      assert.equal(sum(parts), total);
      assert.ok(Object.values(parts).every((v) => v >= 0));
    }
  });

  test(`PT-03 percentage split always adds up to the total (${RUNS} runs)`, () => {
    const rng = makeRng(SEED + 2);
    const { int, ids, sum } = makeHelpers(rng);
    for (let i = 0; i < RUNS; i++) {
      const total = int(1, 100_000_000);
      const n = int(1, 8);
      // random cut points that partition 10000 basis points (100.00%) into n positive pieces
      const cuts = new Set();
      while (cuts.size < n - 1) cuts.add(int(1, 9999));
      const edges = [0, ...[...cuts].sort((a, b) => a - b), 10000];
      const percents = {};
      ids(n).forEach((id, k) => { percents[id] = fromMinor(edges[k + 1] - edges[k]); });
      assert.equal(sum(splitPercent(total, percents)), total);
    }
  });

  test(`PT-04 exact split built from a random partition is accepted unchanged (${RUNS} runs)`, () => {
    const rng = makeRng(SEED + 3);
    const { int, ids } = makeHelpers(rng);
    for (let i = 0; i < RUNS; i++) {
      const n = int(1, 8);
      const cuts = new Set();
      const total = int(n, 10_000_000);
      while (cuts.size < n - 1) cuts.add(int(1, total - 1));
      const edges = [0, ...[...cuts].sort((a, b) => a - b), total];
      const amounts = {};
      const expected = {};
      ids(n).forEach((id, k) => {
        expected[id] = edges[k + 1] - edges[k];
        amounts[id] = fromMinor(expected[id]);
      });
      assert.deepEqual(splitExact(total, amounts), expected);
    }
  });
});

describe('properties: money', () => {
  test(`PT-05 fromMinor then toMinor returns the original value (${RUNS} runs)`, () => {
    const rng = makeRng(SEED + 4);
    const { int } = makeHelpers(rng);
    for (let i = 0; i < RUNS; i++) {
      const minor = int(1, MAX_MINOR);
      assert.equal(toMinor(fromMinor(minor)), minor);
    }
  });
});

describe('properties: ledger', () => {
  // Build a random group with random expenses (all four split styles collapsed to valid share maps)
  function randomGroup(rng) {
    const { int, ids } = makeHelpers(rng);
    const members = ids(int(2, 8));
    const expenses = [];
    for (let e = int(0, 12); e > 0; e--) {
      const total = int(1, 5_000_000);
      const involved = members.filter(() => rng() < 0.6);
      const participants = involved.length ? involved : [members[0]];
      expenses.push({ paidBy: members[int(0, members.length - 1)], amount: total, splits: splitEqual(total, participants) });
    }
    const settlements = [];
    for (let s = int(0, 4); s > 0; s--) {
      const from = members[int(0, members.length - 1)];
      let to = members[int(0, members.length - 1)];
      if (to === from) to = members[(members.indexOf(from) + 1) % members.length];
      settlements.push({ from, to, amount: int(1, 100_000) });
    }
    return { members, expenses, settlements };
  }

  test(`PT-06 balances always sum to exactly zero (${RUNS} runs)`, () => {
    const rng = makeRng(SEED + 5);
    for (let i = 0; i < RUNS; i++) {
      const { members, expenses, settlements } = randomGroup(rng);
      const balances = calculateBalances(members, expenses, settlements);
      assert.equal(Object.values(balances).reduce((a, b) => a + b, 0), 0);
    }
  });

  test(`PT-07 following the simplified payments settles every balance (${RUNS} runs)`, () => {
    const rng = makeRng(SEED + 6);
    for (let i = 0; i < RUNS; i++) {
      const { members, expenses, settlements } = randomGroup(rng);
      const balances = calculateBalances(members, expenses, settlements);
      const after = { ...balances };
      for (const p of simplifyDebts(balances)) {
        after[p.from] += p.amount;
        after[p.to] -= p.amount;
      }
      assert.ok(Object.values(after).every((v) => v === 0));
    }
  });

  test(`PT-08 simplified payments never exceed (people with a balance - 1) (${RUNS} runs)`, () => {
    const rng = makeRng(SEED + 7);
    for (let i = 0; i < RUNS; i++) {
      const { members, expenses, settlements } = randomGroup(rng);
      const balances = calculateBalances(members, expenses, settlements);
      const nonZero = Object.values(balances).filter((v) => v !== 0).length;
      const payments = simplifyDebts(balances);
      assert.ok(payments.length <= Math.max(nonZero - 1, 0), `${payments.length} payments for ${nonZero} people`);
      assert.ok(payments.every((p) => p.amount > 0 && p.from !== p.to));
    }
  });

  test(`PT-09 the order of expenses does not change the final balances (${RUNS} runs)`, () => {
    const rng = makeRng(SEED + 8);
    for (let i = 0; i < RUNS; i++) {
      const { members, expenses, settlements } = randomGroup(rng);
      const forward = calculateBalances(members, expenses, settlements);
      const reversed = calculateBalances(members, [...expenses].reverse(), [...settlements].reverse());
      assert.deepEqual(forward, reversed);
    }
  });
});
