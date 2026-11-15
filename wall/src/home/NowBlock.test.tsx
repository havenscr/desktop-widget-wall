import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePlaceStore } from '../state/places';
import { playerLink } from '../unwind/watch/PlayerFrame';
import { SAVED_KEY } from '../unwind/watch/saved';
import { resetWatch, useWatchStore } from '../unwind/watch/store';
import { HoverTipLayer, TIP_DELAY_MS } from '../ui/HoverTip';
import { NP_ART_RETRY_MS, NP_FADE_MS, NP_HINT_MS, NP_HOLD_MS, NowBlock, OPEN_WATCH_TO_CONTROL, type NowBlockProps } from './NowBlock';
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
    nowPlaying: playing ? { speaker: 'Den', track: 'Night Drive', artist: 'Neon Coast', duration: 181, position: 65, art: null } : null,
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

it('a station with no length has no bar; the where line sits right under the artist, as one group', () => {
  const s = summary();
  s.nowPlaying = { speaker: 'Den', track: 'Night Drive', artist: null, duration: null, position: null, art: null };
  const { container } = render(<NowBlock {...props({ s })} />);
  expect(container.querySelector('.np-prog')).toBeNull();
  expect(container.querySelector('.np-mid')).toBeNull();
  expect(container.querySelector('.np-meta .np-where')?.textContent).toBe('Den, 2 speakers');
  expect(container.querySelector('.np-foot .np-where')).toBeNull();
  expect(container.querySelector('.np-artist')).toBeNull();
  expect(label(container, 'Pause')).toBeTruthy();
});

it('a very long title keeps its full text for the hover and clamps to two lines', () => {
  const long = 'A Song With A Rather Long Title That Keeps Going And Going Through The Night (Extended Mix)';
  const s = summary();
  s.nowPlaying = { speaker: 'Den', track: long, artist: 'Neon Coast', duration: 181, position: 65, art: null };
  const { container } = render(<NowBlock {...props({ s })} />);
  expect(container.querySelector('.np-title')?.textContent).toBe(long);
});

