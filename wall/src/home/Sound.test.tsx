import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePacificTime } from '../ribbon/testZone';
import { RESULT_MS, Sound } from './Sound';
import { LAST_PLAY_KEY, type SonosSummary } from './soundModel';

usePacificTime();

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** Invented names only. Thursday 6:30 PM Pacific: the dusk routine is the suggestion. */
const NOW = new Date('2026-11-12T18:30:00-08:00').getTime();
const routine = (key: string, name: string, volume = 10) => ({ key, name, favorite: `${name} Station`, volume });

function summary(over: Partial<SonosSummary> = {}): SonosSummary {
  return {
    speakers: [
      { name: 'Studio', state: 'playing', volume: 100, input: 'lineIn', group: 'G1', online: true },
      { name: 'Den', state: 'playing', volume: 14, input: null, group: 'G2', online: true },
      { name: 'Porch', state: 'playing', volume: 10, input: null, group: 'G2', online: true },
      { name: 'Shed', state: 'offline', volume: null, input: null, group: null, online: false },
    ],
    groups: [
      { id: 'G1', coordinator: 'Studio', members: ['Studio'] },
      { id: 'G2', coordinator: 'Den', members: ['Den', 'Porch'] },
    ],
    presets: [
      { id: 'whole', name: 'Whole House', active: false, loud: false },
      { id: 'desk', name: 'Office Desk', active: true, loud: false },
      { id: 'party', name: 'Party Set', active: false, loud: true },
    ],
    music: [
      routine('Dawn_Mix', 'Dawn Music'),
      routine('Noon_Mix', 'Noon Music'),
      routine('Dusk_Mix', 'Dusk Music'),
      routine('Owl_Mix', 'Night Owl Music'),
      routine('Desk_Mix', 'Desk Focus Music'),
      routine('Pop_Mix', 'Bright Pop'),
      routine('Book_Mix', 'Book Club'),
      routine('Loud_Mix', 'Loud Party', 55),
    ],
    controls: [{ key: 'Group_All', name: 'Group Everything', action: 'groupAll' }],
    scenes: [],
    sleepTimers: [],
    nowPlaying: { speaker: 'Den', track: 'Song A', artist: 'Band B' },
    currentGroup: 'G2',
    readAtMs: NOW,
    ...over,
  };
}

