import { reviewNow } from '../../ui/reviewClock';
import { mocks } from '../tauri';
import { retryFor } from '../../tools/reports';
import { knob } from './long';

/**
 * The Sound block's Sonos service, with invented speakers, routines and presets. Review
 * knobs: `?sonos=off` (not set up), `?sonos=down` (never reached), `?sonos=sparse` (one
 * routine, one speaker, no presets), `?sonos=heavy` (many routines with long names, many
 * speakers, a sleep timer), `?sonos=timeout`, `?sonos=dropped` and `?sonos=garbled` (a good first read, then a quarter of
 * a second later a read that fails as timed-out, no-answer or bad-answer, and its second try fails the same way:
 * the dimmed card with its line, shown at once because a review frame shortens the 5 second wait), `?sonos=pending` (the
 * same, but the second try never answers: one failed read waiting, nothing shown), `?where=office|all|common|none` (which place is in use), `?sonos=quiet` (nothing playing), `?sonos=few` (one matching routine plus More), `?sonos=slow` (never answers, for the loading state), `?skip=1` (an unforced play is
 * skipped). `?np=` is a comma list for the Now Playing block: `station` (no length, as for a radio station), `noart` (no cover
 * address), `skip` (the service has back and next), `skipfail` (a skip is refused as a station that cannot skip), `long` (a very long
 * title and artist). `?favs=` is one word for the favorites commands: `empty` (no favorites), `timeout`, `dropped` or `garbled` (the
 * list fails as timed-out, no-answer or bad-answer), `stale` (play answers "Sonos status is out of date"), `noroom` (play answers
 * "No room to play on"), `confirm` (play asks for a confirm first), `refused` (play answers "Sonos could not do that"), `unreachable`
 * (play answers "Could not reach Sonos"). The default is a typical
 * evening with music playing on a group, a cover, a 3:01 length at 1:05 and no back or next.
 */
const now = () => (reviewNow ? reviewNow() : Date.now());

type Mode = 'typical' | 'off' | 'down' | 'sparse' | 'heavy' | 'quiet' | 'slow' | 'few' | 'timeout' | 'dropped' | 'garbled' | 'pending';

/** After its first good read each of these modes fails with the word Rust sends. */
const FAILS: Partial<Record<Mode, string>> = { timeout: 'timed-out', dropped: 'no-answer', garbled: 'bad-answer', pending: 'timed-out' };
/** Reads answered so far in each mode (each mode counts its own). */
const reads = new Map<Mode, number>();

function mode(): Mode {
  const k = knob('sonos');
  return k === 'off' || k === 'down' || k === 'sparse' || k === 'heavy' || k === 'quiet' || k === 'slow' || k === 'few' || k === 'timeout' || k === 'dropped' || k === 'garbled' || k === 'pending' ? k : 'typical';
}

const ROUTINES = [
  { key: 'Morning_Mix', name: 'Morning Mix', favorite: 'Quiet Radio', volume: 6 },
  { key: 'Day_Mix', name: 'Day Mix', favorite: 'Sunny Beats', volume: 10 },
  { key: 'Evening_Mix', name: 'Evening Mix', favorite: 'Lo-fi Room', volume: 12 },
  { key: 'Late_Night_Mix', name: 'Late Night Mix', favorite: 'Blue Hour', volume: 5 },
  { key: 'Workday_Mix', name: 'Workday Mix', favorite: 'Synth Drive', volume: 10 },
  { key: 'Bright_Mix', name: 'Bright Pop', favorite: 'Pop Picks', volume: 14 },
  { key: 'Book_Mix', name: 'Book Club', favorite: 'Soft Strings', volume: 9 },
  { key: 'Rain_Mix', name: 'Rain Sounds', favorite: 'Rain on a Tin Roof', volume: 18 },
];

const LONG_ROUTINES = [
  { key: 'Long_1', name: 'Slow Sunday Morning With Coffee And The Paper', favorite: 'A Very Long Station Name For Gentle Acoustic Mornings', volume: 8 },
  { key: 'Long_2', name: 'Day Music For Cleaning The Whole House Top To Bottom', favorite: 'Lively Cleaning Anthems Volume Two', volume: 18 },
  { key: 'Long_3', name: 'Evening Music When Friends Come Over For Dinner', favorite: 'Dinner Party Classics', volume: 15 },
  { key: 'Long_4', name: 'Late Night Music Very Quiet So Nobody Wakes Up', favorite: 'Velvet Hours', volume: 4 },
  { key: 'Long_5', name: 'Workday Music For Long Afternoons Of Spreadsheets', favorite: 'Retro Drive', volume: 10 },
  { key: 'Long_6', name: 'Party Music Loud', favorite: 'Dance Floor', volume: 55 },
  ...ROUTINES.slice(5),
  ...Array.from({ length: 6 }, (_, i) => ({ key: `Extra_${i}`, name: `Extra Playlist Number ${i + 1}`, favorite: `Station ${i + 1}`, volume: 10 })),
];

