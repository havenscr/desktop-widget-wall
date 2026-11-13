import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePacificTime } from '../ribbon/testZone';
import { KEY_SETTLE_MS, RESULT_MS, Sound } from './Sound';
import { LAST_PLAY_KEY, LATCH_MS, type SonosSummary } from './soundModel';

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
      { id: 'whole', name: 'Whole House', active: false, loud: [] },
      { id: 'desk', name: 'Office Desk', active: true, loud: [] },
      { id: 'party', name: 'Party Set', active: false, loud: [{ name: 'Den', level: 70, sets: true }] },
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
    controls: [{ key: 'Group_All', name: 'Group Everything', action: 'groupAll', loud: [] }],
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
  const dusk = screen.getByText('Dusk').closest('button')!;
  expect(dusk.className).toContain('sug');
  expect(dusk.className).toContain('has-tag');
  expect(screen.getByText('Noon').closest('button')!.className).not.toContain('has-tag');
  expect(within(dusk).getByText('Suggested')).toBeTruthy();
  expect(dusk.getAttribute('title')).toContain('Suggested for this hour');
});

it('long names put five chips on the face and the rest under More', async () => {
  const long = (k: string) => routine(k, `A Rather Long Playlist Name ${k}`);
  wire(() => summary({ music: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(long) }));
  const { container } = render(<Sound />);
  await flush();
  expect(container.querySelectorAll('.sound-plays > .sound-chip')).toHaveLength(5);
  expect(screen.getByText('2 more')).toBeTruthy();
});

