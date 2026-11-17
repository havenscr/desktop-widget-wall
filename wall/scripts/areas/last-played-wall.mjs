// Unwind's idle player when the last thing played was the wall's own video: its words after a restart,
// and that the web view's process name is never on screen in any Listen state that can name it.

const AT = encodeURIComponent('2026-11-11T22:30:00-08:00');
const base = (knobs) => `hz=unwind&at=${AT}&clock=review&weather=ok&watch=mock&wlist=three&wtab=listen&${knobs}`;
const NAME = 'msedgewebview2';
const STATES = [
  ['restart, item known', 'media=none&wlastown=known', ['Last played on the wall', 'Night drive mix', 'Play again', '!msedgewebview2']],
  ['restart, item unknown', 'media=none&wlastown=unknown', ['Last played on the wall', 'Pick it in Watch to play again', '!Play again', '!msedgewebview2']],
  ['playing in Watch', 'wplay=0&media=watchown', ['Playing in Watch', '!msedgewebview2']],
  ['another web view app', 'media=webview', ['Last played on an app on this PC', '!msedgewebview2']],
  ['last played in Watch', 'wlast=one&media=watchstopped', ['Last played in Watch', '!msedgewebview2']],
];
const V = (n) => `Last played, ${n}`;

// Runs in the page: the visible text, aria labels and titles of the whole page must not hold the web view's name.
function measureWebview() {
  if (!new URLSearchParams(location.search).get('wvcheck')) return { hits: [] };
  const hits = [];
  const seen = (text, where) => { if (/msedgewebview2/i.test(text || '')) hits.push(where + ': ' + String(text).slice(0, 60)); };
  seen(document.body.innerText, 'text');
  // Text a stylesheet draws (generated content) is on screen too.
  for (const e of document.querySelectorAll('*')) {
    for (const pseudo of ['::before', '::after']) seen(getComputedStyle(e, pseudo).content, pseudo + ' content');
  }
  for (const e of document.querySelectorAll('[aria-label], [title]')) {
    seen(e.getAttribute('aria-label'), 'aria-label');
    seen(e.getAttribute('title'), 'title');
  }
  return { hits };
}

export default {
  name: 'last-played-wall',
  gallery: { states: STATES.slice(0, 2).map(([n, k, expect]) => ({ screen: 'unwind', name: `listen: last played on the wall, ${n}`, query: base(k), custom: true, expect })) },
  fit: {
    variants: STATES.map(([n, k]) => ({ name: V(n), q: `?${base(k)}&wvcheck=1`, checks: ['.u-player'] })),
    measurements: { webviewName: measureWebview },
    rules: {
      webviewName: (variant, results, emit) => {
        if (!/[?&]wvcheck=1\b/.test(variant.q)) return false;
        const { hits } = results.webviewName;
        if (!hits.length) { emit(`  ok   last played: the web view's process name is nowhere on screen`); return false; }
        for (const h of hits) emit(`  FAIL last played: the web view's process name is shown (${h})`);
        return true;
      },
    },
    breaks: {
      'webview-name': {
        css: `.u-player .u-k::after { content: "${NAME}" !important; }`,
        expect: /^ *FAIL last played: the web view's process name is shown/m,
        appliesTo: (variant) => variant.name === V('restart, item known'),
      },
    },
  },
};