/** Eight invented favorites; two have very long names. */
const FAVORITES = [
  { id: '0a1b2c3d4e5f6071', name: 'Quiet Radio', kind: 'radio' },
  { id: '1b2c3d4e5f607182', name: 'Sunny Beats', kind: 'spotify' },
  { id: '2c3d4e5f60718293', name: 'Lo-fi Room', kind: 'spotify' },
  { id: '3d4e5f60718293a4', name: 'Blue Hour', kind: 'other' },
  { id: '4e5f60718293a4b5', name: 'Rain on a Tin Roof', kind: null },
  { id: '5f60718293a4b5c6', name: 'A Very Long Station Name For Gentle Acoustic Mornings With Coffee And The Paper On The Porch', kind: 'radio' },
  { id: '60718293a4b5c6d7', name: 'Lively Cleaning Anthems For Getting The Whole House Done Before Friends Arrive For Dinner Tonight', kind: 'spotify' },
  { id: '718293a4b5c6d7e8', name: 'Soft Strings', kind: 'other' },
];

/** The `?favs=` word, if any. */
const favs = (): string | null => knob('favs');

/** The `?np=` words. */
function np(word: string): boolean {
  return (knob('np') ?? '').split(',').includes(word);
}

/**
 * The invented cover: a sunset over a dark field, drawn on a canvas when there is one (the browser), else a 1 pixel
 * picture (tests). Rust sends a sniffed type and base 64 bytes; this is the same shape.
 */
