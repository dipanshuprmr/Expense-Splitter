'use strict';

const { validation } = require('./errors');

/**
 * All money inside the system is an integer number of paise (minor units).
 * Floating point is only used at the edges (parsing input, formatting output).
 */

// 1 crore rupees. Keeps every intermediate multiplication far below 2^53.
const MAX_MINOR = 1_000_000_000;

/**
 * Convert a rupee amount (number or numeric string) into integer paise.
 * Rejects NaN, non-numeric text, zero, negatives, more than 2 decimals, and huge values.
 */
function toMinor(amount, { allowZero = false } = {}) {
  if (amount === null || amount === undefined || amount === '' || typeof amount === 'boolean') {
    throw validation('INVALID_AMOUNT', 'Amount is required');
  }
  const text = typeof amount === 'number' ? numberToPlainString(amount) : String(amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw validation('INVALID_AMOUNT', `Amount "${amount}" is not a valid number`);
  }
  const negative = text.startsWith('-');
  const [whole, frac = ''] = text.replace('-', '').split('.');
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) {
    throw validation('INVALID_AMOUNT', 'Amount cannot have more than 2 decimal places');
  }
  const minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (negative && minor !== 0) {
    throw validation('INVALID_AMOUNT', 'Amount cannot be negative');
  }
  if (minor === 0 && !allowZero) {
    throw validation('INVALID_AMOUNT', 'Amount must be greater than zero');
  }
  if (minor > MAX_MINOR) {
    throw validation('AMOUNT_TOO_LARGE', 'Amount exceeds the supported maximum');
  }
  return minor;
}

// Avoid exponent notation such as 1e-7 or 1e21 when a JS number is passed in.
function numberToPlainString(n) {
  if (!Number.isFinite(n)) throw validation('INVALID_AMOUNT', 'Amount must be a finite number');
  // toFixed() falls back to exponent notation from 1e21 upwards, so reject these before formatting.
  if (Math.abs(n) >= 1e21) throw validation('AMOUNT_TOO_LARGE', 'Amount exceeds the supported maximum');
  if (n !== 0 && Math.abs(n) < 1e-6) return n.toFixed(10);
  return String(n);
}

/** Integer paise -> "1234.50" */
function fromMinor(minor) {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Integer paise -> "₹1,234.50" (Indian digit grouping) */
function formatINR(minor) {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const rupees = String(Math.floor(abs / 100));
  const paise = String(abs % 100).padStart(2, '0');
  let grouped;
  if (rupees.length <= 3) {
    grouped = rupees;
  } else {
    const last3 = rupees.slice(-3);
    const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  }
  return `${sign}₹${grouped}.${paise}`;
}

module.exports = { toMinor, fromMinor, formatINR, MAX_MINOR };
