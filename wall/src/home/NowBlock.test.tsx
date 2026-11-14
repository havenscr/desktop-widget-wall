import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { playerLink } from '../unwind/watch/PlayerFrame';
import { SAVED_KEY } from '../unwind/watch/saved';
import { resetWatch, useWatchStore } from '../unwind/watch/store';
import { NP_FADE_MS, NP_HINT_MS, NowBlock, OPEN_WATCH_TO_CONTROL, type NowBlockProps } from './NowBlock';
import type { SonosSummary } from './soundModel';

vi.setConfig({ testTimeout: 20_000 });

const NOW = new Date('2026-11-12T18:30:00-08:00').getTime();
const V = 'Ab3dEfGh1jK';
const LIST = 'PLmockPlaylist0001';
const TW = 'pixel_harbor';
const SAVED = [
  { kind: 'video', id: V, label: 'Night drive mix' },
  { kind: 'playlist', id: LIST, label: 'Slow synth evenings' },
  { kind: 'twitch', id: TW, label: TW },
];

/** Invented names only: music plays on a den group, a studio sits on line-in. */
function summary(over: Partial<SonosSummary> = {}, playing = true): SonosSummary {
  return {
    speakers: [
      { name: 'Studio', state: 'playing', volume: 100, input: 'lineIn', group: 'G1', online: true },
      { name: 'Den', state: playing ? 'playing' : 'stopped', volume: 14, input: null, group: 'G2', online: true },
      { name: 'Porch', state: playing ? 'playing' : 'stopped', volume: 10, input: null, group: 'G2', online: true },
    ],
    groups: [
      { id: 'G1', coordinator: 'Studio', members: ['Studio'] },
      { id: 'G2', coordinator: 'Den', members: ['Den', 'Porch'] },
    ],
    presets: [],
    music: [],
    controls: [],
    scenes: [],
    sleepTimers: [],
    nowPlaying: playing ? { speaker: 'Den', track: 'Night Drive', artist: 'Neon Coast', duration: 181, position: 65, art: false } : null,
    currentGroup: 'G2',
    readAtMs: NOW,
    canSkip: false,
    ...over,
  };
}

const skip = vi.fn();
const pauseAll = vi.fn();
function props(over: Partial<NowBlockProps> = {}): NowBlockProps {
  return {
    s: summary(),
    now: NOW,
    live: true,
    track: null,
    trackAt: NOW,
    activeSlot: null,
    activeName: null,
    locked: false,
    pauseAll,
    skip,
    playSuggested: <button type="button" className="sound-btn cy">Play Day</button>,
    suggestedSlot: null,
    playArt: (slot, size) => <span data-slot={slot} data-size={size} />,
    ...over,
  };
}

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
type Report = Partial<ReturnType<typeof useWatchStore.getState>['report']>;
const start = (i: number, report: Report = {}) =>
  act(() => {
    const st = useWatchStore.getState();
    st.play(SAVED[i] as never);
    st.setReport({ started: true, time: 754, duration: 2710, count: 0, index: 0, ...report });
  });
/** Starts the item and lets the layout change finish (the old layout fades for 200 ms). */
const play = async (i: number, report: Report = {}) => {
  await start(i, report);
  await flush(NP_FADE_MS + 10);
};
const block = (c: HTMLElement) => c.querySelector('.sound-np') as HTMLElement;
const layers = (c: HTMLElement) => [...block(c).querySelectorAll(':scope > .np-layer')] as HTMLElement[];
const label = (c: HTMLElement, name: string) => c.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement | null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  localStorage.setItem(SAVED_KEY, JSON.stringify(SAVED));
  resetWatch();
  usePlaceStore.setState({ active: 'home', from: 'work' });
  skip.mockClear();
  pauseAll.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  playerLink.send = () => false;
});

