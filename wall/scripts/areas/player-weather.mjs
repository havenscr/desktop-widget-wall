// The Listen player with an ended session, and the Work card with the weather failed (its reason in plain sight).
// Everything this area needs lives here; the two big review scripts are not edited for it.

const NOON = encodeURIComponent('2026-11-11T10:24:00-08:00');
const NIGHT = encodeURIComponent('2026-11-11T22:30:00-08:00');
const workQuery = (knobs) => `hz=work&at=${NOON}&clock=review&${knobs}`;
const unwindQuery = (knobs) => `hz=unwind&at=${NIGHT}&clock=review&${knobs}`;
const fitWork = (knobs, kind) => `?${workQuery(knobs)}&npcheck=${kind}`;
const fitUnwind = (knobs, kind) => `?${unwindQuery(knobs)}&npcheck=${kind}`;

const WHY = 'Work, weather refused: the reason under "Weather unavailable"';
const WHY_LANES = 'Work, weather refused with agent lanes: the reason under "Weather unavailable"';
const PLAYER = 'Listen, an ended session: last played with the play button';

// Why (npcheck=why): the reason text sits inside the card it is printed in, is at least 16 px, and takes two lines at most.
// Player (npcheck=player): the top player is the idle "last played" view with the play button, no time bar and no pause button.
function measureNp() {
  const out = [];
  const kind = new URLSearchParams(location.search).get('npcheck');
  if (kind === 'why') {
    const why = document.querySelector('.focus-note .wx-why');
    const card = why && why.closest('.panel');
    if (!why || !card || !/\S/.test(why.textContent || '')) out.push('np why: expected the reason text inside the focus card, found none');
    else {
      const w = why.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      if (w.left < c.left - 0.5 || w.right > c.right + 0.5 || w.top < c.top - 0.5 || w.bottom > c.bottom + 0.5) {
        out.push('np why: the reason leaves its card (x ' + Math.round(w.left) + ' to ' + Math.round(w.right) + ' in ' + Math.round(c.left) + ' to ' + Math.round(c.right) + ', y ' + Math.round(w.top) + ' to ' + Math.round(w.bottom) + ' in ' + Math.round(c.top) + ' to ' + Math.round(c.bottom) + ')');
      }
      const fs = parseFloat(getComputedStyle(why).fontSize);
      if (fs < 16) out.push('np why: the reason is set at ' + fs + ' px (16 px floor)');
      const lh = parseFloat(getComputedStyle(why).lineHeight) || fs * 1.25;
      if (w.height > lh * 2.5) out.push('np why: the reason takes ' + Math.round(w.height / lh) + ' lines (at most 2)');
    }
  } else if (kind === 'player') {
    const p = document.querySelector('.u-player');
    if (!p) out.push('np player: no top player to test');
    else {
      const state = p.getAttribute('data-state');
      if (state !== 'idle') out.push('np player: an ended session shows the "' + state + '" view, not the last played view');
      if (p.querySelector('[role="progressbar"]')) out.push('np player: a time bar is shown for an ended session');
      if (p.querySelector('[aria-label="Pause"]')) out.push('np player: the pause button is shown for an ended session');
      const play = p.querySelector('[aria-label="Play"]');
      if (!play) out.push('np player: no play button for an ended session');
      else if (play.disabled) out.push('np player: the play button is disabled for an ended session');
      if (!/Last played/.test(p.textContent || '')) out.push('np player: the words "Last played" are not shown');
    }
  }
  return out;
}

export default {
  name: 'player-weather',
  gallery: { states: [
    { screen: 'unwind', name: 'player: Listen with an ended session', query: unwindQuery('weather=ok&media=ended'), custom: true, expect: ['Last played on Video App', 'Evening Radio Mix', 'Play again'] },
    { screen: 'work', name: 'weather: refused (429), the reason and the next try on the Work card', query: workQuery('weather=refused&agents=0'), custom: true, expect: ['Weather unavailable', 'Open-Meteo is refusing this address for now (too many requests). Next try at'] },
    { screen: 'work', name: 'weather: this PC could not look up the address', query: workQuery('weather=dns&agents=0'), custom: true, expect: ['Weather unavailable', "This PC could not look up Open-Meteo's address."] },
    { screen: 'work', name: 'weather: Open-Meteo refuses, the National Weather Service answers', query: workQuery('weather=second&agents=0'), custom: true, expect: ['Overcast', '!Weather unavailable'] },
  ] },
  fit: {
    variants: [
      { name: WHY, q: fitWork('weather=refused&agents=0', 'why'), checks: ['.focus-note .wx-status'] },
      { name: WHY_LANES, q: fitWork('weather=refused&agents=3', 'why'), checks: ['.focus-note .wx-status'] },
      { name: PLAYER, q: fitUnwind('weather=ok&media=ended', 'player'), checks: ['.u-player'] },
    ],
    measurements: { np: measureNp },
    rules: {
      np: (variantEntry, results, emit) => {
        const kind = /[?&]npcheck=(why|player)\b/.exec(variantEntry.q)?.[1];
        if (!kind) return false;
        for (const failure of results.np) emit(`  FAIL ${failure}`);
        if (results.np.length) return true;
        emit(kind === 'why' ? '  ok   np why: the reason is inside its card, at least 16 px, two lines at most' : '  ok   np player: last played view, play button, no time bar, no pause button');
        return false;
      },
    },
    breaks: {
      // The reason pushed out of its card (no wrapping, huge type); the reason below the 16 px floor; an ended session shown as live.
      'np-why-out': { css: '.wx-why { white-space: nowrap !important; font-size: 90px !important; }', expect: /^ *FAIL np why: the reason leaves its card/m, appliesTo: (v) => v.name === WHY || v.name === WHY_LANES },
      'np-why-small': { css: '.wx-why { font-size: 12px !important; }', expect: /^ *FAIL np why: the reason is set at [\d.]+ px/m, appliesTo: (v) => v.name === WHY },
      'np-player-live': { query: '&mediabreak=live', expect: /^ *FAIL np player: an ended session shows the "playing" view/m, appliesTo: (v) => v.name === PLAYER },
    },
  },
};
