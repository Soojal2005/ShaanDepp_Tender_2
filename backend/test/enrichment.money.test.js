import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIndianMoney } from '../src/services/enrichment/money.js';

test('parses plain rupee amounts with grouping and /-', () => {
  assert.equal(parseIndianMoney('Rs. 1,50,00,000/-').rupees, 15000000);
  assert.equal(parseIndianMoney('INR 1,00,000.00').rupees, 100000);
  assert.equal(parseIndianMoney('50000').rupees, 50000);
  assert.equal(parseIndianMoney('₹ 2,00,00,000').rupees, 20000000);
});

test('applies lakh/crore multipliers', () => {
  assert.equal(parseIndianMoney('2.5 Crore').rupees, 25000000);
  assert.equal(parseIndianMoney('15.00 Lakh').rupees, 1500000);
  assert.equal(parseIndianMoney('Rs. 1.5 Cr.').rupees, 15000000);
  assert.equal(parseIndianMoney('10 Lacs').rupees, 1000000);
  assert.equal(parseIndianMoney('2.50 Cr').unit, 'crore');
});

test('attaches the unit to the number it follows, not a later number', () => {
  assert.equal(parseIndianMoney('2.5 Crore (EMD Rs 50000)').rupees, 25000000);
});

test('requireCurrency ignores bare numbers but keeps marked money', () => {
  assert.equal(parseIndianMoney('Clause 14000 of the act', { requireCurrency: true }), null);
  assert.equal(parseIndianMoney('Rs 14000', { requireCurrency: true }).rupees, 14000);
  assert.equal(parseIndianMoney('14 Lakh', { requireCurrency: true }).rupees, 1400000);
});

test('rejects out-of-range and unparseable input', () => {
  assert.equal(parseIndianMoney('Rs 10'), null);            // below floor
  assert.equal(parseIndianMoney('no amount here'), null);
  assert.equal(parseIndianMoney(''), null);
  assert.equal(parseIndianMoney(null), null);
});