it('a click plays the routine unforced, says so briefly, and marks it once the music shows', async () => {
  wire();
  mocks.set('wall2_sonos_play', (args) => {
    writes.push({ cmd: 'wall2_sonos_play', args });
    return { started: true, reason: null };
  });
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Noon').closest('button')!, { detail: 1 });
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

it('a skipped play says why and offers Play anyway, which sends the forced call', async () => {
  wire();
  mocks.set('wall2_sonos_play', (args) => {
    writes.push({ cmd: 'wall2_sonos_play', args });
    return (args as { force?: boolean }).force ? { started: true, reason: null } : { started: false, reason: null };
  });
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Noon').closest('button')!);
  await flush();
  expect(screen.getByText("Skipped: this routine's own conditions say not now")).toBeTruthy();
  expect(screen.queryByText('Playing Noon')).toBeNull();
  expect(localStorage.getItem(LAST_PLAY_KEY)).toBeNull();
  const anyway = screen.getByText('Play anyway').closest('button')!;
  expect(anyway.getAttribute('title')).toBe("ignores this routine's own conditions");
  await flush(LATCH_MS);
  fireEvent.click(anyway);
  await flush();
  expect(writes).toEqual([
    { cmd: 'wall2_sonos_play', args: { routineKey: 'Noon_Mix' } },
    { cmd: 'wall2_sonos_play', args: { routineKey: 'Noon_Mix', force: true } },
  ]);
  expect(screen.getByText('Playing Noon')).toBeTruthy();
  expect(screen.queryByText(/^Skipped/)).toBeNull();
});

it('the Play anyway offer goes after a minute', async () => {
  wire();
  mocks.set('wall2_sonos_play', () => ({ started: false, reason: null }));
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Noon').closest('button')!);
  await flush();
  expect(screen.getByText("Skipped: this routine's own conditions say not now")).toBeTruthy();
  await flush(61_000);
  expect(screen.queryByText('Play anyway')).toBeNull();
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

it('group all names the loud speaker before it groups', async () => {
  wire(() => summary({ controls: [{ key: 'Group_All', name: 'Group Everything', action: 'groupAll', loud: [{ name: 'Studio', level: 100, sets: false }] }] }));
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('2 more').closest('button')!);
  fireEvent.click(screen.getByText('Group Everything').closest('button')!);
  expect(screen.getByRole('alertdialog').textContent).toContain('Studio is at 100. Group anyway?');
  expect(writes).toEqual([]);
  fireEvent.click(screen.getByText('Group'));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_play', args: { routineKey: 'Group_All', confirm: true } }]);
});

it('the group slider moves the group by a step on release, and asks before any speaker goes above 40', async () => {
  wire();
  render(<Sound />);
  await flush();
  const slider = () => screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement;
  expect(slider().value).toBe('12');
  expect(slider().closest('label')!.getAttribute('title')).toContain('same step from its own level');
  fireEvent.change(slider(), { target: { value: '20' } });
  fireEvent.change(slider(), { target: { value: '22' } });
  expect(writes).toEqual([]);
  fireEvent.pointerUp(slider());
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_volume', args: { target: { kind: 'group', id: 'G2' }, step: 10 } }]);
  expect(screen.getByText('Den and 1 more volume up 10')).toBeTruthy();

  writes = [];
  await flush(LATCH_MS);
  // 12 to 40 is a step of 28: Den goes 14 to 42, over 40, so it asks and names it.
  fireEvent.change(slider(), { target: { value: '40' } });
  fireEvent.pointerUp(slider());
  await flush();
  expect(writes).toEqual([]);
  expect(screen.getByRole('alertdialog').textContent).toContain('Den to 42');
  fireEvent.click(screen.getByText('Cancel'));
  expect(slider().value).toBe('12');
  fireEvent.change(slider(), { target: { value: '40' } });
  fireEvent.pointerUp(slider());
  fireEvent.click(screen.getByText('Set'));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_volume', args: { target: { kind: 'group', id: 'G2' }, step: 28, confirm: true } }]);
});

it('a speaker slider above 40 asks even when the read says it was louder', async () => {
  wire(() => summary({ speakers: summary().speakers.map((x) => (x.name === 'Den' ? { ...x, volume: 80 } : x)) }));
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText(/Speakers 4/).closest('button')!);
  const den = within(screen.getByRole('dialog', { name: 'Speakers' })).getByLabelText('Den volume') as HTMLInputElement;
  fireEvent.change(den, { target: { value: '60' } });
  fireEvent.pointerUp(den);
  await flush();
  expect(writes).toEqual([]);
  expect(screen.getByRole('alertdialog').textContent).toContain('Set Den to 60');
  // Confirming keeps the Speakers pop-out open.
  fireEvent.pointerDown(screen.getByText('Set 60'));
  fireEvent.click(screen.getByText('Set 60'));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_volume', args: { target: { kind: 'speaker', id: 'Den' }, level: 60, confirm: true } }]);
  expect(screen.getByRole('dialog', { name: 'Speakers' })).toBeTruthy();
});

it('a partial group change says so and reads again at once', async () => {
  let reads = 0;
  wire(() => {
    reads += 1;
    return summary();
  });
  mocks.set('wall2_sonos_volume', () => Promise.reject(new Error('Some speakers did not change')));
  render(<Sound />);
  await flush();
  const before = reads;
  const slider = screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement;
  fireEvent.change(slider, { target: { value: '15' } });
  fireEvent.pointerUp(slider);
  await flush();
  expect(screen.getByText('Some speakers did not change').className).toContain('warn-text');
  expect(reads).toBeGreaterThan(before);
});

it('Rust asking for a confirm opens the same question; a failure says so', async () => {
  wire();
  mocks.set('wall2_sonos_preset', () => Promise.reject(new Error('Could not reach Sonos')));
  mocks.set('wall2_sonos_play', (args) => {
    if (!(args as { confirm?: boolean }).confirm) return Promise.reject(new Error('needs-confirm'));
    writes.push({ cmd: 'wall2_sonos_play', args });
    return { started: true, reason: null };
  });
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Dawn').closest('button')!);
  await flush();
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  fireEvent.click(screen.getByText('Start'));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_play', args: { routineKey: 'Dawn_Mix', confirm: true } }]);
  fireEvent.click(screen.getByRole('radio', { name: 'Whole House' }));
  await flush();
  expect(screen.getByText('Could not reach Sonos').className).toContain('warn-text');
});

it('Where puts Office first, marks the grouping in use, and a loud preset names the speaker', async () => {
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
  writes = [];
  fireEvent.click(screen.getByRole('radio', { name: 'Party Set' }));
  await flush();
  expect(writes).toEqual([]);
  expect(screen.getByRole('alertdialog').textContent).toContain('It sets Den to 70. Apply anyway?');
  fireEvent.click(screen.getByText('Apply'));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_preset', args: { presetId: 'party', confirm: true } }]);
});

it('applying a preset closes the Speakers pop-out first', async () => {
  wire();
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText(/Speakers 4/).closest('button')!);
  expect(screen.getByRole('dialog', { name: 'Speakers' })).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'Whole House' }));
  expect(screen.queryByRole('dialog', { name: 'Speakers' })).toBeNull();
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

