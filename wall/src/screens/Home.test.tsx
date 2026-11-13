import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePacificTime } from '../ribbon/testZone';
import css from '../styles/home.css?raw';
import * as sun from '../home/sunLine';
import { Home } from './Home';

usePacificTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T16:30:00-08:00'));
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

it('lays Home on the concept zones: sun block, mood cards over Sound, chores and network, and no Rooms placeholder', async () => {
  mocks.set('wall2_moods', () => [
    { id: 'day', label: 'Day' },
    { id: 'evening', label: 'Evening' },
  ]);
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0 }));
  mocks.set('wall2_home_security', () => Promise.reject(new Error('Could not reach the service')));
  mocks.set('wall2_sonos_summary', () => Promise.reject(new Error('not-configured')));
  const { container } = render(<Home />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const home = container.querySelector('section.home.zones');
  expect(home).toBeTruthy();
  expect([...home!.children].map((c) => c.className)).toEqual(['home-wing', 'home-centre tall', 'home-right']);
  // The centre: moods, then Sound; the Rooms row's place renders nothing yet.
  expect([...home!.querySelector('.home-centre')!.children].map((c) => c.className)).toEqual(['moods', 'sound bare']);
  expect(screen.getByText('Add sonosBaseUrl to feeds.json to control Sonos from here.')).toBeTruthy();
  expect(screen.getByText(/^Sunset in \d+ min$/)).toBeTruthy();
  expect(container.querySelectorAll('.mood-btn')).toHaveLength(2);
  expect(screen.getByLabelText('Around the house')).toBeTruthy();
  // Unreachable is a quiet amber line inside the network card, nowhere else.
  const net = screen.getByLabelText('Network and security');
  expect(net.textContent).toContain('Home app not reachable');
  expect(container.querySelector('.home-wing')?.textContent).not.toContain('not reachable');
  expect(screen.queryByText(/Rooms/)).toBeNull();
});

it('pins each zone to its own column, so an empty one never shifts the others', () => {
  const col = (sel: string) => new RegExp(`\\${sel} \\{[^}]*grid-column: (\\d)`).exec(css)?.[1];
  expect([col('.home-wing'), col('.home-centre'), col('.home-right')]).toEqual(['1', '2', '3']);
});

it('with no moods and an empty left wing, the centre shows one compact card and the right wing stays', async () => {
  const spy = vi.spyOn(sun, 'sunLine').mockReturnValue(null);
  mocks.set('wall2_moods', () => []);
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0 }));
  mocks.set('wall2_home_security', () => Promise.reject(new Error('not-configured')));
  mocks.set('wall2_sonos_summary', () => Promise.reject(new Error('not-configured')));
  const { container } = render(<Home />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const home = container.querySelector('section.home.zones')!;
  expect([...home.children].map((c) => c.className)).toEqual(['home-centre tall', 'home-right']);
  expect(screen.getByText('No moods set up in the home app yet')).toBeTruthy();
  spy.mockRestore();
});

it('with the home app and Sonos both out, the centre shows one status card naming both, and Check again reads both', async () => {
  let moodReads = 0;
  let sonosReads = 0;
  mocks.set('wall2_moods', () => {
    moodReads += 1;
    return Promise.reject(new Error('Could not reach the service'));
  });
  mocks.set('wall2_sonos_summary', () => {
    sonosReads += 1;
    return Promise.reject(new Error('not-configured'));
  });
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0 }));
  mocks.set('wall2_home_security', () => Promise.reject(new Error('not-configured')));
  const { container } = render(<Home />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const card = screen.getByLabelText('Home centre status');
  expect(card.textContent).toContain('Moods (the home app): not reachable.');
  expect(card.textContent).toContain('Sound (the Sonos service): not set up. Add sonosBaseUrl to feeds.json.');
  expect(container.querySelector('.home-centre.both-out')).toBeTruthy();
  const before = [moodReads, sonosReads];
  fireEvent.click(screen.getByText('Check again'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(moodReads).toBe(before[0] + 1);
  expect(sonosReads).toBe(before[1] + 1);
});

it('with only one source out, there is no status card', async () => {
  mocks.set('wall2_moods', () => [{ id: 'day', label: 'Day' }]);
  mocks.set('wall2_sonos_summary', () => Promise.reject(new Error('Could not reach Sonos')));
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0 }));
  mocks.set('wall2_home_security', () => Promise.reject(new Error('not-configured')));
  render(<Home />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.queryByLabelText('Home centre status')).toBeNull();
  expect(screen.getByText('Could not reach Sonos')).toBeTruthy();
});

