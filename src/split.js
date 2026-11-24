'use strict';

const { validation } = require('./errors');
const { toMinor } = require('./money');

const SPLIT_TYPES = ['equal', 'exact', 'percent', 'shares'];

/**
 * Distribute `total` paise across members in proportion to integer `weights`
 * using the largest remainder method, so the parts always add up to exactly `total`.
 * Ties are broken by member id (ascending) so results are deterministic.
 *
 * @param {number} total  integer paise
 * @param {Object<string, number>} weights  memberId -> positive integer
 * @returns {Object<string, number>} memberId -> paise
 */
function largestRemainder(total, weights) {
  const ids = Object.keys(weights).sort();
  const weightSum = ids.reduce((s, id) => s + weights[id], 0);
  const parts = {};
  const remainders = [];
  let assigned = 0;
  for (const id of ids) {
    const exact = total * weights[id];
    const floor = Math.floor(exact / weightSum);
    parts[id] = floor;
    assigned += floor;
    remainders.push({ id, rem: exact % weightSum });
  }
  let leftover = total - assigned;
  remainders.sort((a, b) => b.rem - a.rem || (a.id < b.id ? -1 : 1));
  for (let i = 0; leftover > 0; i++, leftover--) {
    parts[remainders[i].id] += 1;
  }
  return parts;
}

function assertMemberList(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw validation('NO_PARTICIPANTS', 'At least one participant is required');
  }
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw validation('DUPLICATE_PARTICIPANT', `Participant ${id} listed more than once`);
    seen.add(id);
  }
}

function assertMap(map) {
  if (map === null || typeof map !== 'object' || Array.isArray(map) || Object.keys(map).length === 0) {
    throw validation('NO_PARTICIPANTS', 'At least one participant is required');
  }
}

/** Equal split. Leftover paise go to the first members in id order. */
function splitEqual(totalMinor, memberIds) {
  assertMemberList(memberIds);
  const weights = {};
  for (const id of memberIds) weights[id] = 1;
  return largestRemainder(totalMinor, weights);
}

/** Exact split. `amounts` are rupee values; they must add up to the total. */
function splitExact(totalMinor, amounts) {
  assertMap(amounts);
  const result = {};
  let sum = 0;
  for (const [id, value] of Object.entries(amounts)) {
    result[id] = toMinor(value);
    sum += result[id];
  }
  if (sum !== totalMinor) {
    throw validation('SPLIT_SUM_MISMATCH', `Exact amounts add up to ${sum} paise but the expense is ${totalMinor} paise`);
  }
  return result;
}

/** Percentage split. Percentages may have up to 2 decimals and must total exactly 100. */
function splitPercent(totalMinor, percents) {
  assertMap(percents);
  const weights = {};
  let sum = 0;
  for (const [id, value] of Object.entries(percents)) {
    weights[id] = toBasisPoints(value);
    sum += weights[id];
  }
  if (sum !== 10000) {
    throw validation('PERCENT_SUM_INVALID', 'Percentages must add up to exactly 100');
  }
  return largestRemainder(totalMinor, weights);
}

/** Share-based split, e.g. 2 nights vs 3 nights. Shares must be positive whole numbers. */
function splitShares(totalMinor, shares) {
  assertMap(shares);
  const weights = {};
  for (const [id, value] of Object.entries(shares)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw validation('INVALID_SHARES', `Shares for ${id} must be a positive whole number`);
    }
    weights[id] = value;
  }
  return largestRemainder(totalMinor, weights);
}

// "33.33" -> 3333 basis points. Uses the same strict parser as money (2 decimals max).
function toBasisPoints(value) {
  try {
    return toMinor(value);
  } catch (e) {
    throw validation('INVALID_PERCENT', `Percentage "${value}" is not valid`);
  }
}

/**
 * Entry point used by the service layer.
 * For 'equal', `input` is an array of member ids; for the others it is a map id -> value.
 */
function computeSplit(type, totalMinor, input) {
  switch (type) {
    case 'equal': return splitEqual(totalMinor, input);
    case 'exact': return splitExact(totalMinor, input);
    case 'percent': return splitPercent(totalMinor, input);
    case 'shares': return splitShares(totalMinor, input);
    default:
      throw validation('INVALID_SPLIT_TYPE', `Split type must be one of: ${SPLIT_TYPES.join(', ')}`);
  }
}

module.exports = {
  SPLIT_TYPES, largestRemainder, splitEqual, splitExact, splitPercent, splitShares, computeSplit,
};
