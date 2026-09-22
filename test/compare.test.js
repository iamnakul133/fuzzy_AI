const test = require('node:test');
const assert = require('node:assert/strict');

const { compare, normalizeName } = require('../src/index');

test('normalizes titles and punctuation', () => {
  const normalized = normalizeName(' Mr.   C, Balaji ');
  assert.equal(normalized.normalized, 'c balaji');
  assert.deepEqual(normalized.tokens, ['c', 'balaji']);
});

test('accepts initial + surname matches for KYC/bank names', () => {
  const result = compare('Chinnaraj Balaji', 'Mr C Balaji');

  assert.equal(result.samePerson, true);
  assert.equal(result.method, 'fuzzy');
  assert.ok(result.fuzzyScore >= 60);
});

test('falls back to JEV when fuzzy score is below 50', () => {
  const result = compare('Robert', 'Rupert', {
    fuzzyPassThreshold: 90,
    fuzzyToJevFallbackThreshold: 99,
    jevPassThreshold: 70
  });

  assert.equal(result.method, 'jev_fallback');
  assert.ok(result.jevScore !== null);
});

test('rejects clearly different names', () => {
  const result = compare('Chinnaraj Balaji', 'Mohan Kumar');

  assert.equal(result.samePerson, false);
});
