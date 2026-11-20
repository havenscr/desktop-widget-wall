import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAudio, useAudioStore } from '../audio/store';
import { CAMERAS } from '../horizon/cameras';
import { publishCamera } from '../horizon/signal';
import { usePlaceStore } from '../state/places';
import { FADE_IN_S } from './model';
import { Watt, restClock } from './Watt';
import { resetWeatherStore, useWeatherStore } from '../weather/useWeather';
import { useSceneWeather } from '../weather/sceneSetting';
import type { WeatherReading } from '../weather/model';
import { resetAgents } from '../agents/useAgents';
import { resetMeetingFeed } from '../work/useNextMeeting';

vi.setConfig({ testTimeout: 20_000 });

vi.mock('../ribbon/sun', async (original) => ({
  ...(await original<typeof import('../ribbon/sun')>()),
  sunTimes: () => ({ rise: null, set: null }),
}));
vi.mock('../ui/useIdle', () => ({ useIdle: () => false }));
const invokeMock = vi.hoisted(() => vi.fn((..._args: unknown[]) => new Promise(() => {})));
vi.mock('../bridge/tauri', async (original) => ({
  ...(await original<typeof import('../bridge/tauri')>()),
  invoke: invokeMock,
}));
vi.mock('../horizon/index', async (original) => ({
  ...(await original<typeof import('../horizon/index')>()),
  drawHorizon: vi.fn(),
}));

let frames: Map<number, FrameRequestCallback>;
let nextId = 1;
let ts = 0;
let rests: Map<number, { fn: () => void; due: number }>;
const realRest = { ...restClock };
const local = (h: number, m = 0) => new Date(2026, 10, 11, h, m, 0).getTime();
const day = () => local(14);

function tick() {
  ts += 50;
  const due = [...frames.entries()];
  frames.clear();
  act(() => {
    for (const [, cb] of due) cb(ts);
    for (const [id, r] of [...rests.entries()]) {
      if (r.due > ts || !rests.has(id)) continue;
      rests.delete(id);
      r.fn();
    }
  });
}
const runFor = (s: number, each?: () => void) => {
  for (let i = 0; i < Math.round(s / 0.05); i++) {
    tick();
    each?.();
  }
};

function reduced(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

const reading = (over: Partial<WeatherReading> = {}): WeatherReading =>
  ({ temp: 52, look: { label: 'Rain', icon: 'rain' }, high: 55, low: 45, hours: [], fetchedAt: day(), code: 63, ...over }) as WeatherReading;
const setReading = (r: WeatherReading | null) => useWeatherStore.setState({ reading: r });

const sheepRects = (c: HTMLElement) => [...c.querySelectorAll<SVGRectElement>('.watt-sheep > svg rect')].map((r) => ({ x: Number(r.getAttribute('x')), y: Number(r.getAttribute('y')), fill: r.getAttribute('fill') ?? '' }));
const fills = (c: HTMLElement) => new Set(sheepRects(c).map((r) => r.fill));
const water = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('.watt-wx:not(.watt-wx-strand)')].filter((e) => e.style.display === 'block');
const strand = (c: HTMLElement) => c.querySelector<HTMLElement>('.watt-wx-strand')!;
const facing = (c: HTMLElement) => (/scaleX\((-?[\d.]+)\)/.exec(c.querySelector<HTMLElement>('.watt-sheep')!.style.transform)?.[1] ?? '1');
const topRow = (c: HTMLElement) => sheepRects(c).filter((r) => r.y === 0).map((r) => r.x).sort((a, b) => a - b);

