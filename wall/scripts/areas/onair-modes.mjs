// The new On Air frame (development only, behind `?onair=v2`): the modes row, the Recording page and the Presenting page.
// Gallery states, fit variants, the `onair2` measurement and its deliberate breaks live here; the two big review scripts are not edited for it.

const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const HEAD = 'hz=onair&at=' + at + '&clock=review&weather=ok&screen=onair&onair=v2';
// A knob that is given replaces the default; the page reads the first of a repeated knob.
const full = (knobs) => `${HEAD}${/(^|&)show=/.test(knobs) ? '' : '&show=typical'}${/(^|&)marks=/.test(knobs) ? '' : '&marks=2'}${knobs ? '&' + knobs : ''}`;
const galleryQuery = (knobs) => full(knobs);
const fitQuery = (knobs) => `?${full(knobs)}`;
const state = (name, knobs, expect, actions) => ({ screen: 'onair', name: 'on air v2: ' + name, query: galleryQuery(knobs), custom: true, expect, actions });
const checks = ['.oa2 .oa2-modes', '.oa2 .oa2-why'];
const variant = (name, knobs, extra = {}) => ({ name: 'On Air v2, ' + name, q: fitQuery(knobs), checks, ...extra });

const REC = 'rec=1&oatake=3';
const MEET = 'call=teams&camera=1&meetnow=1';
const KEYS = '.oa2-reckeys .key-tile';

