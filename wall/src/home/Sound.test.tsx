import { act, fireEvent, render, screen, within } from '@testing-library/react';
// @ts-ignore node's own file calls; this test reads the stylesheet as text.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePacificTime } from '../ribbon/testZone';
import { HoverTipLayer } from '../ui/HoverTip';
import { KEY_SETTLE_MS, RESULT_MS, Sound } from './Sound';
import { LAST_PLAY_KEY, LATCH_MS, NEEDS_CONFIRM, type SonosSummary } from './soundModel';

usePacificTime();
// Several tests step fake timers through minutes: a busy machine gets 20 seconds per test.
vi.setConfig({ testTimeout: 20_000 });

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
      { id: 'whole', name: 'All Speakers', active: false, loud: [] },
      { id: 'desk', name: 'Office (Work)', active: true, loud: [] },
      { id: 'party', name: 'Common Areas', active: false, loud: [{ name: 'Den', level: 70, sets: true }] },
    ],
    music: [
      routine('Dawn_Mix', 'Morning Music'),
      routine('Noon_Mix', 'Day Music'),
      routine('Dusk_Mix', 'Evening Music'),
      routine('Owl_Mix', 'Late Night Music'),
      routine('Desk_Mix', 'Workday Music'),
      routine('Pop_Mix', 'Upbeat Music'),
      routine('Book_Mix', 'Reading Music'),
      routine('Loud_Mix', 'Romantic Music', 55),
      routine('Rain_Mix', 'Rain Sounds'),
    ],
    controls: [{ key: 'Group_All', name: 'Group Everything', action: 'groupAll', loud: [] }],
    scenes: [],
    sleepTimers: [],
    nowPlaying: { speaker: 'Den', track: 'Song A', artist: 'Band B', duration: null, position: null, art: null },
    currentGroup: 'G2',
    readAtMs: NOW,
    canSkip: false,
    ...over,
  };
}

let writes: { cmd: string; args: unknown }[] = [];
function wire(read: () => unknown = () => summary()) {
  writes = [];
  mocks.set('wall2_sonos_summary', read);
  for (const cmd of ['wall2_sonos_play', 'wall2_sonos_preset', 'wall2_sonos_volume', 'wall2_sonos_pause_all', 'wall2_sonos_sleep', 'wall2_sonos_sleep_cancel', 'wall2_sonos_skip', 'open_volume_mixer']) {
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
  // One failed read shows nothing; the second, 5 seconds later, says what happened.
  expect(screen.queryByText('Sonos cannot be reached')).toBeNull();
  await flush(5_000);
  expect(screen.getByText('Sonos cannot be reached')).toBeTruthy();
  // One voice: the body says the same first sentence, then when it looks again.
  expect(screen.getByText('Sonos cannot be reached. Checks again every 30 seconds.')).toBeTruthy();
  expect(container.querySelectorAll('button')).toHaveLength(0);
});

it('shows the five quick plays in the owner\'s order with More, and nothing is written without a click', async () => {
  wire();
  const { container } = render(
    <>
      <Sound />
      <HoverTipLayer />
    </>,
  );
  await flush(5 * 60_000);
  const names = [...container.querySelectorAll('.sound-plays > .sound-chip .sound-chip-name')].map((n) => n.textContent);
  expect(names).toEqual(['Morning', 'Day', 'Evening', 'Late Night', 'Workday']);
  expect(screen.getByText('3 more')).toBeTruthy();
  expect(writes).toEqual([]);
  const evening = screen.getByText('Evening').closest('button')!;
  expect(evening.className).toContain('sug');
  expect(evening.className).not.toContain('has-tag');
  expect(screen.getByText('Day').closest('button')!.className).not.toContain('has-tag');
  expect(within(evening).queryByRole('img', { name: 'Suggested' })).toBeNull();
  const hover = await tipText(evening);
  expect(hover).toContain('Play Evening Music');
  expect(hover).toContain('Suggested for this hour');
});