const SONOS = {
  speakers: [{ name: 'Den', state: 'playing', volume: 10, input: null, group: 'G1', online: true }],
  groups: [{ id: 'G1', coordinator: 'Den', members: ['Den'] }],
  presets: [],
  music: [{ key: 'm', name: 'Morning Mix', favorite: null, volume: 8 }],
  controls: [],
  scenes: [],
  sleepTimers: [],
  nowPlaying: null,
  currentGroup: 'G1',
  readAtMs: Date.now(),
};

function pending<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function loadingHome(sonos: Promise<unknown>) {
  mocks.set('wall2_moods', () => [
    { id: 'day', label: 'Day' },
    { id: 'evening', label: 'Evening' },
  ]);
  mocks.set('wall2_sonos_summary', () => sonos);
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0 }));
  mocks.set('wall2_home_security', () => Promise.reject(new Error('not-configured')));
  return render(<Home />);
}

it('first paint holds the final layout: a Sound skeleton, no "Loading", the short mood row, and it stays so when Sound arrives', async () => {
  const sonos = pending<unknown>();
  const { container } = loadingHome(sonos.promise);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const centre = container.querySelector('.home-centre')!;
  expect(centre.className).toBe('home-centre');
  expect(container.querySelector('.sound-skel')).toBeTruthy();
  expect(container.querySelector('.sound.bare')).toBeNull();
  expect(screen.queryByText('Loading')).toBeNull();
  expect(container.querySelector('.mood-row')).toBeTruthy();
  sonos.resolve(SONOS);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(centre.className).toBe('home-centre');
  expect(container.querySelector('.sound-skel')).toBeNull();
  expect(container.querySelector('.sound-plays')).toBeTruthy();
});

it('the tall-mood layout waits for 2.5 seconds of silence, then comes once; Sound arriving late brings the short row back', async () => {
  const sonos = pending<unknown>();
  const { container } = loadingHome(sonos.promise);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2400);
  });
  const centre = container.querySelector('.home-centre')!;
  expect(centre.className).toBe('home-centre');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(centre.className).toBe('home-centre tall');
  expect(container.querySelector('.sound.bare')).toBeTruthy();
  sonos.resolve(SONOS);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(centre.className).toBe('home-centre');
  expect(container.querySelector('.sound-plays')).toBeTruthy();
});

it('the layout change is one slow fade (at least 400 ms) and instant under reduced motion', () => {
  expect(/\.mood-row \{[^}]*transition: height (\d+)ms/.exec(css)?.[1]).toBeTruthy();
  expect(Number(/\.mood-row \{[^}]*transition: height (\d+)ms/.exec(css)![1])).toBeGreaterThanOrEqual(400);
  expect(/prefers-reduced-motion: reduce\) \{\s*\.mood-row,/.test(css)).toBe(true);
  // No :has() layout switch: only the class Home sets chooses the tall row.
  expect(css).not.toContain('.home-centre:has(.sound.bare)');
});

it('an immediate "not set up" answer goes straight to the tall layout with no wait', async () => {
  const sonos = pending<unknown>();
  const { container } = loadingHome(sonos.promise);
  sonos.reject(new Error('not-configured'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(container.querySelector('.home-centre')!.className).toBe('home-centre tall');
});