// Runs in the page: nothing here may refer to anything outside this function.
function measureOnAir2() {
  const fails = [];
  const root = document.querySelector('.oa2');
  const want = new URLSearchParams(location.search).get('onair') === 'v2' && new URLSearchParams(location.search).get('screen') === 'onair';
  if (!root) return want ? ['on air v2: the new frame did not open'] : [];
  const r1 = (n) => Math.round(n * 10) / 10;
  const mode = root.getAttribute('data-mode');
  const visible = (e) => {
    const b = e.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return false;
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const boxes = {
    '.oa2-modes': [124, 24, 640, 40],
    ...(mode === 'rec' ? { '.oa2-marks': [124, 84, 640, 230], '.oa2-outline': [800, 24, 890, 486], '.oa2-take': [1720, 24, 820, 166], '.oa2-reckeys': [1720, 202, 820, 110], '.oa2-lights-rec': [1720, 328, 820, 154] } : {}),
    ...(mode === 'meet' ? { '.oa2-talk': [124, 76, 640, 166], '.oa2-callchips': [124, 250, 640, 36], '.oa2-meeting': [124, 298, 640, 212], '.oa2-speaker': [800, 24, 1080, 486], '.oa2-callkeys': [1920, 24, 620, 192], '.oa2-lights-meet': [1920, 348, 620, 154] } : {}),
  };
  const empty = mode === 'rec' ? ['.oa2-empty-rec', [124, 336, 640, 104]] : mode === 'meet' ? ['.oa2-empty-meet', [1920, 230, 620, 104]] : null;
  const expected = Object.keys(boxes).length;
  const found = Object.keys(boxes).filter((s) => document.querySelector('.oa2 ' + s)).length;
  if (found !== expected) fails.push('on air v2: ' + found + ' of ' + expected + ' blocks are on the ' + mode + ' page');
  // The page for nothing on air is empty below the row: no other child of the frame, nothing drawn after it or before it, no text but the row's. (The Live page is measured by the onair-live area.)
  if (mode === 'none') {
    const others = [...root.children].filter((c) => c !== document.querySelector('.oa2 .oa2-modes'));
    if (others.length > 0) fails.push('on air v2: the ' + 'nothing on air' + ' page has ' + others.length + ' block(s) below the modes row (it must be empty)');
    const drawn = [getComputedStyle(root, '::after').content, getComputedStyle(root, '::before').content].filter((c) => c !== 'none' && c !== 'normal');
    if (drawn.length > 0) fails.push('on air v2: the ' + 'nothing on air' + ' page draws ' + drawn[0] + ' below the modes row (it must be empty)');
  }
  // Every block inside its table box (1 px of slack), and everything in it too.
  for (const [sel, [x, y, w, h]] of Object.entries(boxes)) {
    const el = document.querySelector('.oa2 ' + sel);
    if (!el) continue;
    const b = el.getBoundingClientRect();
    if (Math.abs(b.left - x) > 1 || Math.abs(b.top - y) > 1 || Math.abs(b.width - w) > 1 || Math.abs(b.height - h) > 1) {
      fails.push('on air v2: ' + sel + ' is at x ' + r1(b.left) + ', y ' + r1(b.top) + ', ' + r1(b.width) + ' by ' + r1(b.height) + ' and should be at x ' + x + ', y ' + y + ', ' + w + ' by ' + h);
      continue;
    }
    for (const c of el.querySelectorAll('*')) {
      if (!visible(c)) continue;
      const cb = c.getBoundingClientRect();
      if (cb.left < x - 1 || cb.right > x + w + 1 || cb.top < y - 1 || cb.bottom > y + h + 1) {
        fails.push('on air v2: ' + sel + ' holds ' + (c.className && c.className.baseVal === undefined ? '.' + String(c.className).split(' ')[0] : c.tagName) + ' at x ' + r1(cb.left) + ' to ' + r1(cb.right) + ', y ' + r1(cb.top) + ' to ' + r1(cb.bottom) + ', outside its box (x ' + x + ' to ' + (x + w) + ', y ' + y + ' to ' + (y + h) + ')');
        break;
      }
    }
  }
  // Nothing of the new frame above wall y 20 or below y 510.
  for (const c of root.querySelectorAll('*')) {
    if (!visible(c)) continue;
    const b = c.getBoundingClientRect();
    if (b.top < 19.5 || b.bottom > 510.5) {
      fails.push('on air v2: ' + (String(c.className).split(' ')[0] || c.tagName) + ' is at y ' + r1(b.top) + ' to ' + r1(b.bottom) + ', outside the band y 20 to 510');
      break;
    }
  }
  // The empty box exists, holds no child and draws nothing, and no block reaches into it.
  if (empty) {
    const el = document.querySelector('.oa2 ' + empty[0]);
    const [x, y, w, h] = empty[1];
    if (!el) fails.push('on air v2: the empty prompter box is missing');
    else {
      const b = el.getBoundingClientRect();
      if (Math.abs(b.left - x) > 1 || Math.abs(b.top - y) > 1 || Math.abs(b.width - w) > 1 || Math.abs(b.height - h) > 1) fails.push('on air v2: the empty prompter box is at x ' + r1(b.left) + ', y ' + r1(b.top) + ', ' + r1(b.width) + ' by ' + r1(b.height));
      const after = getComputedStyle(el, '::after').content;
      const before = getComputedStyle(el, '::before').content;
      if (el.children.length > 0 || (el.textContent || '').trim() !== '') fails.push('on air v2: the empty prompter box holds something');
      if ((after !== 'none' && after !== 'normal') || (before !== 'none' && before !== 'normal')) fails.push('on air v2: the empty prompter box draws ' + (after !== 'none' && after !== 'normal' ? after : before));
      for (const c of root.querySelectorAll(':scope > *')) {
        if (c === el || !visible(c)) continue;
        const cb = c.getBoundingClientRect();
        if (cb.left < x + w && x < cb.right && cb.top < y + h && y < cb.bottom) fails.push('on air v2: ' + (String(c.className).split(' ')[1] || c.className) + ' reaches into the empty prompter box');
      }
    }
  }
  // The reason is one line and inside the modes box.
  const why = root.querySelector('.oa2-why');
  const modes = root.querySelector('.oa2-modes');
  if (why && modes) {
    const wb = why.getBoundingClientRect();
    const mb = modes.getBoundingClientRect();
    if (Math.abs(wb.height - 22) > 1) fails.push('on air v2: the reason is ' + r1(wb.height) + ' px tall (one line is 22)');
    if (wb.left < mb.left - 0.5 || wb.right > mb.right + 0.5 || wb.top < mb.top - 0.5 || wb.bottom > mb.bottom + 0.5) fails.push('on air v2: the reason is outside the modes row');
  }
  // Every key tile at least 76 by 76.
  for (const tile of root.querySelectorAll('.key-tile')) {
    const b = tile.getBoundingClientRect();
    if (b.height < 75.5 || b.width < 75.5) fails.push('on air v2: key tile "' + tile.getAttribute('aria-label') + '" is ' + Math.round(b.width) + ' x ' + Math.round(b.height) + ' px (at least 76 by 76)');
  }
  // No text under 16 px.
  for (const e of root.querySelectorAll('*')) {
    if (!visible(e)) continue;
    if (![...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim())) continue;
    const px = parseFloat(getComputedStyle(e).fontSize);
    if (px < 15.99) {
      fails.push('on air v2: "' + (e.textContent || '').trim().slice(0, 28) + '" is ' + px + ' px');
      break;
    }
  }
  // The notes are not cut without "+N more".
  const list = root.querySelector('.oa-notes');
  if (list) {
    const lb = list.getBoundingClientRect();
    const notes = [...list.querySelectorAll(':scope > .oa-note')];
    const hidden = notes.filter((n) => getComputedStyle(n).display === 'none').length;
    const cutNote = notes.findIndex((n) => getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().bottom > lb.bottom + 0.5);
    const more = list.querySelector(':scope > .oa-more');
    const moreShown = more && getComputedStyle(more).display !== 'none' ? (more.textContent || '').trim() : '';
    if (list.scrollHeight > list.clientHeight + 0.5 || cutNote >= 0) fails.push('on air v2: the notes are cut (' + (cutNote >= 0 ? 'note ' + (cutNote + 1) + ' of ' + notes.length + ' ends below the card' : 'the list is ' + list.scrollHeight + ' px for ' + list.clientHeight) + ', ' + hidden + ' behind "+N more")');
    else if (hidden > 0 && moreShown !== '+' + hidden + ' more') fails.push('on air v2: the notes are cut: ' + hidden + ' hidden but the more line reads "' + moreShown + '"');
    else if (hidden === 0 && moreShown !== '') fails.push('on air v2: the more line reads "' + moreShown + '" with no note hidden');
  }
  // Watt's box and click box overlap no block.
  for (const [label, sel] of [['Watt', '.watt-sheep'], ['Watt click box', '.watt-hit']]) {
    const w = document.querySelector(sel);
    if (!w) continue;
    const wb = w.getBoundingClientRect();
    if (wb.width === 0 && wb.height === 0) continue;
    for (const c of root.querySelectorAll(':scope > *')) {
      if (!visible(c) || c.classList.contains('oa2-empty')) continue;
      const cb = c.getBoundingClientRect();
      if (wb.left < cb.right && cb.left < wb.right && wb.top < cb.bottom && cb.top < wb.bottom) fails.push('on air v2: ' + label + ' at x ' + r1(wb.left) + ' to ' + r1(wb.right) + ', y ' + r1(wb.top) + ' to ' + r1(wb.bottom) + ' overlaps ' + (String(c.className).split(' ')[1] || c.className));
    }
  }
  return fails;
}

const isNamed = (n) => (v) => v.name === 'On Air v2, ' + n;

export default {
  name: 'onair-modes',
  gallery: {
    states: [
      state('Recording, running (take 3)', REC, ['a recorder is running', 'Take timer', '04:12', 'Take 3. It started by itself at', 'Takes today: 3. The longest ran 06:40.', 'Load the data', 'Open marks.txt', 'Outline · Welcome and news', 'Recording keys', 'sent to the recorder', '!Held by hand']),
      state('Recording, paused', `${REC}&oapaused=1`, ['Take 3 is paused. The timer waits with the recorder.', 'Paused', 'Resume', '04:12']),
      state('Recording, held with nothing on', 'oamode=rec', ['Held by hand', 'No recording running. The timer starts with the recorder.', '00:00', 'Record', '!Take 3']),
      state('Recording, no marks yet', 'rec=1&marks=0', ['None yet today.', 'a recorder is running']),
      state('Recording, marks.txt full after a click', 'rec=1&marks=full', 'marks.txt is full; move it aside', `${KEYS}[data-kind="focus"]`),
      state('Recording, Pause answered', REC, ['Resume', 'Paused', 'Take 3 is paused'], `${KEYS}[aria-label="Pause"]`),
      state('Recording, the reason hovered', REC, 'a recorder is running', 'hover:.oa2-why'),
      state('Recording, Auto focused with the keyboard', REC, 'Auto', 'kbd:.oa2-auto'),
      state('Presenting, matched Teams call', MEET, ['a Teams call is on', 'Teams call on', 'camera on', 'mic on', 'Talk timer', '24:00', '36 min left', 'Community talk: November', '10:00 to 11:00 AM today', '42 invited. Organiser: Event host', 'You joined at 9:56 AM', 'Speaker notes · Welcome and news', 'Call keys', 'sent to Teams', 'Started 10:00 AM with the meeting']),
      state('Presenting, unmatched Zoom call', 'call=zoom&callsince=-12&meet=none', ['A Zoom call is on', 'No meeting on your calendar matches it', 'Started 10:12 AM, when the call began. No end time known.', 'Time left: not known. The timer counts up', 'On since 10:12 AM', 'sent to Zoom', '!Open in Outlook']),
      state('Presenting, browser call', 'call=browser&meetnow=1', ['a browser call is on', 'Browser call on', 'no keys for a browser call', 'Mute', 'Share screen']),
      state('Auto picks Recording over a call', `${REC}&call=teams&meetnow=1`, ['a recorder is running', 'Take timer', '!Held by hand']),
      state('held on Presenting while recording', `${REC}&call=teams&meetnow=1&oamode=meet`, ['Held by hand', 'Talk timer', 'Community talk: November']),
      state('Live picked from the browser camera and mic', 'callbrowserav=1&meet=none&yt=notsetup', ['mic or camera in use', '!Take timer', '!Talk timer']),
      state('nothing on air', '', ['nothing is on air', '!Take timer', '!Talk timer']),
    ],
  },
  fit: {
    variants: [
      variant('Recording running', REC),
      variant('Recording paused', `${REC}&oapaused=1`),
      variant('Recording held with nothing on', 'oamode=rec'),
      variant('nothing on air (empty below the row)', ''),
      variant('Presenting matched', MEET),
      variant('Presenting matched with a 120 character meeting title', `${MEET}&meetlong=1`),
      variant('Presenting unmatched', 'call=zoom&callsince=-12&meet=none'),
      variant('Presenting held while recording', `${REC}&call=teams&meetnow=1&oamode=meet`),
      variant('Recording, Watt standing at x 1000', 'oamode=rec&wattspot=1000'),
      variant('Recording, Watt standing at x 2300', 'oamode=rec&wattspot=2300'),
      variant('Recording, long notes', `${REC}&show=long`),
      variant('Presenting, long notes', `${MEET}&show=long`),
    ],
    measurements: { onair2: measureOnAir2 },
    rules: {
      onair2: (variantEntry, results, emit) => {
        for (const failure of results.onair2) emit(`  FAIL ${failure}`);
        if (results.onair2.length) return true;
        if (variantEntry.name.startsWith('On Air v2,')) emit('  ok   on air v2: every block in its planned box inside y 20 to 510, the empty boxes empty, the reason on one line, key tiles at least 76 px, text at least 16 px, no note cut without "+N more"');
        return false;
      },
    },
    breaks: {
      'onair2-why': { css: '.oa2-why { white-space: normal !important; }', query: '&whylong=1', expect: /^ *FAIL on air v2: the reason is [\d.]+ px tall/m, appliesTo: isNamed('Recording running') },
      'onair2-keys': { css: '.oa2 .key-tile { height: 30px !important; min-height: 0 !important; }', expect: /^ *FAIL on air v2: key tile ".*" is \d+ x \d+ px/m, appliesTo: isNamed('Recording running') },
      'onair2-box': { css: '.oa2-outline { width: 1100px !important; }', expect: /^ *FAIL on air v2: \.oa2-outline is at/m, appliesTo: isNamed('Recording running') },
      'onair2-empty': { css: '.oa2-empty-prompter::after { content: "x"; }', expect: /^ *FAIL on air v2: the empty prompter box draws/m, appliesTo: isNamed('Recording running') },
      'onair2-empty-none': { css: '.oa2::after { content: "x"; display: block; }', expect: /^ *FAIL on air v2: the nothing on air page draws/m, appliesTo: isNamed('nothing on air (empty below the row)') },
      'onair2-watt': { css: '.watt-sheep, .watt-hit { margin-top: -300px !important; }', expect: /^ *FAIL on air v2: Watt .* overlaps /m, appliesTo: isNamed('Recording, Watt standing at x 1000') },
    },
  },
};
