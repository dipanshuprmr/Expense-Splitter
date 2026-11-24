'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { openDb, transaction } = require('../src/db');

const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

describe('database layer', () => {
  test('IT-D01 transaction commits when the callback succeeds and returns its value', () => {
    const db = openDb(':memory:');
    const result = transaction(db, () => {
      db.prepare('INSERT INTO groups (name) VALUES (?)').run('kept');
      return 'done';
    });
    assert.equal(result, 'done');
    assert.equal(count(db, 'groups'), 1);
  });

  test('IT-D02 transaction rolls back every change when the callback throws', () => {
    const db = openDb(':memory:');
    assert.throws(
      () => transaction(db, () => {
        db.prepare('INSERT INTO groups (name) VALUES (?)').run('a');
        db.prepare('INSERT INTO groups (name) VALUES (?)').run('b');
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.equal(count(db, 'groups'), 0);
  });

  test('IT-D03 database constraints reject bad data even if the service layer is bypassed', () => {
    const db = openDb(':memory:');
    db.prepare('INSERT INTO groups (name) VALUES (?)').run('g');
    db.prepare('INSERT INTO members (group_id, name) VALUES (1, ?)').run('Asha');
    // duplicate name (case-insensitive) in the same group
    assert.throws(() => db.prepare('INSERT INTO members (group_id, name) VALUES (1, ?)').run('ASHA'));
    // member of a group that does not exist (foreign key)
    assert.throws(() => db.prepare('INSERT INTO members (group_id, name) VALUES (99, ?)').run('Ghost'));
    // non-positive expense amount
    assert.throws(() => db.prepare(
      "INSERT INTO expenses (group_id, description, amount, paid_by, split_type) VALUES (1, 'x', 0, 1, 'equal')",
    ).run());
    // unknown split type
    assert.throws(() => db.prepare(
      "INSERT INTO expenses (group_id, description, amount, paid_by, split_type) VALUES (1, 'x', 10, 1, 'nonsense')",
    ).run());
    // settlement with yourself
    assert.throws(() => db.prepare(
      'INSERT INTO settlements (group_id, from_member, to_member, amount) VALUES (1, 1, 1, 10)',
    ).run());
  });

  test('IT-D04 deleting a group cascades to its members, expenses and splits', () => {
    const db = openDb(':memory:');
    db.prepare('INSERT INTO groups (name) VALUES (?)').run('g');
    db.prepare('INSERT INTO members (group_id, name) VALUES (1, ?)').run('A');
    db.prepare("INSERT INTO expenses (group_id, description, amount, paid_by, split_type) VALUES (1, 'x', 100, 1, 'equal')").run();
    db.prepare('INSERT INTO expense_splits (expense_id, member_id, amount) VALUES (1, 1, 100)').run();
    db.prepare('DELETE FROM groups WHERE id = 1').run();
    for (const table of ['members', 'expenses', 'expense_splits']) assert.equal(count(db, table), 0, table);
  });
});
