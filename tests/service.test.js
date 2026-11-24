'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { ExpenseService } = require('../src/service');

const rejects = (fn, code) => assert.throws(fn, (e) => e.code === code, `expected error code ${code}`);

let svc;
let group;
let ids; // { rahul, priya, amit }

beforeEach(() => {
  svc = new ExpenseService(openDb(':memory:'));
  group = svc.createGroup({ name: 'Goa Trip', members: ['Rahul', 'Priya', 'Amit'] });
  const byName = Object.fromEntries(group.members.map((m) => [m.name.toLowerCase(), m.id]));
  ids = byName;
});

describe('service: groups and members', () => {
  test('IT-G01 creates a group with members', () => {
    assert.equal(group.name, 'Goa Trip');
    assert.deepEqual(group.members.map((m) => m.name), ['Rahul', 'Priya', 'Amit']);
  });

  test('IT-G02 creates a group with no members and trims/collapses whitespace in names', () => {
    const g = svc.createGroup({ name: '  Flat   expenses  ' });
    assert.equal(g.name, 'Flat expenses');
    assert.deepEqual(g.members, []);
  });

  test('IT-G03 rejects missing, blank and oversized group names', () => {
    rejects(() => svc.createGroup({}), 'INVALID_NAME');
    rejects(() => svc.createGroup({ name: '   ' }), 'INVALID_NAME');
    rejects(() => svc.createGroup({ name: 'x'.repeat(101) }), 'INVALID_NAME');
    rejects(() => svc.createGroup({ name: 42 }), 'INVALID_NAME');
  });

  test('IT-G04 rejects duplicate member names (case-insensitive) at creation and later', () => {
    rejects(() => svc.createGroup({ name: 'G', members: ['Asha', 'asha'] }), 'DUPLICATE_MEMBER');
    rejects(() => svc.addMember(group.id, 'RAHUL'), 'DUPLICATE_MEMBER');
  });

  test('IT-G05 allows the same member name in different groups', () => {
    const other = svc.createGroup({ name: 'Other', members: ['Rahul'] });
    assert.equal(other.members[0].name, 'Rahul');
  });

  test('IT-G06 failed group creation leaves nothing behind (atomic)', () => {
    rejects(() => svc.createGroup({ name: 'Bad', members: ['ok', ''] }), 'INVALID_NAME');
    rejects(() => svc.getGroup(2), 'GROUP_NOT_FOUND');
  });

  test('IT-G07 getGroup reports not found and invalid ids', () => {
    rejects(() => svc.getGroup(999), 'GROUP_NOT_FOUND');
    rejects(() => svc.getGroup('abc'), 'INVALID_ID');
    rejects(() => svc.getGroup(0), 'INVALID_ID');
    rejects(() => svc.getGroup(-3), 'INVALID_ID');
    rejects(() => svc.getGroup(1.5), 'INVALID_ID');
  });

  test('IT-G08 adding a member works and the new member can be used in expenses', () => {
    const m = svc.addMember(group.id, 'Neha');
    const e = svc.addExpense(group.id, { description: 'Snacks', amount: 80, paidBy: m.id });
    assert.equal(e.splits.length, 4);
  });
});

