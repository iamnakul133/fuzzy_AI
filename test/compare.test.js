const test = require('node:test');
const assert = require('node:assert/strict');
const fuzzball = require('fuzzball');

const { compare, normalizeName, jevDecision } = require('../src/index');

test('normalizes titles and punctuation', () => {
  const normalized = normalizeName(' Mr.   C, Balaji ');
  assert.equal(normalized.normalized, 'c balaji');
  assert.deepEqual(normalized.tokens, ['c', 'balaji']);
});

test('accepts initial + surname matches for KYC/bank names', async () => {
  const result = await compare('Chinnaraj Balaji', 'Mr C Balaji');

  assert.equal(result.samePerson, true);
  assert.equal(result.method, 'fuzzy');
  assert.ok(result.fuzzyScore >= 60);
});

test('uses fuzzball library for initial fuzzy comparison score', async () => {
  const left = normalizeName('Chinnaraj Balaji');
  const right = normalizeName('Mr C Balaji');
  const expected = Math.max(
    fuzzball.ratio(left.normalized, right.normalized),
    fuzzball.token_set_ratio(left.normalized, right.normalized),
    fuzzball.partial_ratio(left.normalized, right.normalized)
  );

  const result = await compare('Chinnaraj Balaji', 'Mr C Balaji');

  assert.equal(result.fuzzyScore, expected);
  assert.equal(result.method, 'fuzzy');
});

test('falls back to JEV when fuzzball score is below 50', async () => {
  let receivedRequest;
  let receivedConfig;

  const result = await compare('John Balaji', 'Ravi Kumar', {
    jevPassThreshold: 50,
    jevApiKey: 'test-api-key',
    jevClient: async (requestPayload, config) => {
      receivedRequest = requestPayload;
      receivedConfig = config;

      return {
        model: 'jev-1.13.0',
        answers: {
          same_person: { type: 'noul', noul: 0.63 },
          match_decision: { type: 'choice', choice: 'uncertain' },
          match_basis: { type: 'choice', choice: 'mismatch_signals' }
        },
        usage: {
          input_tokens: 120,
          output_tokens: 12
        }
      };
    }
  });

  assert.equal(result.method, 'jev_fallback');
  assert.ok(result.fuzzyScore < 50);
  assert.equal(result.jevScore, 63);
  assert.equal(result.jevDecision.engine, 'typesafe_system_one');
  assert.equal(result.jevDecision.model, 'jev-1.13.0');
  assert.equal(result.jevDecision.confidence, 'medium');
  assert.deepEqual(result.jevDecision.reasons, [
    'decision_uncertain',
    'basis_mismatch_signals'
  ]);
  assert.equal(receivedConfig.apiKey, 'test-api-key');
  assert.equal(receivedRequest.model, 'jev-latest');
  assert.equal(receivedRequest.questions.same_person.type, 'noul');
  assert.equal(receivedRequest.state.signals.fuzzyScore, result.fuzzyScore);
});

test('throws a helpful error when JEV fallback is needed without an API key', async () => {
  await assert.rejects(
    compare('John Balaji', 'Ravi Kumar'),
    /Missing JEV API key\. Set JEV_API_KEY or TYPESAFE_API_KEY/
  );
});

test('does not call JEV for strong fuzzy matches', async () => {
  let jevCalls = 0;

  const result = await compare('Chinnaraj Balaji', 'Mr C Balaji', {
    jevApiKey: 'test-api-key',
    jevClient: async () => {
      jevCalls += 1;
      return {};
    }
  });

  assert.equal(result.method, 'fuzzy');
  assert.equal(jevCalls, 0);
});

test('rejects clearly different names with structured JEV output', async () => {
  const left = normalizeName('Chinnaraj Balaji');
  const right = normalizeName('Mohan Kumar');

  const result = await jevDecision(left, right, 22, 70, {
    jevApiKey: 'test-api-key',
    jevClient: async () => ({
      model: 'jev-1.13.0',
      answers: {
        same_person: { type: 'noul', noul: 0.12 },
        match_decision: { type: 'choice', choice: 'likely_mismatch' },
        match_basis: { type: 'choice', choice: 'mismatch_signals' }
      }
    })
  });

  assert.equal(result.samePerson, false);
  assert.equal(result.confidenceScore, 12);
  assert.equal(result.signals.surnameMatch, false);
});