it('a word with no routine leaves its tile out, and the rest stay under More', async () => {
  wire(() => summary({ music: [routine('a', 'Morning Mix'), routine('w', 'Workday Mix'), routine('x', 'Romantic Music'), routine('y', 'Rain Sounds')] }));
  const { container } = render(<Sound />);
  await flush();
  expect([...container.querySelectorAll('.sound-plays > .sound-chip .sound-chip-name')].slice(0, 2).map((n) => n.textContent)).toEqual(['Morning', 'Workday']);
  expect(container.querySelectorAll('.sound-plays > .sound-chip:not(.more)')).toHaveLength(2);
  expect(screen.getByText('1 more')).toBeTruthy();
});

it('a click plays the routine unforced, says so briefly, and marks it once the music shows', async () => {
  wire();
  mocks.set('wall2_sonos_play', (args) => {
    writes.push({ cmd: 'wall2_sonos_play', args });
    return { started: true, reason: null };
  });
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Day').closest('button')!, { detail: 1 });
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_play', args: { routineKey: 'Noon_Mix' } }]);
  expect(screen.getByText('Playing Day')).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(LAST_PLAY_KEY)!).key).toBe('Noon_Mix');
  expect(screen.getByText('started just now')).toBeTruthy();
  await flush(RESULT_MS + 10);
  expect(screen.queryByText('Playing Day')).toBeNull();
  await flush(5 * 60_000);
  expect(screen.getByText('started 5 min ago')).toBeTruthy();
});

it('a skipped play says why and offers Play anyway, which sends the forced call', async () => {
  wire();
  mocks.set('wall2_sonos_play', (args) => {
    writes.push({ cmd: 'wall2_sonos_play', args });
    return (args as { force?: boolean }).force ? { started: true, reason: null } : { started: false, reason: null };
  });
  render(
    <>
      <Sound />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.click(screen.getByText('Day').closest('button')!);
  await flush();
  expect(screen.getByText("Skipped: this routine's own conditions say not now")).toBeTruthy();
  expect(screen.queryByText('Playing Day')).toBeNull();
  expect(localStorage.getItem(LAST_PLAY_KEY)).toBeNull();
  const anyway = screen.getByText('Play anyway').closest('button')!;
  expect(await tipText(anyway)).toBe("Ignores this routine's own conditions");
  await flush(LATCH_MS);
  fireEvent.click(anyway);
  await flush();
  expect(writes).toEqual([
    { cmd: 'wall2_sonos_play', args: { routineKey: 'Noon_Mix' } },
    { cmd: 'wall2_sonos_play', args: { routineKey: 'Noon_Mix', force: true } },
  ]);
  expect(screen.getByText('Playing Day')).toBeTruthy();
  expect(screen.queryByText(/^Skipped/)).toBeNull();
});

it('a forced play refused for needing the loud confirm asks, and Yes sends it again with the confirm', async () => {
  wire();
  mocks.set('wall2_sonos_play', (args) => {
    writes.push({ cmd: 'wall2_sonos_play', args });
    const a = args as { force?: boolean; confirm?: boolean };
    if (!a.force) return { started: false, reason: null };
    if (!a.confirm) throw new Error(NEEDS_CONFIRM);
    return { started: true, reason: null };
  });
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Day').closest('button')!);
  await flush();
  await flush(LATCH_MS);
  fireEvent.click(screen.getByText('Play anyway').closest('button')!);
  await flush();
  expect(screen.getByText('Day starts at a volume the Sonos service sets. Start it?')).toBeTruthy();
  expect(screen.getByText('Play anyway')).toBeTruthy();
  fireEvent.click(screen.getByText('Start').closest('button')!);
  await flush();
  expect(writes[writes.length - 1]).toEqual({ cmd: 'wall2_sonos_play', args: { routineKey: 'Noon_Mix', confirm: true, force: true } });
  expect(screen.getByText('Playing Day')).toBeTruthy();
});

it('the Play anyway offer goes after a minute', async () => {
  wire();
  mocks.set('wall2_sonos_play', () => ({ started: false, reason: null }));
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('Day').closest('button')!);
  await flush();
  expect(screen.getByText("Skipped: this routine's own conditions say not now")).toBeTruthy();
  await flush(61_000);
  expect(screen.queryByText('Play anyway')).toBeNull();
});