describe('service: expenses', () => {
  test('IT-E01 equal split defaults to every member and stores shares in paise', () => {
    const e = svc.addExpense(group.id, { description: 'Dinner', amount: 100, paidBy: ids.rahul });
    assert.equal(e.amount, 10000);
    assert.deepEqual(e.splits.map((s) => s.amount), [3334, 3333, 3333]);
    assert.equal(e.splitType, 'equal');
    assert.equal(e.category, 'general');
  });

  test('IT-E02 equal split among a chosen subset only', () => {
    const e = svc.addExpense(group.id, {
      description: 'Cab', amount: '250.50', paidBy: ids.amit, participants: [ids.amit, ids.priya],
    });
    assert.deepEqual(e.splits.map((s) => s.amount), [12525, 12525]);
  });

  test('IT-E03 exact, percent and shares splits are stored correctly', () => {
    const exact = svc.addExpense(group.id, {
      description: 'Hotel', amount: 1000, paidBy: ids.rahul, splitType: 'exact',
      splits: { [ids.rahul]: 500, [ids.priya]: 300, [ids.amit]: 200 },
    });
    assert.deepEqual(exact.splits.map((s) => s.amount), [50000, 30000, 20000]);

    const pct = svc.addExpense(group.id, {
      description: 'Fuel', amount: 200, paidBy: ids.priya, splitType: 'percent',
      splits: { [ids.rahul]: 50, [ids.priya]: 25, [ids.amit]: 25 },
    });
    assert.deepEqual(pct.splits.map((s) => s.amount), [10000, 5000, 5000]);

    const shares = svc.addExpense(group.id, {
      description: 'Stay', amount: 90, paidBy: ids.amit, splitType: 'shares',
      splits: { [ids.rahul]: 1, [ids.priya]: 2, [ids.amit]: 3 },
    });
    assert.deepEqual(shares.splits.map((s) => s.amount), [1500, 3000, 4500]);
  });

  test('IT-E04 rejects invalid amounts', () => {
    for (const amount of [0, -10, 'abc', null, undefined, '12.345']) {
      rejects(() => svc.addExpense(group.id, { description: 'x', amount, paidBy: ids.rahul }), 'INVALID_AMOUNT');
    }
  });

  test('IT-E05 rejects missing or blank description', () => {
    rejects(() => svc.addExpense(group.id, { amount: 10, paidBy: ids.rahul }), 'INVALID_NAME');
    rejects(() => svc.addExpense(group.id, { description: '  ', amount: 10, paidBy: ids.rahul }), 'INVALID_NAME');
    rejects(() => svc.addExpense(group.id, { description: 'x'.repeat(201), amount: 10, paidBy: ids.rahul }), 'INVALID_NAME');
  });

  test('IT-E06 rejects a payer or participant who is not in the group', () => {
    const outsider = svc.createGroup({ name: 'Elsewhere', members: ['Zed'] }).members[0].id;
    rejects(() => svc.addExpense(group.id, { description: 'x', amount: 10, paidBy: outsider }), 'NOT_A_MEMBER');
    rejects(() => svc.addExpense(group.id, { description: 'x', amount: 10, paidBy: 999 }), 'NOT_A_MEMBER');
    rejects(
      () => svc.addExpense(group.id, { description: 'x', amount: 10, paidBy: ids.rahul, participants: [ids.rahul, outsider] }),
      'NOT_A_MEMBER',
    );
    rejects(
      () => svc.addExpense(group.id, {
        description: 'x', amount: 10, paidBy: ids.rahul, splitType: 'shares', splits: { [outsider]: 1 },
      }),
      'NOT_A_MEMBER',
    );
  });

  test('IT-E07 rejects missing payer, bad split type and bad category', () => {
    rejects(() => svc.addExpense(group.id, { description: 'x', amount: 10 }), 'INVALID_ID');
    rejects(() => svc.addExpense(group.id, { description: 'x', amount: 10, paidBy: ids.rahul, splitType: 'weird' }), 'INVALID_SPLIT_TYPE');
    rejects(() => svc.addExpense(group.id, { description: 'x', amount: 10, paidBy: ids.rahul, category: 'gambling' }), 'INVALID_CATEGORY');
  });

  test('IT-E08 rejects empty participants and missing splits maps', () => {
    rejects(() => svc.addExpense(group.id, { description: 'x', amount: 10, paidBy: ids.rahul, participants: [] }), 'NO_PARTICIPANTS');
    rejects(() => svc.addExpense(group.id, { description: 'x', amount: 10, paidBy: ids.rahul, splitType: 'exact' }), 'NO_PARTICIPANTS');
    rejects(() => svc.addExpense(group.id, { description: 'x', amount: 10, paidBy: ids.rahul, splitType: 'percent', splits: [] }), 'NO_PARTICIPANTS');
  });

  test('IT-E09 a rejected expense leaves no partial data behind (atomic)', () => {
    rejects(() => svc.addExpense(group.id, {
      description: 'Bad percents', amount: 100, paidBy: ids.rahul, splitType: 'percent',
      splits: { [ids.rahul]: 60, [ids.priya]: 60 },
    }), 'PERCENT_SUM_INVALID');
    assert.deepEqual(svc.listExpenses(group.id), []);
  });

  test('IT-E10 deleting an expense removes it and its effect on balances', () => {
    const e = svc.addExpense(group.id, { description: 'Dinner', amount: 300, paidBy: ids.rahul });
    assert.equal(svc.getBalances(group.id).balances.find((b) => b.name === 'Rahul').net, 20000);
    svc.deleteExpense(group.id, e.id);
    assert.deepEqual(svc.listExpenses(group.id), []);
    assert.ok(svc.getBalances(group.id).balances.every((b) => b.net === 0));
    rejects(() => svc.deleteExpense(group.id, e.id), 'EXPENSE_NOT_FOUND');
  });

  test('IT-E11 an expense cannot be read or deleted through a different group', () => {
    const other = svc.createGroup({ name: 'Other', members: ['Q'] });
    const e = svc.addExpense(group.id, { description: 'Dinner', amount: 300, paidBy: ids.rahul });
    rejects(() => svc.getExpense(other.id, e.id), 'EXPENSE_NOT_FOUND');
    rejects(() => svc.deleteExpense(other.id, e.id), 'EXPENSE_NOT_FOUND');
    assert.equal(svc.listExpenses(group.id).length, 1);
  });
});

