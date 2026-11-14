# Review script areas

Put new gallery states, fit-check variants, measurements, rules, and deliberate breaks in a new `*.mjs` file here. Both review scripts discover files automatically in file-name order. New area work must not add registration entries to `gallery.mjs` or `fit-check.mjs`.

Every module exports one object with a unique `name`. A gallery state supplies its complete query, expected text, and optional action:

```js
export default {
  name: 'example',
  gallery: {
    states: [{
      screen: 'work',
      name: 'example: Work typical',
      query: 'hz=work&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok',
      custom: true,
      expect: 'Voice: iPhone mic fix',
    }],
  },
};
```

This gallery example uses the existing Work typical state and passes unchanged. Replace its query and expected text with the state being added.

`actions` accepts a plain `<selector>` click, `hover:<selector>`, `press:<selector>`, `focus:<selector>`, `kbd:<selector>`, `ctx:<selector>`, `type:<selector>=<value>`, and `drag:<selector>@<x>,<y>`. Put steps in an array or join them with ` >> `. Use `expectNote` instead of `expect` only when a state changes pixels but cannot change text.

A fit-check contribution can add a variant, a browser measurement, a host rule, and a deliberate break:

```js
export default {
  name: 'example',
  fit: {
    variants: [{
      name: 'Example, full',
      q: '?hz=work&clock=review&weather=ok',
      checks: ['.work .left-wing'],
    }],
    measurements: {
      example: () => ({ width: document.querySelector('.work .left-wing')?.getBoundingClientRect().width ?? 0 }),
    },
    rules: {
      example: (variant, results, emit) => {
        if (variant.name !== 'Example, full') return false;
        if (results.example.width >= 400) { emit('  ok   example: left wing at least 400 px wide'); return false; }
        emit(`  FAIL example: left wing is ${results.example.width} px wide`);
        return true;
      },
    },
    breaks: {
      'example-width': {
        css: '.work .left-wing { width: 200px !important; }',
        expect: /^ *FAIL example: left wing is \d+ px wide/m,
        appliesTo: (variant) => variant.name === 'Example, full',
      },
    },
  },
};
```

This example uses the existing Work left wing, so it runs unchanged. Replace its query, selectors, measurement, and rule with the area being checked.

Measurement functions run in the page and must use an arrow function or `function` expression that references nothing outside its own body. Method shorthand becomes invalid syntax when serialized into the page. Rule functions run in the script process. Their output must keep the existing `ok` and `FAIL` line format.

A break may provide `css`, `query`, or both. `query` is a suffix such as `&examplebreak=1`, or a function that receives the selected variant and returns a suffix. Break names automatically feed validation, self-test, the usage listing, and per-state selection.

Run one area while developing:

```text
npm --prefix wall run gallery -- --area=example
npm --prefix wall run fit-check -- --area=example
```

Both commands validate every discovered area first, then run only the selected area's gallery states or fit variants, measurements, rules, and breaks. Built-in entries and entries from other areas do not run in focused mode. A focused fit-check area must contain at least one variant, one rule, and one break. Otherwise it exits with `fit-check: area "<name>" has zero <kind>`.

Validation is strict. Unknown top-level, `gallery`, `fit`, state, variant, and break keys fail with the file name, bad key, and allowed keys. Missing required fields, wrong types, empty contributions, unmatched break predicates, and duplicate state names, variant names, measurement keys, rule keys, or break names also fail immediately. Duplicate messages name both origins, including `built-in` where applicable, in every mode.