it('More holds only Upbeat, Romantic and Reading as tiles; the favorite and volume are in the hover text, never "volume 10"', async () => {
  wire();
  render(
    <>
      <Sound />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.click(screen.getByText('3 more').closest('button')!);
  const pop = screen.getByRole('dialog', { name: 'More routines' });
  expect([...pop.querySelectorAll('.sound-mood b')].map((n) => n.textContent)).toEqual(['Upbeat', 'Romantic', 'Reading']);
  expect(within(pop).queryByText('Rain Sounds')).toBeNull();
  expect(within(pop).queryByText('Speakers')).toBeNull();
  const hover = await tipText(within(pop).getByText('Upbeat').closest('button')!);
  expect(hover).toBe('Play Upbeat Music (Upbeat Music Station) at Vol. 10');
  expect(hover).not.toMatch(/volume \d/i);
});

it('a loud mood tile asks first; Cancel sends nothing and Start sends the confirmed play', async () => {
  wire();
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('3 more').closest('button')!);
  const pop = screen.getByRole('dialog', { name: 'More routines' });
  fireEvent.click(within(pop).getByText('Romantic').closest('button')!);
  await flush();
  expect(writes).toEqual([]);
  expect(screen.getByRole('alertdialog').textContent).toContain('above 40');
  fireEvent.click(screen.getByText('Cancel'));
  expect(writes).toEqual([]);
  fireEvent.click(screen.getByText('3 more').closest('button')!);
  fireEvent.click(within(screen.getByRole('dialog', { name: 'More routines' })).getByText('Romantic').closest('button')!);
  fireEvent.click(screen.getByText('Start'));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_play', args: { routineKey: 'Loud_Mix', confirm: true } }]);
});

it('Group all and the other speaker controls are not offered anywhere: not on the face, not under More', async () => {
  wire(() =>
    summary({
      controls: [
        { key: 'Group_All', name: 'Group Everything', action: 'groupAll', loud: [{ name: 'Studio', level: 100, sets: false }] },
        { key: 'Ungroup_All', name: 'Ungroup Everything', action: 'ungroupAll', loud: [] },
      ],
    }),
  );
  const { container } = render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('3 more').closest('button')!);
  const pop = screen.getByRole('dialog', { name: 'More routines' });
  expect(within(pop).queryByText('Ungroup Everything')).toBeNull();
  expect(container.textContent).not.toMatch(/\bgroup (all|everything)/i);
});

it('the favorites dropdown is closed under More; opening it lists them, a long name is cut with an ellipsis, a pick plays it and asks first when the service says so', async () => {
  wire();
  const favs = [
    { id: '0a1b2c3d4e5f6071', name: 'Quiet Radio', kind: 'radio' },
    { id: '1b2c3d4e5f607182', name: 'A Very Long Station Name For Gentle Acoustic Mornings With Coffee And The Paper On The Porch', kind: 'spotify' },
  ];
  mocks.set('wall2_sonos_favorites', () => favs);
  let ask = true;
  mocks.set('wall2_sonos_favorite_play', (args) => {
    writes.push({ cmd: 'wall2_sonos_favorite_play', args });
    if (ask && !(args as { confirm?: boolean }).confirm) throw new Error(NEEDS_CONFIRM);
  });
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByText('3 more').closest('button')!);
  expect(screen.getByText('Choose a favorite')).toBeTruthy();
  expect(document.querySelector('.sound-fav-list')).toBeNull();
  fireEvent.click(screen.getByText('Choose a favorite').closest('button')!);
  await flush();
  const rows = [...document.querySelectorAll('.sound-fav-row span')].map((n) => n.textContent);
  expect(rows).toEqual(['Quiet Radio', favs[1].name]);
  expect(css('.sound-fav-row span')).toMatch(/text-overflow:\s*ellipsis/);
  fireEvent.click(screen.getByText('Quiet Radio').closest('button')!);
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_favorite_play', args: { favoriteId: '0a1b2c3d4e5f6071' } }]);
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  await flush(LATCH_MS);
  ask = false;
  fireEvent.click(screen.getByText('Start'));
  await flush();
  expect(writes.at(-1)).toEqual({ cmd: 'wall2_sonos_favorite_play', args: { favoriteId: '0a1b2c3d4e5f6071', confirm: true } });
});

const openFavorites = async () => {
  if (!screen.queryByText('Choose a favorite')) fireEvent.click(screen.getByText('3 more').closest('button')!);
  fireEvent.click(screen.getByText('Choose a favorite').closest('button')!);
  await flush();
};

