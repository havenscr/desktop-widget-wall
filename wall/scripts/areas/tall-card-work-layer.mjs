// The tall music card while the work layer is shown: unwind-work.css cuts it from 624 to 506 px so it ends above the lifted
// Office moods row. Every view inside it (Spotify and YouTube: the library, an opened playlist, For you, a playing list) must
// fit that height: each button sits whole inside the card with 10 px or more to its foot, unless it is a row of a list that
// scrolls inside its own scroll area. Nothing is registered in fit-check.mjs for it.

const day = '2026-11-11T10:24:00-08:00';
const SWITCH = '.sp-switch button:nth-child(2)';
const TALL = 'grow';
const TILE = '.yt-tile';
const LIKED = '.sp-tabs button:nth-child(3)';
const FORYOU = '.mu-places button:nth-child(1)';
const CLOSEFOCUS = '.yt-chip:nth-child(1)';
const steps = (...s) => s.join(' >> ');
const q = (extra) => `?hz=unwind&at=${day}&long=1&agents=3&${extra}`;
const play = (mode) => `youtube=in&ytlib=full&media=none&watch=mock&wtab=listen&ytplay=${mode}`;
const variant = (name, extra, click, more = {}) => ({ name: `Tall card with the work layer, ${name}`, q: q(extra), checks: ['.sp-card'], click, ...more });
const OPENED_YT = 'Tall card with the work layer, YouTube playlist opened';

/**
 * Runs in the page (it references nothing outside its own body). Puts the page in the layer-shown state itself (the frame's
 * `data-work-shown` mark; the layer's own open state needs a pointer) with transitions off, then reads the card: 506 px high,
 * and every button, field and slider whole inside it with 10 px or more to the foot. A control inside a list's own scroll
 * area may be partly scrolled away; the scroll area itself must still end inside the card with the same 10 px.
 */
function measureTallWork() {
  const st = document.createElement('style');
  st.textContent = '.sp-card, .u-foot, .u-office-slot { transition: none !important; }';
  document.head.appendChild(st);
  const main = document.querySelector('.main');
  const cardEl = document.querySelector('.sp-card');
  if (!main || !cardEl || cardEl.getAttribute('data-tall') !== 'true') return { tall: false, fails: [] };
  main.setAttribute('data-work-shown', '');
  void main.offsetHeight;
  const card = cardEl.getBoundingClientRect();
  const fails = [];
  const name = (e) => String((e.className?.baseVal ?? e.className) || e.tagName).slice(0, 28);
  const label = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20);
  if (Math.abs(card.height - 506) > 1.5) fails.push('the card is ' + Math.round(card.height) + ' px high (506 with the layer shown)');
  const scrolls = (e) => {
    for (let p = e.parentElement; p && p !== cardEl; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') return p;
    }
    return null;
  };
  let n = 0;
  for (const e of cardEl.querySelectorAll('button, input, [role="slider"]')) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(e).visibility === 'hidden') continue;
    if (scrolls(e)) continue;
    n++;
    if (r.bottom > card.bottom - 9.5) fails.push('button ' + name(e) + ' "' + label(e) + '" ends ' + Math.round(card.bottom - r.bottom) + ' px from the card foot (10 at least)');
  }
  for (const e of cardEl.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue;
    const r = e.getBoundingClientRect();
    if (r.height > 0 && r.bottom > card.bottom - 9.5) fails.push('scroll area ' + name(e) + ' ends ' + Math.round(card.bottom - r.bottom) + ' px from the card foot (10 at least)');
  }
  const small = [...cardEl.querySelectorAll('*')].filter((e) => !e.closest('.sp-off') && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 15.99);
  for (const e of small.slice(0, 3)) fails.push('text under 16 px in ' + name(e) + ' (' + getComputedStyle(e).fontSize + ')');
  return { tall: true, fails, buttons: n, cardBottom: Math.round(card.bottom) };
}

