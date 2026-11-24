'use strict';

/**
 * Pure ledger maths: no database, no HTTP. This is the heart of the system and the easiest part to test.
 *
 * Sign convention for a balance (paise):
 *   positive = the group owes this member money (they are a creditor)
 *   negative = this member owes the group money (they are a debtor)
 * The sum of all balances is always exactly zero.
 */

/**
 * @param {string[]} memberIds
 * @param {{paidBy: string, amount: number, splits: Object<string, number>}[]} expenses  amounts in paise
 * @param {{from: string, to: string, amount: number}[]} settlements  amounts in paise
 * @returns {Object<string, number>} memberId -> net balance in paise
 */
function calculateBalances(memberIds, expenses = [], settlements = []) {
  const balances = {};
  for (const id of memberIds) balances[id] = 0;

  for (const e of expenses) {
    balances[e.paidBy] += e.amount;
    for (const [id, share] of Object.entries(e.splits)) {
      balances[id] -= share;
    }
  }
  // A settlement is a real payment: `from` handed money to `to`, which reduces what `from` owes.
  for (const s of settlements) {
    balances[s.from] += s.amount;
    balances[s.to] -= s.amount;
  }
  return balances;
}

/**
 * Reduce a set of balances to a small list of payments that settles everyone.
 * Greedy: repeatedly match the biggest debtor with the biggest creditor.
 * Produces at most (number of non-zero balances - 1) payments.
 *
 * @param {Object<string, number>} balances
 * @returns {{from: string, to: string, amount: number}[]}
 */
function simplifyDebts(balances) {
  const creditors = [];
  const debtors = [];
  for (const id of Object.keys(balances).sort()) {
    if (balances[id] > 0) creditors.push({ id, amt: balances[id] });
    else if (balances[id] < 0) debtors.push({ id, amt: -balances[id] });
  }

  const payments = [];
  const byAmountThenId = (a, b) => b.amt - a.amt || (a.id < b.id ? -1 : 1);

  while (creditors.length && debtors.length) {
    creditors.sort(byAmountThenId);
    debtors.sort(byAmountThenId);
    const c = creditors[0];
    const d = debtors[0];
    const pay = Math.min(c.amt, d.amt);
    payments.push({ from: d.id, to: c.id, amount: pay });
    c.amt -= pay;
    d.amt -= pay;
    if (c.amt === 0) creditors.shift();
    if (d.amt === 0) debtors.shift();
  }
  return payments;
}

module.exports = { calculateBalances, simplifyDebts };
