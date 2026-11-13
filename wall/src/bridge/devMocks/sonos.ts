import { reviewNow } from '../../ui/reviewClock';
import { mocks } from '../tauri';
import { knob } from './long';

/**
 * The Sound block's Sonos service, with invented speakers, routines and presets. Review
 * knobs: `?sonos=off` (not set up), `?sonos=down` (never reached), `?sonos=sparse` (one
 * routine, one speaker, no presets), `?sonos=heavy` (many routines with long names, many
 * speakers, a sleep timer), `?sonos=quiet` (nothing playing), `?skip=1` (an unforced play is
 * skipped). The default is a typical
 * evening with music playing on a group.
 */
const now = () => (reviewNow ? reviewNow() : Date.now());

type Mode = 'typical' | 'off' | 'down' | 'sparse' | 'heavy' | 'quiet';

function mode(): Mode {
  const k = knob('sonos');
  return k === 'off' || k === 'down' || k === 'sparse' || k === 'heavy' || k === 'quiet' ? k : 'typical';
}

const ROUTINES = [
  { key: 'Dawn_Mix', name: 'Dawn Music', favorite: 'Quiet Radio', volume: 6 },
  { key: 'Midday_Mix', name: 'Noon Music', favorite: 'Sunny Beats', volume: 10 },
  { key: 'Dusk_Mix', name: 'Dusk Music', favorite: 'Lo-fi Room', volume: 12 },
  { key: 'Night_Mix', name: 'Night Owl Music', favorite: 'Blue Hour', volume: 5 },
  { key: 'Desk_Mix', name: 'Desk Focus Music', favorite: 'Synth Drive', volume: 10 },
  { key: 'Bright_Mix', name: 'Bright Pop', favorite: 'Pop Picks', volume: 14 },
  { key: 'Book_Mix', name: 'Book Club', favorite: 'Soft Strings', volume: 9 },
  { key: 'Rain_Mix', name: 'Rain Sounds', favorite: 'Rain on a Tin Roof', volume: 18 },
];

const LONG_ROUTINES = [
  { key: 'Long_1', name: 'Slow Sunday Morning With Coffee And The Paper Music', favorite: 'A Very Long Station Name For Gentle Acoustic Mornings', volume: 8 },
  { key: 'Long_2', name: 'Noon Music For Cleaning The Whole House Top To Bottom', favorite: 'Lively Cleaning Anthems Volume Two', volume: 18 },
  { key: 'Long_3', name: 'Dusk Music When Friends Come Over For Dinner', favorite: 'Dinner Party Classics', volume: 15 },
  { key: 'Long_4', name: 'Night Owl Music Very Quiet So Nobody Wakes Up', favorite: 'Velvet Hours', volume: 4 },
  { key: 'Long_5', name: 'Desk Focus Music For Long Afternoons Of Spreadsheets', favorite: 'Retro Drive', volume: 10 },
  { key: 'Long_6', name: 'Party Music Loud', favorite: 'Dance Floor', volume: 55 },
  ...ROUTINES,
  ...Array.from({ length: 6 }, (_, i) => ({ key: `Extra_${i}`, name: `Extra Playlist Number ${i + 1}`, favorite: `Station ${i + 1}`, volume: 10 })),
];

function speakers(m: Mode) {
  if (m === 'sparse') return [{ name: 'Den', state: 'stopped', volume: 12, input: null, group: 'G1', online: true }];
  const playing = m === 'quiet' ? 'stopped' : 'playing';
  const base = [
    { name: 'Studio', state: 'playing', volume: 100, input: 'lineIn', group: 'G1', online: true },
    { name: 'Den', state: playing, volume: 14, input: null, group: 'G2', online: true },
    { name: 'Porch', state: playing, volume: 10, input: null, group: 'G2', online: true },
    { name: 'Loft', state: playing, volume: 10, input: null, group: 'G2', online: true },
    { name: 'Hall', state: playing, volume: 8, input: null, group: 'G2', online: true },
    { name: 'Patio', state: 'offline', volume: null, input: null, group: null, online: false },
  ];
  if (m !== 'heavy') return base;
  return [
    ...base,
    { name: 'Garage Workshop Corner Speaker', state: 'paused', volume: 22, input: null, group: 'G3', online: true },
    { name: 'Lounge', state: 'playing', volume: 30, input: 'tv', group: 'G4', online: true },
    { name: 'Guest Room', state: 'stopped', volume: 5, input: null, group: 'G5', online: true },
    { name: 'Gym', state: 'stopped', volume: 25, input: null, group: 'G6', online: true },
    { name: 'Sunroom', state: 'unknown', volume: null, input: null, group: null, online: true },
    { name: 'Pantry', state: 'stopped', volume: 7, input: null, group: 'G7', online: true },
  ];
}

