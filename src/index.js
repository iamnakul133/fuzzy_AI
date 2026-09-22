const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
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

const DEFAULT_JEV_API_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_JEV_MODEL = 'jev-latest';
const DEFAULT_JEV_TIMEOUT_MS = 10000;

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

function buildJevSignals(left, right, fuzzyScore) {
  const leftParts = identifyNameParts(left.tokens);
  const rightParts = identifyNameParts(right.tokens);
  const surnameMatch = Boolean(
    leftParts.surname && rightParts.surname && leftParts.surname === rightParts.surname
  );
  const givenMatch = isInitialCompatible(leftParts.given, rightParts.given);
  const sharedTokens = left.tokens.filter((token) => right.tokens.includes(token)).length;
  const tokenOverlap = sharedTokens / Math.max(left.tokens.length, right.tokens.length, 1);

  return {
    leftParts,
    rightParts,
    surnameMatch,
    givenMatch,
    sharedTokens,
    tokenOverlap: Number(tokenOverlap.toFixed(2)),
    fuzzyScore
  };
}

function buildJevRequest(left, right, signals, model) {
  return {
    model,
    state: {
      task: 'Decide whether two KYC/bank names likely belong to the same person.',
      names: {
        left: {
          raw: left.raw,
          normalized: left.normalized,
          tokens: left.tokens,
          parts: signals.leftParts
        },
        right: {
          raw: right.raw,
          normalized: right.normalized,
          tokens: right.tokens,
          parts: signals.rightParts
        }
      },
      signals: {
        fuzzyScore: signals.fuzzyScore,
        surnameMatch: signals.surnameMatch,
        givenMatch: signals.givenMatch,
        sharedTokens: signals.sharedTokens,
        tokenOverlap: signals.tokenOverlap
      }
    },
    questions: {
      same_person: {
        type: 'noul',
        instructions:
          'Return the probability that these names refer to the same person for KYC/bank verification.',
        criteria: {
          true: 'Structured evidence supports the names being the same person.',
          false: 'Structured evidence supports the names being different people.'
        }
      },
      match_decision: {
        type: 'choice',
        instructions: 'Choose the best structured decision label for these two names.',
        criteria: {
          likely_match: 'The names are likely the same person.',
          uncertain: 'The names are ambiguous and need manual review.',
          likely_mismatch: 'The names are likely different people.'
        }
      },
      match_basis: {
        type: 'choice',
        instructions: 'Choose the strongest basis for the decision.',
        criteria: {
          surname_and_given: 'Surname and given names align strongly.',
          surname_and_initial: 'Surname aligns and initials support the match.',
          token_overlap: 'Shared token overlap is the main evidence.',
          mismatch_signals: 'Mismatch indicators dominate the comparison.'
        }
      }
    }
  };
}

function bandFromScore(confidenceScore) {
  return confidenceScore >= 80 ? 'high' : confidenceScore >= 60 ? 'medium' : 'low';
}

function resolveJevConfig(options = {}) {
  const timeoutMs = Number(
    options.jevTimeoutMs || process.env.JEV_TIMEOUT_MS || DEFAULT_JEV_TIMEOUT_MS
  );

  return {
    apiKey: options.jevApiKey || process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY || '',
    apiUrl: options.jevApiUrl || process.env.JEV_API_URL || DEFAULT_JEV_API_URL,
    model: options.jevModel || process.env.JEV_MODEL || DEFAULT_JEV_MODEL,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_JEV_TIMEOUT_MS,
    jevClient: options.jevClient || defaultJevClient
  };
}

function postJson(url, payload, headers, timeoutMs) {
  const target = new URL(url);
  const transport = target.protocol === 'http:' ? http : https;
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...headers
        },
        timeout: timeoutMs
      },
      (response) => {
        let responseBody = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          const statusCode = response.statusCode || 500;
          let parsed = {};

          if (responseBody) {
            try {
              parsed = JSON.parse(responseBody);
            } catch {
              reject(new Error('JEV response was not valid JSON.'));
              return;
            }
          }

          if (statusCode < 200 || statusCode >= 300) {
            const error = new Error(`JEV request failed with status ${statusCode}`);
            error.statusCode = statusCode;
            error.response = parsed;
            reject(error);
            return;
          }

          resolve(parsed);
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error(`JEV request timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function defaultJevClient(requestPayload, config) {
  return postJson(
    config.apiUrl,
    requestPayload,
    {
      authorization: 'Bearer ' + config.apiKey
    },
    config.timeoutMs
  );
}

function mapJevResponseToDecision(response, signals, jevPassThreshold) {
  const answers = response && typeof response === 'object' ? response.answers || {} : {};
  const samePersonProbability = Number(answers.same_person && answers.same_person.noul);
  const probability = Number.isFinite(samePersonProbability) ? samePersonProbability : 0;
  const confidenceScore = Math.max(0, Math.min(99, Math.round(probability * 100)));
  const decision = answers.match_decision && answers.match_decision.choice;
  const basis = answers.match_basis && answers.match_basis.choice;
  const reasons = [];

  if (decision) reasons.push(`decision_${decision}`);
  if (basis) reasons.push(`basis_${basis}`);
  if (!reasons.length) reasons.push('structured_decision_only');

  return {
    engine: 'typesafe_system_one',
    model: response && response.model ? response.model : null,
    samePerson: confidenceScore >= jevPassThreshold,
    confidence: bandFromScore(confidenceScore),
    confidenceScore,
    signals: {
      fuzzyScore: signals.fuzzyScore,
      surnameMatch: signals.surnameMatch,
      givenMatch: signals.givenMatch,
      tokenOverlap: signals.tokenOverlap,
      sharedTokens: signals.sharedTokens,
      decision,
      basis
    },
    reasons,
    usage: response && response.usage ? response.usage : null
  };
}

async function jevDecision(left, right, fuzzyScore, jevPassThreshold, options = {}) {
  const config = resolveJevConfig(options);

  if (!config.apiKey) {
    throw new Error('Missing JEV API key. Set JEV_API_KEY or TYPESAFE_API_KEY before using JEV fallback.');
  }

  const signals = buildJevSignals(left, right, fuzzyScore);
  const requestPayload = buildJevRequest(left, right, signals, config.model);
  const response = await config.jevClient(requestPayload, config);

  return mapJevResponseToDecision(response, signals, jevPassThreshold);
}

async function compare(leftName, rightName, options = {}) {
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
    const decision = await jevDecision(left, right, fuzzyScore, jevPassThreshold, options);

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
