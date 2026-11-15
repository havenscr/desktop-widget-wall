// Watch list fixes: the left block's real title and channel for a single video, and the paste offer
// under the list's field. One area file: gallery states, fit variants, the in-page measurement, its rule
// and the deliberate breaks. The mock player's words are invented (see `devMocks/watch.ts`).
//
// The gallery's `type:` action cuts its value at the second `=`, so a link with both `v=` and `list=` cannot
// be typed in it; the offer is shown by the `woffer=1` knob instead, and unit tests paste the real link.

const BASE = 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock';
const TITLE = 'Rooftop synth session, the full set';
const CHANNEL = 'Harbor Light Studio';
const SHORTS = 'type:.w-paste=https://www.youtube.com/shorts/Ab3dEfGh1jQ >> .w-add >> .w-row.editing .w-mini';

const state = (name, extra, expect, actions) => ({
  screen: 'unwind',
  name: `watch list: ${name}`,
  query: `${BASE}&${extra}`,
  custom: true,
  expect,
  ...(actions ? { actions } : {}),
});

const states = [
  state('a video with its title and channel', 'wlist=three&wlook=sky&wplay=0&wmeta=title', [TITLE, CHANNEL, 'Playing on the wall']),
  state('the long title and the long channel, whole sky', 'wlist=three&wlook=sky&wplay=0&wmeta=long', ['A very long title for the review states', 'The Harbor Light Studio and Friends Collective']),
  state('title not known yet, the label shows and no channel line', 'wlist=three&wlook=sky&wplay=0', ['Night drive mix', 'Playing on the wall', `!${CHANNEL}`]),
  state('a report for another video, the label shows', 'wlist=three&wlook=sky&wplay=0&wmeta=other', ['Night drive mix', '!Some other channel', '!A title for some other video']),
  state('a live stream with its title', 'wlist=three&wlook=sky&wplay=1&wmeta=title', [TITLE, CHANNEL]),
  state('a playlist, unchanged', 'wlist=many&wlook=sky&wplay=3&wmeta=title', ['Saved for the weekend, a very long playlist name', `!${CHANNEL}`, `!${TITLE}`]),
  state('a Twitch item, unchanged', 'wlist=three&wlook=sky&wplay=2&wmeta=title', ['Live on the wall', `!${CHANNEL}`, `!${TITLE}`]),
  state('at rest with a title', 'wlist=three&wlook=sky&wplay=0&wmeta=title&wctl=rest', [TITLE]),
  state('paused with a title', 'wlist=three&wlook=sky&wplay=0&wmeta=title&wstate=paused', ['Paused', TITLE, CHANNEL]),
  state('the list with a default label filled from the title', 'wlist=default&wlook=sky&wplay=0&wmeta=title', [TITLE, 'YouTube live stream']),
  state('the paste offer', 'wlist=three&wlook=sky&wplay=0&woffer=1', ['Saved the video. The link also names a playlist.', 'Save the playlist too']),
  state('after Save the playlist too', 'wlist=three&wlook=sky&wplay=0&woffer=1', ['!Save the playlist too', 'YouTube playlist', '4 saved'], '.w-offer button'),
  state('a Shorts link saved as a video', 'wlist=three&wlook=sky', ['YouTube video', '4 saved', '!Saved the video'], SHORTS),
  state('the long title on the feathered look', 'wlist=three&wlook=feather&wplay=0&wmeta=long', ['A very long title for the review states']),
  state('the long title on the whole sky look', 'wlist=three&wlook=sky&wplay=0&wmeta=long&wposter=bright', ['A very long title for the review states']),
  state('the long title on the drive-in look', 'wlist=three&wlook=drivein&wplay=0&wmeta=long', ['A very long title for the review states']),
];

/**
 * In the page (self-contained: it is serialised into the page). With `wlcheck=now|long|rest` the left block while a
 * video plays: the title at most two lines and clamped when long, the channel on one line inside the block's 460 px,
 * text 16 px or more, the block clear of the picture's box, the list card, the tabs, the clock and the office slot
 * (y 662); at rest the channel line is invisible. With `wlcheck=offer` the paste offer: inside the card, clear of the
 * list rows and the field, its button 32 to 40 px tall and every text 16 px or more.
 */
