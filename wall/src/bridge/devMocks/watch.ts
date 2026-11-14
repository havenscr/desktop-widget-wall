import type { ReactNode } from 'react';
import { createElement as h } from 'react';
import type { WatchRef } from '../../unwind/watch/links';
import { LOOKS_KEY } from '../../unwind/watch/looks';
import { framePoster } from '../../unwind/watch/PlayerFrame';
import { SAVED_KEY } from '../../unwind/watch/saved';
import { useWatchStore } from '../../unwind/watch/store';
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
 *   ?wlist=none|three|many    nothing saved, three items, or the full 24 (default three)
 *   ?wlook=feather|sky|sun|drivein   one look for everything
 *   ?wplay=<n>                play saved item n (0 is the first)
 *   ?wsheet=one|kind          open the settings sheet (`kind`: a look per kind)
 *   ?wtab=listen              stay on Listen (for the art's Video corner)
 *   ?wposter=bright           a pale bright picture, the worst case for text over video
 *   ?wstate=paused|refused|silent   a mock player: paused; autoplay refused (the click line;
 *                             for Twitch the "Not started?" hint);
 *                             or a player that has reported nothing yet (default: playing at
 *                             12:34 of 45:10; a playlist reports item 4 of 24; live has no length)
 *   ?wctl=rest                watch behaviour: the controls fade as with no pointer near (after
 *                             200 ms, so a still catches it); by default the stills hold them
 *                             shown, as with the pointer over the video's lower edge
 *   ?wplace=work|home|meet    watch behaviour: after it starts, go to that place, so the video
 *                             plays out of sight and the rail marks Unwind
 */
const THREE = [
  { kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix' },
  { kind: 'live', id: 'Lofi_Live01', label: 'Lofi beats radio, live' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];
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
  st.setReport({ started: true, time: 754, duration: kind === 'live' ? 0 : 2710, count: kind === 'playlist' ? 24 : 0, index: kind === 'playlist' ? 3 : 0 });
  if (state === 'paused') st.setPaused(true);
}

export function registerWatchMocks(): void {
  mocks.set('wall2_watch_open', () => undefined);
  if (knob('watch') !== 'mock') return;
  framePoster.render = knob('wposter') === 'bright' ? brightPoster : poster;
  const list = knob('wlist') ?? 'three';
  try {
    if (list === 'none') localStorage.removeItem(SAVED_KEY);
    else localStorage.setItem(SAVED_KEY, JSON.stringify(list === 'many' ? many() : THREE));
    const look = knob('wlook');
    const sheet = knob('wsheet');
    if (look || sheet === 'kind') localStorage.setItem(LOOKS_KEY, JSON.stringify({ mode: sheet === 'kind' ? 'kind' : 'one', all: look ?? 'drivein' }));
  } catch {
    /* no storage: the stills show the empty list */
  }
  const st = useWatchStore.getState();
  st.load();
  // After the review place is applied (the horizon mounts first), so leaving Work does not stop it.
  setTimeout(() => {
    if (knob('wtab') !== 'listen') useWatchStore.getState().setTab('watch');
    const n = Number(knob('wplay'));
    const item = useWatchStore.getState().saved[n];
    if (knob('wplay') !== null && item) {
      useWatchStore.getState().play(item);
      mockPlayer(item.kind, knob('wstate'));
      if (knob('wctl') === 'rest') ctlTiming.restMs = 200;
      else useWatchStore.getState().setPeek(true);
      const away = knob('wplace');
      if (away === 'work' || away === 'home' || away === 'meet') usePlaceStore.getState().setActive(away);
    }
    if (knob('wsheet')) useWatchStore.getState().setSheet(true);
  }, 600);
}