let writes: { cmd: string; args: unknown }[] = [];
function wire(read: () => unknown = () => summary()) {
  writes = [];
  mocks.set('wall2_sonos_summary', read);
  for (const cmd of ['wall2_sonos_play', 'wall2_sonos_preset', 'wall2_sonos_volume', 'wall2_sonos_pause_all', 'wall2_sonos_sleep', 'wall2_sonos_sleep_cancel', 'open_volume_mixer']) {
    mocks.set(cmd, (args) => {
      writes.push({ cmd, args });
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

it('not set up shows one quiet line with what to add', async () => {
  mocks.set('wall2_sonos_summary', () => Promise.reject(new Error('not-configured')));
  const { container } = render(<Sound />);
  await flush();
  expect(screen.getByText('Add sonosBaseUrl to feeds.json to control Sonos from here.')).toBeTruthy();
  expect(container.querySelector('.sound.bare')).toBeTruthy();
  expect(container.querySelectorAll('button')).toHaveLength(0);
});

it('never reached says so, with no controls', async () => {
  mocks.set('wall2_sonos_summary', () => Promise.reject(new Error('Could not reach Sonos')));
  const { container } = render(<Sound />);
  await flush();
  expect(screen.getByText('Could not reach Sonos')).toBeTruthy();
  expect(container.querySelectorAll('button')).toHaveLength(0);
});

it('shows six quick plays in the service order with More, and nothing is written without a click', async () => {
  wire();
  const { container } = render(<Sound />);
  await flush(5 * 60_000);
  const names = [...container.querySelectorAll('.sound-plays > .sound-chip .sound-chip-name')].map((n) => n.textContent);
  expect(names).toEqual(['Dawn', 'Noon', 'Dusk', 'Night Owl', 'Desk Focus', 'Bright Pop']);
  expect(screen.getByText('2 more')).toBeTruthy();
  expect(writes).toEqual([]);
  // The hour's routine carries the suggestion.
  const dusk = screen.getByText('Dusk').closest('button')!;
  expect(dusk.className).toContain('sug');
  expect(within(dusk).getByText('Suggested')).toBeTruthy();
  expect(dusk.getAttribute('title')).toContain('Suggested for this hour');
});

it('a click plays the routine, says so briefly, and marks it as started', async () => {
  wire();
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Noon').closest('button')!);
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_play', args: { routineKey: 'Noon_Mix' } }]);
  expect(screen.getByText('Playing Noon')).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(LAST_PLAY_KEY)!).key).toBe('Noon_Mix');
  expect(screen.getByText('started just now')).toBeTruthy();
  await flush(RESULT_MS + 10);
  expect(screen.queryByText('Playing Noon')).toBeNull();
  await flush(5 * 60_000);
  expect(screen.getByText('started 5 min ago')).toBeTruthy();
});

it('More lists the other routines and the speaker controls; a loud one asks first', async () => {
  wire();
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('2 more').closest('button')!);
  const pop = screen.getByRole('dialog', { name: 'More routines' });
  expect(within(pop).getByText('Book Club')).toBeTruthy();
  expect(within(pop).getByText('Group Everything')).toBeTruthy();
  fireEvent.click(within(pop).getByText('Loud Party').closest('button')!);
  await flush();
  expect(writes).toEqual([]);
  expect(screen.getByRole('alertdialog').textContent).toContain('above 40');
  fireEvent.click(screen.getByText('Cancel'));
  expect(writes).toEqual([]);
  fireEvent.click(screen.getByText('2 more').closest('button')!);
  fireEvent.click(within(screen.getByRole('dialog', { name: 'More routines' })).getByText('Loud Party').closest('button')!);
  fireEvent.click(screen.getByText('Start'));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_play', args: { routineKey: 'Loud_Mix', confirm: true } }]);
});

it('the group slider sends one change on release, and asks before going above 40', async () => {
  wire();
  render(<Sound />);
  await flush();
  const slider = screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement;
  expect(slider.value).toBe('12');
  fireEvent.change(slider, { target: { value: '20' } });
  fireEvent.change(slider, { target: { value: '25' } });
  expect(writes).toEqual([]);
  fireEvent.pointerUp(slider);
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_volume', args: { target: { kind: 'group', id: 'G2' }, level: 25 } }]);
  expect(screen.getByText('Den and 1 more volume 25')).toBeTruthy();

  writes = [];
  const again = screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement;
  fireEvent.change(again, { target: { value: '60' } });
  fireEvent.pointerUp(again);
  await flush();
  expect(writes).toEqual([]);
  expect(screen.getByRole('alertdialog').textContent).toContain('louder than 40');
  fireEvent.click(screen.getByText('Cancel'));
  expect((screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement).value).toBe('12');
  const third = screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement;
  fireEvent.change(third, { target: { value: '60' } });
  fireEvent.pointerUp(third);
  fireEvent.click(screen.getByText('Set 60'));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_volume', args: { target: { kind: 'group', id: 'G2' }, level: 60, confirm: true } }]);
});

it('Rust asking for a confirm opens the same question; a failure says so', async () => {
  wire();
  mocks.set('wall2_sonos_preset', () => Promise.reject(new Error('Could not reach Sonos')));
  mocks.set('wall2_sonos_play', (args) => {
    if (!(args as { confirm?: boolean }).confirm) return Promise.reject(new Error('needs-confirm'));
    writes.push({ cmd: 'wall2_sonos_play', args });
  });
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Dawn').closest('button')!);
  await flush();
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  fireEvent.click(screen.getByText('Yes'));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_play', args: { routineKey: 'Dawn_Mix', confirm: true } }]);
  fireEvent.click(screen.getByRole('radio', { name: 'Whole House' }));
  await flush();
  expect(screen.getByText('Could not reach Sonos').className).toContain('warn-text');
});

it('Where puts Office first, marks the grouping in use, and applies a preset on a click', async () => {
  wire();
  render(<Sound />);
  await flush();
  const radios = screen.getAllByRole('radio');
  expect(radios.map((r) => r.textContent)).toEqual(['Office Desk', 'Whole House', 'Party Set']);
  expect(radios[0].getAttribute('aria-checked')).toBe('true');
  fireEvent.click(radios[1]);
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_preset', args: { presetId: 'whole' } }]);
  expect(screen.getByText('Speakers set to Whole House')).toBeTruthy();
  // A preset that sets a speaker above 40 asks first.
  writes = [];
  fireEvent.click(screen.getByRole('radio', { name: 'Party Set' }));
  await flush();
  expect(writes).toEqual([]);
  expect(screen.getByRole('alertdialog').textContent).toContain('above 40');
  fireEvent.click(screen.getByText('Apply'));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_preset', args: { presetId: 'party', confirm: true } }]);
});

it('a routine with no volume of its own asks first, and a question left open goes when the read goes stale', async () => {
  let fail = false;
  wire(() => (fail ? Promise.reject(new Error('Could not reach Sonos')) : summary({ music: [{ key: 'Free_Mix', name: 'Free Mix', favorite: null, volume: null }] })));
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Free Mix').closest('button')!);
  expect(screen.getByRole('alertdialog').textContent).toContain('a volume the Sonos service sets');
  fail = true;
  await flush(3 * 60_000);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(writes).toEqual([]);
});

it('a new read moves a slider to the speakers\' level, but not while it is held', async () => {
  let level = 14;
  wire(() => summary({ readAtMs: Date.now(), speakers: summary().speakers.map((x) => (x.name === 'Den' ? { ...x, volume: level } : x)) }));
  render(<Sound />);
  await flush();
  const slider = () => screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement;
  expect(slider().value).toBe('12');
  fireEvent.pointerDown(slider());
  fireEvent.change(slider(), { target: { value: '30' } });
  level = 20;
  await flush(30_000);
  expect(slider().value).toBe('30');
  fireEvent.pointerUp(slider());
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_volume', args: { target: { kind: 'group', id: 'G2' }, level: 30 } }]);
  await flush(30_000);
  expect(slider().value).toBe('15');
});

it('Speakers lists every speaker; line-in says PC audio and offers the PC volume', async () => {
  wire();
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText(/Speakers 4/).closest('button')!);
  const pop = screen.getByRole('dialog', { name: 'Speakers' });
  const rows = [...pop.querySelectorAll('.sound-spk')];
  expect(rows.map((r) => r.querySelector('.sound-spk-name')!.textContent)).toEqual(['Studio', 'Den', 'Porch', 'Shed']);
  expect(within(rows[0] as HTMLElement).getByText('PC audio')).toBeTruthy();
  fireEvent.click(within(rows[0] as HTMLElement).getByText('PC volume'));
  expect(writes).toEqual([{ cmd: 'open_volume_mixer', args: undefined }]);
  expect(within(rows[3] as HTMLElement).getByText('Offline')).toBeTruthy();
  writes = [];
  const den = within(rows[1] as HTMLElement).getByRole('slider') as HTMLInputElement;
  fireEvent.change(den, { target: { value: '20' } });
  fireEvent.pointerUp(den);
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_volume', args: { target: { kind: 'speaker', id: 'Den' }, level: 20 } }]);
});