it('music alone fills the block: cover tile, kicker, title, artist, time bar, controls at the foot', async () => {
  const { container } = render(<NowBlock {...props()} />);
  expect(block(container).dataset.layout).toBe('music');
  expect(container.querySelector('.np-k')?.textContent).toBe('Now playing');
  expect(container.querySelector('.np-title')?.textContent).toBe('Night Drive');
  expect(container.querySelector('.np-artist')?.textContent).toBe('Neon Coast');
  expect(container.querySelector('.np-prog')?.textContent).toContain('1:05');
  expect(container.querySelector('.np-prog')?.textContent).toContain('3:01');
  expect(container.querySelector('.np-foot .np-where')?.textContent).toBe('Den, 2 speakers');
  expect(container.querySelector('.np-cover.blank')).toBeTruthy();
  fireEvent.click(label(container, 'Pause')!);
  expect(pauseAll).toHaveBeenCalledTimes(1);
});

it('back and next show only when the sound service has the commands, and send the direction', () => {
  const none = render(<NowBlock {...props()} />);
  expect(label(none.container, 'Previous track')).toBeNull();
  expect(label(none.container, 'Next track')).toBeNull();
  none.unmount();
  const { container } = render(<NowBlock {...props({ s: summary({ canSkip: true }) })} />);
  fireEvent.click(label(container, 'Previous track')!);
  fireEvent.click(label(container, 'Next track')!);
  expect(skip.mock.calls).toEqual([['previous'], ['next']]);
  // The order left to right in the foot: back, pause, next.
  const order = [...container.querySelectorAll('.np-foot button')].map((b) => b.getAttribute('aria-label'));
  expect(order).toEqual(['Previous track', 'Pause', 'Next track']);
});

it('the music controls stop while the read is not live or a write runs', () => {
  const { container } = render(<NowBlock {...props({ s: summary({ canSkip: true }), locked: true })} />);
  for (const name of ['Previous track', 'Pause', 'Next track']) expect(label(container, name)!.disabled).toBe(true);
});

it('the time bar advances between reads, never past the end, and stops when the read is not live', async () => {
  const { container, rerender } = render(<NowBlock {...props()} />);
  const shown = () => container.querySelector('.np-prog span')?.textContent;
  expect(shown()).toBe('1:05');
  await flush(10_000);
  expect(shown()).toBe('1:15');
  const fill = () => (container.querySelector('.np-prog i') as HTMLElement).style.width;
  expect(fill()).toBe(`${Math.round((75 / 181) * 100)}%`);
  // The page's own clock stops counting at the stale limit: no bar runs on for ever.
  await flush(10 * 60_000);
  expect(shown()).toBe('3:01');
  expect(fill()).toBe('100%');
  rerender(<NowBlock {...props({ live: false })} />);
  expect(container.querySelector('.np-prog span')?.textContent).toBe('1:05');
});

it('a station with no length has no bar and the where line moves up', () => {
  const s = summary();
  s.nowPlaying = { speaker: 'Den', track: 'Night Drive', artist: null, duration: null, position: null, art: false };
  const { container } = render(<NowBlock {...props({ s })} />);
  expect(container.querySelector('.np-prog')).toBeNull();
  expect(container.querySelector('.np-mid .np-where')?.textContent).toBe('Den, 2 speakers');
  expect(container.querySelector('.np-artist')).toBeNull();
  expect(label(container, 'Pause')).toBeTruthy();
});

it('a very long title keeps its full text for the hover and clamps to two lines', () => {
  const long = 'A Song With A Rather Long Title That Keeps Going And Going Through The Night (Extended Mix)';
  const s = summary();
  s.nowPlaying = { speaker: 'Den', track: long, artist: 'Neon Coast', duration: 181, position: 65, art: false };
  const { container } = render(<NowBlock {...props({ s })} />);
  expect(container.querySelector('.np-title')?.textContent).toBe(long);
});

