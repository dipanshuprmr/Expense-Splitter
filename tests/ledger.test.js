'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { calculateBalances, simplifyDebts } = require('../src/ledger');

const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

describe('ledger: calculateBalances', () => {
  test('UT-L01 no expenses means everyone is at zero', () => {
    assert.deepEqual(calculateBalances(['a', 'b']), { a: 0, b: 0 });
  });

  test('UT-L02 payer is credited the total and debited their own share', () => {
    const expenses = [{ paidBy: 'a', amount: 9000, splits: { a: 3000, b: 3000, c: 3000 } }];
    assert.deepEqual(calculateBalances(['a', 'b', 'c'], expenses), { a: 6000, b: -3000, c: -3000 });
  });

  test('UT-L03 payer who is not part of the split is simply owed the full amount', () => {
    const expenses = [{ paidBy: 'a', amount: 5000, splits: { b: 5000 } }];
    assert.deepEqual(calculateBalances(['a', 'b'], expenses), { a: 5000, b: -5000 });
  });

  test('UT-L04 several expenses accumulate and can cancel each other out', () => {
    const expenses = [
      { paidBy: 'a', amount: 1000, splits: { a: 500, b: 500 } },
      { paidBy: 'b', amount: 1000, splits: { a: 500, b: 500 } },
    ];
    assert.deepEqual(calculateBalances(['a', 'b'], expenses), { a: 0, b: 0 });
  });

  test('UT-L05 a settlement reduces the debtor debt and the creditor credit', () => {
    const expenses = [{ paidBy: 'a', amount: 2000, splits: { a: 1000, b: 1000 } }];
    const settlements = [{ from: 'b', to: 'a', amount: 400 }];
    assert.deepEqual(calculateBalances(['a', 'b'], expenses, settlements), { a: 600, b: -600 });
  });

  test('UT-L06 a full settlement brings both balances to zero', () => {
    const expenses = [{ paidBy: 'a', amount: 2000, splits: { a: 1000, b: 1000 } }];
    const settlements = [{ from: 'b', to: 'a', amount: 1000 }];
    assert.deepEqual(calculateBalances(['a', 'b'], expenses, settlements), { a: 0, b: 0 });
  });

  test('UT-L07 overpaying a settlement flips the direction of the debt', () => {
    const expenses = [{ paidBy: 'a', amount: 2000, splits: { a: 1000, b: 1000 } }];
    const settlements = [{ from: 'b', to: 'a', amount: 1500 }];
    assert.deepEqual(calculateBalances(['a', 'b'], expenses, settlements), { a: -500, b: 500 });
  });

  test('UT-L08 balances always sum to zero', () => {
    const expenses = [
      { paidBy: 'a', amount: 10001, splits: { a: 3334, b: 3334, c: 3333 } },
      { paidBy: 'c', amount: 777, splits: { a: 100, b: 677 } },
    ];
    const settlements = [{ from: 'b', to: 'c', amount: 123 }];
    assert.equal(sum(calculateBalances(['a', 'b', 'c'], expenses, settlements)), 0);
  });
});

describe('ledger: simplifyDebts', () => {
  test('UT-L09 nothing to settle returns an empty list', () => {
    assert.deepEqual(simplifyDebts({}), []);
    assert.deepEqual(simplifyDebts({ a: 0, b: 0 }), []);
  });

  test('UT-L10 two people produce one payment', () => {
    assert.deepEqual(simplifyDebts({ a: 500, b: -500 }), [{ from: 'b', to: 'a', amount: 500 }]);
  });

  test('UT-L11 chain A->B->C collapses into one direct payment A->C', () => {
    // A owes B 100 and B owes C 100  =>  A: -100, B: 0, C: +100
    assert.deepEqual(simplifyDebts({ A: -100, B: 0, C: 100 }), [{ from: 'A', to: 'C', amount: 100 }]);
  });

  test('UT-L12 several debtors paying one creditor', () => {
    const payments = simplifyDebts({ a: 3000, b: -1000, c: -1000, d: -1000 });
    assert.equal(payments.length, 3);
    assert.ok(payments.every((p) => p.to === 'a' && p.amount === 1000));
  });

  test('UT-L13 one debtor paying several creditors', () => {
    const payments = simplifyDebts({ a: 700, b: 300, c: -1000 });
    assert.deepEqual(payments, [
      { from: 'c', to: 'a', amount: 700 },
      { from: 'c', to: 'b', amount: 300 },
    ]);
  });

  test('UT-L14 never needs more than (people with a balance - 1) payments', () => {
    const balances = { a: 1500, b: 500, c: -700, d: -900, e: -400 };
    const payments = simplifyDebts(balances);
    assert.ok(payments.length <= 4);
  });

  test('UT-L15 applying the payments settles every balance exactly', () => {
    const balances = { a: 1234, b: -234, c: 800, d: -1500, e: -300 };
    const after = { ...balances };
    for (const p of simplifyDebts(balances)) {
      after[p.from] += p.amount;
      after[p.to] -= p.amount;
    }
    assert.deepEqual(after, { a: 0, b: 0, c: 0, d: 0, e: 0 });
  });

  test('UT-L16 does not modify its input', () => {
    const balances = { a: 100, b: -100 };
    simplifyDebts(balances);
    assert.deepEqual(balances, { a: 100, b: -100 });
  });

  test('UT-L17 result is deterministic when amounts tie', () => {
    const first = simplifyDebts({ a: 500, b: 500, c: -500, d: -500 });
    const second = simplifyDebts({ d: -500, c: -500, b: 500, a: 500 });
    assert.deepEqual(first, second);
  });

  test('UT-L18 all payments are positive and nobody pays themselves', () => {
    const payments = simplifyDebts({ a: 10, b: 20, c: -5, d: -25 });
    for (const p of payments) {
      assert.ok(p.amount > 0);
      assert.notEqual(p.from, p.to);
    }
  });
});
