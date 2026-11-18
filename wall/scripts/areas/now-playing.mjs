// Home's Now Playing block (the left of the Sound card): music, the wall's own video, and both at once.
// Everything this area needs lives here; the two big review scripts are not edited for it.

const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const galleryQuery = (knobs) => `hz=home&at=${at}&clock=review&weather=ok&${knobs}`;
const state = (name, knobs, expect, actions) => ({ screen: 'home', name, query: galleryQuery(knobs), custom: true, ...(expect ? { expect } : {}), ...(actions ? { actions } : {}) });
const WALL = 'watch=mock&wlist=three&wplace=home';
const LIST = 'watch=mock&wlist=many&wplace=home';
const QUIET = 'sonos=quiet';


const homeQuery = (knobs) => `?hz=home&at=2026-11-12T16:36:00-08:00&long=1&moods=five&${knobs}`;
const variant = (name, layout, knobs) => ({ name, q: `${homeQuery(knobs)}&nowcheck=${layout}`, checks: ['.home .sound-panel', '.home .sound-np', '.home .sound-plays'] });

// What the block must be in every layout (nowcheck=<layout>): its box is main's (390 wide, the height of the Sound card's rows: 226 at
// the default card), one layer on screen once the cross-fade is over, nothing overlapping or leaving the layer, the control row
// at the foot (its bottom within 12 px of the block's), no title clipped without its ellipsis, every button 40 px or more and 8 px
// from the next, all text 16 px or more, and in the split view the hairline between the halves with 6 px clear of text on each side.
function measureNow() {
  const fails = [];
  const kind = new URLSearchParams(location.search).get('nowcheck');
  if (!kind) return { fails, info: '' };
  const block = document.querySelector('.home .sound-np');
  if (!block) return { fails: ['now playing: the block is not on the page'], info: '' };
  const R = (e) => e.getBoundingClientRect();
  const n = (v) => Math.round(v * 10) / 10;
  // Home's short form (the 64 px line with the studio lights under it) has its own box and no foot, bar or halves.
  const compact = block.classList.contains('compact');
  const layers = [...block.querySelectorAll(':scope > .np-layer')];
  const layer = layers.find((l) => !l.classList.contains('out')) || layers[0];
  if (layers.length !== 1) fails.push('now playing: ' + layers.length + ' layers on screen (one is expected once the cross-fade is over)');
  if (block.dataset.layout !== kind) fails.push('now playing: the block shows the ' + block.dataset.layout + ' layout, expected ' + kind);
  if (!layer) return { fails: fails.concat('now playing: no layer in the block'), info: '' };
  const bb = R(block);
  const panel = block.closest('.sound-panel');
  const pb = panel ? R(panel) : null;
  const plays = document.querySelector('.home .sound-plays');
  const first = plays ? R(plays) : null;
  const box = { x: n(bb.left), y: n(bb.top), w: n(bb.width), h: n(bb.height) };
  // Box: the card's own rows give it its box (main's 390 wide, 226 high at the default card), whatever the layout: it starts where the
  // first row starts, ends where the last row of the right column ends, and the layers never grow or shrink it.
  const rows = panel ? [...panel.children].filter((c) => c !== block && R(c).height > 0 && !c.classList.contains('sound-confirm')) : [];
  const rowsBottom = rows.length ? Math.max(...rows.map((c) => R(c).bottom)) : null;
  if (Math.abs(bb.width - (compact ? 398 : 390)) > 1.5) fails.push('now playing: the block is ' + box.w + ' px wide, ' + (compact ? 'the short form\'s is 398' : 'main\'s is 390'));
  if (compact && Math.abs(bb.height - 64) > 1) fails.push('now playing: the short form is ' + box.h + ' px high (64)');
  if (first && Math.abs(bb.top - first.top) > 2) fails.push('now playing: the block starts ' + n(bb.top - first.top) + ' px from the top of the card\'s first row');
  if (!compact && rowsBottom !== null && Math.abs(rowsBottom - bb.bottom) > 2) fails.push('now playing: the block is ' + box.h + ' px high but the card\'s rows give it ' + n(rowsBottom - bb.top) + ' (' + box.w + ' by ' + box.h + ' against ' + n(bb.width) + ' by ' + n(rowsBottom - bb.top) + ')');
  // Leaves: the parts that must not overlap or leave the layer.
  const lr = R(layer);
  const sel = 'button, img, .np-cover, .np-slot, .np-k, .np-title, .np-artist, .np-l1, .np-l2, .np-prog, .np-where, .np-mid, .np-hair';
  const leaves = [...layer.querySelectorAll(sel)].filter((e) => { const r = R(e); return r.width > 0 && r.height > 0; });
  const name = (e) => (e.getAttribute('aria-label') || e.className || e.tagName).toString().split(' ')[0] || e.tagName;
  for (const e of leaves) {
    const r = R(e);
    if (r.left < lr.left - 0.5 || r.right > lr.right + 0.5 || r.top < lr.top - 0.5 || r.bottom > lr.bottom + 0.5) fails.push('now playing: ' + name(e) + ' leaves the block (x ' + n(r.left) + ' to ' + n(r.right) + ', y ' + n(r.top) + ' to ' + n(r.bottom) + ' in x ' + n(lr.left) + ' to ' + n(lr.right) + ', y ' + n(lr.top) + ' to ' + n(lr.bottom) + ')');
  }
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i]; const b = leaves[j];
      if (a.contains(b) || b.contains(a)) continue;
      const x = R(a); const y = R(b);
      const w = Math.min(x.right, y.right) - Math.max(x.left, y.left);
      const h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
      if (w > 1 && h > 1) fails.push('now playing: ' + name(a) + ' overlaps ' + name(b) + ' (' + n(w) + ' by ' + n(h) + ' px)');
    }
  }
  // The foot: the control row (the music half in the split view) ends within 12 px of the block's bottom.
  const foot = kind === 'both' ? layer.querySelector('.np-half[data-half="music"]') : layer.querySelector('.np-foot');
  if (compact) {
    // The short form's controls sit at the line's right end.
    const btns = layer.querySelector('.np-btns');
    if (!btns) fails.push('now playing: no control row');
    else if (R(btns).right > bb.right + 0.5 || R(btns).bottom > bb.bottom + 0.5 || R(btns).top < bb.top - 0.5) fails.push('now playing: the control row leaves the line');
  } else if (!foot) fails.push('now playing: no control row');
  else {
    const gap = bb.bottom - R(foot).bottom;
    if (gap < -0.5 || gap > 12) fails.push('now playing: the control row ends ' + n(gap) + ' px from the block\'s bottom (0 to 12 allowed)');
  }
  // Titles, artists and lines: text that does not fit ends in an ellipsis (a line) or the line clamp (a title).
  for (const e of layer.querySelectorAll('.np-title, .np-artist, .np-l1, .np-l2, .np-where span, .np-mid.note')) {
    const cs = getComputedStyle(e);
    const wide = e.scrollWidth > e.clientWidth + 1;
    const tall = e.scrollHeight > e.clientHeight + 1;
    const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    if (wide && !clamp && cs.textOverflow !== 'ellipsis') fails.push('now playing: "' + e.textContent.slice(0, 24) + '" is clipped without an ellipsis (' + e.scrollWidth + ' px of text in ' + e.clientWidth + ')');
    if (tall && !clamp && cs.textOverflow !== 'ellipsis') fails.push('now playing: "' + e.textContent.slice(0, 24) + '" is clipped without an ellipsis (' + e.scrollHeight + ' px tall in ' + e.clientHeight + ')');
  }
  // Buttons: 40 px or more each way, 8 px or more from the next.
  const buttons = [...layer.querySelectorAll('button')].filter((e) => R(e).width > 0);
  for (const e of buttons) {
    const r = R(e);
    const least = compact ? 37.5 : 39.5;
    if (r.width < least || r.height < least) fails.push('now playing: the ' + name(e) + ' button is ' + n(r.width) + ' by ' + n(r.height) + ' px (' + (compact ? '38 by 38' : '40 by 40') + ' at least)');
  }
  for (let i = 0; i < buttons.length; i++) {
    for (let j = i + 1; j < buttons.length; j++) {
      const a = R(buttons[i]); const b = R(buttons[j]);
      const apart = Math.max(a.left - b.right, b.left - a.right, a.top - b.bottom, b.top - a.bottom);
      if (apart < 7.5) fails.push('now playing: the ' + name(buttons[i]) + ' and ' + name(buttons[j]) + ' buttons are ' + n(apart) + ' px apart (8 at least)');
    }
  }
  // Text: 16 px or more everywhere in the block.
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.nodeValue.trim()) continue;
    const fs = parseFloat(getComputedStyle(t.parentElement).fontSize);
    if (fs < 15.9) fails.push('now playing: "' + t.nodeValue.trim().slice(0, 24) + '" is set at ' + fs + ' px (16 at least)');
  }
  // The split view: the hairline between the halves, 6 px clear of text on each side.
  if (kind === 'both' && !compact) {
    const halves = [...layer.querySelectorAll('.np-half')];
    const hair = layer.querySelector('.np-hair');
    if (halves.length !== 2 || !hair) fails.push('now playing: the split view has ' + halves.length + ' halves and ' + (hair ? 'a' : 'no') + ' hairline');
    else {
      const h0 = R(halves[0]); const h1 = R(halves[1]); const hr = R(hair);
      if (!(h0.bottom <= hr.top + 0.5 && hr.bottom <= h1.top + 0.5)) fails.push('now playing: the hairline (y ' + n(hr.top) + ') is not between the halves (the first ends at ' + n(h0.bottom) + ', the second starts at ' + n(h1.top) + ')');
      halves.forEach((h, i) => {
        for (const e of h.querySelectorAll('.np-k, .np-title, .np-l1, .np-l2, button')) {
          const r = R(e);
          const clear = i === 0 ? hr.top - r.bottom : r.top - hr.bottom;
          if (clear < 5.5) fails.push('now playing: in the ' + (i === 0 ? 'first' : 'second') + ' half ' + name(e) + ' comes within ' + n(clear) + ' px of the hairline (6 at least)');
        }
      });
    }
  }
  return { fails, info: 'box ' + box.x + ',' + box.y + ' ' + box.w + ' by ' + box.h };
}