const measureWatchList = () => {
  const mode = new URLSearchParams(location.search).get('wlcheck');
  if (!mode) return null;
  try {
    return check(mode);
  } catch (e) {
    return { fails: ['watch list: the check broke: ' + e.message], mode };
  }
  function check(mode) {
    const fails = [];
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const meet = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const px = (e, prop) => parseFloat(getComputedStyle(e)[prop]);
    const small = [];
    if (mode === 'offer') {
      const card = document.querySelector('.w-card');
      const offer = document.querySelector('.w-offer');
      const button = offer && offer.querySelector('button');
      if (!card || !offer || !button) return { fails: ['watch list: no paste offer in the list card'], mode };
      const c = R(card), o = R(offer), b = R(button);
      if (o.l < c.l - 0.5 || o.r > c.r + 0.5 || o.t < c.t - 0.5 || o.b > c.b + 0.5) fails.push('the offer line is at ' + [o.l, o.t, o.r, o.b].map(Math.round).join(',') + ', outside the card ' + [c.l, c.t, c.r, c.b].map(Math.round).join(','));
      const list = card.querySelector('.w-list');
      const field = card.querySelector('.w-field');
      if (list && R(list).b > o.t + 0.5) fails.push('the offer line overlaps the list rows');
      if (field && R(field).b > o.t + 0.5) fails.push('the offer line overlaps the paste field');
      if (b.h < 31.5 || b.h > 40.5) fails.push('the offer button is ' + Math.round(b.h * 10) / 10 + ' px tall (32 to 40)');
      if (offer.scrollWidth > offer.clientWidth + 1) fails.push('the offer line is cut sideways');
      for (const e of [offer.querySelector('span'), button]) if (px(e, 'fontSize') < 15.99) small.push(Math.round(px(e, 'fontSize')) + ' px');
      if (small.length) fails.push('text under 16 px in the offer: ' + small.join(', '));
      return { fails, mode };
    }
    const now = document.querySelector('.w-now');
    const title = now && now.querySelector('.w-title');
    const by = now && now.querySelector('.w-by');
    if (!now || !title) return { fails: ['watch list: no left block with a title'], mode };
    const n = R(now);
    if (mode === 'rest') {
      if (!by) return { fails: ['watch list: no channel line to fade'], mode };
      if (now.getAttribute('data-ctl') !== 'rest') fails.push('the left block is not at rest');
      else if (Number(getComputedStyle(by).opacity) > 0.001) fails.push('the channel line is at opacity ' + getComputedStyle(by).opacity + ' at rest (0)');
      return { fails, mode };
    }
    const cs = getComputedStyle(title);
    const lines = Math.round(R(title).h / parseFloat(cs.lineHeight));
    if (lines > 2) fails.push('the title is ' + lines + ' lines (two at most)');
    const clamped = title.scrollHeight > title.clientHeight + 1;
    if (mode === 'long' && !clamped && lines <= 2) fails.push('the long title is not cut at two lines');
    if (cs.webkitLineClamp !== '2' || cs.display !== '-webkit-box') fails.push('a clamped title ends in an ellipsis only with -webkit-line-clamp 2 on a -webkit-box (found ' + cs.webkitLineClamp + ' on ' + cs.display + ')');
    if (!by) return { fails: fails.concat(['watch list: no channel line']), mode };
    const b = R(by);
    if (b.h > px(by, 'lineHeight') * 1.05) fails.push('the channel is ' + Math.round(b.h) + ' px tall, more than one line');
    if (b.r > n.r + 0.5 || b.w > 460.5) fails.push('the channel runs to x ' + Math.round(b.r) + ' and is ' + Math.round(b.w) + ' px wide, outside the block\'s 460 px');
    if (px(by, 'fontSize') < 15.99) fails.push('text under 16 px in the channel line (' + Math.round(px(by, 'fontSize')) + ' px)');
    if (mode === 'long' && by.scrollWidth <= by.clientWidth + 1) fails.push('the long channel is not cut with an ellipsis');
    const stage = document.querySelector('.w-stage');
    const sb = ((stage && stage.getAttribute('data-sky-box')) || '').split(',').map(Number);
    const keep = [['the picture box', sb.length === 4 && !sb.some(Number.isNaN) ? { l: sb[0], t: sb[1], r: sb[0] + sb[2], b: sb[1] + sb[3] } : null], ['the list card', (() => { const e = document.querySelector('.w-card'); return e ? R(e) : null; })()], ['the tabs', (() => { const e = document.querySelector('.u-tabs'); return e ? R(e) : null; })()], ['the clock', (() => { const e = document.querySelector('.clk'); if (!e) return null; const rg = document.createRange(); rg.selectNodeContents(e); return R(rg); })()]];
    for (const [name, box] of keep) if (box && meet(n, box)) fails.push('the left block ' + [n.l, n.t, n.r, n.b].map(Math.round).join(',') + ' overlaps ' + name);
    if (n.b > 658.5) fails.push('the left block ends at y ' + Math.round(n.b) + ', into the office slot at y 662');
    return { fails, mode };
  }
};