it('a cover Rust fetched shows; a type it does not send, or no address, shows the glyph', async () => {
  const withArt = summary();
  withArt.nowPlaying = { ...withArt.nowPlaying!, art: true };
  let calls = 0;
  mocks.set('wall2_sonos_art', () => {
    calls += 1;
    return { mime: 'image/png', base64: 'iVBORw0KGgo=' };
  });
  const a = render(<NowBlock {...props({ s: withArt })} />);
  await flush();
  expect((a.container.querySelector('img.np-cover') as HTMLImageElement).src).toBe('data:image/png;base64,iVBORw0KGgo=');
  expect(calls).toBe(1);
  // The same track on the next read asks nothing more of Rust.
  a.rerender(<NowBlock {...props({ s: { ...withArt, readAtMs: NOW + 30_000 } })} />);
  await flush();
  expect(calls).toBe(1);
  a.unmount();
  for (const odd of [{ mime: 'image/svg+xml', base64: 'PHN2Zz4=' }, { mime: 'image/png', base64: 'not base64!' }, { mime: 'text/html', base64: 'PGI+' }, null]) {
    mocks.set('wall2_sonos_art', () => odd);
    const b = render(<NowBlock {...props({ s: withArt })} />);
    await flush();
    expect(b.container.querySelector('img.np-cover')).toBeNull();
    expect(b.container.querySelector('.np-cover.blank')).toBeTruthy();
    b.unmount();
  }
  mocks.set('wall2_sonos_art', () => Promise.reject(new Error('boom')));
  const c = render(<NowBlock {...props({ s: withArt })} />);
  await flush();
  expect(c.container.querySelector('img.np-cover')).toBeNull();
  c.unmount();
  // No cover address: Rust is never asked.
  calls = 0;
  mocks.set('wall2_sonos_art', () => {
    calls += 1;
    return null;
  });
  render(<NowBlock {...props()} />);
  await flush();
  expect(calls).toBe(0);
});

it('a new track drops the old cover at once', async () => {
  const one = summary();
  one.nowPlaying = { ...one.nowPlaying!, art: true };
  mocks.set('wall2_sonos_art', () => ({ mime: 'image/png', base64: 'iVBORw0KGgo=' }));
  const { container, rerender } = render(<NowBlock {...props({ s: one })} />);
  await flush();
  expect(container.querySelector('img.np-cover')).toBeTruthy();
  const two = summary();
  two.nowPlaying = { ...two.nowPlaying!, track: 'Another Song', art: false };
  rerender(<NowBlock {...props({ s: two })} />);
  expect(container.querySelector('img.np-cover')).toBeNull();
});

it('nothing playing is the quiet block on the same grid, with the suggestion at the foot', () => {
  const { container } = render(<NowBlock {...props({ s: summary({}, false), suggestedSlot: 'day' })} />);
  expect(block(container).dataset.layout).toBe('quiet');
  expect(container.querySelector('.np-k')?.textContent).toBe('Sound');
  expect(container.querySelector('.np-title')?.textContent).toBe('Nothing playing');
  expect(container.querySelector('.np-mid')?.textContent).toBe('Suggested for this hour');
  expect(container.querySelector('.np-foot button')?.textContent).toBe('Play Day');
  expect(container.querySelector('[data-slot="day"]')).toBeTruthy();
});

it('a TV or line-in room is not music: the quiet words stay', () => {
  const s = summary({}, false);
  s.speakers[0] = { ...s.speakers[0], state: 'playing', input: 'tv' };
  const { container } = render(<NowBlock {...props({ s })} />);
  expect(container.querySelector('.np-title')?.textContent).toBe('Nothing playing');
});

