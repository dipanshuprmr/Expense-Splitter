'use strict';

/**
 * End-to-end API tests: a real HTTP server on a random port, a fresh in-memory database per test,
 * and real HTTP requests made with fetch. Nothing is mocked.
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { ExpenseService } = require('../src/service');
const { createServer } = require('../src/server');

let server;
let base;
let service;

before(async () => {
  service = new ExpenseService(openDb(':memory:'));
  server = createServer(service);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  // fresh data for every test while keeping the same server
  service.db.exec('DELETE FROM settlements; DELETE FROM expense_splits; DELETE FROM expenses; DELETE FROM members; DELETE FROM groups;');
});

async function call(method, path, body, rawBody) {
  const res = await fetch(base + path, {
    method,
    headers: body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: res.status, json, text };
}

async function newGroup(members = ['Rahul', 'Priya', 'Amit']) {
  const { json } = await call('POST', '/api/groups', { name: 'Goa Trip', members });
  return { id: json.id, ids: Object.fromEntries(json.members.map((m) => [m.name, m.id])) };
}

describe('API: basics', () => {
  test('E2E-A01 health check responds ok', async () => {
    const r = await call('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { status: 'ok' });
  });

  test('E2E-A02 meta lists split types and categories', async () => {
    const r = await call('GET', '/api/meta');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.splitTypes, ['equal', 'exact', 'percent', 'shares']);
    assert.ok(r.json.categories.includes('food'));
  });

  test('E2E-A03 the web page is served at /', async () => {
    const r = await call('GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.text, /Expense Splitter/);
  });

  test('E2E-A04 unknown endpoints return 404, wrong methods return 405', async () => {
    assert.equal((await call('GET', '/api/nothing')).status, 404);
    assert.equal((await call('GET', '/somewhere/else')).status, 404);
    const r = await call('DELETE', '/api/groups/1');
    assert.equal(r.status, 405);
    assert.equal(r.json.error.code, 'METHOD_NOT_ALLOWED');
    assert.equal((await call('PUT', '/api/groups')).status, 405);
  });
});

describe('API: groups', () => {
  test('E2E-G01 create a group returns 201 with members and ids', async () => {
    const r = await call('POST', '/api/groups', { name: 'Flat', members: ['A', 'B'] });
    assert.equal(r.status, 201);
    assert.equal(r.json.name, 'Flat');
    assert.equal(r.json.members.length, 2);
    assert.ok(Number.isInteger(r.json.id));
  });

  test('E2E-G02 create a group with bad input returns 400 with an error code', async () => {
    const r = await call('POST', '/api/groups', { name: '' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'INVALID_NAME');
  });

  test('E2E-G03 fetching a missing group returns 404, a malformed id returns 400', async () => {
    const missing = await call('GET', '/api/groups/999');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'GROUP_NOT_FOUND');
    const bad = await call('GET', '/api/groups/abc');
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'INVALID_ID');
  });

  test('E2E-G04 malformed JSON and non-object bodies are rejected with 400', async () => {
    const broken = await call('POST', '/api/groups', undefined, '{"name": ');
    assert.equal(broken.status, 400);
    assert.equal(broken.json.error.code, 'INVALID_JSON');
    const array = await call('POST', '/api/groups', undefined, '[1,2,3]');
    assert.equal(array.status, 400);
    assert.equal(array.json.error.code, 'INVALID_JSON');
  });

  test('E2E-G05 oversized request bodies are rejected with 413', async () => {
    const huge = JSON.stringify({ name: 'x'.repeat(200 * 1024) });
    const r = await call('POST', '/api/groups', undefined, huge);
    assert.equal(r.status, 413);
    assert.equal(r.json.error.code, 'PAYLOAD_TOO_LARGE');
  });

  test('E2E-G06 add a member, and reject a duplicate with 400', async () => {
    const g = await newGroup(['Rahul']);
    const ok = await call('POST', `/api/groups/${g.id}/members`, { name: 'Neha' });
    assert.equal(ok.status, 201);
    const dup = await call('POST', `/api/groups/${g.id}/members`, { name: 'neha' });
    assert.equal(dup.status, 400);
    assert.equal(dup.json.error.code, 'DUPLICATE_MEMBER');
  });

  test('E2E-G07 SQL-injection style text is stored as plain text and does not break anything', async () => {
    const evil = "Robert'); DROP TABLE groups;--";
    const created = await call('POST', '/api/groups', { name: evil, members: ['x'] });
    assert.equal(created.status, 201);
    const fetched = await call('GET', `/api/groups/${created.json.id}`);
    assert.equal(fetched.json.name, evil);
    const still = await call('GET', '/api/groups/' + created.json.id);
    assert.equal(still.status, 200);
  });
});

describe('API: expenses', () => {
  test('E2E-E01 Rs 100 split equally between 3 people gives 33.34 / 33.33 / 33.33', async () => {
    const g = await newGroup();
    const r = await call('POST', `/api/groups/${g.id}/expenses`, {
      description: 'Dinner', amount: 100, paidBy: g.ids.Rahul,
    });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.splits.map((s) => s.amountFormatted), ['₹33.34', '₹33.33', '₹33.33']);
  });

  test('E2E-E02 all four split types work through the API', async () => {
    const g = await newGroup();
    const { Rahul, Priya, Amit } = g.ids;
    const bodies = [
      { description: 'exact', amount: 100, paidBy: Rahul, splitType: 'exact', splits: { [Rahul]: 50, [Priya]: 30, [Amit]: 20 } },
      { description: 'percent', amount: 100, paidBy: Priya, splitType: 'percent', splits: { [Rahul]: '33.33', [Priya]: '33.33', [Amit]: '33.34' } },
      { description: 'shares', amount: 100, paidBy: Amit, splitType: 'shares', splits: { [Rahul]: 1, [Priya]: 1 } },
      { description: 'equal subset', amount: 100, paidBy: Amit, participants: [Priya, Amit] },
    ];
    for (const body of bodies) {
      const r = await call('POST', `/api/groups/${g.id}/expenses`, body);
      assert.equal(r.status, 201, `${body.description}: ${r.text}`);
      assert.equal(r.json.splits.reduce((s, x) => s + x.amount, 0), 10000);
    }
    const list = await call('GET', `/api/groups/${g.id}/expenses`);
    assert.equal(list.json.length, 4);
  });

  test('E2E-E03 invalid expenses return 400 with specific error codes', async () => {
    const g = await newGroup();
    const base = { description: 'x', paidBy: g.ids.Rahul };
    const cases = [
      [{ ...base, amount: 0 }, 'INVALID_AMOUNT'],
      [{ ...base, amount: -5 }, 'INVALID_AMOUNT'],
      [{ ...base, amount: 'ten' }, 'INVALID_AMOUNT'],
      [{ ...base, amount: 1.234 }, 'INVALID_AMOUNT'],
      [{ ...base, amount: 20_000_000 }, 'AMOUNT_TOO_LARGE'],
      [{ ...base, amount: 10, description: '' }, 'INVALID_NAME'],
      [{ ...base, amount: 10, paidBy: 9999 }, 'NOT_A_MEMBER'],
      [{ ...base, amount: 10, splitType: 'exact', splits: { [g.ids.Rahul]: 4 } }, 'SPLIT_SUM_MISMATCH'],
      [{ ...base, amount: 10, splitType: 'percent', splits: { [g.ids.Rahul]: 99 } }, 'PERCENT_SUM_INVALID'],
      [{ ...base, amount: 10, splitType: 'shares', splits: { [g.ids.Rahul]: 0 } }, 'INVALID_SHARES'],
      [{ ...base, amount: 10, splitType: 'banana' }, 'INVALID_SPLIT_TYPE'],
      [{ ...base, amount: 10, participants: [] }, 'NO_PARTICIPANTS'],
    ];
    for (const [body, code] of cases) {
      const r = await call('POST', `/api/groups/${g.id}/expenses`, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error.code, code, JSON.stringify(body));
    }
    assert.equal((await call('GET', `/api/groups/${g.id}/expenses`)).json.length, 0);
  });

  test('E2E-E04 expense in a group that does not exist returns 404', async () => {
    const r = await call('POST', '/api/groups/12345/expenses', { description: 'x', amount: 10, paidBy: 1 });
    assert.equal(r.status, 404);
  });

  test('E2E-E05 delete an expense, then deleting it again returns 404', async () => {
    const g = await newGroup();
    const e = await call('POST', `/api/groups/${g.id}/expenses`, { description: 'x', amount: 10, paidBy: g.ids.Rahul });
    const del = await call('DELETE', `/api/groups/${g.id}/expenses/${e.json.id}`);
    assert.equal(del.status, 200);
    assert.deepEqual(del.json, { deleted: e.json.id });
    const again = await call('DELETE', `/api/groups/${g.id}/expenses/${e.json.id}`);
    assert.equal(again.status, 404);
  });

  test('E2E-E06 an expense belonging to another group cannot be deleted via this group', async () => {
    const g1 = await newGroup();
    const g2 = await newGroup(['Solo']);
    const e = await call('POST', `/api/groups/${g1.id}/expenses`, { description: 'x', amount: 10, paidBy: g1.ids.Rahul });
    const r = await call('DELETE', `/api/groups/${g2.id}/expenses/${e.json.id}`);
    assert.equal(r.status, 404);
    assert.equal((await call('GET', `/api/groups/${g1.id}/expenses`)).json.length, 1);
  });
});

describe('API: balances and settling up (full user journey)', () => {
  test('E2E-B01 add expenses, read balances, settle, and end at zero', async () => {
    const g = await newGroup();
    const { Rahul, Priya, Amit } = g.ids;

    await call('POST', `/api/groups/${g.id}/expenses`, { description: 'Dinner', amount: 1200, paidBy: Rahul, category: 'food' });
    await call('POST', `/api/groups/${g.id}/expenses`, { description: 'Cab', amount: 450, paidBy: Priya, category: 'travel', participants: [Priya, Amit] });
    await call('POST', `/api/groups/${g.id}/expenses`, {
      description: 'Hotel', amount: 3000, paidBy: Amit, category: 'stay', splitType: 'shares',
      splits: { [Rahul]: 1, [Priya]: 1, [Amit]: 2 },
    });

    const bal = await call('GET', `/api/groups/${g.id}/balances`);
    assert.equal(bal.status, 200);
    assert.equal(bal.json.totalSpent, 465000);
    assert.equal(bal.json.balances.reduce((s, b) => s + b.net, 0), 0);
    assert.ok(bal.json.simplified.length >= 1 && bal.json.simplified.length <= 2);

    for (const p of bal.json.simplified) {
      const s = await call('POST', `/api/groups/${g.id}/settlements`, { from: p.from, to: p.to, amount: p.amountDecimal });
      assert.equal(s.status, 201);
    }
    const settled = await call('GET', `/api/groups/${g.id}/balances`);
    assert.ok(settled.json.balances.every((b) => b.net === 0));
    assert.deepEqual(settled.json.simplified, []);

    const list = await call('GET', `/api/groups/${g.id}/settlements`);
    assert.equal(list.json.length, bal.json.simplified.length);
  });

  test('E2E-B02 the classic chain: A paid for B, B paid for C, so A and C settle directly', async () => {
    const g = await newGroup(['A', 'B', 'C']);
    const { A, B, C } = g.ids;
    // B owes A 100 (A paid, only B involved); C owes B 100 (B paid, only C involved)
    await call('POST', `/api/groups/${g.id}/expenses`, { description: 'one', amount: 100, paidBy: A, participants: [B] });
    await call('POST', `/api/groups/${g.id}/expenses`, { description: 'two', amount: 100, paidBy: B, participants: [C] });
    const bal = await call('GET', `/api/groups/${g.id}/balances`);
    assert.equal(bal.json.simplified.length, 1);
    assert.deepEqual(
      [bal.json.simplified[0].fromName, bal.json.simplified[0].toName, bal.json.simplified[0].amount],
      ['C', 'A', 10000],
    );
  });

  test('E2E-B03 settlement validation: self, outsider and bad amount', async () => {
    const g = await newGroup();
    const { Rahul, Priya } = g.ids;
    const self = await call('POST', `/api/groups/${g.id}/settlements`, { from: Rahul, to: Rahul, amount: 10 });
    assert.equal(self.json.error.code, 'SELF_SETTLEMENT');
    const out = await call('POST', `/api/groups/${g.id}/settlements`, { from: Rahul, to: 9999, amount: 10 });
    assert.equal(out.json.error.code, 'NOT_A_MEMBER');
    const bad = await call('POST', `/api/groups/${g.id}/settlements`, { from: Rahul, to: Priya, amount: 0 });
    assert.equal(bad.json.error.code, 'INVALID_AMOUNT');
    assert.equal((await call('GET', `/api/groups/${g.id}/settlements`)).json.length, 0);
  });

  test('E2E-B04 deleting an expense updates balances immediately', async () => {
    const g = await newGroup();
    const e = await call('POST', `/api/groups/${g.id}/expenses`, { description: 'x', amount: 300, paidBy: g.ids.Rahul });
    assert.equal((await call('GET', `/api/groups/${g.id}/balances`)).json.simplified.length, 2);
    await call('DELETE', `/api/groups/${g.id}/expenses/${e.json.id}`);
    const after = await call('GET', `/api/groups/${g.id}/balances`);
    assert.equal(after.json.totalSpent, 0);
    assert.deepEqual(after.json.simplified, []);
  });
});

describe('API: unexpected failures', () => {
  test('E2E-X01 an unexpected internal error returns a generic 500 and leaks no details', async () => {
    const broken = createServer({ getGroup() { throw new Error('secret database path /var/db'); } });
    await new Promise((resolve) => broken.listen(0, '127.0.0.1', resolve));
    const originalError = console.error;
    console.error = () => {}; // the server logs the real error; keep test output clean
    try {
      const res = await fetch(`http://127.0.0.1:${broken.address().port}/api/groups/1`);
      const text = await res.text();
      assert.equal(res.status, 500);
      assert.equal(JSON.parse(text).error.code, 'INTERNAL_ERROR');
      assert.ok(!text.includes('secret'), 'internal error details must not be sent to the client');
    } finally {
      console.error = originalError;
      await new Promise((resolve) => broken.close(resolve));
    }
  });
});

describe('API: concurrency and robustness', () => {
  test('E2E-R01 50 expenses added at the same time are all stored and balances still sum to zero', async () => {
    const g = await newGroup();
    const payers = Object.values(g.ids);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => call('POST', `/api/groups/${g.id}/expenses`, {
        description: `Expense ${i}`, amount: Number(((i + 1) * 3.37).toFixed(2)), paidBy: payers[i % 3],
      })),
    );
    assert.ok(results.every((r) => r.status === 201));
    const list = await call('GET', `/api/groups/${g.id}/expenses`);
    assert.equal(list.json.length, 50);
    const bal = await call('GET', `/api/groups/${g.id}/balances`);
    assert.equal(bal.json.balances.reduce((s, b) => s + b.net, 0), 0);
  });

  test('E2E-R02 two groups are completely independent', async () => {
    const g1 = await newGroup(['A', 'B']);
    const g2 = await newGroup(['A', 'B']);
    await call('POST', `/api/groups/${g1.id}/expenses`, { description: 'x', amount: 100, paidBy: g1.ids.A });
    const other = await call('GET', `/api/groups/${g2.id}/balances`);
    assert.equal(other.json.totalSpent, 0);
    assert.ok(other.json.balances.every((b) => b.net === 0));
  });

  test('E2E-R03 special characters and unicode in names round-trip safely', async () => {
    const r = await call('POST', '/api/groups', { name: 'यात्रा ✈️ <script>alert(1)</script>', members: ['राहुल', 'Zoë'] });
    assert.equal(r.status, 201);
    const back = await call('GET', `/api/groups/${r.json.id}`);
    assert.equal(back.json.name, 'यात्रा ✈️ <script>alert(1)</script>');
    assert.deepEqual(back.json.members.map((m) => m.name), ['राहुल', 'Zoë']);
  });
});