it('Sonos off pauses everything; with nothing playing, Play starts the suggestion', async () => {
  wire();
  const { unmount } = render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Sonos off').closest('button')!);
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_pause_all', args: undefined }]);
  unmount();

  const quiet = summary({
    nowPlaying: null,
    speakers: summary().speakers.map((s) => (s.input ? s : { ...s, state: s.online ? 'stopped' : s.state })),
  });
  wire(() => quiet);
  render(<Sound />);
  await flush();
  expect(screen.getByText('Nothing playing')).toBeTruthy();
  fireEvent.click(screen.getByText('Play').closest('button')!);
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_play', args: { routineKey: 'Dusk_Mix' } }]);
});

it('sleep sets 30, 60 or 90 minutes, and a running timer cancels on a click', async () => {
  wire();
  const { unmount } = render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Sleep').closest('button')!);
  fireEvent.click(screen.getByText('60 min'));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_sleep', args: { minutes: 60 } }]);
  unmount();

  wire(() => summary({ sleepTimers: [{ id: 't1', endsAtMs: NOW + 42 * 60_000, fadeMinutes: 5 }] }));
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Sleep 42 min').closest('button')!);
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_sleep_cancel', args: { id: 't1' } }]);
});

it('a read that is not live dims the block, says how old it is, and turns writes off', async () => {
  let fail = false;
  wire(() => (fail ? Promise.reject(new Error('Could not reach Sonos')) : summary()));
  const { container } = render(<Sound />);
  await flush();
  expect(container.querySelector('.sound.stale')).toBeNull();
  fail = true;
  await flush(3 * 60_000);
  expect(container.querySelector('.sound.stale')).toBeTruthy();
  expect(screen.getByText(/^Sonos not reachable, showing \d+ min ago$/)).toBeTruthy();
  const play = screen.getByText('Dawn').closest('button') as HTMLButtonElement;
  expect(play.disabled).toBe(true);
  expect((screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement).disabled).toBe(true);
  expect(writes).toEqual([]);
});

it('a slider never sends the same level twice, and arrow keys settle before sending', async () => {
  wire();
  render(<Sound />);
  await flush();
  const slider = screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement;
  fireEvent.change(slider, { target: { value: '20' } });
  fireEvent.pointerUp(slider);
  fireEvent.blur(slider);
  await flush();
  expect(writes).toHaveLength(1);
  writes = [];
  fireEvent.change(slider, { target: { value: '21' } });
  fireEvent.keyUp(slider, { key: 'ArrowRight' });
  fireEvent.change(slider, { target: { value: '22' } });
  fireEvent.keyUp(slider, { key: 'ArrowRight' });
  await flush(100);
  expect(writes).toEqual([]);
  await flush(400);
  expect(writes).toEqual([{ cmd: 'wall2_sonos_volume', args: { target: { kind: 'group', id: 'G2' }, level: 22 } }]);
});
