# fuzzy_AI

A small npm-ready library for KYC/bank person-name matching.

## Usage

```js
const { compare } = require('fuzzy-ai-name-matcher');

const result = compare('Chinnaraj Balaji', 'Mr C Balaji');
// { samePerson: true, method: 'fuzzy', score: ..., ... }
```

## Matching flow

1. Normalize names (lowercase, remove punctuation and titles)
2. Identify name parts (given, middle, surname, initials)
3. Run initial fuzzy comparison with `fuzzball` (`ratio`, `token_set_ratio`, `partial_ratio`)
4. If the fuzzball score is below 50, run JEV fallback (TypeSafe AI System One probabilistic structured-decision engine with confidence scores)
