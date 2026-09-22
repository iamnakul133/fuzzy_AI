const fuzzball = require('fuzzball');

const TITLES = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'shri',
  'sri',
  'smt',
  'kumari'
]);

function normalizeName(input) {
  if (typeof input !== 'string') {
    return { raw: '', normalized: '', tokens: [] };
  }

  const cleaned = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = cleaned
    .split(' ')
    .filter(Boolean)
    .filter((token) => !TITLES.has(token));

  return {
    raw: input,
    normalized: tokens.join(' '),
    tokens
  };
}

function identifyNameParts(tokens) {
  if (!tokens.length) {
    return { given: '', middle: [], surname: '', initials: [] };
  }

  const given = tokens[0];
  const surname = tokens[tokens.length - 1];
  const middle = tokens.slice(1, -1);

  return {
    given,
    middle,
    surname,
    initials: tokens.map((token) => token[0])
  };
}

function isInitialCompatible(leftGiven, rightGiven) {
  if (!leftGiven || !rightGiven) return false;
  if (leftGiven === rightGiven) return true;

  if (leftGiven.length === 1 && rightGiven.length > 1) {
    return leftGiven === rightGiven[0];
  }

  if (rightGiven.length === 1 && leftGiven.length > 1) {
    return rightGiven === leftGiven[0];
  }

  return false;
}

function fuzzyLogicScore(left, right) {
  if (!left.tokens.length || !right.tokens.length) return 0;

  return Math.max(
    fuzzball.ratio(left.normalized, right.normalized),
    fuzzball.token_set_ratio(left.normalized, right.normalized),
    fuzzball.partial_ratio(left.normalized, right.normalized)
  );
}

function jevDecision(left, right, fuzzyScore, jevPassThreshold) {
  const leftParts = identifyNameParts(left.tokens);
  const rightParts = identifyNameParts(right.tokens);
  const surnameMatch = leftParts.surname && leftParts.surname === rightParts.surname;
  const givenMatch = isInitialCompatible(leftParts.given, rightParts.given);
  const sharedTokens = left.tokens.filter((token) => right.tokens.includes(token)).length;
  const tokenOverlap = sharedTokens / Math.max(left.tokens.length, right.tokens.length, 1);

  let confidence = 0.05;
  if (surnameMatch) confidence += 0.45;
  if (givenMatch) confidence += 0.28;
  if (tokenOverlap >= 0.5) confidence += 0.15;
  if (fuzzyScore >= 35) confidence += 0.07;
  if (leftParts.surname && rightParts.surname && !surnameMatch) confidence -= 0.2;
  if (!givenMatch && leftParts.given && rightParts.given) confidence -= 0.1;

  const confidenceScore = Math.max(0, Math.min(99, Math.round(confidence * 100)));
  const confidenceBand =
    confidenceScore >= 80 ? 'high' : confidenceScore >= 60 ? 'medium' : 'low';
  const samePerson = confidenceScore >= jevPassThreshold;
  const reasons = [];

  if (surnameMatch) reasons.push('surname_match');
  if (givenMatch) reasons.push('given_or_initial_match');
  if (tokenOverlap >= 0.5) reasons.push('token_overlap_support');
  if (!reasons.length) reasons.push('insufficient_structured_alignment');

  return {
    engine: 'typesafe_system_one',
    samePerson,
    confidence: confidenceBand,
    confidenceScore,
    signals: {
      fuzzyScore,
      surnameMatch,
      givenMatch,
      tokenOverlap: Number(tokenOverlap.toFixed(2))
    },
    reasons
  };
}

function compare(leftName, rightName, options = {}) {
  const {
    fuzzyPassThreshold = 60,
    fuzzyToJevFallbackThreshold = 50,
    jevPassThreshold = 70
  } = options;

  const left = normalizeName(leftName);
  const right = normalizeName(rightName);

  if (!left.normalized || !right.normalized) {
    return {
      samePerson: false,
      method: 'empty',
      score: 0,
      fuzzyScore: 0,
      jevScore: null,
      jevDecision: null,
      normalized: { left: left.normalized, right: right.normalized },
      parts: {
        left: identifyNameParts(left.tokens),
        right: identifyNameParts(right.tokens)
      }
    };
  }

  const fuzzyScore = fuzzyLogicScore(left, right);

  if (fuzzyScore < fuzzyToJevFallbackThreshold) {
    const decision = jevDecision(left, right, fuzzyScore, jevPassThreshold);

    return {
      samePerson: decision.samePerson,
      method: 'jev_fallback',
      score: decision.confidenceScore,
      fuzzyScore,
      jevScore: decision.confidenceScore,
      jevDecision: decision,
      normalized: { left: left.normalized, right: right.normalized },
      parts: {
        left: identifyNameParts(left.tokens),
        right: identifyNameParts(right.tokens)
      }
    };
  }

  return {
    samePerson: fuzzyScore >= fuzzyPassThreshold,
    method: 'fuzzy',
    score: fuzzyScore,
    fuzzyScore,
    jevScore: null,
    jevDecision: null,
    normalized: { left: left.normalized, right: right.normalized },
    parts: {
      left: identifyNameParts(left.tokens),
      right: identifyNameParts(right.tokens)
    }
  };
}

module.exports = {
  compare,
  normalizeName,
  identifyNameParts,
  fuzzyLogicScore,
  jevDecision
};
