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
3. Run fuzzy logic scoring
4. If fuzzy score is below 50, run JEV fallback (Jaro-Winkler + Levenshtein)
