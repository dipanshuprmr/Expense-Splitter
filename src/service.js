'use strict';

const { validation, notFound } = require('./errors');
const { toMinor, fromMinor, formatINR } = require('./money');
const { computeSplit, SPLIT_TYPES } = require('./split');
const { calculateBalances, simplifyDebts } = require('./ledger');
const { transaction } = require('./db');

const CATEGORIES = ['general', 'food', 'travel', 'stay', 'shopping', 'bills', 'entertainment'];

function parseId(value, what = 'id') {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (!Number.isInteger(n) || n <= 0) throw validation('INVALID_ID', `${what} must be a positive whole number`);
  return n;
}

function cleanName(value, what, max) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw validation('INVALID_NAME', `${what} is required`);
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length > max) throw validation('INVALID_NAME', `${what} must be at most ${max} characters`);
  return name;
}

/**
 * Business logic layer. Talks to SQLite, delegates maths to split.js and ledger.js.
 */
class ExpenseService {
  constructor(db) {
    this.db = db;
  }

  // ---------- groups and members ----------

  createGroup({ name, members = [] } = {}) {
    const groupName = cleanName(name, 'Group name', 100);
    if (!Array.isArray(members)) throw validation('INVALID_MEMBERS', 'members must be a list of names');
    const names = members.map((m) => cleanName(m, 'Member name', 50));
    const lower = names.map((n) => n.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      throw validation('DUPLICATE_MEMBER', 'Member names must be unique within a group');
    }
    return transaction(this.db, () => {
      const { lastInsertRowid } = this.db.prepare('INSERT INTO groups (name) VALUES (?)').run(groupName);
      const groupId = Number(lastInsertRowid);
      for (const n of names) {
        this.db.prepare('INSERT INTO members (group_id, name) VALUES (?, ?)').run(groupId, n);
      }
      return this.getGroup(groupId);
    });
  }

  getGroup(groupIdRaw) {
    const groupId = parseId(groupIdRaw, 'Group id');
    const group = this.db.prepare('SELECT id, name, created_at FROM groups WHERE id = ?').get(groupId);
    if (!group) throw notFound('GROUP_NOT_FOUND', `Group ${groupId} does not exist`);
    const members = this.db.prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY id').all(groupId);
    return { id: group.id, name: group.name, createdAt: group.created_at, members: members.map((m) => ({ ...m })) };
  }

  addMember(groupIdRaw, name) {
    const group = this.getGroup(groupIdRaw);
    const memberName = cleanName(name, 'Member name', 50);
    const clash = this.db
      .prepare('SELECT id FROM members WHERE group_id = ? AND name = ? COLLATE NOCASE')
      .get(group.id, memberName);
    if (clash) throw validation('DUPLICATE_MEMBER', `"${memberName}" is already in this group`);
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO members (group_id, name) VALUES (?, ?)')
      .run(group.id, memberName);
    return { id: Number(lastInsertRowid), name: memberName };
  }

  // ---------- expenses ----------