it('Sonos off pauses everything and clears the started mark; with nothing playing, Play names the suggestion', async () => {
  wire();
  localStorage.setItem(LAST_PLAY_KEY, JSON.stringify({ key: 'Noon_Mix', at: NOW - 60_000, group: 'G2', seen: true }));
  const { unmount } = render(<Sound />);
  await flush();
  expect(screen.getByText('started 1 min ago')).toBeTruthy();
  fireEvent.click(screen.getByText('Sonos off').closest('button')!);
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_pause_all', args: undefined }]);
  expect(localStorage.getItem(LAST_PLAY_KEY)).toBeNull();
  expect(screen.queryByText(/^started/)).toBeNull();
  unmount();

  const quiet = summary({
    nowPlaying: null,
    speakers: summary().speakers.map((s) => (s.input ? s : { ...s, state: s.online ? 'stopped' : s.state })),
  });
  wire(() => quiet);
  const again = render(<Sound />);
  await flush();
  expect(screen.getByText('Nothing playing')).toBeTruthy();
  fireEvent.click(screen.getByText('Play Dusk').closest('button')!);
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_play', args: { routineKey: 'Dusk_Mix' } }]);
  again.unmount();

  // No routine fits the hour: Play is off.
  wire(() => ({ ...quiet, music: [routine('Pop_Mix', 'Bright Pop')] }));
  render(<Sound />);
  await flush();
  const play = screen.getByText('Play').closest('button') as HTMLButtonElement;
  expect(play.disabled).toBe(true);
});

it('a stored mark for music the wall did not start never comes back', async () => {
  const quiet = summary({ nowPlaying: null, speakers: summary().speakers.map((s) => (s.input ? s : { ...s, state: 'stopped' as const })) });
  let now = quiet;
  wire(() => now);
  localStorage.setItem(LAST_PLAY_KEY, JSON.stringify({ key: 'Noon_Mix', at: NOW - 5 * 60_000, group: 'G2', seen: true }));
  render(<Sound />);
  await flush();
  expect(localStorage.getItem(LAST_PLAY_KEY)).toBeNull();
  now = summary();
  await flush(30_000);
  expect(screen.queryByText(/^started/)).toBeNull();
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

  wire(() =>
    summary({
      sleepTimers: [
        { id: 't2', endsAtMs: NOW + 80 * 60_000, fadeMinutes: 5 },
        { id: 't1', endsAtMs: NOW + 42 * 60_000, fadeMinutes: 5 },
      ],
    }),
  );
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
  await flush(LATCH_MS);
  fireEvent.change(slider, { target: { value: '21' } });
  fireEvent.keyUp(slider, { key: 'ArrowRight' });
  fireEvent.change(slider, { target: { value: '22' } });
  fireEvent.keyUp(slider, { key: 'ArrowRight' });
  await flush(100);
  expect(writes).toEqual([]);
  await flush(KEY_SETTLE_MS);
  expect(writes).toHaveLength(1);
});

it('a drag released outside the window still finishes once; a cancelled one goes back', async () => {
  wire();
  render(<Sound />);
  await flush();
  const slider = () => screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement;
  // Released outside: the pointer was captured, so it is lost, not released here.
  fireEvent.pointerDown(slider());
  fireEvent.change(slider(), { target: { value: '18' } });
  fireEvent(slider(), new Event('lostpointercapture', { bubbles: true }));
  fireEvent.pointerUp(slider());
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_volume', args: { target: { kind: 'group', id: 'G2' }, step: 6 } }]);
  writes = [];
  await flush(LATCH_MS + 2000);
  // Cancelled: nothing sent, the slider back at the read's level, and reads move it again.
  fireEvent.pointerDown(slider());
  fireEvent.change(slider(), { target: { value: '30' } });
  fireEvent(slider(), new Event('pointercancel', { bubbles: true }));
  await flush();
  expect(writes).toEqual([]);
  expect(slider().value).toBe('12');
  // A window blur mid-drag also puts it back.
  fireEvent.pointerDown(slider());
  fireEvent.change(slider(), { target: { value: '33' } });
  fireEvent(window, new Event('blur'));
  await flush();
  expect(slider().value).toBe('12');
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
  expect(writes).toHaveLength(1);
  await flush(30_000);
  expect(slider().value).toBe('15');
});

