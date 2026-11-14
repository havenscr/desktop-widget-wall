// Home's Sound card: the Where row, the amber failure line, and the failed phases of a read.
// Everything this area needs lives here; the two big review scripts are not edited for it.

const homeQuery = (knobs) => `?hz=home&at=2026-11-12T16:36:00-08:00&long=1&${knobs}`;
const galleryQuery = (knobs) => `hz=home&at=${encodeURIComponent('2026-11-11T10:24:00-08:00')}&clock=review&weather=ok&${knobs}`;
const HOME_CENTRE = ['.home .home-centre', '.home .moods', '.home .mood-row', '.home .home-right'];
const SOUND_FULL = ['.home .sound', '.home .sound-panel', '.home .sound-plays', '.home .sound-line', '.home .sound-where', '.home .sound-plays .sound-chip'];
const state = (name, knobs, expect) => ({ screen: 'home', name, query: galleryQuery(knobs), custom: true, expect });
const variant = (name, knobs, kind, checks) => ({ name, q: `${homeQuery(knobs)}&soundcheck=${kind}`, checks });

// Where (soundcheck=where): the three buttons equal (1 px), filling the row up to its end (the row's own padding and border
// aside), content centred (1.5 px), not clipped, 19 px type. Line (soundcheck=line): the longest amber sentence (probed into
// the head in place of whatever is there) stays on one line and clear of the heading and of the card's edge.
function measureSound() {
    const sound = [];
    const soundCheck = new URLSearchParams(location.search).get('soundcheck');
    if (soundCheck === 'where') {
      const row = document.querySelector('.home .sound-where');
      const segs = row ? [...row.querySelectorAll('.seg')] : [];
      if (!row || segs.length !== 3) sound.push('sound where: expected the row with three buttons, found ' + segs.length);
      else {
        const rr = row.getBoundingClientRect();
        const ws = segs.map((e) => Math.round(e.getBoundingClientRect().width * 10) / 10);
        if (Math.max(...ws) - Math.min(...ws) > 1) sound.push('sound where: the three buttons are ' + ws[0] + ', ' + ws[1] + ' and ' + ws[2] + ' px wide (within 1 px of each other)');
        const lastRight = segs[2].getBoundingClientRect().right;
        const short = Math.round((rr.right - lastRight) * 10) / 10;
        if (short > 6.5) sound.push('sound where: the buttons stop ' + short + " px short of the row's end (at most 6.5: its padding and border)");
        for (const e of segs) {
          const b = e.getBoundingClientRect();
          const rg = document.createRange(); rg.selectNodeContents(e);
          const cb = rg.getBoundingClientRect();
          const off = Math.round(Math.abs((cb.left - b.left) - (b.right - cb.right)) * 10) / 10;
          if (off > 1.5) sound.push('sound where: "' + e.textContent + '" sits ' + off + ' px off centre (at most 1.5)');
          if (cb.left < b.left + 8 || cb.right > b.right - 8) sound.push('sound where: "' + e.textContent + '" is clipped (content ' + Math.round(cb.width) + ' px in a ' + Math.round(b.width) + ' px button, 8 px clear needed each side)');
          const fs = parseFloat(getComputedStyle(e).fontSize);
          if (Math.abs(fs - 19) > 0.5 && !(e.textContent === '')) sound.push('sound where: "' + e.textContent + '" is set at ' + fs + ' px, not 19');
        }
      }
    } else if (soundCheck === 'line') {
      const head = document.querySelector('.home .sound-head');
      const k = head && head.querySelector('.k');
      if (!head || !k) sound.push('sound line: no card head to test');
      else {
        let line = head.querySelector('.warn-text');
        if (!line) { line = document.createElement('span'); line.className = 'xs warn-text'; line.setAttribute('role', 'status'); head.appendChild(line); }
        line.textContent = 'Sonos sent an answer the wall could not read. Last good read less than a minute ago';
        const lb = line.getBoundingClientRect();
        const kb = k.getBoundingClientRect();
        const hb = head.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(line).lineHeight) || parseFloat(getComputedStyle(line).fontSize) * 1.3;
        if (lb.height > lh * 1.5) sound.push('sound line: the longest sentence wraps (' + Math.round(lb.height) + ' px tall, one line is ' + Math.round(lh) + ')');
        if (lb.left < kb.right + 8 - 0.5 && lb.top < kb.bottom && kb.top < lb.bottom) sound.push('sound line: the longest sentence covers the heading (its left edge ' + Math.round(lb.left) + ' against the heading ending at ' + Math.round(kb.right) + ', 8 px clear needed)');
        const edge = Math.round((hb.right - lb.right) * 10) / 10;
        if (edge < 12 - 0.5) sound.push('sound line: the longest sentence ends ' + edge + " px from the card head's edge (12 px clear needed)");
        if (lb.right > hb.right + 0.5 || lb.left < hb.left - 0.5) sound.push('sound line: the longest sentence leaves the card head (x ' + Math.round(lb.left) + ' to ' + Math.round(lb.right) + ' in ' + Math.round(hb.left) + ' to ' + Math.round(hb.right) + ')');
        const card = head.closest('.sound');
        const cr = card && card.getBoundingClientRect();
        if (cr && (lb.right > cr.right + 0.5 || lb.bottom > cr.bottom)) sound.push('sound line: the longest sentence leaves the card');
      }
    }
  return sound;
}

