# fuzzy_AI

A small npm-ready library for KYC/bank person-name matching.

## Installation

```bash
npm install fuzzy-ai-name-matcher
```

## Configure JEV

When the initial `fuzzball` score is below `50`, the library calls TypeSafe AI System One (JEV) for a structured decision.

Set your API key with an environment variable before calling `compare`:

```bash
export JEV_API_KEY="your-jev-api-key"
```

You can also use `TYPESAFE_API_KEY`. Optional overrides:

- `JEV_API_URL` (defaults to `https://api.typesafe.ai/v1/systemone`)
- `JEV_MODEL` (defaults to `jev-latest`)
- `JEV_TIMEOUT_MS` (defaults to `10000`)

## Usage

```js
const { compare } = require('fuzzy-ai-name-matcher');

async function run() {
  const result = await compare('Chinnaraj Balaji', 'Mr C Balaji');
  console.log(result);
}

run();
```

## Matching flow

1. Normalize names (lowercase, remove punctuation and titles)
2. Identify name parts (given, middle, surname, initials)
3. Run initial fuzzy comparison with `fuzzball` (`ratio`, `token_set_ratio`, `partial_ratio`)
4. If the fuzzball score is below 50, call JEV with structured state and typed questions
5. Return a structured decision with confidence score, reasons, and signals

## Testing JEV integrations

Live API calls are not required in tests. Pass a mock `jevClient` and `jevApiKey` through `compare` options:

```js
const result = await compare('John Balaji', 'Ravi Kumar', {
  jevApiKey: 'test-key',
  jevClient: async () => ({
    model: 'jev-1.13.0',
    answers: {
      same_person: { type: 'noul', noul: 0.82 },
      match_decision: { type: 'choice', choice: 'likely_match' },
      match_basis: { type: 'choice', choice: 'surname_and_initial' }
    }
  })
});
```
