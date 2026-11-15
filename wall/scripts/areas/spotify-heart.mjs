// The heart (Save to Liked) at the right end of the music card's player row: its gallery states, fit variants, one browser
// measurement with its rules, and the deliberate breaks. The heart is 36 px, sits inside the row at its right end, keeps at least
// 8 px from the time bar's end label, leaves every other part of the row in the box it had, and its note stays inside the card.

/**
 * Runs in the page (it references nothing outside its own body). Boxes of the player row's parts and of the heart's note, as
 * plain numbers, so the rules (which run in the script) do the arithmetic.
 */
function measureHeart() {
  // Transitions off first, so the boxes measured are the ones the card settles on.
  const st = document.createElement('style');
  st.textContent = '.sp-card { transition: none !important; }';
  document.head.appendChild(st);
  const q = (s) => document.querySelector(s);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  };
  const row = q('.sp-player');
  const times = row ? [...row.querySelectorAll('.sp-pl-time')] : [];
  const ask = q('.sp-heart-ask');
  const askText = ask?.querySelector('p');
  const askButton = ask?.querySelector('button');
  return {
    row: box(row),
    card: box(q('.sp-card')),
    heart: box(q('.sp-heart')),
    cover: box(q('.sp-pl-cover')),
    title: box(q('.sp-pl-title')),
    previous: box(q('[data-control="previous"]')),
    play: box(q('[data-control="play"]')),
    next: box(q('[data-control="next"]')),
    seek: box(q('.sp-seek')),
    end: box(times[1]),
    ask: box(ask),
    askButton: box(askButton),
    askRefused: !!ask?.classList.contains('refused'),
    // The sentence is shown whole: no ellipsis or clipping in the note's text, and the note holds it.
    askClipped: !!askText && (askText.scrollWidth > askText.clientWidth + 1 || askText.scrollHeight > askText.clientHeight + 1 || (ask && ask.scrollWidth > ask.clientWidth + 1)),
    askFont: askText ? parseFloat(getComputedStyle(askText).fontSize) : 0,
    askButtonFont: askButton ? parseFloat(getComputedStyle(askButton).fontSize) : 0,
  };
}

const at = '2026-11-11T10:24:00-08:00';
const night = '2026-11-11T22%3A30%3A00-08%3A00';
const fitQuery = (extra) => `?hz=unwind&at=${at}&long=1&agents=3${extra}`;
const NO_HEART = 'Heart, the tall view, an episode has no heart';
const NOTE = 'Heart, the tall view, the note on the dim heart';
const REFUSED = 'Heart, the tall view, the save refused';
const SAVED = 'Heart, the tall view, saved';
const variant = (name, extra, click) => ({ name, q: fitQuery(extra), checks: ['.sp-card'], ...(click ? { click } : {}) });
const base = `hz=unwind&at=${night}&clock=review&weather=ok&audio=demo`;
const state = (name, extra, expect, actions) => ({ screen: 'unwind', name: `heart: ${name}`, query: `${base}${extra}`, custom: true, ...expect, actions });

