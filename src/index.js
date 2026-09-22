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

function jaro(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);

    for (let j = start; j < end; j += 1) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }

  if (!matches) return 0;

  let transpositions = 0;
  let k = 0;

  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }

  return (
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) /
    3
  );
}

function jaroWinkler(a, b) {
  const j = jaro(a, b);
  if (j === 0) return 0;

  let prefix = 0;
  const maxPrefix = 4;
  for (let i = 0; i < Math.min(maxPrefix, a.length, b.length); i += 1) {
    if (a[i] !== b[i]) break;
    prefix += 1;
  }

  return j + prefix * 0.1 * (1 - j);
}

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[a.length][b.length];
}

function tokenOverlapScore(leftTokens, rightTokens) {
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const union = new Set([...leftSet, ...rightSet]);

  if (!union.size) return 0;

  let common = 0;
  for (const token of union) {
    if (leftSet.has(token) && rightSet.has(token)) common += 1;
  }

  return common / union.size;
}

function fuzzyLogicScore(left, right) {
  if (!left.tokens.length || !right.tokens.length) return 0;

  const leftParts = identifyNameParts(left.tokens);
  const rightParts = identifyNameParts(right.tokens);

  const surnameMatch = leftParts.surname === rightParts.surname ? 1 : 0;
  const firstExact = leftParts.given === rightParts.given ? 1 : 0;
  const initialMatch = leftParts.given[0] === rightParts.given[0] ? 1 : 0;

  const givenSimilarity = jaroWinkler(leftParts.given, rightParts.given);
  const overlap = tokenOverlapScore(left.tokens, right.tokens);
  const fullSimilarity = jaroWinkler(left.normalized, right.normalized);

  const weighted =
    surnameMatch * 40 +
    firstExact * 20 +
    (firstExact ? 0 : initialMatch * 18) +
    givenSimilarity * 10 +
    overlap * 7 +
    fullSimilarity * 5;

  return Math.max(0, Math.min(100, Math.round(weighted)));
}

function jevScore(leftNormalized, rightNormalized) {
  if (!leftNormalized || !rightNormalized) return 0;

  const jw = jaroWinkler(leftNormalized, rightNormalized);
  const distance = levenshtein(leftNormalized, rightNormalized);
  const maxLen = Math.max(leftNormalized.length, rightNormalized.length) || 1;
  const levSimilarity = 1 - distance / maxLen;

  return Math.round((jw * 0.65 + levSimilarity * 0.35) * 100);
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
      normalized: { left: left.normalized, right: right.normalized },
      parts: {
        left: identifyNameParts(left.tokens),
        right: identifyNameParts(right.tokens)
      }
    };
  }

  const fuzzyScore = fuzzyLogicScore(left, right);

  if (fuzzyScore < fuzzyToJevFallbackThreshold) {
    const fallbackScore = jevScore(left.normalized, right.normalized);

    return {
      samePerson: fallbackScore >= jevPassThreshold,
      method: 'jev_fallback',
      score: fallbackScore,
      fuzzyScore,
      jevScore: fallbackScore,
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
  jevScore
};
