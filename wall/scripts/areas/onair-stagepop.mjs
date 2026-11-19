// The prompter box on the Live page: the stage pop-out controls (Open, Close, Full screen, the Tools link and one view button per
// feed the Firefox add-on lists). Gallery states for the five frames, the port and link states, fit variants, the `stagepop`
// measurement and a deliberate break live here. Every name in the mocks is invented (`?sp=` and friends, see devMocks/stagepop.ts).

const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const full = (knobs) => `hz=onair&at=${at}&clock=review&weather=ok&screen=onair&oamode=live&yt=live&show=typical&marks=2${knobs ? '&' + knobs : ''}`;
const state = (name, knobs, expect, actions) => ({ screen: 'onair', name: 'stage pop-out: ' + name, query: full(knobs), custom: true, expect, actions });
const variant = (name, knobs, extra = {}) => ({ name: 'Stage pop-out, ' + name, q: '?' + full(knobs), checks: ['.oa2 .oa2-modes', '.oa2 .oa2-stagepop'], ...extra });
const isNamed = (n) => (v) => v.name === 'Stage pop-out, ' + n;
const NOTE = 'Name tags and banners are not drawn.';

// Runs in the page: nothing here may refer to anything outside this function.
function measureStagePop() {
  const fails = [];
  const q = new URLSearchParams(location.search);
  const root = document.querySelector('.oa2');
  if (!(q.get('screen') === 'onair' && q.get('oamode') === 'live') || !root) return fails;
  const box = root.querySelector('.oa2-stagepop');
  if (!box) return ['stage pop-out: the prompter box is missing'];
  const r1 = (n) => Math.round(n * 10) / 10;
  const b = box.getBoundingClientRect();
  if (Math.abs(b.left - 1920) > 1 || Math.abs(b.top - 230) > 1 || Math.abs(b.width - 620) > 1 || Math.abs(b.height - 104) > 1) fails.push('stage pop-out: the box is at x ' + r1(b.left) + ', y ' + r1(b.top) + ', ' + r1(b.width) + ' by ' + r1(b.height) + ' and should be at x 1920, y 230, 620 by 104');
  const visible = (e) => {
    const eb = e.getBoundingClientRect();
    return (eb.width > 0 || eb.height > 0) && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
  };
  for (const c of box.querySelectorAll('*')) {
    if (!visible(c)) continue;
    const cb = c.getBoundingClientRect();
    if (cb.left < b.left - 1 || cb.right > b.right + 1 || cb.top < b.top - 1 || cb.bottom > b.bottom + 1) {
      fails.push('stage pop-out: ' + (String(c.className.baseVal ?? c.className).split(' ')[0] || c.tagName) + ' is outside the box (x ' + r1(cb.left) + ' to ' + r1(cb.right) + ', y ' + r1(cb.top) + ' to ' + r1(cb.bottom) + ')');
      break;
    }
  }
  // Text at least 16 px.
  for (const el of box.querySelectorAll('*')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 15.99) fails.push('stage pop-out: "' + el.textContent.trim().slice(0, 30) + '" is ' + px + ' px, under 16');
  }
  // The heading's controls and the view buttons each at least 32 px tall; the views side by side, none overlapping, none cut off at the edge.
  for (const btn of box.querySelectorAll('button')) {
    if (btn.getBoundingClientRect().height < 31.5) fails.push('stage pop-out: a button is ' + r1(btn.getBoundingClientRect().height) + ' px tall');
  }
  const views = [...box.querySelectorAll('.oa2-sp-view')];
  const rects = views.map((v) => v.getBoundingClientRect());
  for (let i = 1; i < rects.length; i++) if (rects[i].left < rects[i - 1].right - 1) fails.push('stage pop-out: view buttons ' + i + ' and ' + (i + 1) + ' overlap');
  const heading = box.querySelector('.oa2-hd');
  if (heading && heading.scrollWidth > heading.clientWidth + 1) fails.push('stage pop-out: the heading row runs past the box');
  const lit = views.filter((v) => v.getAttribute('aria-checked') === 'true').length;
  const sp = q.get('sp') ?? 'open';
  const wantLit = sp === 'open' || sp === 'closed' || sp === 'full' ? 1 : 0;
  if (lit !== wantLit) fails.push('stage pop-out: ' + lit + ' view buttons are lit (should be ' + wantLit + ')');
  if (!q.has('long') && wantLit === 1) {
    for (const v of views) {
      const s = v.querySelector('span');
      if (s && s.scrollWidth > s.clientWidth + 1) fails.push('stage pop-out: the label "' + s.textContent + '" is cut off');
    }
    const note = box.querySelector('.oa2-sp-note');
    if (note && note.scrollWidth > note.clientWidth + 1) fails.push('stage pop-out: the note is cut off');
  }
  return fails;
}

export default {
  name: 'onair-stagepop',
  gallery: {
    states: [
      state('open, a guest showing', 'sp=open', ['Prompter', 'Open', 'Close', 'Full screen', 'Stage', 'Share', 'Maya', 'Theo', 'Priya', NOTE]),
      state('open, three people and a screenshare', 'sp=open', ['Share', 'Maya', 'Theo', 'Priya'], '.oa2-sp-view:nth-child(2)'),
      state('closed', 'sp=closed', ['Closed', 'Open', NOTE]),
      state('add-on not connected', 'sp=waiting', ['Not connected', 'Firefox add-on not connected. Open the studio tab in Firefox.', NOTE, '!Maya']),
      state('full screen', 'sp=full', ['Full screen', 'Close', 'Priya', NOTE]),
      state('port busy', 'sp=busy', ['Port 47231 is in use by another program.']),
      state('link off', 'sp=off', ['The pop-out link is off on this PC.']),
      state('no screenshare', 'sp=open&spshare=none', ['Stage', 'Maya', 'Theo']),
    ],
  },
  fit: {
    variants: [
      variant('open, a guest showing', 'sp=open'),
      variant('closed', 'sp=closed'),
      variant('add-on not connected', 'sp=waiting'),
      variant('full screen', 'sp=full'),
      variant('port busy', 'sp=busy'),
      variant('link off', 'sp=off'),
      variant('no screenshare', 'sp=open&spshare=none'),
      variant('long camera name', 'sp=open&long=1'),
    ],
    measurements: { stagepop: measureStagePop },
    rules: {
      stagepop: (variantEntry, results, emit) => {
        for (const failure of results.stagepop) emit(`  FAIL ${failure}`);
        if (results.stagepop.length) return true;
        if (variantEntry.name.startsWith('Stage pop-out,')) emit('  ok   stage pop-out: the box at x 1920, y 230, 620 by 104 with everything inside it, text at least 16 px, buttons at least 32 px tall, the views side by side and cut off nowhere (except the long name), one view lit when connected');
        return false;
      },
    },
    breaks: {
      'stagepop-small-text': { css: '.oa2-sp-view { font-size: 12px !important; }', expect: /^ *FAIL stage pop-out: ".*" is [\d.]+ px, under 16/m, appliesTo: isNamed('open, a guest showing') },
      'stagepop-box-moves': { css: '.oa2-stagepop { top: 260px !important; }', expect: /^ *FAIL stage pop-out: the box is at/m, appliesTo: isNamed('closed') },
    },
  },
};