function groups(m: Mode) {
  if (m === 'sparse') return [{ id: 'G1', coordinator: 'Den', members: ['Den'] }];
  const g = [
    { id: 'G1', coordinator: 'Studio', members: ['Studio'] },
    { id: 'G2', coordinator: 'Den', members: ['Den', 'Porch', 'Loft', 'Hall'] },
  ];
  if (m !== 'heavy') return g;
  return [
    ...g,
    { id: 'G3', coordinator: 'Garage Workshop Corner Speaker', members: ['Garage Workshop Corner Speaker'] },
    { id: 'G4', coordinator: 'Lounge', members: ['Lounge'] },
    { id: 'G5', coordinator: 'Guest Room', members: ['Guest Room'] },
    { id: 'G6', coordinator: 'Gym', members: ['Gym'] },
    { id: 'G7', coordinator: 'Pantry', members: ['Pantry'] },
  ];
}

function summary(m: Mode) {
  const t = now();
  const presets =
    m === 'sparse'
      ? []
      : m === 'heavy'
        ? [
            { id: 'whole', name: 'Whole House And Garden', active: false, loud: [{ name: 'Studio', level: 100, sets: false }] },
            { id: 'desk', name: 'Office Desk With The Big Speaker', active: true, loud: [] },
            { id: 'living', name: 'Living Spaces Downstairs', active: false, loud: [] },
            { id: 'upstairs', name: 'Upstairs Only', active: false, loud: [] },
          ]
        : [
            { id: 'whole', name: 'Whole House', active: false, loud: [{ name: 'Studio', level: 100, sets: false }] },
            { id: 'desk', name: 'Office Desk', active: m !== 'quiet', loud: [] },
            { id: 'living', name: 'Living Spaces', active: false, loud: [] },
          ];
  return {
    speakers: speakers(m),
    groups: groups(m),
    presets,
    music: m === 'sparse' ? ROUTINES.slice(2, 3) : m === 'heavy' ? LONG_ROUTINES : ROUTINES,
    controls: m === 'sparse' ? [] : [{ key: 'Group_Everything', name: 'Group Everything', action: 'groupAll', loud: [{ name: 'Studio', level: 100, sets: false }] }],
    scenes: [],
    sleepTimers: m === 'heavy' ? [{ id: 't1', endsAtMs: t + 42 * 60_000, fadeMinutes: 5 }] : [],
    nowPlaying:
      m === 'heavy'
        ? { speaker: 'Den', track: 'A Song With A Rather Long Title That Keeps Going (Extended Mix)', artist: 'The Invented Band' }
        : m === 'typical'
          ? { speaker: 'Den', track: 'Night Drive', artist: 'Neon Coast' }
          : null,
    currentGroup: m === 'sparse' ? 'G1' : 'G2',
    readAtMs: t,
  };
}

export function registerSonosMocks(): void {
  mocks.set('wall2_sonos_summary', () => {
    const m = mode();
    if (m === 'off') return Promise.reject(new Error('not-configured'));
    if (m === 'down') return Promise.reject(new Error('Could not reach Sonos'));
    return summary(m);
  });
  const slow = async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  };
  // `?skip=1`: an unforced play is skipped (nobody home), so "Play anyway" shows.
  mocks.set('wall2_sonos_play', async (args) => {
    await slow();
    const forced = !!(args as { force?: boolean } | undefined)?.force;
    return knob('skip') && !forced ? { started: false, reason: 'nobody is home' } : { started: true, reason: null };
  });
  mocks.set('wall2_sonos_preset', slow);
  mocks.set('wall2_sonos_volume', slow);
  mocks.set('wall2_sonos_pause_all', slow);
  mocks.set('wall2_sonos_sleep', slow);
  mocks.set('wall2_sonos_sleep_cancel', slow);
  if (!mocks.has('open_volume_mixer')) mocks.set('open_volume_mixer', () => undefined);
}