it('the favorites list is a plain group of buttons; Escape closes only the list, focus goes back to its button, More stays open', async () => {
  wire();
  mocks.set('wall2_sonos_favorites', () => [{ id: 'f1', name: 'Quiet Radio', kind: 'radio' }]);
  render(<Sound />);
  await flush();
  await openFavorites();
  const list = document.querySelector('.sound-fav-list') as HTMLElement;
  expect(list.querySelector('[role="listbox"], [role="option"]')).toBeNull();
  const group = within(list).getByRole('group', { name: 'Sonos favorites' });
  expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Quiet Radio']);
  const opener = screen.getByText('Choose a favorite').closest('button')!;
  expect(opener.getAttribute('aria-haspopup')).toBeNull();
  fireEvent.keyDown(within(group).getByText('Quiet Radio'), { key: 'Escape' });
  expect(document.querySelector('.sound-fav-list')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(screen.getByRole('dialog', { name: 'More routines' })).toBeTruthy();
  // With the list shut, Escape closes More as before.
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'More routines' })).toBeNull();
});

it('the loading and error words sit outside the favorites group', async () => {
  wire();
  mocks.set('wall2_sonos_favorites', () => new Promise(() => {}));
  render(<Sound />);
  await flush();
  await openFavorites();
  const note = screen.getByText('Loading favorites');
  expect(note.parentElement!.classList.contains('sound-fav-list')).toBe(true);
  expect(document.querySelector('.sound-fav-list [role="group"]')).toBeNull();
});

it('the favorites are read again each time More opens, and the shown list stays while it loads', async () => {
  wire();
  let reads = 0;
  let answer: Promise<unknown> | null = null;
  mocks.set('wall2_sonos_favorites', () => {
    reads += 1;
    return answer ?? [{ id: 'f1', name: reads === 1 ? 'Quiet Radio' : 'Old Radio', kind: 'radio' }];
  });
  render(<Sound />);
  await flush();
  await openFavorites();
  expect(reads).toBe(1);
  fireEvent.click(screen.getByText('Choose a favorite').closest('button')!);
  answer = new Promise(() => {});
  fireEvent.click(screen.getByText('Choose a favorite').closest('button')!);
  await flush();
  expect(reads).toBe(2);
  expect(screen.getByText('Quiet Radio')).toBeTruthy();
  expect(screen.queryByText('Loading favorites')).toBeNull();
});

it('a favorite pressed while another write holds the latch keeps the pop-up open and says Busy, try again', async () => {
  wire();
  mocks.set('wall2_sonos_favorites', () => [{ id: 'f1', name: 'Quiet Radio', kind: 'radio' }]);
  mocks.set('wall2_sonos_favorite_play', (args) => {
    writes.push({ cmd: 'wall2_sonos_favorite_play', args });
  });
  render(<Sound />);
  await flush();
  await openFavorites();
  fireEvent.click(screen.getByText('Quiet Radio').closest('button')!);
  await flush();
  expect(screen.queryByRole('dialog', { name: 'More routines' })).toBeNull();
  // Straight away again: the same write is latched, so nothing starts.
  await openFavorites();
  fireEvent.click(screen.getByText('Quiet Radio').closest('button')!);
  await flush();
  expect(writes).toHaveLength(1);
  expect(screen.getByRole('dialog', { name: 'More routines' })).toBeTruthy();
  expect(screen.getByText('Busy, try again')).toBeTruthy();
});