it('a cover Rust fetched shows; a type it does not send, or no address, shows the glyph', async () => {
  const withArt = summary();
  withArt.nowPlaying = { ...withArt.nowPlaying!, art: 'key-1' };
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

const withArt = (key: string | null, track = 'Night Drive') => {
  const x = summary();
  x.nowPlaying = { ...x.nowPlaying!, track, art: key };
  return x;
};
const PNG_A = { mime: 'image/png', base64: 'iVBORw0KGgo=' };
const PNG_B = { mime: 'image/png', base64: 'iVBORw0KGgp=' };
const cover = (c: HTMLElement) => (c.querySelector('img.np-cover') as HTMLImageElement | null)?.src ?? null;

it('a cover is fetched again when Rust\'s key for it changes, whatever the title is', async () => {
  const seen: string[] = [];
  let next = PNG_A;
  mocks.set('wall2_sonos_art', () => {
    seen.push('ask');
    return next;
  });
  const { container, rerender } = render(<NowBlock {...props({ s: withArt('k1') })} />);
  await flush();
  expect(cover(container)).toBe('data:image/png;base64,iVBORw0KGgo=');
  // The same title and artist with different art: the key changed, so it asks again.
  next = PNG_B;
  rerender(<NowBlock {...props({ s: withArt('k2') })} />);
  await flush();
  expect(seen).toHaveLength(2);
  expect(cover(container)).toBe('data:image/png;base64,iVBORw0KGgp=');
  // A new title with the same key (the same art) asks nothing.
  rerender(<NowBlock {...props({ s: withArt('k2', 'Another Song') })} />);
  await flush();
  expect(seen).toHaveLength(2);
});

it('a track with no cover shows the glyph at once; the old cover is held only while a new one is on its way', async () => {
  let release: (v: typeof PNG_A) => void = () => {};
  mocks.set('wall2_sonos_art', () => new Promise((done) => { release = done; }));
  const { container, rerender } = render(<NowBlock {...props({ s: withArt('k1') })} />);
  await flush();
  release(PNG_A);
  await flush();
  expect(cover(container)).not.toBeNull();
  // The next track has no cover: nothing is coming, so the glyph shows at once.
  rerender(<NowBlock {...props({ s: withArt(null, 'Another Song') })} />);
  expect(cover(container)).toBeNull();
  expect(container.querySelector('.np-cover.blank')).toBeTruthy();
  // The next one has a cover on its way: the old one stays while it comes.
  rerender(<NowBlock {...props({ s: withArt('k3', 'Third Song') })} />);
  await flush();
  rerender(<NowBlock {...props({ s: withArt('k1', 'Third Song') })} />);
  await flush();
  release(PNG_A);
  await flush();
  expect(cover(container)).not.toBeNull();
  rerender(<NowBlock {...props({ s: withArt('k4', 'Fourth Song') })} />);
  expect(cover(container)).not.toBeNull();
  await flush(NP_HOLD_MS - 100);
  expect(cover(container)).not.toBeNull();
  // It never comes: after 2 seconds the glyph.
  await flush(200);
  expect(cover(container)).toBeNull();
  expect(container.querySelector('.np-cover.blank')).toBeTruthy();
  // And when it does come late, it shows.
  release(PNG_B);
  await flush();
  expect(cover(container)).toBe('data:image/png;base64,iVBORw0KGgp=');
});

it('a cover that came back empty is asked for once more after 31 seconds, then never', async () => {
  let calls = 0;
  let answer: typeof PNG_A | null = null;
  mocks.set('wall2_sonos_art', () => {
    calls += 1;
    return answer;
  });
  const { container } = render(<NowBlock {...props({ s: withArt('k1') })} />);
  await flush();
  expect(calls).toBe(1);
  expect(cover(container)).toBeNull();
  await flush(NP_ART_RETRY_MS - 100);
  expect(calls).toBe(1);
  answer = PNG_A;
  await flush(200);
  expect(calls).toBe(2);
  expect(cover(container)).toBe('data:image/png;base64,iVBORw0KGgo=');
  await flush(10 * 60_000);
  expect(calls).toBe(2);
});

it('a cover that fails twice is not asked for a third time for that key', async () => {
  let calls = 0;
  mocks.set('wall2_sonos_art', () => {
    calls += 1;
    return null;
  });
  render(<NowBlock {...props({ s: withArt('k1') })} />);
  await flush();
  await flush(NP_ART_RETRY_MS + 100);
  expect(calls).toBe(2);
  await flush(10 * 60_000);
  expect(calls).toBe(2);
});

it('the per-second clock runs only while a music time bar is on screen', async () => {
  const spy = vi.spyOn(globalThis, 'setInterval');
  const ticks = () => spy.mock.calls.filter((c) => c[1] === 1000).length;
  // Music alone with a bar: it runs.
  const a = render(<NowBlock {...props()} />);
  expect(ticks()).toBeGreaterThan(0);
  a.unmount();
  spy.mockClear();
  // The wall's video alone, and both at once: no music bar, so no clock.
  await start(0);
  const b = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await flush(NP_FADE_MS + 10);
  expect(ticks()).toBe(0);
  b.unmount();
  const c = render(<NowBlock {...props()} />);
  await flush(NP_FADE_MS + 10);
  expect(c.container.querySelector('.np-both')).toBeTruthy();
  expect(ticks()).toBe(0);
  spy.mockRestore();
});

it('the skip buttons show busy while their write or latch runs', () => {
  const { container, rerender } = render(<NowBlock {...props({ s: summary({ canSkip: true }) })} />);
  expect(label(container, 'Next track')!.getAttribute('aria-busy')).toBeNull();
  rerender(<NowBlock {...props({ s: summary({ canSkip: true }), skipBusy: true })} />);
  for (const name of ['Previous track', 'Next track']) {
    expect(label(container, name)!.getAttribute('aria-busy')).toBe('true');
    expect(label(container, name)!.className).toContain('busy');
  }
  expect(label(container, 'Pause')!.getAttribute('aria-busy')).toBeNull();
});

// Entry 2 of the first fix round: the cut state (back and next stopped after a message the frame did not take) has ways out.
async function cutPlaylist(container: HTMLElement) {
  playerLink.send = () => false;
  await play(1, { count: 24, index: 3 });
  fireEvent.click(label(container, 'Next video')!);
  expect(label(container, 'Next video')!.disabled).toBe(true);
  expect(label(container, 'Previous video')!.disabled).toBe(true);
}
const enabled = (c: HTMLElement) => !label(c, 'Next video')!.disabled && !label(c, 'Previous video')!.disabled;

it('back and next come back when the frame starts answering (the player reports)', async () => {
  const { container } = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await cutPlaylist(container);
  // Nothing from the player: still stopped.
  await flush(5_000);
  expect(label(container, 'Next video')!.disabled).toBe(true);
  act(() => useWatchStore.getState().setReport({ time: 800 }));
  expect(enabled(container)).toBe(true);
});

it('back and next come back when the player reports that it has started', async () => {
  const { container } = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await cutPlaylist(container);
  act(() => useWatchStore.getState().setReport({ started: false, time: null, duration: null }));
  expect(enabled(container)).toBe(true);
  fireEvent.click(label(container, 'Next video')!);
  expect(label(container, 'Next video')!.disabled).toBe(true);
  act(() => useWatchStore.getState().setReport({ started: true, time: 1, duration: 2710 }));
  expect(enabled(container)).toBe(true);
});

it('back and next come back when another item is on, by identity, also the same title replayed after Stop', async () => {
  const { container } = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await cutPlaylist(container);
  fireEvent.click(label(container, 'Stop')!);
  await flush(NP_FADE_MS + 10);
  await play(1, { count: 24, index: 3 });
  expect(enabled(container)).toBe(true);
  // Open Watch and back to Home: also out.
  playerLink.send = () => false;
  fireEvent.click(label(container, 'Next video')!);
  expect(label(container, 'Next video')!.disabled).toBe(true);
  fireEvent.click(container.querySelector('.np-open')!);
  expect(usePlaceStore.getState().active).toBe('unwind');
  act(() => usePlaceStore.getState().setActive('home'));
  expect(enabled(container)).toBe(true);
});

it('back and next come back when Home is shown again', async () => {
  const { container } = render(<NowBlock {...props({ s: summary({}, false) })} />);
  await cutPlaylist(container);
  act(() => usePlaceStore.getState().setActive('work'));
  expect(label(container, 'Next video')!.disabled).toBe(true);
  act(() => usePlaceStore.getState().setActive('home'));
  expect(enabled(container)).toBe(true);
});

it('every control shows its words on hover, and works from the keyboard once per press (a held key never repeats)', async () => {
  const send = vi.fn(() => true);
  playerLink.send = send;
  const { container, rerender } = render(
    <>
      <NowBlock {...props({ s: summary({ canSkip: true }) })} />
      <HoverTipLayer />
    </>,
  );
  const tipWords = async (b: HTMLElement) => {
    fireEvent.mouseEnter(b);
    await flush(TIP_DELAY_MS);
    const words = screen.getByRole('tooltip').textContent;
    fireEvent.mouseLeave(b);
    await flush(10);
    return words;
  };
  const check = async (name: string, words: string, reset: () => void, calls: () => number) => {
    const b = label(container, name)!;
    expect(await tipWords(b)).toContain(words);
    // The browser clicks a button on Enter (keydown) and on Space (keyup): a first press is never swallowed, a repeat always is.
    for (const key of ['Enter', ' ']) {
      reset();
      expect(fireEvent.keyDown(b, { key })).toBe(true);
      expect(fireEvent.keyDown(b, { key, repeat: true })).toBe(false);
      b.click();
      expect(calls()).toBe(1);
      await flush(0);
    }
  };
  const musicCalls = { n: 0 };
  skip.mockImplementation(() => void (musicCalls.n += 1));
  pauseAll.mockImplementation(() => void (musicCalls.n += 1));
  const zero = () => {
    musicCalls.n = 0;
  };
  await check('Previous track', 'Previous track', zero, () => musicCalls.n);
  await check('Pause', 'Pause every Sonos speaker', zero, () => musicCalls.n);
  await check('Next track', 'Next track', zero, () => musicCalls.n);
  expect(skip.mock.calls.map((c) => c[0])).toEqual(['previous', 'previous', 'next', 'next']);
  skip.mockReset();
  pauseAll.mockReset();
  // The wall's video alone (the music stops): the same for each of its controls.
  rerender(
    <>
      <NowBlock {...props({ s: summary({}, false) })} />
      <HoverTipLayer />
    </>,
  );
  await play(1, { count: 24, index: 3 });
  const store = () => useWatchStore.getState();
  const videoCase = async (name: string, words: string, did: () => number) => {
    const b = label(container, name)!;
    expect(await tipWords(b)).toContain(words);
    expect(fireEvent.keyDown(b, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(b, { key: ' ', repeat: true })).toBe(false);
    const before = did();
    b.click();
    expect(did() - before).toBe(1);
  };
  let pauses = 0;
  const unsub = useWatchStore.subscribe((now, prev) => {
    if (now.paused !== prev.paused) pauses += 1;
  });
  await videoCase('Previous video', 'Previous video. Item 4 of 24', () => send.mock.calls.filter((c) => (c as unknown[])[0] === 'previousVideo').length);
  await videoCase('Next video', 'Next video. Item 4 of 24', () => send.mock.calls.filter((c) => (c as unknown[])[0] === 'nextVideo').length);
  await videoCase('Pause', 'Pause the video', () => pauses);
  expect(store().paused).toBe(true);
  await videoCase('Play', 'Play the video', () => pauses);
  expect(store().paused).toBe(false);
  unsub();
  await videoCase('Open Watch', 'Open Watch', () => (usePlaceStore.getState().active === 'unwind' ? 1 : 0));
  usePlaceStore.setState({ active: 'home' });
  const stopBtn = label(container, 'Stop')!;
  expect(await tipWords(stopBtn)).toContain('Stop and remove the video');
  expect(fireEvent.keyDown(stopBtn, { key: 'Enter' })).toBe(true);
  expect(fireEvent.keyDown(stopBtn, { key: ' ', repeat: true })).toBe(false);
  stopBtn.click();
  expect(store().playing).toBeNull();
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