  addExpense(groupIdRaw, body = {}) {
    const group = this.getGroup(groupIdRaw);
    const memberIds = new Set(group.members.map((m) => m.id));

    const description = cleanName(body.description, 'Description', 200);
    const amount = toMinor(body.amount);
    const paidBy = parseId(body.paidBy, 'paidBy');
    if (!memberIds.has(paidBy)) throw validation('NOT_A_MEMBER', `Member ${paidBy} is not in this group`);

    const splitType = body.splitType ?? 'equal';
    if (!SPLIT_TYPES.includes(splitType)) {
      throw validation('INVALID_SPLIT_TYPE', `Split type must be one of: ${SPLIT_TYPES.join(', ')}`);
    }
    const category = body.category ?? 'general';
    if (!CATEGORIES.includes(category)) {
      throw validation('INVALID_CATEGORY', `Category must be one of: ${CATEGORIES.join(', ')}`);
    }

    let splitInput;
    if (splitType === 'equal') {
      const list = body.participants ?? group.members.map((m) => m.id);
      if (!Array.isArray(list)) throw validation('NO_PARTICIPANTS', 'participants must be a list of member ids');
      splitInput = list.map((id) => parseId(id, 'Participant id'));
    } else {
      if (body.splits === null || typeof body.splits !== 'object' || Array.isArray(body.splits)) {
        throw validation('NO_PARTICIPANTS', 'splits must be an object of memberId -> value');
      }
      splitInput = {};
      for (const [key, value] of Object.entries(body.splits)) {
        splitInput[String(parseId(key, 'Participant id'))] = value;
      }
    }

    const participantIds = Array.isArray(splitInput) ? splitInput : Object.keys(splitInput).map(Number);
    for (const id of participantIds) {
      if (!memberIds.has(id)) throw validation('NOT_A_MEMBER', `Member ${id} is not in this group`);
    }

    const shares = computeSplit(splitType, amount, splitInput);

    return transaction(this.db, () => {
      const { lastInsertRowid } = this.db
        .prepare(
          'INSERT INTO expenses (group_id, description, amount, paid_by, split_type, category) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(group.id, description, amount, paidBy, splitType, category);
      const expenseId = Number(lastInsertRowid);
      const insert = this.db.prepare('INSERT INTO expense_splits (expense_id, member_id, amount) VALUES (?, ?, ?)');
      for (const [memberId, share] of Object.entries(shares)) insert.run(expenseId, Number(memberId), share);
      return this.getExpense(group.id, expenseId);
    });
  }

  getExpense(groupIdRaw, expenseIdRaw) {
    const groupId = parseId(groupIdRaw, 'Group id');
    const expenseId = parseId(expenseIdRaw, 'Expense id');
    const row = this.db
      .prepare('SELECT * FROM expenses WHERE id = ? AND group_id = ?')
      .get(expenseId, groupId);
    if (!row) throw notFound('EXPENSE_NOT_FOUND', `Expense ${expenseId} does not exist in group ${groupId}`);
    const splits = this.db
      .prepare('SELECT member_id, amount FROM expense_splits WHERE expense_id = ? ORDER BY member_id')
      .all(expenseId);
    return {
      id: row.id,
      groupId: row.group_id,
      description: row.description,
      amount: row.amount,
      amountFormatted: formatINR(row.amount),
      paidBy: row.paid_by,
      splitType: row.split_type,
      category: row.category,
      createdAt: row.created_at,
      splits: splits.map((s) => ({ memberId: s.member_id, amount: s.amount, amountFormatted: formatINR(s.amount) })),
    };
  }

  listExpenses(groupIdRaw) {
    const group = this.getGroup(groupIdRaw);
    const ids = this.db.prepare('SELECT id FROM expenses WHERE group_id = ? ORDER BY id').all(group.id);
    return ids.map((r) => this.getExpense(group.id, r.id));
  }

  deleteExpense(groupIdRaw, expenseIdRaw) {
    const expense = this.getExpense(groupIdRaw, expenseIdRaw);
    this.db.prepare('DELETE FROM expenses WHERE id = ?').run(expense.id);
    return { deleted: expense.id };
  }

  // ---------- settlements ----------

  addSettlement(groupIdRaw, body = {}) {
    const group = this.getGroup(groupIdRaw);
    const memberIds = new Set(group.members.map((m) => m.id));
    const from = parseId(body.from, 'from');
    const to = parseId(body.to, 'to');
    if (!memberIds.has(from)) throw validation('NOT_A_MEMBER', `Member ${from} is not in this group`);
    if (!memberIds.has(to)) throw validation('NOT_A_MEMBER', `Member ${to} is not in this group`);
    if (from === to) throw validation('SELF_SETTLEMENT', 'A member cannot settle with themselves');
    const amount = toMinor(body.amount);
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO settlements (group_id, from_member, to_member, amount) VALUES (?, ?, ?, ?)')
      .run(group.id, from, to, amount);
    return { id: Number(lastInsertRowid), from, to, amount, amountFormatted: formatINR(amount) };
  }

  listSettlements(groupIdRaw) {
    const group = this.getGroup(groupIdRaw);
    return this.db
      .prepare('SELECT id, from_member AS "from", to_member AS "to", amount FROM settlements WHERE group_id = ? ORDER BY id')
      .all(group.id)
      .map((s) => ({ ...s, amountFormatted: formatINR(s.amount) }));
  }

  // ---------- balances ----------

  getBalances(groupIdRaw) {
    const group = this.getGroup(groupIdRaw);
    const expenses = this.listExpenses(group.id).map((e) => ({
      paidBy: String(e.paidBy),
      amount: e.amount,
      splits: Object.fromEntries(e.splits.map((s) => [String(s.memberId), s.amount])),
    }));
    const settlements = this.listSettlements(group.id).map((s) => ({
      from: String(s.from),
      to: String(s.to),
      amount: s.amount,
    }));
    const memberIds = group.members.map((m) => String(m.id));
    const net = calculateBalances(memberIds, expenses, settlements);
    const names = Object.fromEntries(group.members.map((m) => [String(m.id), m.name]));

    return {
      groupId: group.id,
      totalSpent: expenses.reduce((s, e) => s + e.amount, 0),
      totalSpentFormatted: formatINR(expenses.reduce((s, e) => s + e.amount, 0)),
      balances: group.members.map((m) => ({
        memberId: m.id,
        name: m.name,
        net: net[String(m.id)],
        netFormatted: formatINR(net[String(m.id)]),
      })),
      simplified: simplifyDebts(net).map((p) => ({
        from: Number(p.from),
        fromName: names[p.from],
        to: Number(p.to),
        toName: names[p.to],
        amount: p.amount,
        amountFormatted: formatINR(p.amount),
        amountDecimal: fromMinor(p.amount),
      })),
    };
  }
}

module.exports = { ExpenseService, CATEGORIES, parseId };