function coverImage(): { mime: string; base64: string } {
  const fallback = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  try {
    const c = document.createElement('canvas');
    c.width = 272;
    c.height = 272;
    const g = c.getContext('2d');
    if (!g) return { mime: 'image/png', base64: fallback };
    const sky = g.createLinearGradient(0, 0, 0, 272);
    sky.addColorStop(0, '#2b1a63');
    sky.addColorStop(0.52, '#8f2f86');
    sky.addColorStop(1, '#ff6f6a');
    g.fillStyle = sky;
    g.fillRect(0, 0, 272, 272);
    g.fillStyle = '#ffd98a';
    g.beginPath();
    g.arc(136, 180, 66, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#140e31';
    g.fillRect(0, 185, 272, 87);
    return { mime: 'image/png', base64: c.toDataURL('image/png').split(',')[1] ?? fallback };
  } catch {
    return { mime: 'image/png', base64: fallback };
  }
}

function speakers(m: Mode) {
  if (m === 'sparse') return [{ name: 'Den', state: 'stopped', volume: 12, input: null, group: 'G1', online: true }];
  const playing = m === 'quiet' ? 'stopped' : 'playing';
  const base = [
    { name: 'Studio', state: 'playing', volume: 100, input: np('tv') ? 'tv' : 'lineIn', group: 'G1', online: true },
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

function nowPlaying(m: Mode) {
  const length = np('station') ? { duration: null, position: null } : { duration: 181, position: 65 };
  const art = np('noart') ? null : 'cover-1';
  if (np('long') && (m === 'typical' || m === 'heavy'))
    return { speaker: 'Den', track: 'A Song With A Rather Long Title That Keeps Going And Going Through The Night (Extended Mix)', artist: 'The Invented Band Of Several Long Named Members', ...length, art };
  if (m === 'heavy') return { speaker: 'Den', track: 'A Song With A Rather Long Title That Keeps Going (Extended Mix)', artist: 'The Invented Band', ...length, art };
  if (m === 'typical') return { speaker: 'Den', track: 'Night Drive', artist: 'Neon Coast', ...length, art };
  return null;
}

function summary(m: Mode) {
  const t = now();
  const place = knob('where');
  const presets =
    m === 'sparse'
      ? []
      : m === 'heavy'
        ? [
            { id: 'whole', name: 'All Speakers Including The Garden', active: false, loud: [{ name: 'Studio', level: 100, sets: false }] },
            { id: 'desk', name: 'Office (Work) With The Big Speaker', active: true, loud: [] },
            { id: 'living', name: 'Common Areas Downstairs', active: false, loud: [] },
            { id: 'upstairs', name: 'Upstairs Only', active: false, loud: [] },
          ]
        : [
            { id: 'whole', name: 'All Speakers', active: place === 'all', loud: [{ name: 'Studio', level: 100, sets: false }] },
            { id: 'desk', name: 'Office (Work)', active: place ? place === 'office' : m !== 'quiet', loud: [] },
            { id: 'living', name: 'Common Areas', active: place === 'common', loud: [] },
            { id: 'upstairs', name: 'Upstairs Only', active: false, loud: [] },
          ];
  return {
    speakers: speakers(m),
    groups: groups(m),
    presets,
    music: m === 'few' ? [ROUTINES[0], ROUTINES[7]] : m === 'sparse' ? ROUTINES.slice(2, 3) : m === 'heavy' ? LONG_ROUTINES : ROUTINES,
    controls:
      m === 'sparse'
        ? []
        : [
            // The page no longer offers a group-all control; the mock still sends one to show it stays hidden.
            { key: 'Group_Everything', name: 'Group Everything', action: 'groupAll', loud: [{ name: 'Studio', level: 100, sets: false }] },
            { key: 'Ungroup_Everything', name: 'Ungroup Everything', action: 'ungroupAll', loud: [] },
          ],
    scenes: [],
    sleepTimers: m === 'heavy' ? [{ id: 't1', endsAtMs: t + 42 * 60_000, fadeMinutes: 5 }] : [],
    nowPlaying: nowPlaying(m),
    currentGroup: m === 'sparse' ? 'G1' : 'G2',
    readAtMs: t,
    canSkip: np('skip') || np('skipfail'),
  };
}

export function registerSonosMocks(): void {
  mocks.set('wall2_sonos_summary', () => {
    const m = mode();
    if (m === 'slow') return new Promise(() => undefined);
    if (m === 'off') return Promise.reject(new Error('not-configured'));
    if (m === 'down') return Promise.reject(new Error('Could not reach Sonos'));
    const word = FAILS[m];
    if (word) {
      const n = (reads.get(m) ?? 0) + 1;
      reads.set(m, n);
      if (n === 1) {
        // Ask the page for a second read soon, so the failing phases show without waiting 30 seconds.
        setTimeout(() => void retryFor('sound')?.(), 150);
        return summary('typical');
      }
      // The failed read, then (pending) a second try that never answers, or (the others) one that fails the same way.
      return m === 'pending' && n > 2 ? new Promise(() => undefined) : Promise.reject(new Error(word));
    }
    // `?spotifyplay=speaker` pairs with the Spotify mock: Spotify plays on "Living room", so
    // the group lead here takes that name and Home's strip shows the track.
    if (knob('spotifyplay') === 'speaker') return JSON.parse(JSON.stringify(summary(m)).replaceAll('"Den"', '"Living room"'));
    return summary(m);
  });
  const slow = async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  };
  // `?skip=1`: an unforced play is skipped (the service gives no reason), so "Play anyway" shows.
  mocks.set('wall2_sonos_play', async (args) => {
    await slow();
    const forced = !!(args as { force?: boolean } | undefined)?.force;
    return knob('skip') && !forced ? { started: false, reason: null } : { started: true, reason: null };
  });
  mocks.set('wall2_sonos_preset', slow);
  mocks.set('wall2_sonos_volume', slow);
  mocks.set('wall2_sonos_pause_all', slow);
  mocks.set('wall2_sonos_art', async () => (np('noart') ? null : coverImage()));
  mocks.set('wall2_sonos_skip', async () => {
    await slow();
    if (np('skipfail')) throw new Error('cannot-skip');
  });
  mocks.set('wall2_sonos_favorites', async () => {
    await slow();
    const k = favs();
    if (k === 'timeout') throw new Error('timed-out');
    if (k === 'dropped') throw new Error('no-answer');
    if (k === 'garbled') throw new Error('bad-answer');
    return k === 'empty' ? [] : FAVORITES.map((f) => ({ ...f }));
  });
  mocks.set('wall2_sonos_favorite_play', async (args) => {
    await slow();
    const k = favs();
    if (k === 'stale') throw new Error('Sonos status is out of date');
    if (k === 'noroom') throw new Error('No room to play on');
    if (k === 'refused') throw new Error('Sonos could not do that');
    if (k === 'unreachable') throw new Error('Could not reach Sonos');
    if (k === 'confirm' && !(args as { confirm?: boolean } | undefined)?.confirm) throw new Error('needs-confirm');
    if (!FAVORITES.some((f) => f.id === (args as { favoriteId?: string } | undefined)?.favoriteId)) throw new Error('Unknown favorite');
  });
  mocks.set('wall2_sonos_sleep', slow);
  mocks.set('wall2_sonos_sleep_cancel', slow);
  if (!mocks.has('open_volume_mixer')) mocks.set('open_volume_mixer', () => undefined);
}