beforeEach(() => {
  frames = new Map();
  rests = new Map();
  restClock.set = (fn, ms) => {
    const id = nextId++;
    rests.set(id, { fn, due: ts + ms });
    return id;
  };
  restClock.clear = (id) => void rests.delete(id);
  vi.spyOn(performance, 'now').mockImplementation(() => ts);
  ts = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void frames.delete(id));
  usePlaceStore.setState({ active: 'unwind' });
  publishCamera(CAMERAS.unwind, false);
  resetAudio();
  reduced(false);
  useSceneWeather.setState({ on: true });
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  localStorage.clear();
});
afterEach(() => {
  invokeMock.mockImplementation(() => new Promise(() => {}));
  Object.assign(restClock, realRest);
  resetWeatherStore();
  resetMeetingFeed();
  useSceneWeather.setState({ on: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  publishCamera(null, false);
  resetAgents();
});

describe('Watt in the rain', () => {
  it('dry on a dry day: the dry wool colours and no water', () => {
    setReading(reading({ look: { label: 'Sunny', icon: 'sun' }, code: 0 } as Partial<WeatherReading>));
    const { container } = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.5);
    expect(fills(container).has('#f6f2ff')).toBe(true);
    expect(fills(container).has('#a79bdc')).toBe(false);
    expect(water(container)).toHaveLength(0);
  });

  it('damp wool with darker strands on a rainy day, and no umbrella', () => {
    setReading(reading());
    const { container } = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.5);
    const f = fills(container);
    expect(f.has('#f6f2ff')).toBe(false);
    expect(f.has('#dcd3fb') && f.has('#bfb2f0') && f.has('#a79bdc')).toBe(true);
    expect(container.querySelector('.watt-prop-umbrella')).toBeNull();
    expect(container.querySelector('.watt-prop')).toBeNull();
  });

  it('a drip hangs and falls, one at a time, while he stands', () => {
    setReading(reading());
    const { container } = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.1);
    let seen = 0;
    let most = 0;
    runFor(6, () => {
      const w = water(container);
      if (w.length > 0) seen++;
      most = Math.max(most, w.length);
    });
    expect(seen).toBeGreaterThan(20);
    expect(most).toBeLessThanOrEqual(2);
    const w = water(container)[0];
    if (w) expect(w.style.opacity).not.toBe('');
  });

  it('wears the headphones in rain on Unwind with music playing', () => {
    setReading(reading());
    act(() => useAudioStore.setState({ playing: true }));
    const { container } = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.5);
    expect(container.querySelector('.watt-prop-headphones')).not.toBeNull();
    expect(container.querySelector('.watt-prop-umbrella')).toBeNull();
  });

  it('with the Tools switch off he looks as on a dry day: no damp, no drip, no lean', () => {
    setReading(reading({ windy: true, wind: { speed: 25, gust: 35 } }));
    useSceneWeather.setState({ on: false });
    const { container } = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.1);
    let drips = 0;
    runFor(6, () => void (drips += water(container).length));
    expect(drips).toBe(0);
    expect(fills(container).has('#f6f2ff')).toBe(true);
    expect(fills(container).has('#a79bdc')).toBe(false);
    expect(strand(container).style.display).not.toBe('block');
    act(() => useSceneWeather.getState().setOn(true));
    runFor(1);
    expect(fills(container).has('#f6f2ff')).toBe(false);
  });

  it('under reduced motion only the damp colours show: no drip, no lean, no strand, no frame loop', () => {
    reduced(true);
    setReading(reading({ windy: true, wind: { speed: 25, gust: 35 } }));
    const { container } = render(<Watt now={day} />);
    runFor(2);
    expect(fills(container).has('#f6f2ff')).toBe(false);
    expect(fills(container).has('#a79bdc')).toBe(true);
    expect(water(container)).toHaveLength(0);
    expect(strand(container).style.display).not.toBe('block');
    expect(frames.size).toBe(0);
  });

  it('asleep he is damp too (the sleeping pose), and drips nothing', () => {
    setReading(reading({ fetchedAt: local(23) }));
    const { container } = render(<Watt now={() => local(23)} />);
    runFor(FADE_IN_S + 0.5);
    expect(fills(container).has('#f6f2ff')).toBe(false);
    expect(fills(container).has('#a79bdc')).toBe(true);
    let drips = 0;
    runFor(4, () => void (drips += water(container).length));
    expect(drips).toBe(0);
  });

  it('a stale reading leaves him dry', () => {
    setReading(reading({ fetchedAt: day() - 3 * 3_600_000 }));
    const { container } = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.5);
    expect(fills(container).has('#f6f2ff')).toBe(true);
  });
});

describe('Watt in the wind', () => {
  it('leans the top two wool rows one pixel downwind while he stands, and trails a strand when he faces left', () => {
    const dryWind = reading({ look: { label: 'Sunny', icon: 'sun' }, code: 0, windy: true, wind: { speed: 24, gust: 35 } } as Partial<WeatherReading>);
    setReading({ ...dryWind, windy: false });
    const calm = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.2);
    const calmTop = Math.min(...topRow(calm.container));
    calm.unmount();
    setReading(dryWind);
    const { container } = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.2);
    let leaned = 0;
    let strands = 0;
    let wrong = 0;
    runFor(120, () => {
      const top = Math.min(...topRow(container));
      const dir = facing(container);
      // Facing right the top row moves right (+6 px); facing left, in his own pixels, it moves left, which is the screen's right.
      if (top !== calmTop) leaned++;
      if (strand(container).style.display === 'block') {
        strands++;
        if (!dir.startsWith('-')) wrong++;
      }
    });
    expect(leaned).toBeGreaterThan(10);
    expect(strands).toBeGreaterThan(0);
    expect(wrong).toBe(0);
  });

  it('shows neither lean nor strand on a calm day', () => {
    setReading(reading({ look: { label: 'Sunny', icon: 'sun' }, code: 0 } as Partial<WeatherReading>));
    const { container } = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.2);
    const base = Math.min(...topRow(container));
    let moved = 0;
    let strands = 0;
    runFor(60, () => {
      if (Math.min(...topRow(container)) !== base) moved++;
      if (strand(container).style.display === 'block') strands++;
    });
    expect(moved).toBe(0);
    expect(strands).toBe(0);
  });
});