const BOTH = 'Home, Now Playing: both at once';
const NAMES = {
  music: 'Home, Now Playing: music with a cover and a time bar',
  musicLong: 'Home, Now Playing: music, a very long title, back and next',
  station: 'Home, Now Playing: a station with no length',
  noart: 'Home, Now Playing: music with no cover',
  quiet: 'Home, Now Playing: nothing playing',
  stale: 'Home, Now Playing: not live, dimmed',
  video: 'Home, Now Playing: the wall video',
  playlist: 'Home, Now Playing: a playlist on the wall',
  twitch: 'Home, Now Playing: a Twitch stream on the wall',
  click: 'Home, Now Playing: the wall video waits for a click',
  both: BOTH,
  bothLong: 'Home, Now Playing: both at once, long names and a station',
  bothPlaylist: 'Home, Now Playing: both at once, a playlist',
  bothClick: 'Home, Now Playing: both at once, the video waits for a click',
};
const SPLIT = (v) => v.name.startsWith(BOTH);
const MUSIC_OR_VIDEO = (v) => /Now Playing: (music|a station|the wall video|a playlist|a Twitch)/.test(v.name) || v.name === NAMES.click;
const LONG_TITLES = (v) => v.name === NAMES.musicLong || v.name === NAMES.bothLong;
const RULE = /[?&]nowcheck=(music|video|both|quiet)\b/;