it('the wall video alone: its own block with pause, stop and Open Watch, no back or next for one video', async () => {
  const { container } = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await play(0);
  expect(block(container).dataset.layout).toBe('video');
  expect(container.querySelector('.np-k')?.textContent).toBe('On the wall');
  expect(container.querySelector('.np-title')?.textContent).toBe('Night drive mix');
  expect(container.querySelector('.np-artist')?.textContent).toBe('YouTube video');
  expect(container.querySelector('.np-prog')?.textContent).toContain('12:34');
  expect(container.querySelector('.np-prog')?.textContent).toContain('45:10');
  expect(label(container, 'Previous video')).toBeNull();
  expect(label(container, 'Next video')).toBeNull();
  const order = [...container.querySelectorAll('.np-foot button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
  expect(order).toEqual(['Pause', 'Stop', 'Open Watch']);
});

it('pause, play and stop act on the Watch store; Open Watch goes to the Watch tab', async () => {
  const { container } = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await play(0);
  fireEvent.click(label(container, 'Pause')!);
  expect(useWatchStore.getState().paused).toBe(true);
  expect(label(container, 'Play')).toBeTruthy();
  fireEvent.click(label(container, 'Play')!);
  expect(useWatchStore.getState().paused).toBe(false);
  fireEvent.click(container.querySelector('.np-open')!);
  expect(usePlaceStore.getState().active).toBe('unwind');
  expect(useWatchStore.getState().tab).toBe('watch');
  usePlaceStore.setState({ active: 'home' });
  fireEvent.click(label(container, 'Open Watch')!);
  expect(usePlaceStore.getState().active).toBe('unwind');
  fireEvent.click(label(container, 'Stop')!);
  expect(useWatchStore.getState().playing).toBeNull();
});

it('a playlist the player reports with more than one item gets back and next, sent to the frame', async () => {
  const send = vi.fn(() => true);
  playerLink.send = send;
  const { container } = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await play(1, { count: 24, index: 3 });
  expect(container.querySelector('.np-artist')?.textContent).toBe('YouTube playlist, 4 of 24');
  const order = [...container.querySelectorAll('.np-foot button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
  expect(order).toEqual(['Previous video', 'Pause', 'Next video', 'Stop', 'Open Watch']);
  fireEvent.click(label(container, 'Previous video')!);
  fireEvent.click(label(container, 'Next video')!);
  expect(send.mock.calls).toEqual([['previousVideo'], ['nextVideo']]);
  expect(label(container, 'Next video')!.disabled).toBe(false);
});

it('a playlist with one item reported has no back or next', async () => {
  const { container } = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await play(1, { count: 1, index: 0 });
  expect(label(container, 'Next video')).toBeNull();
  expect(container.querySelector('.np-artist')?.textContent).toBe('YouTube playlist');
});

it('when the frame does not take a message, back and next stop with the reason on hover and a line, which goes', async () => {
  playerLink.send = () => false;
  const { container } = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await play(1, { count: 24, index: 3 });
  fireEvent.click(label(container, 'Next video')!);
  expect(label(container, 'Next video')!.disabled).toBe(true);
  expect(label(container, 'Previous video')!.disabled).toBe(true);
  expect(container.querySelector('.np-mid')?.textContent).toBe(OPEN_WATCH_TO_CONTROL);
  fireEvent.mouseEnter(label(container, 'Previous video')!);
  await flush(NP_HINT_MS + 10);
  expect(container.querySelector('.np-mid')?.textContent).not.toBe(OPEN_WATCH_TO_CONTROL);
  // Still stopped (the hover says why) until another video is on.
  expect(label(container, 'Next video')!.disabled).toBe(true);
  await play(0);
  await play(1, { count: 24, index: 0 });
  expect(label(container, 'Next video')!.disabled).toBe(false);
});

it('a Twitch stream takes only Stop and Open Watch', async () => {
  const { container } = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await play(2);
  expect(container.querySelector('.np-artist')?.textContent).toBe('Twitch stream');
  const order = [...container.querySelectorAll('.np-foot button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
  expect(order).toEqual(['Stop', 'Open Watch']);
  expect(container.querySelector('.np-prog')).toBeNull();
});

it('while the video waits for a click: the line, and no pause', async () => {
  const { container } = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await play(0, { started: false, time: null, duration: null });
  act(() => useWatchStore.getState().setNeedsClick(true));
  expect(container.querySelector('.np-mid')?.textContent).toBe('Click the video on Watch to start it');
  expect(label(container, 'Pause')).toBeNull();
  expect(label(container, 'Play')).toBeNull();
  expect(label(container, 'Stop')).toBeTruthy();
});

it('a live stream shows no bar; a video that has ended is not shown', async () => {
  const { container } = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await play(0, { time: 5, duration: 0 });
  expect(container.querySelector('.np-prog')).toBeNull();
  expect(block(container).dataset.layout).toBe('video');
  act(() => useWatchStore.getState().setReport({ ended: true }));
  expect(block(container).dataset.layout).toBe('quiet');
});

it('both at once split in two halves with a hairline between; no bar, no back or next', async () => {
  const { container } = render(<NowBlock {...props({ s: summary({ canSkip: true }) })} />);
  await play(0);
  expect(block(container).dataset.layout).toBe('both');
  const halves = [...container.querySelectorAll('.np-layer:not(.out) .np-half')] as HTMLElement[];
  expect(halves.map((h) => h.dataset.half)).toEqual(['video', 'music']);
  expect(halves[0].nextElementSibling?.className).toBe('np-hair');
  expect(halves[0].querySelector('.np-k')?.textContent).toBe('On the wall');
  expect(halves[0].querySelector('.np-l1')?.textContent).toBe('12:34 of 45:10');
  expect(halves[0].querySelector('.np-l2')?.textContent).toBe('YouTube video');
  expect(halves[1].querySelector('.np-k')?.textContent).toBe('Now playing');
  expect(halves[1].querySelector('.np-l1')?.textContent).toBe('Neon Coast');
  expect(halves[1].querySelector('.np-l2')?.textContent).toBe('Den, 2 speakers');
  expect(container.querySelector('.np-prog')).toBeNull();
  expect(label(container, 'Next track')).toBeNull();
  expect(label(container, 'Previous track')).toBeNull();
  expect(label(container, 'Next video')).toBeNull();
  const videoButtons = [...halves[0].querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
  expect(videoButtons).toEqual(['Open Watch', 'Pause', 'Stop']);
  expect([...halves[1].querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Pause']);
  fireEvent.click(halves[0].querySelector('[aria-label="Stop"]')!);
  expect(useWatchStore.getState().playing).toBeNull();
  expect(block(container).dataset.layout).toBe('music');
  await play(0);
  fireEvent.click(container.querySelector('.np-half[data-half="music"] [aria-label="Pause"]')!);
  expect(pauseAll).toHaveBeenCalledTimes(1);
});

it('the layouts cross-fade for 200 ms and never change the block\'s box (every layer fills it)', async () => {
  const { container } = render(<NowBlock {...props()} />);
  expect(layers(container)).toHaveLength(1);
  expect(layers(container)[0].className).not.toContain('in');
  await start(0);
  // The new layout fades in over the one that goes: both on screen, the old one inert and hidden.
  expect(layers(container)).toHaveLength(2);
  const [out, now] = layers(container);
  expect(out.className).toContain('out');
  expect(out.getAttribute('aria-hidden')).toBe('true');
  expect(out.hasAttribute('inert')).toBe(true);
  expect(now.className).toContain('in');
  expect(block(container).querySelectorAll('.np-layer').length).toBe(2);
  await flush(NP_FADE_MS + 10);
  expect(layers(container)).toHaveLength(1);
  expect(layers(container)[0].className).not.toContain('in');
  // A rerender inside the fade never leaves the old layer stuck.
  act(() => useWatchStore.getState().stop());
  await flush(50);
  act(() => useWatchStore.getState().setMuted(false));
  await flush(NP_FADE_MS + 10);
  expect(layers(container)).toHaveLength(1);
});

it('under reduced motion the layouts change at once', async () => {
  const original = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  try {
    const { container } = render(<NowBlock {...props()} />);
    await start(0);
    expect(layers(container)).toHaveLength(1);
  } finally {
    window.matchMedia = original;
  }
});

it('every button has a hover tip text and is a real button (keyboard Space and Enter work)', async () => {
  const { container } = render(<NowBlock {...props({ s: summary({ canSkip: true }) })} />);
  for (const b of container.querySelectorAll('button')) {
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('type')).toBe('button');
    expect(b.getAttribute('aria-label') || b.textContent).toBeTruthy();
  }
  await play(0);
  for (const b of container.querySelectorAll('button')) expect(b.getAttribute('aria-label') || b.textContent).toBeTruthy();
});
