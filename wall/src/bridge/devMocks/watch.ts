import type { ReactNode } from 'react';
import { createElement as h } from 'react';
import type { WatchRef } from '../../unwind/watch/links';
import { LOOKS_KEY, isLook } from '../../unwind/watch/looks';
import { TUNE_KEY, defaultTune, withPatch } from '../../unwind/watch/lookSettings';
import { framePoster, takeVideoInfo } from '../../unwind/watch/PlayerFrame';
import { PINS_KEY, usePins } from '../../unwind/watch/pins';
import { OWN_KEY, useOwnLists } from '../../unwind/watch/ownLists';
import { ownTiming, playOwn, setFollow, useOwnPlay } from '../../unwind/watch/ownPlay';
import { ownThumb } from '../../unwind/watch/OwnParts';
import { markFailed } from '../../unwind/ytmusic/queue';
import { SAVED_KEY } from '../../unwind/watch/saved';
import { endSleepNow, startSleepAt } from '../../unwind/watch/sleep';
import { useWatchStore, VOLUME_KEY } from '../../unwind/watch/store';
import { resetLastPlayed } from '../../unwind/lastPlayed';
import { underClock } from '../../unwind/UnderClock';
import { ctlTiming } from '../../unwind/watch/Watch';
import { usePlaceStore } from '../../state/places';
import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the Watch tab for stills. Headless Chromium shows an empty frame, so with
 * `?watch=mock` a poster picture (stage lights over a singer and a crowd, the approved
 * drawing's stand-in) is drawn where the player would be, and the tab opens.
 *
 *   ?watch=mock               the poster in place of the frame; opens Watch
 *   ?wlist=none|three|many|default   nothing saved, three items, the full 24 (default three), or
 *                             a video and a live stream that still carry their kind's default label
 *   ?wmeta=title|long|none|other   what the mock player reports of the playing video (through the
 *                             frame's own `takeVideoInfo`): an invented title and channel; a long
 *                             title and a long channel; nothing; or a report for another video id,
 *                             which must be ignored (default: nothing)
 *   ?wlook=feather|sky|sun|drivein|holo   one look for everything
 *   ?wlastown=known|unknown|session|alert   after a restart: the last thing played was the wall's own player (its process name
 *                             is the stored source); `known` also remembers the first saved item, `unknown` does not.
 *                             Use with `media=none`, `wtab=listen`.
 *   ?wplay=<n>                play saved item n (0 is the first)
 *   ?wsheet=one|kind          open the settings sheet (`kind`: a look per kind)
 *   ?wtune=sky.size=80,sky.soft=0,sun.up=-100   settings of a look (look.key=value, a switch as 0 or 1)
 *   ?wtab=listen              stay on Listen (for the art's video icon)
 *   ?wposter=bright           a pale bright picture, the worst case for text over video
 *   ?wpaste=<link>            after the tab is up, paste this link into the list's field and press Save, through
 *                             the real field and form (the link is a URL-encoded query value, so it can carry
 *                             `v=` and `list=`); the offer, the refusal lines and the new row come from the real code
 *   ?wstate=paused|refused|silent|start|end   a mock player: paused; autoplay refused (the click line;
 *                             for Twitch the "Not started?" hint);
 *                             or a player that has reported nothing yet (default: playing at
 *                             12:34 of 45:10; `start` is 0:04 and `end` 45:06 of it; a playlist reports item 4 of 24; live has no length)
 *   ?wctl=rest                watch behaviour: the controls fade as with no pointer near (after
 *                             200 ms, so a still catches it); by default the stills hold them
 *                             shown, as with the pointer over the video's lower edge
 *   ?wpins=none|one|three|long|gone   the pins under the clock: nothing pinned; the first item; the three items of the
 *                             mock list (default none); three with long labels; one pin whose item left the Watch list
 *   ?wvol=<0..100>            the video's level under the clock (default 100)
 *   ?wsleep=<minutes left>|end   a running sleep timer with that many minutes left; `end` ends the timer at once (the video
 *                             stops with its line and the player the wall follows is paused through the mocked commands)
 *   ?wrows=shown              hold the rows under the clock at full strength (they start at rest)
 *   ?wown=lists|draft|edit|drag|menu|rowmenu|playing|pill|repeat|skip|end|none   playlists the owner makes (with `watch=mock`): the list holds two
 *                             invented playlists of the owner's own (12 and 5 videos), a connected YouTube playlist, a video, a live
 *                             stream and a Twitch channel (`wlist` is ignored); `draft` presses New playlist; `edit` opens the editor
 *                             (two videos not yet named, one that plays only on YouTube); `drag` is that with a row held by its grip; `menu` opens the play row's add menu and `rowmenu` the one on the saved video's row (play
 *                             a video with `wplay=3`); `playing` plays the first playlist from its third video with the card following;
 *                             `pill` is that after the back arrow; `repeat` is that with repeat on; `skip` skips one video with its note held on screen; `end` and `none`
 *                             show the block after the playlist ran out, or when nothing in it could play. Pictures are drawn `data:`
 *                             motifs through the `ownThumb` seam: no request ever leaves the page.
 *   ?ytown=none|two|three|five|nine|in|full   playlists of the owner's own for "Add to a playlist" on the rows of the YouTube library (with
 *                             `watch=mock`, `youtube=in` and `wtab=listen`): none, two (12 and 5 videos), three, five or nine invented ones, two with
 *                             some library videos already in the first (`in`: the second row of an opened playlist, the fourth of Liked and the
 *                             fourth search result), or two with the first one full (50). Without `ytown` the stores are empty, as with no playlist yet.
 *   ?wplace=work|home|meet    watch behaviour: after it starts, go to that place, so the video
 *                             plays out of sight and the rail marks Unwind
 */
const THREE = [
  { kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix' },
  { kind: 'live', id: 'Lofi_Live01', label: 'Lofi beats radio, live' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];
/** The three items with labels long enough to need two lines (and an ellipsis) on a pin. */
const LONG_THREE = [
  { kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix for the long way home, the whole album with the extended intro and the bonus tracks' },
  { kind: 'live', id: 'Lofi_Live01', label: 'Lofi beats radio, live from the harbor studio all night long' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor_and_the_long_channel_name_of_a_streamer' },
];
/** Invented videos for the owner's own playlists: id, title, channel, seconds, hue of the drawn picture. */
const OWN_VIDEOS = [
  ['mockvideo01', 'Tape loops for a small room', 'Marlow Field', 2292, 28],
  ['mockvideo02', 'Night drive, coast road at dusk', 'Slow Lane Films', 3760, 318],
  ['mockvideo03', 'Rooftop synth session, the full set', 'Harbor Light Studio', 2710, 200],
  ['mockvideo04', 'Late train through the valley', 'Slow Lane Films', 3150, 262],
  ['mockvideo05', 'Rain on a tin roof', 'Quiet Hours', 7200, 215],
  ['mockvideo06', 'Neon harbor, live at the pier', 'Harbor Light Studio', 4445, 334],
  ['mockvideo07', 'Desert road 4', 'Open Mile', 1668, 18],
  ['mockvideo08', 'Lanterns over the lake', 'Quiet Hours', 2480, 46],
  ['mockvideo09', 'Cassette city, side B', 'Marlow Field', 1985, 290],
  ['mockvideo10', 'Slow snow, cabin window', 'Quiet Hours', 3480, 190],
  ['mockvideo11', 'Last bus home', 'Open Mile', 1476, 240],
  ['mockvideo12', 'Sunrise from the hill', 'Slow Lane Films', 2174, 30],
] as const;
const FRIDAY = 'fridaywind01';
const SLOW = 'slowmorning1';
/** The list `wown` shows: the owner's two playlists, a connected playlist, a video, a live stream and a Twitch channel. */
const OWN_SAVED = [
  { kind: 'own', id: FRIDAY, label: 'Friday wind down' },
  { kind: 'own', id: SLOW, label: 'Slow mornings' },
  { kind: 'playlist', id: 'PLmockPlaylist0001', label: 'Weekend cooking' },
  { kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix' },
  { kind: 'live', id: 'Lofi_Live01', label: 'Lofi beats radio, live' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];

/** `?ytown`: the owner's own playlists a YouTube library row can be added to (ids of the youtube mock's videos: see `devMocks/youtube.ts`). */
const YT_NAMES = ['Friday wind down', 'Slow mornings', 'Weekend cooking', 'Late set', 'Rainy day', 'Road trip', 'Focus hour', 'Sunday kitchen', 'Night shift'];
function ytOwn(kind: string): { saved: { kind: string; id: string; label: string }[]; store: string } {
  const count = kind === 'none' ? 0 : kind === 'three' ? 3 : kind === 'five' ? 5 : kind === 'nine' ? 9 : 2;
  const ids = Array.from({ length: count }, (_, i) => (i === 0 ? FRIDAY : i === 1 ? SLOW : `ytown${String(i).padStart(7, '0')}`));
  const filler = (list: number, n: number) => Array.from({ length: n }, (_, k) => ({ id: `fill${String(list * 100 + k).padStart(7, '0')}`, title: `Filler ${k + 1}`, channel: 'Quiet Hours', seconds: 180 + k }));
  const held = ['mock0000001', 'mock0000103', 'mock0000203'].map((id) => ({ id, title: 'Held', channel: 'Quiet Hours', seconds: 200 }));
  const lists: Record<string, unknown> = {};
  ids.forEach((id, i) => {
    const items = kind === 'full' && i === 0 ? filler(i, 50) : [...filler(i, i === 0 ? 12 : i === 1 ? 5 : 3 + i), ...(kind === 'in' && i === 0 ? held : [])];
    lists[id] = { items, shuffle: false, repeat: false };
  });
  return { saved: ids.map((id, i) => ({ kind: 'own', id, label: YT_NAMES[i]! })), store: JSON.stringify({ v: 1, lists }) };
}

function ownStore(edit: boolean): string {
  const full = OWN_VIDEOS.map(([id, title, channel, seconds], i) => (edit && (i === 7 || i === 11) ? { id, seconds } : { id, title, channel, seconds }));
  const slow = [OWN_VIDEOS[8], OWN_VIDEOS[9], OWN_VIDEOS[10], OWN_VIDEOS[6], OWN_VIDEOS[7]].map(([id, title, channel, seconds]) => ({ id, title, channel, seconds }));
  return JSON.stringify({ v: 1, lists: { [FRIDAY]: { items: full, shuffle: false, repeat: false }, [SLOW]: { items: slow, shuffle: false, repeat: false } } });
}

/** A drawn picture for a video id: a gradient and a sun in a hue taken from the id, so no request ever leaves the page. */
function drawnThumb(id: string): string | null {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const known = OWN_VIDEOS.find((v) => v[0] === id);
  const hue = known ? known[4] : [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 44%)"/><stop offset="1" stop-color="hsl(${(hue + 300) % 360} 60% 16%)"/></linearGradient><radialGradient id="s" cx=".7" cy=".2" r=".6"><stop offset="0" stop-color="hsl(${(hue + 40) % 360} 90% 70%)" stop-opacity=".85"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs><rect width="160" height="90" fill="url(#g)"/><rect width="160" height="90" fill="url(#s)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** `?wown`: what happens after the tab is up (the lists are already in storage). */
function runOwn(state: string): void {
  const own = useOwnLists.getState();
  const hold = () => {
    if (knob('wctl') === 'rest') ctlTiming.restMs = 200;
    else useWatchStore.getState().setPeek(true);
  };
  if (state === 'draft') setTimeout(() => document.querySelector<HTMLButtonElement>('.w-new')?.click(), 200);
  else if (state === 'edit' || state === 'drag') {
    markFailed(OWN_VIDEOS[8][0], 'embed');
    own.setOpen(FRIDAY);
    // `drag` holds the sixth video by its grip, carried to the line between the second and the third (nothing is dropped).
    if (state === 'drag')
      setTimeout(() => {
        const grip = document.querySelectorAll<HTMLElement>('.own-v .own-grip')[5];
        if (!grip) return;
        const r = grip.getBoundingClientRect();
        const fire = (type: string, x: number, y: number) => grip.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y }));
        fire('pointerdown', r.left + r.width / 2, r.top + r.height / 2);
        const list = document.querySelector('.own-vlist')?.getBoundingClientRect();
        if (list) fire('pointermove', r.left + r.width / 2 + 4, list.top + 2 * 56 + 22);
      }, 400);
  } else if (state === 'menu' || state === 'rowmenu') {
    // `menu` is the play row's add menu; `rowmenu` is the one on the saved video's row in the list.
    setTimeout(() => document.querySelector<HTMLButtonElement>(state === 'menu' ? '.w-addpl' : '.w-addrow')?.click(), 300);
  }
  else if (state === 'playing' || state === 'repeat' || state === 'skip' || state === 'pill') {
    if (state === 'repeat') own.setRepeat(FRIDAY, true);
    const from = state === 'skip' ? OWN_VIDEOS[4][0] : OWN_VIDEOS[2][0];
    playOwn(FRIDAY, from);
    mockPlayer('video', null);
    hold();
    // `pill` is `playing` after the back arrow: the Watch list with the playlist's row on and its place in a pill.
    if (state === 'pill') setFollow(false);
    if (state === 'skip') {
      ownTiming.noteMs = 600_000;
      setFollow(false);
      // After the first video's load gap, the player says it cannot play it: the wall skips to the next one and says so.
      setTimeout(() => {
        useWatchStore.getState().setReport({ error: 150 });
        mockPlayer('video', null);
      }, 1100);
    }
  } else if (state === 'end' || state === 'none') {
    useOwnPlay.setState({ listId: FRIDAY, finished: { listId: FRIDAY, played: state === 'end' ? 12 : 0, total: 12, none: state === 'none' } });
  }
}

const DEFAULTS = [
  { kind: 'video', id: 'Ab3dEfGh1jK', label: 'YouTube video' },
  { kind: 'live', id: 'Lofi_Live01', label: 'YouTube live stream' },
  { kind: 'playlist', id: 'PLmockPlaylist0001', label: 'YouTube playlist' },
];
/** What the mock player says of a video (invented, generic words). */
const META = {
  title: { title: 'Rooftop synth session, the full set', channel: 'Harbor Light Studio' },
  long: {
    title: 'A very long title for the review states, with the whole set list, the story of the night, the guest list and every credit read out in order',
    channel: 'The Harbor Light Studio and Friends Collective, the long channel name for the review states',
  },
  other: { title: 'A title for some other video', channel: 'Some other channel' },
} as const;
const WORDS = ['Synthwave set', 'Rain on a city window', 'Concert wide shots', 'Harbor at dusk', 'Desert road', 'Late show replay', 'Jazz trio session', 'Northern lights'];

function many(): typeof THREE {
  const out = [...THREE, { kind: 'playlist', id: 'PLmockPlaylist0001', label: 'Saved for the weekend, a very long playlist name' }];
  for (let i = out.length; i < 24; i++) {
    const id = `Mock${String(i).padStart(2, '0')}abcde`.slice(0, 11);
    out.push(i % 5 === 0 ? { kind: 'twitch', id: `channel_${i}`, label: `channel_${i}` } : { kind: 'video', id, label: `${WORDS[i % WORDS.length]} ${i}` });
  }
  return out;
}

/** A bright test picture (`?wposter=bright`): a pale sky and sun, the worst case for text over video. */
function brightPoster(ref: WatchRef): ReactNode {
  return h('div', {
    'data-mock-poster': ref.kind,
    style: {
      position: 'absolute',
      inset: 0,
      background: 'radial-gradient(40% 60% at 50% 45%,#ffffff,#fff6c8 40%,transparent 70%),linear-gradient(#e8f4ff,#ffe9b8 60%,#ffd27a)',
    },
  });
}

/** The stand-in picture, drawn with plain elements so it needs no stylesheet. */
function poster(ref: WatchRef): ReactNode {
  const crowd = Array.from({ length: 26 }, (_, i) => {
    const x = i * 6.4 + ((i * 37) % 30) / 10;
    const r = 3.4 + ((i * 13) % 16) / 10;
    const hgt = 9 + ((i * 29) % 90) / 10;
    return h('circle', { key: i, cx: x.toFixed(1), cy: (92 - hgt).toFixed(1), r: r.toFixed(1), fill: '#040207' });
  });
  return h(
    'div',
    {
      'data-mock-poster': ref.kind,
      style: {
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background:
          'radial-gradient(55% 85% at 26% -6%,rgba(255,176,84,.95),transparent 62%),radial-gradient(48% 80% at 78% -4%,rgba(84,214,255,.9),transparent 62%),radial-gradient(40% 60% at 52% 30%,rgba(255,92,150,.45),transparent 70%),linear-gradient(#1c1026,#07040b)',
      },
    },
    h('div', {
      style: {
        position: 'absolute',
        left: '-20%',
        right: '-20%',
        top: '-30%',
        height: '150%',
        background:
          'conic-gradient(from 150deg at 30% 0%,transparent 0 12deg,rgba(255,214,150,.35) 14deg 19deg,transparent 21deg 30deg,rgba(255,214,150,.25) 32deg 36deg,transparent 38deg 360deg),conic-gradient(from 168deg at 72% 0%,transparent 0 10deg,rgba(150,236,255,.32) 12deg 17deg,transparent 19deg 31deg,rgba(150,236,255,.22) 33deg 37deg,transparent 39deg 360deg)',
      },
    }),
    h(
      'svg',
      { viewBox: '0 0 160 90', preserveAspectRatio: 'xMidYMax slice', style: { position: 'absolute', left: 0, bottom: 0, width: '100%', height: '100%' } },
      h('ellipse', { cx: 80, cy: 64, rx: 34, ry: 5, fill: 'rgba(255,220,180,.18)' }),
      h('circle', { cx: 80, cy: 33, r: 5.2, fill: '#07040b' }),
      h('path', { d: 'M73 62 L75 42 Q80 37 85 42 L87 62 Z', fill: '#07040b' }),
      h('path', { d: 'M85 44 L95 36', stroke: '#07040b', strokeWidth: 2.2, strokeLinecap: 'round' }),
      h('rect', { x: 59, y: 38, width: 1.2, height: 26, fill: '#07040b' }),
      ...crowd,
      h('rect', { x: 0, y: 84, width: 160, height: 6, fill: '#040207' }),
    ),
  );
}

/** The mock player's report for the review states (no real player is loaded). */
function mockPlayer(kind: string, state: string | null): void {
  const st = useWatchStore.getState();
  if (state === 'refused') {
    // Twitch: the start wait has passed and the hint holds the pointer open.
    if (kind === 'twitch') st.setClickHint(true);
    st.setNeedsClick(true);
    return;
  }
  if (state === 'silent' || kind === 'twitch') return;
  // `start` and `end` put the position near either end of the bar (the marker stays inside it).
  const at = state === 'start' ? 4 : state === 'end' ? 2706 : 754;
  st.setReport({ started: true, time: at, duration: kind === 'live' ? 0 : 2710, count: kind === 'playlist' ? 24 : 0, index: kind === 'playlist' ? 3 : 0 });
  if (state === 'paused') st.setPaused(true);
}

/** `?wmeta`: the mock player's title and channel, passed through the frame's own gate (`takeVideoInfo`). */
function mockMeta(item: WatchRef, meta: string | null): void {
  if (item.kind === 'twitch' || (meta !== 'title' && meta !== 'long' && meta !== 'other')) return;
  const m = META[meta];
  // A playlist's player reports the item it is on, never the playlist's own id; `other` is a stray report.
  const videoId = meta === 'other' || item.kind === 'playlist' ? 'Zz9yXxWw8vU' : item.id;
  takeVideoInfo(item, { videoId, title: m.title, channel: m.channel });
}

/** `?wpaste`: what the owner does, step by step, in the real field: type the link, press Save. */
function pasteLink(link: string): void {
  const field = document.querySelector<HTMLInputElement>('.w-paste');
  if (!field) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, link);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  // After React has taken the value, so the button is enabled.
  setTimeout(() => document.querySelector<HTMLButtonElement>('.w-add')?.click(), 50);
}

export function registerWatchMocks(): void {
  mocks.set('wall2_watch_open', () => undefined);
  if (knob('watch') !== 'mock') return;
  framePoster.render = knob('wposter') === 'bright' ? brightPoster : poster;
  const list = knob('wlist') ?? 'three';
  const ownState = knob('wown');
  if (ownState) ownThumb.url = drawnThumb;
  try {
    const ytOwnKnob = knob('ytown');
    const yt = ytOwnKnob ? ytOwn(ytOwnKnob) : null;
    if (ownState) localStorage.setItem(OWN_KEY, ownStore(ownState === 'edit'));
    else if (yt) localStorage.setItem(OWN_KEY, yt.store);
    else localStorage.removeItem(OWN_KEY);
    if (ownState) localStorage.setItem(SAVED_KEY, JSON.stringify(OWN_SAVED));
    else if (yt) localStorage.setItem(SAVED_KEY, JSON.stringify([...yt.saved, ...THREE]));
    else if (list === 'none') localStorage.removeItem(SAVED_KEY);
    else localStorage.setItem(SAVED_KEY, JSON.stringify(list === 'many' ? many() : list === 'default' ? DEFAULTS : knob('wpins') === 'long' ? LONG_THREE : THREE));
    const pins = knob('wpins');
    const keys = THREE.map((i) => `${i.kind}:${i.id}`);
    if (pins === 'one') localStorage.setItem(PINS_KEY, JSON.stringify([keys[0]]));
    else if (pins === 'three' || pins === 'long') localStorage.setItem(PINS_KEY, JSON.stringify(keys));
    else if (pins === 'gone') localStorage.setItem(PINS_KEY, JSON.stringify(['video:Zz9yXxWw8vU']));
    else localStorage.removeItem(PINS_KEY);
    const vol = Number(knob('wvol'));
    if (knob('wvol') !== null && Number.isFinite(vol)) localStorage.setItem(VOLUME_KEY, String(Math.min(100, Math.max(0, Math.round(vol)))));
    else localStorage.removeItem(VOLUME_KEY);
    const look = knob('wlook');
    const sheet = knob('wsheet');
    const tune = knob('wtune');
    if (tune) {
      let t = defaultTune();
      for (const pair of tune.split(',')) {
        const m = /^([a-z]+)\.([a-z]+)=(-?\d+)$/.exec(pair);
        if (!m || !isLook(m[1])) continue;
        const rec = t[m[1]] as unknown as Record<string, number | boolean>;
        t = withPatch(t, m[1], { [m[2]!]: typeof rec[m[2]!] === 'boolean' ? m[3] === '1' : Number(m[3]) });
      }
      localStorage.setItem(TUNE_KEY, JSON.stringify(t));
    }
    if (look || sheet === 'kind') localStorage.setItem(LOOKS_KEY, JSON.stringify({ mode: sheet === 'kind' ? 'kind' : 'one', all: look ?? 'drivein' }));
  } catch {
    /* no storage: the stills show the empty list */
  }
  const st = useWatchStore.getState();
  st.load();
  useOwnLists.getState().load();
  usePins.getState().load();
  underClock.hold = knob('wrows') === 'shown';
  // After the review place is applied (the horizon mounts first), so leaving Work does not stop it.
  setTimeout(() => {
    if (knob('wlast') === 'one') useWatchStore.setState({ lastStopped: useWatchStore.getState().saved[0] ?? null, playing: null });
    const lastOwn = knob('wlastown');
    if (lastOwn === 'known' || lastOwn === 'unknown' || lastOwn === 'session' || lastOwn === 'alert') {
      const first = useWatchStore.getState().saved[0];
      const ownItem = lastOwn !== 'unknown' && first ? { kind: first.kind, id: first.id, label: first.label, from: 'watch' as const } : null;
      // session: the record is empty and only the stopped session says what played; alert: the web view's last sound was not the item.
      const record = lastOwn === 'session' ? null : { title: lastOwn === 'alert' ? 'Alert chime' : (first?.label ?? 'Night drive mix'), artist: '', source: 'msedgewebview2' };
      resetLastPlayed(record, ownItem);
    }
    if (knob('wtab') !== 'listen') useWatchStore.getState().setTab('watch');
    if (ownState) runOwn(ownState);
    const n = Number(knob('wplay'));
    const item = useWatchStore.getState().saved[n];
    if (knob('wplay') !== null && item) {
      useWatchStore.getState().play(item);
      if (knob('wtab') === 'listen') useWatchStore.getState().setTab('listen');
      mockPlayer(item.kind, knob('wstate'));
      mockMeta(item, knob('wmeta'));
      if (knob('wctl') === 'rest') ctlTiming.restMs = 200;
      else useWatchStore.getState().setPeek(true);
      const away = knob('wplace');
      if (away === 'work' || away === 'home' || away === 'meet') usePlaceStore.getState().setActive(away);
    }
    const sleep = knob('wsleep');
    if (sleep === 'end') void endSleepNow();
    else if (sleep !== null && Number.isFinite(Number(sleep)) && Number(sleep) > 0) startSleepAt(Date.now() + Number(sleep) * 60_000, 30);
    if (knob('wsheet')) useWatchStore.getState().setSheet(true);
    const link = knob('wpaste');
    if (link) setTimeout(() => pasteLink(link), 150);
  }, 600);
}