export default {
  name: 'now-playing',
  gallery: { states: [
    // Music alone: the full block (cover, title, artist, time bar, controls at the foot).
    state('now playing: music with a cover and a time bar', '', ['Night Drive', 'Den, 4 speakers', '!1:05', '!Now playing']),
    state('now playing: music, no cover address (the speaker glyph)', 'np=noart', ['Night Drive', '!1:05']),
    state('now playing: a station with no length (no bar)', 'np=station', ['Night Drive', 'Den, 4 speakers', '!3:01']),
    state('now playing: back and next offered', 'np=skip', ['Night Drive']),
    state('now playing: back and next refused as a station that cannot skip', 'np=skip,skipfail,station', ['This station cannot skip'], 'button[aria-label="Next track"]'),
    state('now playing: a very long title and artist, two lines and an ellipsis', 'np=long,skip', ['A Song With A Rather Long Title']),
    state('now playing: heavy Sonos, long names', 'sonos=heavy&np=skip', ['Extended Mix']),
    state('now playing: not live, dimmed, the bar stopped', 'sonos=timeout&np=skip', ['Night Drive', 'Sonos did not answer in time']),
    state('now playing: nothing playing', QUIET, ['Nothing playing', 'Suggested for this hour']),
    state('now playing: a TV room is not music, the quiet words stay', `${QUIET}&np=tv`, ['Nothing playing', 'Suggested for this hour', '!On the wall']),
    state('now playing: a Spotify track on a speaker', 'spotifyplay=speaker', ['Living room']),
    state('now playing: Pause tip', 'np=skip', ['Pause every Sonos speaker'], 'hover:.sound-np .np-rd.big'),
    // The wall's own video alone.
    state('now playing: the wall video', `${QUIET}&${WALL}&wplay=0`, ['Night drive mix', 'On the wall. YouTube video', '!12:34']),
    state('now playing: the wall video, paused', `${QUIET}&${WALL}&wplay=0&wstate=paused`, ['Night drive mix', 'On the wall']),
    state('now playing: a playlist on the wall with back and next', `${QUIET}&${LIST}&wplay=3`, ['On the wall. YouTube playlist, 4 of 24']),
    state('now playing: a live stream on the wall (no length)', `${QUIET}&${WALL}&wplay=1`, ['Lofi beats radio, live', 'On the wall. YouTube live stream']),
    state('now playing: a Twitch stream takes only Stop', `${QUIET}&${WALL}&wplay=2`, ['Twitch stream', 'On the wall', '!12:34']),
    state('now playing: the wall video waits for a click', `${QUIET}&${WALL}&wplay=0&wstate=refused`, ['Click the video on Watch to start it']),
    // Both at once: two halves.
    state('now playing: both, video above music', `${WALL}&wplay=0`, ['Night Drive', 'Night drive mix']),
    state('now playing: both, a playlist', `${LIST}&wplay=3`, ['Night Drive']),
    state('now playing: both, a Twitch stream', `${WALL}&wplay=2`, ['Night Drive']),
    state('now playing: both, the video waits for a click', `${WALL}&wplay=0&wstate=refused`, ['Night Drive']),
    state('now playing: both, a station and long names', `${WALL}&wplay=0&np=station,long,skip`, ['A Song With A Rather Long Title']),
    state('now playing: both, the video paused', `${WALL}&wplay=0&wstate=paused`, ['Night Drive']),
  ] },

  fit: {
    variants: [
      variant(NAMES.music, 'music', 'sonos=typical'),
      variant(NAMES.musicLong, 'music', 'np=long,skip'),
      variant(NAMES.station, 'music', 'np=station,skip'),
      variant(NAMES.noart, 'music', 'np=noart'),
      variant(NAMES.quiet, 'quiet', 'sonos=quiet'),
      variant(NAMES.stale, 'music', 'sonos=timeout&np=skip'),
      variant(NAMES.video, 'video', `sonos=quiet&${WALL}&wplay=0`),
      variant(NAMES.playlist, 'video', `sonos=quiet&${LIST}&wplay=3`),
      variant(NAMES.twitch, 'video', `sonos=quiet&${WALL}&wplay=2`),
      variant(NAMES.click, 'video', `sonos=quiet&${WALL}&wplay=0&wstate=refused`),
      variant(NAMES.both, 'both', `${WALL}&wplay=0`),
      variant(NAMES.bothLong, 'both', `${WALL}&wplay=0&np=station,long,skip`),
      variant(NAMES.bothPlaylist, 'both', `${LIST}&wplay=3`),
      variant(NAMES.bothClick, 'both', `${WALL}&wplay=0&wstate=refused`),
    ],
    measurements: { nowPlaying: measureNow },
    rules: {
      nowPlaying: (variantEntry, results, emit) => {
        if (!RULE.test(variantEntry.q)) return false;
        const { fails, info } = results.nowPlaying;
        for (const failure of fails) emit(`  FAIL ${failure}`);
        if (fails.length) return true;
        emit(`  ok   now playing: main's box, as the card's rows give it (${info}), nothing overlapping or leaving it, the control row at the foot, titles end in an ellipsis, buttons 40 px and 8 px apart, text 16 px or more${/nowcheck=both/.test(variantEntry.q) ? ', the hairline between the halves' : ''}`);
        return false;
      },
    },
    breaks: {
      // The short form's box changes; parts overlap or leave the line; the controls leave it; a title is cut with no ellipsis.
      'now-box': { css: '.np-col > .sound-np { height: 100px !important; }', expect: /^ *FAIL now playing: the short form is [\d.]+ px high/m, appliesTo: (v) => v.name === NAMES.music },
      'now-overlap': { css: '.np-line .np-meta { margin-left: -50px !important; }', expect: /^ *FAIL now playing: .* overlaps .* \([\d.]+ by [\d.]+ px\)/m, appliesTo: (v) => v.name === NAMES.music || v.name === NAMES.video },
      'now-leave': { css: '.np-line .np-title { position: relative !important; left: 300px !important; }', expect: /^ *FAIL now playing: np-title leaves the block/m, appliesTo: (v) => v.name === NAMES.music || v.name === NAMES.both },
      'now-foot': { css: '.np-line .np-btns { margin-top: 50px !important; }', expect: /^ *FAIL now playing: the control row leaves the line/m, appliesTo: (v) => v.name === NAMES.music || v.name === NAMES.video },
      'now-clip': { css: '.np-line .np-title { text-overflow: clip !important; }', expect: /^ *FAIL now playing: ".*" is clipped without an ellipsis/m, appliesTo: LONG_TITLES },
      // Buttons too small or too close; text too small.
      'now-button-size': { css: '.np-line .np-rd, .np-line .np-rd.big { width: 30px !important; height: 30px !important; }', expect: /^ *FAIL now playing: the .* button is [\d.]+ by [\d.]+ px \(38 by 38 at least\)/m, appliesTo: MUSIC_OR_VIDEO },
      'now-button-gap': { css: '.np-line .np-btns { gap: 2px !important; }', expect: /^ *FAIL now playing: the .* and .* buttons are -?[\d.]+ px apart \(8 at least\)/m, appliesTo: (v) => v.name === NAMES.musicLong || v.name === NAMES.video },
      'now-text-size': { css: '.np-where, .np-title { font-size: 12px !important; }', expect: /^ *FAIL now playing: ".*" is set at [\d.]+ px \(16 at least\)/m, appliesTo: (v) => v.name === NAMES.music || v.name === NAMES.quiet },
    },
  },
};
