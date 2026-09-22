const test = require('node:test');
const assert = require('node:assert/strict');
const fuzzball = require('fuzzball');

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

test('uses fuzzball library for initial fuzzy comparison score', () => {
  const left = normalizeName('Chinnaraj Balaji');
  const right = normalizeName('Mr C Balaji');
  const expected = Math.max(
    fuzzball.ratio(left.normalized, right.normalized),
    fuzzball.token_set_ratio(left.normalized, right.normalized),
    fuzzball.partial_ratio(left.normalized, right.normalized)
  );

  const result = compare('Chinnaraj Balaji', 'Mr C Balaji');

  assert.equal(result.fuzzyScore, expected);
  assert.equal(result.method, 'fuzzy');
});

test('falls back to JEV when fuzzball score is below 50', () => {
  const result = compare('John Balaji', 'Ravi Kumar', {
    jevPassThreshold: 50
  });

  assert.equal(result.method, 'jev_fallback');
  assert.ok(result.fuzzyScore < 50);
  assert.ok(result.jevScore !== null);
});

test('rejects clearly different names', () => {
  const result = compare('Chinnaraj Balaji', 'Mohan Kumar');

  assert.equal(result.samePerson, false);
});