export default {
  name: 'spotify-heart',
  gallery: {
    states: [
      state('not saved, pointer on it', '&spotifyheart=unsaved', { expect: ['Save to Liked Songs', 'Lantern Song 1'] }, '.sp-grow >> hover:.sp-heart'),
      state('saved, pointer on it', '&spotifyheart=saved', { expect: ['Remove from Liked Songs', 'Lantern Song 1'] }, '.sp-grow >> hover:.sp-heart'),
      state('saved, pointer away', '&spotifyheart=saved', { expectNote: 'the heart is filled in the wall pink' }, '.sp-grow'),
      state('just saved by a click', '&spotifyheart=unsaved', { expectNote: 'the heart turned pink after the click' }, '.sp-grow >> .sp-heart'),
      state('just removed by a click', '&spotifyheart=saved', { expectNote: 'the heart went back to an outline after the click' }, '.sp-grow >> .sp-heart'),
      state('Spotify refused the save', '&spotifyheart=savefail', { expect: ['Could not save this song'] }, '.sp-grow >> .sp-heart'),
      state('the saved read failed', '&spotifyheart=readfail', { expect: ['Could not check if it is saved.'] }, '.sp-grow >> hover:.sp-heart'),
      state('permission not known yet, the heart works', '&spotifyheart=unknown', { expect: ['Save to Liked Songs'] }, '.sp-grow >> hover:.sp-heart'),
      state('permission not known yet, then refused for it', '&spotifyheart=unknownlacks', { expect: ['Saving songs needs one more permission. Sign in to Spotify again in Tools.'] }, '.sp-grow >> .sp-heart'),
      state('permission missing, pointer on it', '&spotifyheart=nopermission', { expect: ['Needs one more Spotify permission. Click to see how.'] }, '.sp-grow >> hover:.sp-heart'),
      state('permission missing, the note', '&spotifyheart=nopermission', { expect: ['Saving songs needs one more permission. Sign in to Spotify again in Tools.', 'Open Tools'] }, '.sp-grow >> .sp-heart'),
      state('permission missing, Open Tools', '&spotifyheart=nopermission', { expect: ['Spotify', 'Sign in'] }, '.sp-grow >> .sp-heart >> .sp-heart-ask .sp-btn'),
      state('an episode has no heart', '&spotifyheart=episode', { expectNote: 'no heart at the right end of the row' }, '.sp-grow'),
      state('nothing playing has no heart', '&spotifyplay=none&media=none', { expect: ['Nothing playing'] }, '.sp-grow'),
      state('long names beside the heart', '&spotify=long&media=long&spotifyheart=saved', { expect: ['Lantern Song 1, an extremely long name'] }, '.sp-grow'),
    ],
  },
  fit: {
    variants: [
      variant(SAVED, '&audio=demo&spotifyheart=saved', '.sp-grow'),
      variant('Heart, the tall view, not saved', '&audio=demo&spotifyheart=unsaved', '.sp-grow'),
      variant(REFUSED, '&audio=demo&spotifyheart=savefail', '.sp-grow >> .sp-heart'),
      variant('Heart, the tall view, the permission not known yet', '&audio=demo&spotifyheart=unknown', '.sp-grow'),
      variant('Heart, the tall view, the note after a refusal that names the permission', '&audio=demo&spotifyheart=unknownlacks', '.sp-grow >> .sp-heart'),
      variant('Heart, the tall view, the dim heart', '&audio=demo&spotifyheart=nopermission', '.sp-grow'),
      variant(NOTE, '&audio=demo&spotifyheart=nopermission', '.sp-grow >> .sp-heart'),
      variant('Heart, the tall view, long names', '&spotify=long&media=long&spotifyheart=saved', '.sp-grow'),
      variant(NO_HEART, '&audio=demo&spotifyheart=episode', '.sp-grow'),
    ],
    measurements: { spotifyHeart: measureHeart },
    rules: {
      spotifyHeart: (variant, results, emit) => {
        if (!variant.name.startsWith('Heart, ')) return false;
        const m = results.spotifyHeart;
        const fails = [];
        const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
        const size = (name, b, w, h) => {
          if (!b) fails.push(`heart: ${name} is not in the player row`);
          else if (!near(b.w, w) || !near(b.h, h)) fails.push(`heart: ${name} is ${Math.round(b.w)} by ${Math.round(b.h)} px (${w} by ${h})`);
        };
        if (!m || !m.row || !m.card) {
          emit('  FAIL heart: the player row is not on the page');
          return true;
        }
        // The row's other parts keep the boxes the build before the heart gave them.
        size('the cover', m.cover, 48, 48);
        size('Previous', m.previous, 36, 36);
        size('Play or Pause', m.play, 44, 44);
        size('Next', m.next, 36, 36);
        if (!m.title || !near(m.title.w, 180)) fails.push(`heart: the song title box is ${m.title ? Math.round(m.title.w) : 0} px wide (180)`);
        if (!m.seek || !near(m.seek.h, 6)) fails.push(`heart: the time bar is ${m.seek ? Math.round(m.seek.h) : 0} px tall (6)`);
        if (variant.name === NO_HEART) {
          if (m.heart) fails.push('heart: a song without an id still has a heart');
          // The time bar takes the room: its end label ends at the row's right end.
          if (m.end && !near(m.end.r, m.row.r)) fails.push(`heart: with no heart the end label ends ${Math.round(m.row.r - m.end.r)} px short of the row's right end`);
        } else if (!m.heart) {
          fails.push('heart: the heart is not at the right end of the row');
        } else {
          size('the heart', m.heart, 36, 36);
          if (m.heart.l < m.row.l - 0.5 || m.heart.r > m.row.r + 1 || m.heart.t < m.row.t - 0.5 || m.heart.b > m.row.b + 0.5) fails.push('heart: the heart sticks out of the player row');
          if (!near(m.heart.r, m.row.r, 1.5)) fails.push(`heart: the heart is ${Math.round(m.row.r - m.heart.r)} px from the right end of the row (0)`);
          if (m.end && m.heart.l - m.end.r < 7.5) fails.push(`heart: the heart is ${Math.round(m.heart.l - m.end.r)} px from the time bar's end label (8 at least)`);
          if (m.play && !near(m.heart.t + m.heart.h / 2, m.play.t + m.play.h / 2, 2)) fails.push('heart: the heart is not on the line of the play button');
        }
        if (m.ask) {
          if (m.ask.l < m.card.l - 0.5 || m.ask.r > m.card.r + 0.5 || m.ask.t < m.card.t - 0.5 || m.ask.b > m.card.b + 0.5) fails.push('heart: the note leaves the card');
          if (m.heart && m.ask.r > m.heart.r + 1) fails.push('heart: the note runs past the heart to the right');
          if (m.heart && m.ask.b > m.heart.t + 0.5) fails.push('heart: the note covers the heart');
          if (m.heart && Math.abs(m.ask.r - m.heart.r) > 2) fails.push(`heart: the note is not beside the heart (its right edge is ${Math.round(m.heart.r - m.ask.r)} px from the heart's)`);
          if (m.askFont < 15.99 || (m.askButton && m.askButtonFont < 15.99)) fails.push(`heart: text under 16 px in the note (${m.askFont} and ${m.askButtonFont})`);
          if (m.askClipped) fails.push('heart: the sentence in the note is cut off');
          if (!m.askRefused && (!m.askButton || m.askButton.h < 31.5 || m.askButton.w < 31.5)) fails.push('heart: the Open Tools button is under 32 px');
        } else if (variant.name === NOTE || variant.name === REFUSED) {
          fails.push(variant.name === NOTE ? 'heart: the note did not open on a click' : 'heart: the refusal note did not show after the refused save');
        }
        for (const f of fails) emit(`  FAIL ${f}`);
        if (fails.length) return true;
        emit(variant.name === NO_HEART
          ? '  ok   heart: no heart for a song without an id, the other parts of the row in their boxes, the end label at the row\'s right end'
          : `  ok   heart: 36 by 36 at the right end of the row, 8 px or more from the end label, the other parts of the row in their boxes${m.ask ? ', the note inside the card' : ''}`);
        return false;
      },
    },
    breaks: {
      'heart-size': { css: '.sp-pl-btn.sp-heart { width: 28px !important; height: 28px !important; }', expect: /^ *FAIL heart: the heart is \d+ by \d+ px \(36 by 36\)/m, appliesTo: (v) => v.name === SAVED },
      'heart-gap': { css: '.sp-heart-wrap { margin-left: -20px !important; }', expect: /^ *FAIL heart: the heart is -?\d+ px from the time bar's end label/m, appliesTo: (v) => v.name === SAVED },
      'heart-out': { css: '.sp-heart-wrap { margin-right: -30px !important; }', expect: /^ *FAIL heart: the heart sticks out of the player row/m, appliesTo: (v) => v.name === SAVED },
      'heart-line': { css: '.sp-heart-wrap { transform: translateY(-14px) !important; }', expect: /^ *FAIL heart: the heart is not on the line of the play button/m, appliesTo: (v) => v.name === SAVED },
      'heart-cover': { css: '.sp-pl-cover { width: 40px !important; height: 40px !important; }', expect: /^ *FAIL heart: the cover is \d+ by \d+ px \(48 by 48\)/m, appliesTo: (v) => v.name === SAVED },
      'heart-title': { css: '.sp-pl-title { flex: 0 0 150px !important; }', expect: /^ *FAIL heart: the song title box is \d+ px wide \(180\)/m, appliesTo: (v) => v.name === SAVED },
      'heart-play': { css: '.sp-pl-btn.big { width: 36px !important; height: 36px !important; }', expect: /^ *FAIL heart: Play or Pause is \d+ by \d+ px \(44 by 44\)/m, appliesTo: (v) => v.name === SAVED },
      'heart-note-out': { css: '.sp-heart-ask { right: -420px !important; }', expect: /^ *FAIL heart: the note leaves the card/m, appliesTo: (v) => v.name === NOTE },
      'heart-note-text': { css: '.sp-heart-ask p { font-size: 13px !important; }', expect: /^ *FAIL heart: text under 16 px in the note/m, appliesTo: (v) => v.name === NOTE },
      'heart-prev': { css: '[data-control="previous"] { width: 30px !important; height: 30px !important; }', expect: /^ *FAIL heart: Previous is \d+ by \d+ px \(36 by 36\)/m, appliesTo: (v) => v.name === SAVED },
      'heart-next': { css: '[data-control="next"] { width: 30px !important; height: 30px !important; }', expect: /^ *FAIL heart: Next is \d+ by \d+ px \(36 by 36\)/m, appliesTo: (v) => v.name === SAVED },
      'heart-bar': { css: '.sp-seek { height: 10px !important; }', expect: /^ *FAIL heart: the time bar is \d+ px tall \(6\)/m, appliesTo: (v) => v.name === SAVED },
      // The mock keeps an id on the episode, so a heart appears for an item that should have none.
      'heart-noid': { query: '&spotifyheartid=1', expect: /^ *FAIL heart: a song without an id still has a heart/m, appliesTo: (v) => v.name === NO_HEART },
      'heart-open-tools': { css: '.sp-heart-ask .sp-btn { height: 24px !important; }', expect: /^ *FAIL heart: the Open Tools button is under 32 px/m, appliesTo: (v) => v.name === NOTE },
      'heart-note-beside': { css: '.sp-heart-ask { right: 70px !important; }', expect: /^ *FAIL heart: the note is not beside the heart/m, appliesTo: (v) => v.name === NOTE },
      'heart-refusal-cut': { css: '.sp-heart-ask.refused { width: 90px !important; max-width: 90px !important; } .sp-heart-ask.refused p { overflow: hidden !important; white-space: nowrap !important; text-overflow: ellipsis !important; }', expect: /^ *FAIL heart: the sentence in the note is cut off/m, appliesTo: (v) => v.name === REFUSED },
      'heart-note-cover': { css: '.sp-heart-ask { bottom: 20px !important; }', expect: /^ *FAIL heart: the note covers the heart/m, appliesTo: (v) => v.name === NOTE },
    },
  },
};