it('the group slider moves the group by a step on release, and asks before any speaker goes above 40', async () => {
  wire();
  render(
    <>
      <Sound />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const slider = () => screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement;
  expect(slider().value).toBe('12');
  expect(await tipText(slider().closest('label')!)).toContain('same step from its own level');
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
  fireEvent.click(screen.getByText('Morning').closest('button')!);
  await flush();
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  fireEvent.click(screen.getByText('Start'));
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_play', args: { routineKey: 'Dawn_Mix', confirm: true } }]);
  fireEvent.click(screen.getByRole('radio', { name: 'All Speakers' }));
  await flush();
  expect(screen.getByText('Could not reach Sonos').className).toContain('warn-text');
});

it('Where shows Office, All Speakers and Common Areas only (the label drops the parentheses), marks the grouping in use, and a loud preset names the speaker', async () => {
  wire();
  render(<Sound />);
  await flush();
  const radios = screen.getAllByRole('radio');
  expect(radios.map((r) => r.textContent)).toEqual(['Office', 'All Speakers', 'Common Areas']);
  expect(radios[0].getAttribute('aria-checked')).toBe('true');
  fireEvent.click(radios[1]);
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_preset', args: { presetId: 'whole' } }]);
  expect(screen.getByText('Speakers set to All Speakers')).toBeTruthy();
  writes = [];
  fireEvent.click(screen.getByRole('radio', { name: 'Common Areas' }));
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
  fireEvent.click(screen.getByRole('radio', { name: 'All Speakers' }));
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

it('Sonos Off pauses everything and clears the started mark; with nothing playing, Play names the suggestion', async () => {
  wire();
  localStorage.setItem(LAST_PLAY_KEY, JSON.stringify({ key: 'Noon_Mix', at: NOW - 60_000, group: 'G2', seen: true }));
  const { unmount } = render(<Sound />);
  await flush();
  expect(screen.getByText('started 1 min ago')).toBeTruthy();
  fireEvent.click(screen.getByText('Sonos Off').closest('button')!);
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
  fireEvent.click(screen.getByText('Play Evening').closest('button')!);
  await flush();
  expect(writes).toEqual([{ cmd: 'wall2_sonos_play', args: { routineKey: 'Dusk_Mix' } }]);
  again.unmount();

  // No routine fits the hour: Play is off.
  wire(() => ({ ...quiet, music: [routine('Pop_Mix', 'Upbeat Music')] }));
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
  expect(screen.getByText(/^Sonos cannot be reached\. Last good read \d+ min ago$/)).toBeTruthy();
  const play = screen.getByText('Morning').closest('button') as HTMLButtonElement;
  expect(play.disabled).toBe(true);
  expect((screen.getByLabelText('Volume, Den and 1 more') as HTMLInputElement).disabled).toBe(true);
  expect(writes).toEqual([]);
});

it('one failed read leaves the card as it is; the second, 5 seconds later, dims it and a good read clears the line', async () => {
  let word: string | null = null;
  wire(() => (word ? Promise.reject(new Error(word)) : summary()));
  const { container } = render(<Sound />);
  await flush();
  word = 'timed-out';
  await flush(30_000);
  expect(container.querySelector('.sound.stale')).toBeNull();
  expect(container.querySelector('.sound-head .warn-text')).toBeNull();
  expect((screen.getByText('Morning').closest('button') as HTMLButtonElement).disabled).toBe(false);
  await flush(5_000);
  expect(container.querySelector('.sound.stale')).toBeTruthy();
  expect(screen.getByText('Sonos did not answer in time. Last good read less than a minute ago').className).toContain('warn-text');
  word = null;
  await flush(30_000);
  expect(container.querySelector('.sound.stale')).toBeNull();
  expect(container.querySelector('.sound-head .warn-text')).toBeNull();
});

it.each([
  ['timed-out', 'Sonos did not answer in time'],
  ['no-answer', 'Sonos cannot be reached'],
  ['bad-answer', 'Sonos sent an answer the wall could not read'],
])('a failed read of kind %s says %s, with the age of the last good read, and writes stay off', async (word, sentence) => {
  let fail = false;
  wire(() => (fail ? Promise.reject(new Error(word)) : summary()));
  const { container } = render(<Sound />);
  await flush();
  fail = true;
  await flush(30_000 + 5_000);
  expect(container.querySelector('.sound.stale')).toBeTruthy();
  expect(screen.getByText(`${sentence}. Last good read less than a minute ago`)).toBeTruthy();
  await flush(30_000);
  expect(screen.getByText(`${sentence}. Last good read 1 min ago`)).toBeTruthy();
  expect((screen.getByText('Morning').closest('button') as HTMLButtonElement).disabled).toBe(true);
  expect(writes).toEqual([]);
});

it('a card that is only old, with no failed read, says it is being checked and names no kind', async () => {
  let hang = false;
  wire(() => (hang ? new Promise(() => undefined) : summary()));
  const { container } = render(<Sound />);
  await flush();
  hang = true;
  await flush(3 * 60_000);
  expect(container.querySelector('.sound.stale')).toBeTruthy();
  expect(screen.getByText('Checking Sonos. Last good read 3 min ago').className).toContain('warn-text');
  expect(screen.queryByText(/cannot be reached|did not answer|could not read/)).toBeNull();
});

it('with nothing read yet, a bad answer is named in the line and the body alike', async () => {
  mocks.set('wall2_sonos_summary', () => Promise.reject(new Error('bad-answer')));
  render(<Sound />);
  await flush(5_000);
  expect(screen.getByText('Sonos sent an answer the wall could not read')).toBeTruthy();
  expect(screen.getByText('Sonos sent an answer the wall could not read. Checks again every 30 seconds.')).toBeTruthy();
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

  await dbl(screen.getByText('Day').closest('button')!);
  expect(count('wall2_sonos_play')).toBe(1);
  await flush(LATCH_MS);
  await held(screen.getByText('Morning').closest('button')!);
  expect(count('wall2_sonos_play')).toBe(2);
  await flush(LATCH_MS);
  await dbl(screen.getByRole('radio', { name: 'All Speakers' }));
  expect(count('wall2_sonos_preset')).toBe(1);
  await flush(LATCH_MS);
  await held(screen.getByRole('radio', { name: 'Office' }));
  expect(count('wall2_sonos_preset')).toBe(2);
  await flush(LATCH_MS);
  await dbl(screen.getByText('Sonos Off').closest('button')!);
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
  const noon = screen.getByText('Day').closest('button')!;
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

it('the rendered face suggests a Latenight tile at 23:00, and marks Evening only on the Evening tile at 18:30', async () => {
  vi.setSystemTime(new Date('2026-11-12T23:00:00-08:00'));
  wire(() => summary({ music: [routine('n', 'Latenight'), routine('e', 'Evening Workday')] }));
  const { container } = render(<Sound />);
  await flush();
  expect(screen.getByText('Late Night').closest('button')!.className).toContain('sug');
  expect(container.querySelectorAll('.sound-chip.sug')).toHaveLength(1);
});

it('an Evening Workday routine is the Evening tile and is suggested as Evening at 18:30, while Workday has no tile of its own', async () => {
  wire(() => summary({ music: [routine('ew', 'Evening Workday')] }));
  const { container } = render(<Sound />);
  await flush();
  const names = [...container.querySelectorAll('.sound-plays > .sound-chip:not(.more) .sound-chip-name')].map((n) => n.textContent);
  expect(names).toEqual(['Evening']);
  expect(screen.getByText('Evening').closest('button')!.className).toContain('sug');
});

it('one matched routine plus More: the row has two columns, no blank cell; fewer than five tiles never leave one', async () => {
  wire(() => summary({ music: [routine('m', 'Morning Mix'), routine('x', 'Romantic Music')] }));
  const { container } = render(<Sound />);
  await flush();
  const row = container.querySelector('.sound-plays') as HTMLElement;
  expect(row.style.gridTemplateColumns).toBe('repeat(2, minmax(0px, 1fr))');
  expect(row.children).toHaveLength(2);
  for (const n of [2, 3, 4]) {
    const music = ['Morning', 'Day', 'Evening', 'Late Night'].slice(0, n).map((w, i) => routine(`k${i}`, `${w} Mix`));
    wire(() => summary({ music, controls: [] }));
    const r = render(<Sound />);
    await flush();
    const el = r.container.querySelector('.sound-plays') as HTMLElement;
    // More is always there (it holds the favorites), so one column more than the tiles.
    expect(el.style.gridTemplateColumns).toBe(`repeat(${n + 1}, minmax(0px, 1fr))`);
    expect(el.children).toHaveLength(n + 1);
    r.unmount();
  }
});

it('the result line names the place by its label, not the raw preset name', async () => {
  wire();
  render(<Sound />);
  await flush();
  fireEvent.click(screen.getByRole('radio', { name: 'Office' }), { detail: 1 });
  await flush();
  expect(screen.getByText('Speakers set to Office')).toBeTruthy();
  expect(screen.queryByText(/\(Work\)/)).toBeNull();
});

it('when the preset in force is one the page hides, no place shows as selected', async () => {
  wire(() =>
    summary({
      presets: [
        { id: 'whole', name: 'All Speakers', active: false, loud: [] },
        { id: 'desk', name: 'Office (Work)', active: false, loud: [] },
        { id: 'hidden', name: 'Upstairs Only', active: true, loud: [] },
      ],
    }),
  );
  render(<Sound />);
  await flush();
  expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false']);
});

it('a read that fails after Sonos was up keeps the block, marked stale, and the face is unchanged', async () => {
  let up = true;
  wire(() => (up ? summary() : Promise.reject(new Error('Could not reach Sonos'))));
  const { container } = render(<Sound />);
  await flush();
  const before = container.querySelector('.sound-plays')!.children.length;
  up = false;
  await flush(36_000);
  expect(container.querySelector('.sound.stale')).toBeTruthy();
  expect(container.querySelector('.sound-plays')!.children.length).toBe(before);
  expect(container.querySelector('.sound.bare')).toBeNull();
});

// home round two: now playing at the left of the block.
const css = (sel: string): string => {
  const src = readFileSync('src/styles/home.css', 'utf8').replace(/\r\n/g, '\n');
  const i = src.indexOf(`${sel} {`);
  return i < 0 ? '' : src.slice(i, src.indexOf('}', i));
};
const tipText = async (el: Element) => {
  fireEvent.mouseEnter(el);
  await flush(400);
  return document.querySelector('.hover-tip')?.textContent ?? '';
};
const playback = (device: { name: string; kind: string }) => ({
  playing: true,
  device,
  track: { name: 'Paper Lanterns', artists: 'The Quiet Hours', durationMs: 200_000, imageUrl: null, thumbUrl: null },
  progressMs: 65_000,
});

it('a Spotify track on a house speaker shows its title, artist, where it plays and progress, with pause and no next', async () => {
  wire();
  mocks.set('wall2_spotify_playback', () => playback({ name: 'Den', kind: 'Speaker' }));
  const { container } = render(
    <>
      <Sound />
      <HoverTipLayer />
    </>,
  );
  await flush(1_000);
  const strip = container.querySelector('.sound-np')!;
  expect(within(strip as HTMLElement).getByText('Paper Lanterns')).toBeTruthy();
  // The short form: title, artist and where it plays are drawn; the length is on hover; the controls are the play row under it.
  expect(strip.classList.contains('compact')).toBe(true);
  expect(strip.textContent).toContain('The Quiet Hours');
  expect(await tipText(strip.querySelector('.np-title')!)).toContain('The Quiet Hours');
  expect(strip.textContent).toContain('Den, 2 speakers');
  expect(await tipText(strip.querySelector('.np-where')!)).toContain('of 3:20');
  expect(within(container.querySelector('.np-ctl') as HTMLElement).getByLabelText('Pause')).toBeTruthy();
  expect(within(container).queryByLabelText('Next track')).toBeNull();
});

it('a Spotify track playing on this PC is never shown as the house playing', async () => {
  wire();
  mocks.set('wall2_spotify_playback', () => playback({ name: 'Desk PC', kind: 'Computer' }));
  const { container } = render(<Sound />);
  await flush(1_000);
  const strip = container.querySelector('.sound-np')!;
  expect(strip.textContent).not.toContain('Paper Lanterns');
  expect(strip.querySelector('.np-where')!.textContent).not.toContain('of 3:20');
  expect(strip.textContent).toContain('Song A');
});

it('with nothing playing the strip says so and offers the hour\'s suggestion', async () => {
  const quiet = summary({
    speakers: summary().speakers.map((sp) => ({ ...sp, state: sp.online ? 'paused' : sp.state })),
    nowPlaying: null,
  });
  wire(() => quiet);
  const { container } = render(<Sound />);
  await flush(1_000);
  const strip = container.querySelector('.sound-np.quiet')!;
  expect(strip.textContent).toContain('Nothing playing');
  expect(strip.textContent).toContain('Suggested for this hour');
});

it('the progress counts from the Spotify read that carries the position, not from the Sonos read before it', async () => {
  wire();
  // Spotify answers five seconds after the Sonos read: the position (1:05) is as of then.
  let landed = 0;
  mocks.set('wall2_spotify_playback', () => new Promise((done) => setTimeout(() => {
    landed = Date.now();
    done(playback({ name: 'Den', kind: 'Speaker' }));
  }, 5_000)));
  const { container } = render(
    <>
      <Sound />
      <HoverTipLayer />
    </>,
  );
  await flush();
  await flush(20_000);
  // The bar's own clock moves each second; the shown position is 1:05 plus the time since the
  // Spotify read landed (counting from the Sonos read would add five seconds).
  const shown = /\. (\d+:\d\d) of /.exec(await tipText(container.querySelector('.np-where')!))?.[1] ?? '';
  const [m, sec] = shown.split(':').map(Number);
  expect(landed).toBeGreaterThan(NOW);
  expect(m * 60 + sec).toBe(65 + Math.floor((Date.now() - landed) / 1000));
});

it('back and next appear only when the sound service has the commands', async () => {
  wire();
  const without = render(<Sound />);
  await flush(1_000);
  expect(without.container.querySelector('[aria-label="Next track"]')).toBeNull();
  expect(without.container.querySelector('[aria-label="Previous track"]')).toBeNull();
  without.unmount();
  wire(() => summary({ canSkip: true }));
  const { container } = render(<Sound />);
  await flush(1_000);
  expect(container.querySelector('[aria-label="Next track"]')).toBeTruthy();
  expect(container.querySelector('[aria-label="Previous track"]')).toBeTruthy();
});

it('next and back send their direction, then read the summary again', async () => {
  let reads = 0;
  wire(() => {
    reads += 1;
    return summary({ canSkip: true });
  });
  const { container } = render(<Sound />);
  await flush(1_000);
  const before = reads;
  fireEvent.click(container.querySelector('[aria-label="Next track"]')!);
  await flush(100);
  expect(writes.filter((w) => w.cmd === 'wall2_sonos_skip')).toEqual([{ cmd: 'wall2_sonos_skip', args: { direction: 'next' } }]);
  expect(reads).toBeGreaterThan(before);
  await flush(LATCH_MS + 100);
  fireEvent.click(container.querySelector('[aria-label="Previous track"]')!);
  await flush(100);
  expect(writes.filter((w) => w.cmd === 'wall2_sonos_skip').map((w) => w.args)).toEqual([{ direction: 'next' }, { direction: 'previous' }]);
});

it('a station that cannot skip, and nothing playing, show their own sentences', async () => {
  for (const [word, sentence] of [['cannot-skip', 'This station cannot skip'], ['nothing-playing', 'Nothing is playing']] as const) {
    wire(() => summary({ canSkip: true }));
    mocks.set('wall2_sonos_skip', () => Promise.reject(new Error(word)));
    const { container, unmount } = render(<Sound />);
    await flush(1_000);
    fireEvent.click(container.querySelector('[aria-label="Next track"]')!);
    await flush(100);
    expect(screen.getByText(sentence)).toBeTruthy();
    unmount();
  }
});

it('with a stale read the skip buttons are off and nothing is sent', async () => {
  let n = 0;
  wire(() => {
    n += 1;
    return n === 1 ? summary({ canSkip: true }) : Promise.reject(new Error('timed-out'));
  });
  const { container } = render(<Sound />);
  await flush(1_000);
  await flush(40_000);
  const next = container.querySelector('[aria-label="Next track"]') as HTMLButtonElement;
  expect(next.disabled).toBe(true);
  fireEvent.click(next);
  expect(writes.filter((w) => w.cmd === 'wall2_sonos_skip')).toEqual([]);
});

it('the skip buttons show busy through the 800 ms latch, and a second click inside it sends nothing', async () => {
  wire(() => summary({ canSkip: true }));
  const { container } = render(<Sound />);
  await flush(1_000);
  const next = () => container.querySelector('[aria-label="Next track"]') as HTMLButtonElement;
  expect(next().getAttribute('aria-busy')).toBeNull();
  fireEvent.click(next());
  await flush(50);
  expect(next().getAttribute('aria-busy')).toBe('true');
  fireEvent.click(next());
  await flush(50);
  expect(writes.filter((w) => w.cmd === 'wall2_sonos_skip')).toHaveLength(1);
  await flush(LATCH_MS + 100);
  expect(next().getAttribute('aria-busy')).toBeNull();
  fireEvent.click(next());
  await flush(50);
  expect(writes.filter((w) => w.cmd === 'wall2_sonos_skip')).toHaveLength(2);
});
