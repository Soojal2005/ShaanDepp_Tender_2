import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractTenderFields } from '../src/services/enrichment/fields.js';

// A realistic-ish NIT body (key:value lines, as pdf text extraction tends to produce).
const NIT = `
NOTICE INVITING e-TENDER
Name of Work: Construction of RCC drain at Ward 12
Estimated Cost of Work : Rs. 1,50,00,000/-
Earnest Money Deposit (EMD) : Rs. 3,00,000/-
Cost of Tender Document : Rs. 5,000/-
Period of Completion : 18 Months
`;

test('extracts all three money fields from a typical NIT', () => {
  const f = extractTenderFields(NIT);
  assert.equal(f.estimatedValue.rupees, 15000000);
  assert.equal(f.emdAmount.rupees, 300000);
  assert.equal(f.tenderFee.rupees, 5000);
  assert.equal(f.matched, 3);
});

test('handles crore/lakh units and table-style line breaks', () => {
  const text = `Estimated Value\nRs. 2.5 Crore\nBid Security\n15.00 Lakh\nTender Fee\nRs 10,000`;
  const f = extractTenderFields(text);
  assert.equal(f.estimatedValue.rupees, 25000000);
  assert.equal(f.emdAmount.rupees, 1500000);
  assert.equal(f.tenderFee.rupees, 10000);
});

test('picks the rupee amount when EMD is given as a percentage with a value', () => {
  const f = extractTenderFields('Earnest Money: 2% of estimated cost (Rs. 3,00,000)');
  assert.equal(f.emdAmount.rupees, 300000);
});

test('returns nulls when nothing matches', () => {
  const f = extractTenderFields('This document has no money fields at all.');
  assert.equal(f.estimatedValue, null);
  assert.equal(f.emdAmount, null);
  assert.equal(f.tenderFee, null);
  assert.equal(f.matched, 0);
});