describe('service: settlements and balances', () => {
  test('IT-B01 balances for a new group are all zero with nothing to settle', () => {
    const b = svc.getBalances(group.id);
    assert.equal(b.totalSpent, 0);
    assert.ok(b.balances.every((x) => x.net === 0));
    assert.deepEqual(b.simplified, []);
  });

  test('IT-B02 balances and suggested payments after one expense', () => {
    svc.addExpense(group.id, { description: 'Dinner', amount: 300, paidBy: ids.rahul });
    const b = svc.getBalances(group.id);
    assert.equal(b.totalSpent, 30000);
    assert.equal(b.totalSpentFormatted, '₹300.00');
    // equal debts: ties are broken by member id, so Priya (id 2) comes before Amit (id 3)
    assert.deepEqual(b.simplified.map((p) => [p.fromName, p.toName, p.amount]), [
      ['Priya', 'Rahul', 10000],
      ['Amit', 'Rahul', 10000],
    ]);
  });

  test('IT-B03 settling every suggested payment clears all balances', () => {
    svc.addExpense(group.id, { description: 'Dinner', amount: 100, paidBy: ids.rahul });
    svc.addExpense(group.id, { description: 'Cab', amount: '45.50', paidBy: ids.priya, splitType: 'shares', splits: { [ids.rahul]: 1, [ids.amit]: 2 } });
    for (const p of svc.getBalances(group.id).simplified) {
      svc.addSettlement(group.id, { from: p.from, to: p.to, amount: p.amountDecimal });
    }
    const after = svc.getBalances(group.id);
    assert.ok(after.balances.every((b) => b.net === 0));
    assert.deepEqual(after.simplified, []);
  });

  test('IT-B04 balances always sum to zero even with awkward rounding', () => {
    svc.addExpense(group.id, { description: 'A', amount: '100.00', paidBy: ids.rahul });
    svc.addExpense(group.id, { description: 'B', amount: '0.01', paidBy: ids.priya });
    svc.addExpense(group.id, { description: 'C', amount: '9999999.99', paidBy: ids.amit });
    const total = svc.getBalances(group.id).balances.reduce((s, b) => s + b.net, 0);
    assert.equal(total, 0);
  });

  test('IT-B05 rejects self settlement, outsiders, bad ids and bad amounts', () => {
    const outsider = svc.createGroup({ name: 'Elsewhere', members: ['Zed'] }).members[0].id;
    rejects(() => svc.addSettlement(group.id, { from: ids.rahul, to: ids.rahul, amount: 10 }), 'SELF_SETTLEMENT');
    rejects(() => svc.addSettlement(group.id, { from: ids.rahul, to: outsider, amount: 10 }), 'NOT_A_MEMBER');
    rejects(() => svc.addSettlement(group.id, { from: outsider, to: ids.rahul, amount: 10 }), 'NOT_A_MEMBER');
    rejects(() => svc.addSettlement(group.id, { to: ids.rahul, amount: 10 }), 'INVALID_ID');
    rejects(() => svc.addSettlement(group.id, { from: ids.amit, to: ids.rahul, amount: 0 }), 'INVALID_AMOUNT');
    rejects(() => svc.addSettlement(group.id, { from: ids.amit, to: ids.rahul, amount: -5 }), 'INVALID_AMOUNT');
  });

  test('IT-B06 settlements are listed with formatted amounts', () => {
    svc.addSettlement(group.id, { from: ids.amit, to: ids.rahul, amount: '1234.5' });
    const list = svc.listSettlements(group.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].amount, 123450);
    assert.equal(list[0].amountFormatted, '₹1,234.50');
  });
});