describe('the shake he starts on his own', () => {
  /**
   * Step the frame clock in the rain and report what was seen. The first shake is due by 75 s, so `seconds`
   * (default 90) covers it; `untilShake` stops early at the first shake, so the work stays small on a loaded machine.
   */
  function watch(container: HTMLElement, seconds = 90, untilShake = false) {
    const seen = { droplets: 0, fluffy: 0, drips: 0 };
    for (let i = 0; i < Math.round(seconds / 0.05); i++) {
      tick();
      const w = water(container);
      if (w.length >= 3) seen.droplets++;
      if (w.length > 0) seen.drips++;
      if (fills(container).has('#f6f2ff') && !fills(container).has('#a79bdc')) seen.fluffy++;
      if (untilShake && seen.droplets + seen.fluffy > 0) break;
    }
    return seen;
  }

  it('does not start during a meeting with a join link in progress (no call), the damp look stays, and one starts after the meeting ends', async () => {
    let ms = day();
    invokeMock.mockImplementation(((cmd: string) =>
      cmd === 'wall2_meet_next'
        ? Promise.resolve({
            accounts: [],
            meetings: [{ key: 'k', accountId: 'a', title: 'Planning', start: new Date(ms - 10 * 60_000).toISOString(), end: new Date(ms + 30 * 60_000).toISOString(), canJoin: true }],
          })
        : new Promise(() => {})) as never);
    setReading(reading());
    const { container, rerender } = render(<Watt now={() => ms} />);
    await act(async () => void (await Promise.resolve()));
    runFor(FADE_IN_S + 0.5);
    const during = watch(container);
    expect(during.droplets).toBe(0);
    expect(during.fluffy).toBe(0);
    expect(fills(container).has('#a79bdc')).toBe(true);
    // The meeting ends: the shake that fell due while it ran starts at the next calm stand.
    ms += 31 * 60_000;
    setReading(reading({ fetchedAt: ms }));
    rerender(<Watt now={() => ms} />);
    const after = watch(container, 90, true);
    expect(after.droplets + after.fluffy).toBeGreaterThan(0);
  });

  it('does not start while his menu is open; the damp look stays', () => {
    setReading(reading());
    const { container } = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.5);
    fireEvent.contextMenu(container.querySelector('.watt-hit')!);
    runFor(0.2);
    expect(container.querySelector('.watt-menu')).not.toBeNull();
    const seen = watch(container);
    expect(container.querySelector('.watt-menu')).not.toBeNull();
    expect(seen.droplets).toBe(0);
    expect(seen.fluffy).toBe(0);
    expect(fills(container).has('#a79bdc')).toBe(true);
  });
});

describe('the shake', () => {
  it('happens once a minute or so while he stands in the rain: the wool moves four frames, droplets fly, then fluffy wool for five seconds, then damp again', () => {
    setReading(reading());
    const { container } = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.1);
    let droplets = 0;
    let fluffyTicks = 0;
    let shakeTicks = 0;
    const base = new Set<number>();
    runFor(1, () => {});
    sheepRects(container).filter((r) => r.y === 0).forEach((r) => base.add(r.x));
    // Within 80 s one shake begins (the gap is 45 to 75 s); step on the frame clock.
    runFor(84, () => {
      const d = water(container).length;
      if (d >= 3) droplets++;
      if (fills(container).has('#f6f2ff') && !fills(container).has('#a79bdc')) fluffyTicks++;
      if (topRow(container).some((x) => !base.has(x))) shakeTicks++;
    });
    expect(droplets).toBeGreaterThan(0);
    expect(shakeTicks).toBeGreaterThan(0);
    // Five seconds of fluffy is 100 ticks of 50 ms.
    expect(fluffyTicks).toBeGreaterThan(60);
    expect(fluffyTicks).toBeLessThanOrEqual(110);
  });
});

describe('his loop in the rain', () => {
  /** How many rests the loop plans while 200 s pass in a call, which holds his own shake back (the first shake is due by 75 s). */
  async function restsInCall(r: WeatherReading): Promise<number> {
    setReading(r);
    const count = { n: 0 };
    const set = restClock.set;
    restClock.set = (fn, ms) => {
      count.n++;
      return set(fn, ms);
    };
    const { unmount } = render(<Watt now={day} inCall />);
    runFor(FADE_IN_S + 0.5);
    count.n = 0;
    runFor(200);
    unmount();
    return count.n;
  }

  it('a shake that is due while he is held back by a call wakes the loop for nothing: no more rests than on a dry day', async () => {
    const dry = await restsInCall(reading({ look: { label: 'Sunny', icon: 'sun' }, code: 0 } as Partial<WeatherReading>));
    resetWeatherStore();
    const rain = await restsInCall(reading());
    // Drips are not shown in a call, so the rain adds no wake of its own: before this fix it added about one a second.
    expect(rain).toBeLessThanOrEqual(dry + 5);
  });

  it('while he stands it wakes for the drip steps and not for every frame', () => {
    setReading(reading());
    const { container } = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.5);
    // Find a stretch where he stands: count the frame callbacks in the next 8 seconds against a dry run.
    void container;
    let rafs = 0;
    const spy = window.requestAnimationFrame as unknown as ReturnType<typeof vi.fn>;
    const before = spy.mock.calls.length;
    runFor(8);
    rafs = spy.mock.calls.length - before;
    // A frame every 31 ms would be about 250 in 8 s; resting loops stay far under that.
    expect(rafs).toBeLessThan(200);
  });
});