const rule = (variant, results, emit) => {
  const r = results.watchlist;
  if (!r) return false;
  for (const f of r.fails) emit(`  FAIL watch list: ${f}`);
  if (r.fails.length) return true;
  if (r.mode === 'offer') emit('  ok   watch list: the paste offer is inside the card, clear of the rows and the field, its button 32 to 40 px, text 16 px or more');
  else if (r.mode === 'rest') emit('  ok   watch list: at rest the channel line is invisible');
  else emit('  ok   watch list: the title is two lines at most and ends in an ellipsis when long, the channel is one line inside 460 px, text 16 px or more, nothing overlaps');
  return false;
};

const Q = '?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock';
const variants = [
  { name: 'Watch list, title and channel, whole sky', q: `${Q}&wlist=three&wplay=0&wlook=sky&wmeta=title&wlcheck=now`, checks: ['.w-now', '.w-card'] },
  { name: 'Watch list, long title and channel, feathered', q: `${Q}&wlist=three&wplay=0&wlook=feather&wmeta=long&wlcheck=long`, checks: ['.w-now', '.w-card'] },
  { name: 'Watch list, long title and channel, whole sky', q: `${Q}&wlist=three&wplay=0&wlook=sky&wmeta=long&wlcheck=long`, checks: ['.w-now', '.w-card'] },
  { name: 'Watch list, long title and channel, drive-in', q: `${Q}&wlist=three&wplay=0&wlook=drivein&wmeta=long&wlcheck=long`, checks: ['.w-now', '.w-card'] },
  { name: 'Watch list, at rest with a title and channel', q: `${Q}&wlist=three&wplay=0&wlook=sky&wmeta=title&wctl=rest&wlcheck=rest`, checks: ['.w-now'] },
  { name: 'Watch list, paste offer, three items', q: `${Q}&wlist=three&wplay=0&wlook=sky&woffer=1&wlcheck=offer`, checks: ['.w-card'] },
  { name: 'Watch list, paste offer, 24 items', q: `${Q}&wlist=many&wplay=0&wlook=sky&woffer=1&wlcheck=offer`, checks: ['.w-card'] },
];

const on = (...names) => (v) => names.includes(v.name);

export default {
  name: 'watch-list-fixes',
  gallery: { states },
  fit: {
    variants,
    measurements: { watchlist: measureWatchList },
    rules: { watchlist: rule },
    breaks: {
      'watchlist-title-lines': { css: '.w-title { -webkit-line-clamp: unset !important; display: block !important; }', expect: /^ *FAIL watch list: the title is \d+ lines/m, appliesTo: on('Watch list, long title and channel, feathered') },
      'watchlist-channel-wrap': { css: '.w-by { white-space: normal !important; }', expect: /^ *FAIL watch list: the channel is \d+ px tall, more than one line/m, appliesTo: on('Watch list, long title and channel, whole sky') },
      'watchlist-overlap': { css: '.w-by { margin-bottom: 300px !important; }', expect: /^ *FAIL watch list: the left block ends at y \d+, into the office slot/m, appliesTo: on('Watch list, long title and channel, drive-in', 'Watch list, long title and channel, feathered') },
      'watchlist-text': { css: '.w-by { font-size: 12px !important; }', expect: /^ *FAIL watch list: text under 16 px in the channel line/m, appliesTo: on('Watch list, title and channel, whole sky') },
      'watchlist-offer-button': { css: '.w-offer button { height: 20px !important; }', expect: /^ *FAIL watch list: the offer button is [\d.]+ px tall/m, appliesTo: on('Watch list, paste offer, 24 items') },
      'watchlist-rest': { css: ".w-now[data-ctl='rest'] > .w-by { opacity: 1 !important; }", expect: /^ *FAIL watch list: the channel line is at opacity/m, appliesTo: on('Watch list, at rest with a title and channel') },
    },
  },
};
