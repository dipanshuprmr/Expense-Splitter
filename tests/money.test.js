'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { toMinor, fromMinor, formatINR, MAX_MINOR } = require('../src/money');

const rejects = (fn, code) => assert.throws(fn, (e) => e.code === code, `expected error code ${code}`);

describe('money: toMinor (parsing rupees into paise)', () => {
  test('UT-M01 converts whole and decimal rupee numbers', () => {
    assert.equal(toMinor(10), 1000);
    assert.equal(toMinor(10.5), 1050);
    assert.equal(toMinor(0.01), 1);
    assert.equal(toMinor(19.99), 1999);
  });

  test('UT-M02 avoids floating point drift and refuses float arithmetic artefacts', () => {
    assert.equal(toMinor(0.3), 30);
    // 0.1 + 0.2 is 0.30000000000000004 in JavaScript: refused instead of being silently rounded
    rejects(() => toMinor(0.1 + 0.2), 'INVALID_AMOUNT');
    assert.equal(toMinor('0.30'), 30);
    assert.equal(toMinor(1.15), 115);
    assert.equal(toMinor(4.35), 435);
    assert.equal(toMinor(1234.56), 123456);
  });

  test('UT-M03 accepts numeric strings, trims whitespace, allows trailing zeros', () => {
    assert.equal(toMinor('10.50'), 1050);
    assert.equal(toMinor('10.5'), 1050);
    assert.equal(toMinor('  7 '), 700);
    assert.equal(toMinor('10.500'), 1050);
  });

  test('UT-M04 rejects zero and negative amounts', () => {
    rejects(() => toMinor(0), 'INVALID_AMOUNT');
    rejects(() => toMinor('0.00'), 'INVALID_AMOUNT');
    rejects(() => toMinor(-5), 'INVALID_AMOUNT');
    rejects(() => toMinor('-0.01'), 'INVALID_AMOUNT');
  });

  test('UT-M05 rejects non-numeric input', () => {
    for (const bad of ['abc', '', '   ', null, undefined, true, false, NaN, Infinity, '1e3', '1,000', '1.', '.5', '--5', '12abc', {}, []]) {
      rejects(() => toMinor(bad), 'INVALID_AMOUNT');
    }
  });

  test('UT-M06 rejects more than two decimal places', () => {
    rejects(() => toMinor(12.345), 'INVALID_AMOUNT');
    rejects(() => toMinor('1.005'), 'INVALID_AMOUNT');
    rejects(() => toMinor(1e-7), 'INVALID_AMOUNT');
  });

  test('UT-M07 enforces the maximum amount boundary', () => {
    assert.equal(toMinor('10000000'), MAX_MINOR);
    rejects(() => toMinor('10000000.01'), 'AMOUNT_TOO_LARGE');
    rejects(() => toMinor(1e21), 'AMOUNT_TOO_LARGE');
  });

  test('UT-M08 allowZero option permits zero only', () => {
    assert.equal(toMinor(0, { allowZero: true }), 0);
    rejects(() => toMinor(-1, { allowZero: true }), 'INVALID_AMOUNT');
  });
});

describe('money: formatting', () => {
  test('UT-M09 fromMinor renders paise as a decimal string', () => {
    assert.equal(fromMinor(0), '0.00');
    assert.equal(fromMinor(5), '0.05');
    assert.equal(fromMinor(123456), '1234.56');
    assert.equal(fromMinor(-250), '-2.50');
  });

  test('UT-M10 formatINR uses Indian digit grouping', () => {
    assert.equal(formatINR(0), '₹0.00');
    assert.equal(formatINR(99900), '₹999.00');
    assert.equal(formatINR(123456), '₹1,234.56');
    assert.equal(formatINR(12345678), '₹1,23,456.78');
    assert.equal(formatINR(MAX_MINOR), '₹1,00,00,000.00');
    assert.equal(formatINR(-12345), '-₹123.45');
  });
});