const UP = 'hover:.u-foot >> wait:900';
const night = '2026-11-11T22%3A30%3A00-08%3A00';
const gs = (name, extra, actions, expect) => ({ screen: 'unwind', name: `tall card, layer shown: ${name}`, query: `hz=unwind&at=${night}&clock=review&weather=ok&audio=demo${extra}`, custom: true, actions, expect });

export default {
  name: 'tall-card-work-layer',
  gallery: {
    states: [
      gs('a Spotify playlist opened', '', steps(TALL, '.sp-tile', UP), ['Lantern Song 9', 'Shuffle', '58 songs']),
      gs('a YouTube playlist opened', '&youtube=in&ytlib=full', steps(SWITCH, TALL, TILE, UP), ['Night Drive', '41 videos', 'Glass Harbor']),
    ],
  },
  fit: {
    variants: [
      variant('Spotify, Playlists', '&audio=demo', TALL),
      variant('Spotify, playlist opened', '&audio=demo', steps(TALL, '.sp-tile')),
      variant('Spotify, long names, playlist opened', '&spotify=long&media=long', steps(TALL, '.sp-tile')),
      variant('Spotify, playlist of 2000 songs', '&spotify=heavy', steps(TALL, '.sp-tile')),
      variant('Spotify, Up next', '&audio=demo', steps(TALL, '.mu-places button:nth-child(5)')),
      variant('Spotify, a playlist that is not his', '&audio=demo&spotify=notyours', steps(TALL, '.sp-tile')),
      variant('YouTube library, Playlists', 'youtube=in&ytlib=full', steps(SWITCH, TALL)),
      variant('YouTube library, Liked', 'youtube=in&ytlib=full', steps(SWITCH, TALL, LIKED)),
      variant('YouTube playlist opened', 'youtube=in&ytlib=full', steps(SWITCH, TALL, TILE)),
      variant('YouTube long names, playlist opened', 'youtube=in&ytlib=long', steps(SWITCH, TALL, TILE)),
      variant('For you', 'youtube=in&ytlib=full&ytplayed=6', steps(SWITCH, TALL, FORYOU, CLOSEFOCUS)),
      variant('For you, Focus open', 'youtube=in&ytlib=full&ytplayed=6', steps(SWITCH, TALL, FORYOU)),
      variant('YouTube playback, a playlist playing', play('on'), steps(SWITCH, TALL, TILE)),
      variant('YouTube playback, autoplay refused', play('refused'), steps(SWITCH, TALL, TILE)),
      variant('YouTube playback, a video skipped', play('skipped'), steps(SWITCH, TALL, TILE)),
      variant('YouTube playback, stopped after five', play('five'), steps(SWITCH, TALL, TILE)),
      variant('YouTube playback, nothing on', play(''), steps(SWITCH, TALL, TILE)),
      variant('YouTube playback, Liked playing', play('liked'), steps(SWITCH, TALL, LIKED)),
    ],
    measurements: { tallWork: measureTallWork },
    rules: {
      tallWork: (v, results, emit) => {
        if (!v.name.startsWith('Tall card with the work layer, ')) return false;
        const m = results.tallWork;
        if (!m || !m.tall) { emit('  FAIL tall card with the work layer: the tall card is not open'); return true; }
        for (const failure of m.fails) emit(`  FAIL tall card with the work layer: ${failure}`);
        if (m.fails.length) return true;
        emit(`  ok   tall card with the work layer: the card is 506 px high, ${m.buttons} pinned controls each 10 px or more above its foot, scroll areas inside it, no text under 16 px`);
        return false;
      },
    },
    breaks: {
      'tall-work-foot': { css: '.main[data-place="unwind"] .sp-card.tall, .main[data-place="unwind"] .sp-card.yt.tall { height: 624px !important; } .yt-songs.tall .sp-tracks, .sp-songs.tall .sp-tracks { max-height: none !important; }', expect: /^ *FAIL tall card with the work layer: /m, appliesTo: (v) => v.name === OPENED_YT },
    },
  },
};