const WHERE = 'Home, Sound: the Where buttons';
const LINE = 'Home, Sound: the longest amber line';

export default {
  name: 'sound',
  gallery: { states: [
    // Where: the three places share the row, at rest and with each place in use.
    state('sound where: none in use', 'where=none', ['Office', 'All Speakers', 'Common Areas', 'Sonos Off']),
    state('sound where: Office in use', 'where=office', ['Office', 'All Speakers', 'Common Areas']),
    state('sound where: All Speakers in use', 'where=all', ['Office', 'All Speakers', 'Common Areas']),
    state('sound where: Common Areas in use', 'where=common', ['Office', 'All Speakers', 'Common Areas']),
    // Failed reads: a good first read, then a failed read and a failed second try. A review frame shortens the 5 second wait
    // to a quarter of a second, so each state shows its phase at once (the real timers are proven by the unit tests).
    state('sound failure: one failed read waiting for its second try, nothing shown', 'sonos=pending', ['Morning', 'Where', '!Sonos did not answer', '!Sonos cannot be reached', '!could not read']),
    state('sound failure: did not answer in time, dimmed', 'sonos=timeout', 'Sonos did not answer in time. Last good read less than a minute ago'),
    state('sound failure: cannot be reached, dimmed', 'sonos=dropped', 'Sonos cannot be reached. Last good read less than a minute ago'),
    state('sound failure: answer could not be read, dimmed', 'sonos=garbled', 'Sonos sent an answer the wall could not read. Last good read less than a minute ago'),
  ] },
  fit: {
    variants: [
      variant(WHERE, 'moods=five', 'where', ['.home .sound-where']),
      variant('Home, Sound: the Where buttons, Common Areas in use', 'moods=five&where=common', 'where', ['.home .sound-where']),
      variant('Home, Sound: the Where buttons, long preset names', 'sonos=heavy&moods=many', 'where', ['.home .sound-where']),
      variant(LINE, 'moods=five', 'line', ['.home .sound-head']),
      variant('Home, Sound: the longest amber line, Sound at its fullest', 'sonos=heavy&moods=many', 'line', ['.home .sound-head']),
      // Each failed phase of the card, at once: dimmed with each kind's line, and one failed read waiting.
      variant('Home, Sound dimmed: did not answer in time', 'sonos=timeout&moods=five', 'line', [...HOME_CENTRE, ...SOUND_FULL]),
      variant('Home, Sound dimmed: answer could not be read', 'sonos=garbled&moods=five', 'line', [...HOME_CENTRE, ...SOUND_FULL]),
      variant('Home, Sound: one failed read waiting for its second try', 'sonos=pending&moods=five', 'where', [...HOME_CENTRE, ...SOUND_FULL]),
    ],
    measurements: { sound: measureSound },
    rules: {
      sound: (variantEntry, results, emit) => {
        const kind = /[?&]soundcheck=(where|line)\b/.exec(variantEntry.q)?.[1];
        if (!kind) return false;
        for (const failure of results.sound) emit(`  FAIL ${failure}`);
        if (results.sound.length) return true;
        emit(kind === 'where' ? '  ok   sound where: three equal buttons filling the row, content centred, not clipped, 19 px' : '  ok   sound line: the longest sentence on one line, clear of the heading, inside the card');
        return false;
      },
    },
    breaks: {
      // One Where button narrower; all three short of the row's end; content pushed left; type too big for the box.
      'sound-equal': { css: '.sound-where .seg:nth-of-type(2) { flex: 0 0 90px !important; }', expect: /^ *FAIL sound where: the three buttons are [\d.]+, [\d.]+ and [\d.]+ px wide/m, appliesTo: (v) => v.name === WHERE },
      'sound-fill': { css: '.sound-where .seg { flex: 0 0 150px !important; }', expect: /^ *FAIL sound where: the buttons stop [\d.]+ px short of the row's end/m, appliesTo: (v) => v.name === WHERE },
      'sound-centre': { css: '.sound-panel.l2 .sound-where .seg { justify-content: flex-start !important; }', expect: /^ *FAIL sound where: ".*" sits [\d.]+ px off centre/m, appliesTo: (v) => v.name === WHERE },
      'sound-clip': { css: '.sound-where .seg { font-size: 34px !important; }', expect: /^ *FAIL sound where: ".*" is clipped/m, appliesTo: (v) => v.name === WHERE },
      // The amber line squeezed to wrap; laid over the heading; flush with the card's edge.
      'sound-wrap': { css: '.sound-head .warn-text { white-space: normal !important; width: 160px !important; }', expect: /^ *FAIL sound line: the longest sentence wraps/m, appliesTo: (v) => v.name === LINE },
      'sound-cover': { css: '.sound-head .warn-text { position: absolute !important; left: 0 !important; }', expect: /^ *FAIL sound line: the longest sentence covers the heading/m, appliesTo: (v) => v.name === LINE },
      'sound-edge': { css: '.sound-head .warn-text { margin-right: 0 !important; }', expect: /^ *FAIL sound line: the longest sentence ends [\d.]+ px from the card head's edge/m, appliesTo: (v) => v.name === LINE },
    },
  },
};