it('one deliberate action is one write: double clicks and held keys never send twice', async () => {
  wire(() =>
    summary({
      sleepTimers: [],
    }),
  );
  mocks.set('wall2_sonos_play', (args) => {
    writes.push({ cmd: 'wall2_sonos_play', args });
    return { started: true, reason: null };
  });
  const { unmount } = render(<Sound />);
  await flush();
  const dbl = async (el: HTMLElement) => {
    fireEvent.click(el, { detail: 1 });
    await flush();
    fireEvent.click(el, { detail: 2 });
    await flush();
  };
  const held = async (el: HTMLElement) => {
    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.click(el, { detail: 0 });
    await flush();
    // A repeat keydown is held back, and the latch stops the click it would make.
    const repeat = fireEvent.keyDown(el, { key: 'Enter', repeat: true });
    expect(repeat).toBe(false);
    fireEvent.click(el, { detail: 0 });
    await flush();
  };
  const count = (cmd: string) => writes.filter((w) => w.cmd === cmd).length;

  await dbl(screen.getByText('Noon').closest('button')!);
  expect(count('wall2_sonos_play')).toBe(1);
  await flush(LATCH_MS);
  await held(screen.getByText('Dawn').closest('button')!);
  expect(count('wall2_sonos_play')).toBe(2);
  await flush(LATCH_MS);
  await dbl(screen.getByRole('radio', { name: 'Whole House' }));
  expect(count('wall2_sonos_preset')).toBe(1);
  await flush(LATCH_MS);
  await held(screen.getByRole('radio', { name: 'Office Desk' }));
  expect(count('wall2_sonos_preset')).toBe(2);
  await flush(LATCH_MS);
  await dbl(screen.getByText('Sonos off').closest('button')!);
  expect(count('wall2_sonos_pause_all')).toBe(1);
  await flush(LATCH_MS);
  fireEvent.click(screen.getByText('Sleep').closest('button')!);
  await dbl(screen.getByText('30 min'));
  expect(count('wall2_sonos_sleep')).toBe(1);
  await flush(LATCH_MS);
  // Slider keys: a held arrow key settles into one write.
  const slider = screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement;
  for (const v of ['13', '14', '15', '16']) {
    fireEvent.keyDown(slider, { key: 'ArrowRight', repeat: v !== '13' });
    fireEvent.change(slider, { target: { value: v } });
  }
  fireEvent.keyUp(slider, { key: 'ArrowRight' });
  await flush(KEY_SETTLE_MS + 10);
  expect(count('wall2_sonos_volume')).toBe(1);
  unmount();

  wire(() => summary({ sleepTimers: [{ id: 't1', endsAtMs: NOW + 20 * 60_000, fadeMinutes: 5 }] }));
  render(<Sound />);
  await flush();
  await dbl(screen.getByText('Sleep 20 min').closest('button')!);
  expect(count('wall2_sonos_sleep_cancel')).toBe(1);
  await flush(LATCH_MS);
  await held(screen.getByText('Sleep 20 min').closest('button')!);
  expect(count('wall2_sonos_sleep_cancel')).toBe(2);
});

it('a click with detail 2 after the latch has passed is still ignored', async () => {
  wire();
  mocks.set('wall2_sonos_play', (args) => {
    writes.push({ cmd: 'wall2_sonos_play', args });
    return { started: true, reason: null };
  });
  render(<Sound />);
  await flush();
  const noon = screen.getByText('Noon').closest('button')!;
  fireEvent.click(noon, { detail: 1 });
  await flush(LATCH_MS + 500);
  expect(writes).toHaveLength(1);
  fireEvent.click(noon, { detail: 2 });
  await flush(LATCH_MS + 500);
  expect(writes).toHaveLength(1);
});

it('the slider finishes once on lostpointercapture alone', async () => {
  wire();
  render(<Sound />);
  await flush();
  const slider = screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement;
  fireEvent.pointerDown(slider);
  fireEvent.change(slider, { target: { value: '18' } });
  fireEvent(slider, new Event('lostpointercapture', { bubbles: true }));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_volume', args: { target: { kind: 'group', id: 'G2' }, step: 6 } }]);
  fireEvent(slider, new Event('lostpointercapture', { bubbles: true }));
  await flush();
  expect(writes).toHaveLength(1);
});

it('a slider that gets disabled in the middle of a drag goes back and sends nothing', async () => {
  let fail = false;
  wire(() => (fail ? Promise.reject(new Error('Could not reach Sonos')) : summary()));
  render(<Sound />);
  await flush();
  const slider = screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement;
  fireEvent.pointerDown(slider);
  fireEvent.change(slider, { target: { value: '40' } });
  fail = true;
  await flush(3 * 60_000);
  expect(slider.disabled).toBe(true);
  expect(slider.value).toBe('12');
  fireEvent.pointerUp(slider);
  await flush();
  expect(writes).toEqual([]);
});
