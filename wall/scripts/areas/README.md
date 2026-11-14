# Review script areas

Put new gallery states, fit-check variants, measurements, rules, and deliberate breaks in a new `*.mjs` file here. Both review scripts discover files automatically in file-name order. New area work must not add registration entries to `gallery.mjs` or `fit-check.mjs`.

Every module exports one object with a unique `name`. A gallery state supplies its complete query, expected text, and optional action:

```js
export default {
  name: 'example',
  gallery: {
    states: [{
      screen: 'work',
      name: 'example: drawer open',
      query: 'hz=work&clock=review&weather=ok&example=full',
      custom: true,
      actions: '.example-button',
      expect: ['Example', '!Could not load'],
    }],
  },
};
```

`actions` accepts the same click, `hover:`, `press:`, `kbd:`, `ctx:`, and chained action forms as built-in gallery states. Use `expectNote` instead of `expect` only when a state changes pixels but cannot change text.

A fit-check contribution can add a variant, a browser measurement, a host rule, and a deliberate break:

```js
export default {
  name: 'example',
  fit: {
    variants: [{
      name: 'Example, full',
      q: '?hz=work&clock=review&weather=ok&example=full',
      checks: ['.example-card'],
      example: true,
    }],
    measurements: {
      example: () => ({ width: document.querySelector('.example-card')?.getBoundingClientRect().width ?? 0 }),
    },
    rules: {
      example: (variant, results, emit) => {
        if (!variant.example) return false;
        if (results.example.width >= 100) { emit('  ok   example: card at least 100 px wide'); return false; }
        emit(`  FAIL example: card is ${results.example.width} px wide`);
        return true;
      },
    },
    breaks: {
      'example-width': {
        css: '.example-card { width: 20px !important; }',
        expect: /^ *FAIL example: card is \d+ px wide/m,
        appliesTo: (variant) => variant.name === 'Example, full',
      },
    },
  },
};
```

Measurement functions run in the page and must be self-contained. Rule functions run in the script process. Their output must keep the existing `ok` and `FAIL` line format. Break names automatically feed validation, self-test, and per-state selection.

Run one area while developing:

```text
npm --prefix wall run gallery -- --area=example
npm --prefix wall run fit-check -- --area=example
```

Every review script load checks duplicate gallery state names, measurement keys, rule keys, and break names. A duplicate fails immediately and names both area files.
