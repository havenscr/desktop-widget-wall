import { describe, expect, it } from 'vitest';
import {
  PLAY_ART,
  TIME_ADVANCE_MAX_MS,
  artSrc,
  chipLabel,
  clockMs,
  faceTiles,
  houseTrack,
  playingWhere,
  moreControls,
  moreRoutines,
  tileMatches,
  wherePlaces,
  ageWords,
  failureKind,
  failureLine,
  failureSentence,
  whereLabel,
  groupLabel,
  leftOutNote,
  groupVolume,
  groupTargets,
  loudText,
  markAfterRead,
  musicView,
  needsConfirm,
  nowLine,
  soonestTimer,
  orderPresets,
  routineSlot,
  skipSentence,
  sleepLeft,
  slotsFor,
  trackClock,
  splitRoutines,
  startedText,
  suggestedKey,
  type MusicRoutine,
  type PlayMark,
  type SonosSpeaker,
  type SonosSummary,
} from './soundModel';

const sp = (name: string, over: Partial<SonosSpeaker> = {}): SonosSpeaker => ({
  name,
  state: 'playing',
  volume: 10,
  input: null,
  group: 'G2',
  online: true,
  ...over,
});
const r = (key: string, name: string): MusicRoutine => ({ key, name, favorite: null, volume: 10 });

const SUMMARY: SonosSummary = {
  speakers: [sp('Studio', { input: 'lineIn', volume: 100, group: 'G1' }), sp('Den', { volume: 14 }), sp('Porch', { volume: 10 }), sp('Shed', { online: false, state: 'offline', volume: null })],
  groups: [
    { id: 'G1', coordinator: 'Studio', members: ['Studio'] },
    { id: 'G2', coordinator: 'Den', members: ['Den', 'Porch', 'Shed'] },
  ],
  presets: [],
  music: [],
  controls: [],
  scenes: [],
  sleepTimers: [],
  nowPlaying: null,
  currentGroup: 'G2',
  readAtMs: 0,
  canSkip: false,
};

it('shortens a routine name for its button', () => {
  expect(chipLabel('Night Owl Music')).toBe('Night Owl');
  expect(chipLabel('Music for Rain')).toBe('for Rain');
  expect(chipLabel('Music')).toBe('Music');
  expect(chipLabel('Bright Pop')).toBe('Bright Pop');
});

it('puts six routines on the face and the rest under More, in the service order', () => {
  const list = Array.from({ length: 9 }, (_, i) => r(`k${i}`, `Mix ${i}`));
  const { face, more } = splitRoutines(list);
  expect(face.map((x) => x.key)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5']);
  expect(more.map((x) => x.key)).toEqual(['k6', 'k7', 'k8']);
  expect(splitRoutines([]).face).toEqual([]);
});

it('reads the part of the day from a routine name', () => {
  expect(routineSlot('Dawn Music')).toBe('morning');
  expect(routineSlot('Noon Music')).toBe('day');
  expect(routineSlot('Day Mix')).toBe('day');
  expect(routineSlot('Dusk Music')).toBe('evening');
  expect(routineSlot('Night Owl Music')).toBe('night');
  expect(routineSlot('Late Night Mix')).toBe('night');
  expect(routineSlot('Desk Focus Music')).toBe('workday');
  expect(routineSlot('Workday Beats')).toBe('workday');
  expect(routineSlot('Bright Pop')).toBeNull();
  // "Someday" and "Daydream" are not "day".
  expect(routineSlot('Someday Songs')).toBeNull();
});

// Thursday 12 November 2026, local time.
const at = (h: number, m = 0, day = 12) => new Date(2026, 10, day, h, m);

it('suggests the routine that fits the hour', () => {
  const list = [r('a', 'Morning Music'), r('b', 'Day Music'), r('c', 'Evening Music'), r('d', 'Late Night Music'), r('e', 'Workday Music'), r('f', 'Bright Pop')];
  expect(suggestedKey(list, at(7))).toBe('a');
  expect(suggestedKey(list, at(10))).toBe('e');
  expect(suggestedKey(list, at(10, 0, 14))).toBe('b'); // Saturday: the day mix, not work
  expect(suggestedKey(list, at(18))).toBe('c');
  expect(suggestedKey(list, at(23))).toBe('d');
  expect(suggestedKey(list, at(2))).toBe('d');
  expect(suggestedKey([r('f', 'Bright Pop')], at(18))).toBeNull();
  // On a weekday with no work routine, the day one stands in.
  expect(suggestedKey([r('b', 'Day Music')], at(11))).toBe('b');
  expect(slotsFor(at(16, 59))).toEqual(['workday', 'day']);
  expect(slotsFor(at(17))).toEqual(['evening']);
});

it('puts the preset whose name starts with Office first', () => {
  const p = (id: string, name: string) => ({ id, name, active: false, loud: [] });
  expect(orderPresets([p('a', 'Whole House'), p('b', 'Living'), p('c', 'Office Desk')]).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  expect(orderPresets([p('a', 'Whole House'), p('b', 'Living')]).map((x) => x.id)).toEqual(['a', 'b']);
  expect(orderPresets([p('c', 'office'), p('a', 'Whole')]).map((x) => x.id)).toEqual(['c', 'a']);
});

it('the group slider leaves out line-in and offline speakers', () => {
  expect(groupVolume(SUMMARY)).toBe(12);
  expect(groupLabel(SUMMARY)).toBe('Den and 1 more');
  expect(groupVolume({ ...SUMMARY, currentGroup: 'G1' })).toBeNull();
  expect(groupLabel({ ...SUMMARY, currentGroup: null })).toBeNull();
});

it('asks first for any target above 40, whatever the read says', () => {
  expect(needsConfirm([41])).toBe(true);
  expect(needsConfirm([40])).toBe(false);
  expect(needsConfirm([10, 60])).toBe(true);
  expect(needsConfirm([])).toBe(false);
});

it('a group step moves each music speaker from its own level, clamped', () => {
  expect(groupTargets(SUMMARY, 5)).toEqual([
    { name: 'Den', level: 19 },
    { name: 'Porch', level: 15 },
  ]);
  expect(groupTargets(SUMMARY, -50)).toEqual([
    { name: 'Den', level: 0 },
    { name: 'Porch', level: 0 },
  ]);
});

it('names the speakers that make an action ask first', () => {
  expect(loudText([{ name: 'Studio', level: 100, sets: false }], 'Group')).toBe('Studio is at 100. Group anyway?');
  expect(loudText([{ name: 'Den', level: null, sets: false }, { name: 'Loft', level: 70, sets: true }], 'Apply')).toBe(
    "Den's level is not known; it sets Loft to 70. Apply anyway?",
  );
});

it('keeps "started" only while what plays is what the wall started', () => {
  const t = 1_000_000;
  const start: PlayMark = { key: 'k', at: t, group: null, seen: false };
  const quiet = { ...SUMMARY, speakers: SUMMARY.speakers.map((s) => (s.input ? s : { ...s, state: 'stopped' as const })) };
  // A first read before the music shows keeps it; a later quiet read clears it.
  expect(markAfterRead(start, quiet, t + 5_000)).toBe(start);
  expect(markAfterRead(start, quiet, t + 30_000)).toBeNull();
  // The first read with music records the group.
  const seen = markAfterRead(start, SUMMARY, t + 5_000)!;
  expect(seen).toEqual({ key: 'k', at: t, group: 'G2', seen: true });
  expect(markAfterRead(seen, SUMMARY, t + 10 * 60_000)).toBe(seen);
  // Nothing playing, another group, no group to tell by, or past an hour: cleared.
  expect(markAfterRead(seen, quiet, t + 10 * 60_000)).toBeNull();
  expect(markAfterRead(seen, { ...SUMMARY, currentGroup: 'G1' }, t + 60_000)).toBeNull();
  expect(markAfterRead(seen, { ...SUMMARY, currentGroup: null }, t + 60_000)).toBeNull();
  expect(markAfterRead(seen, SUMMARY, t + 61 * 60_000)).toBeNull();
  expect(markAfterRead(null, SUMMARY, t)).toBeNull();
});

it('shows the soonest running sleep timer, never one that ended', () => {
  const now = 10 * 60_000;
  expect(
    soonestTimer(
      [
        { id: 'late', endsAtMs: now + 50 * 60_000, fadeMinutes: 5 },
        { id: 'soon', endsAtMs: now + 5 * 60_000, fadeMinutes: 5 },
        { id: 'gone', endsAtMs: now - 2 * 60_000, fadeMinutes: 5 },
      ],
      now,
    )?.id,
  ).toBe('soon');
  expect(soonestTimer([{ id: 'gone', endsAtMs: now - 2 * 60_000, fadeMinutes: 5 }], now)).toBeNull();
});

it('says what plays and where, never claiming a track it does not know', () => {
  expect(nowLine(SUMMARY)).toBe('Playing on 2 speakers');
  expect(nowLine({ ...SUMMARY, nowPlaying: { speaker: 'Den', track: 'Song A', artist: 'Band B', duration: null, position: null, art: null } })).toBe('Song A, Band B, on 2 speakers');
  const quiet = { ...SUMMARY, speakers: SUMMARY.speakers.map((s) => ({ ...s, state: s.input ? s.state : ('stopped' as const) })) };
  expect(nowLine(quiet)).toBe('Nothing playing');
});

it('counts sleep minutes and start ages', () => {
  expect(sleepLeft({ id: 't', endsAtMs: 10 * 60_000, fadeMinutes: 5 }, 0)).toBe(10);
  expect(sleepLeft({ id: 't', endsAtMs: 0, fadeMinutes: 5 }, 60_000)).toBe(0);
  expect(sleepLeft({ id: 't', endsAtMs: null, fadeMinutes: null }, 0)).toBeNull();
  expect(startedText(0, 30_000)).toBe('started just now');
  expect(startedText(0, 5 * 60_000)).toBe('started 5 min ago');
  expect(startedText(0, 125 * 60_000)).toBe('started 2 h ago');
});

it('a group step leaves out a speaker with no level and says so; the label counts only movers', () => {
  const four: SonosSummary = {
    ...SUMMARY,
    speakers: [sp('Den', { volume: 14 }), sp('Porch', { volume: 10 }), sp('Loft', { volume: 20 }), sp('Attic', { volume: null })],
    groups: [{ id: 'G2', coordinator: 'Den', members: ['Den', 'Porch', 'Loft', 'Attic'] }],
  };
  expect(groupTargets(four, 5).map((t) => t.name)).toEqual(['Den', 'Porch', 'Loft']);
  expect(groupLabel(four)).toBe('Den and 2 more');
  expect(leftOutNote(four, 'G2')).toBe('3 of 4 speakers changed');
  expect(leftOutNote({ ...SUMMARY, speakers: SUMMARY.speakers.filter((x) => x.name !== 'Shed'), groups: [{ id: 'G2', coordinator: 'Den', members: ['Den', 'Porch'] }] }, 'G2')).toBe('');
});

it('an unseen mark older than the start grace is cleared even when something plays', () => {
  const t = 1_000_000;
  const start: PlayMark = { key: 'k', at: t, group: null, seen: false };
  // A restart thirty minutes after the start: music plays, but not what the wall started.
  expect(markAfterRead(start, SUMMARY, t + 30 * 60_000)).toBeNull();
  // Within the grace it still attaches.
  expect(markAfterRead(start, SUMMARY, t + 5_000)).toEqual({ key: 'k', at: t, group: 'G2', seen: true });
});

const rt = (key: string, name: string): MusicRoutine => ({ key, name, favorite: null, volume: 10 });

it('the five tiles match by whole words: workday is never Day, Late night is two words or one, case and underscores are fine', () => {
  expect(tileMatches('workday', 'Workday Mix')).toBe(true);
  expect(tileMatches('day', 'Workday Mix')).toBe(false);
  expect(tileMatches('workday', 'Work Day Mix')).toBe(true);
  expect(tileMatches('day', 'Work Day Mix')).toBe(false);
  expect(tileMatches('day', 'Day Mix')).toBe(true);
  expect(tileMatches('day', 'Day_Mix')).toBe(true);
  for (const n of ['Someday Songs', 'Sunday', 'Midday', 'Mid-day', 'Daytime', 'Day-time', 'Work  Day', 'Work-day']) expect(tileMatches('day', n)).toBe(false);
  for (const n of ['Day-Mix', 'Day Mix', 'The Day']) expect(tileMatches('day', n)).toBe(true);
  expect(tileMatches('workday', 'Work  Day')).toBe(true);
  expect(tileMatches('morning', 'Morning-Mix')).toBe(true);
  expect(tileMatches('morning', 'Morning1')).toBe(false);
  expect(tileMatches('evening', 'Evening-wind-down')).toBe(true);
  expect(tileMatches('evening', 'Evening2')).toBe(false);
  for (const n of ['LATE NIGHT', 'latenight mix', 'Late-Night', 'Late_Night']) expect(tileMatches('night', n)).toBe(true);
  expect(tileMatches('night', 'Night Owl')).toBe(false);
  expect(tileMatches('morning', 'MORNING')).toBe(true);
  expect(tileMatches('evening', 'Evening')).toBe(true);
  expect(tileMatches('morning', 'Rain Sounds')).toBe(false);
});

it('each tile tests routines by its own word: Morning workday gives Morning and no Workday tile, and with Workday Mix both exist', () => {
  const only = faceTiles([rt('mw', 'Morning workday')]);
  expect(only.map((t) => [t.label, t.routine.key])).toEqual([['Morning', 'mw']]);
  const both = faceTiles([rt('mw', 'Morning workday'), rt('w', 'Workday Mix')]);
  expect(both.map((t) => [t.label, t.routine.key])).toEqual([
    ['Morning', 'mw'],
    ['Workday', 'w'],
  ]);
});

it('the face has the tiles in the fixed order, leaves out a word with no routine, and the first by NAME wins a tie (the service order is reversed here)', () => {
  const music = [rt('w', 'Workday Mix'), rt('e', 'Evening Mix'), rt('m1', 'Morning Two'), rt('m2', 'Morning One'), rt('x', 'Rain')];
  const tiles = faceTiles(music);
  expect(tiles.map((t) => [t.label, t.routine.key])).toEqual([
    ['Morning', 'm2'],
    ['Evening', 'e'],
    ['Workday', 'w'],
  ]);
  expect(moreRoutines(music, tiles).map((r) => r.key)).toEqual(['m1', 'x']);
  expect(faceTiles([])).toEqual([]);
  // Same name: by key.
  expect(faceTiles([rt('b', 'Day Mix'), rt('a', 'day mix')])[0].routine.key).toBe('a');
});

it('the hour\'s suggestion walks the tiles: Latenight is suggested at 23:00; an Evening Workday routine is not Evening unless it is the Evening tile', () => {
  expect(suggestedKey([rt('n', 'Latenight')], at(23))).toBe('n');
  // Evening tile is "Evening Workday" (it carries the word), so it is suggested at 18:00.
  expect(suggestedKey([rt('ew', 'Evening Workday')], at(18))).toBe('ew');
  // With a plain Evening routine present the Evening tile takes the first by name ("Evening Mix" < "Evening Workday").
  expect(suggestedKey([rt('ew', 'Evening Workday'), rt('e', 'Evening Mix')], at(18))).toBe('e');
  // No tile for the hour: nothing is suggested, even when the old word list would have matched.
  expect(suggestedKey([rt('s', 'Sleep Sounds')], at(23))).toBeNull();
});

it('More never lists Group all or Pause all', () => {
  const c = (key: string, action: string) => ({ key, name: key, action, loud: [] });
  expect(moreControls([c('a', 'groupAll'), c('b', 'pauseAll'), c('c', 'ungroupAll')]).map((x) => x.key)).toEqual(['c']);
});

it('the age words never say "just now" beside a failure: less than a minute, minutes, hours', () => {
  expect(ageWords(0, 0)).toBe('less than a minute ago');
  expect(ageWords(0, 59_000)).toBe('less than a minute ago');
  expect(ageWords(0, 60_000)).toBe('1 min ago');
  expect(ageWords(0, 59 * 60_000)).toBe('59 min ago');
  expect(ageWords(0, 2 * 3_600_000)).toBe('2 h ago');
});

it('each kind of failed read has its own sentence; the line adds the age of the last good read, or stops at the sentence', () => {
  expect(failureKind('timed-out')).toBe('timed-out');
  expect(failureKind('no-answer')).toBe('no-answer');
  expect(failureKind('bad-answer')).toBe('bad-answer');
  expect(failureKind('Could not reach Sonos')).toBe('no-answer');
  expect(failureLine('timed-out', 0, 60_000)).toBe('Sonos did not answer in time. Last good read 1 min ago');
  expect(failureLine('no-answer', 0, 30_000)).toBe('Sonos cannot be reached. Last good read less than a minute ago');
  expect(failureLine('bad-answer', 0, 2 * 3_600_000)).toBe('Sonos sent an answer the wall could not read. Last good read 2 h ago');
  expect(failureLine('timed-out', null, 5_000)).toBe('Sonos did not answer in time');
  expect(failureSentence('bad-answer')).toBe('Sonos sent an answer the wall could not read');
});

it('two presets that start with the same word: the first by name wins', () => {
  const p = (id: string, name: string) => ({ id, name, active: false, loud: [] });
  expect(wherePlaces([p('z', 'Office Zed'), p('a', 'Office Alpha')]).map((x) => x.preset.id)).toEqual(['a']);
  // The label is the owner's word, never the preset's longer name; the id is the preset's own.
  expect(wherePlaces([p('a', 'Office Alpha'), p('s', 'ALL SPEAKERS upstairs'), p('c', 'common area east')]).map((x) => [x.label, x.preset.id])).toEqual([
    ['Office', 'a'],
    ['All Speakers', 's'],
    ['Common Areas', 'c'],
  ]);
});

it('Where is Office, All Speakers, Common Areas in that order; the label drops parentheses; other presets are hidden', () => {
  const p = (id: string, name: string) => ({ id, name, active: false, loud: [] });
  const places = wherePlaces([p('a', 'Common Areas'), p('b', 'Upstairs'), p('c', 'All Speakers'), p('d', 'Office (Work)')]);
  expect(places.map((x) => [x.label, x.preset.id])).toEqual([
    ['Office', 'd'],
    ['All Speakers', 'c'],
    ['Common Areas', 'a'],
  ]);
  expect(wherePlaces([p('b', 'Upstairs')])).toEqual([]);
  expect(whereLabel('Office (Work)')).toBe('Office');
});

describe('home round two: what the house plays', () => {
  const base = {
    speakers: [
      { name: 'Den', state: 'playing', volume: 10, input: null, group: 'G2', online: true },
      { name: 'Porch', state: 'playing', volume: 10, input: null, group: 'G2', online: true },
      { name: 'Studio', state: 'stopped', volume: 10, input: null, group: 'G1', online: true },
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
    nowPlaying: null,
    currentGroup: 'G2',
    readAtMs: 0,
  } as unknown as SonosSummary;
  const track = { name: 'Lantern Song', artists: 'Mira Vale', durationMs: 200_000, imageUrl: 'a', thumbUrl: 'b' };
  it('shows a Spotify track only when it plays on a house speaker the Sonos read shows playing', () => {
    expect(houseTrack({ playing: true, device: { name: 'den', kind: 'Speaker' }, track, progressMs: 5000 }, base)).toEqual({ title: 'Lantern Song', artist: 'Mira Vale', cover: 'b', where: 'Den, 2 speakers', progressMs: 5000, durationMs: 200_000 });
    // On this PC: never the house.
    expect(houseTrack({ playing: true, device: { name: 'Den', kind: 'Computer' }, track, progressMs: 0 }, base)).toBeNull();
    // A speaker the Sonos read shows quiet, or one it does not know.
    expect(houseTrack({ playing: true, device: { name: 'Studio', kind: 'Speaker' }, track, progressMs: 0 }, base)).toBeNull();
    expect(houseTrack({ playing: true, device: { name: 'Garden', kind: 'Speaker' }, track, progressMs: 0 }, base)).toBeNull();
    expect(houseTrack({ playing: false, device: { name: 'Den', kind: 'Speaker' }, track, progressMs: 0 }, base)).toBeNull();
    expect(houseTrack(null, base)).toBeNull();
  });
  it('words where it plays and the progress times', () => {
    expect(playingWhere(base)).toBe('Den, 2 speakers');
    expect(clockMs(82_000)).toBe('1:22');
    expect(clockMs(0)).toBe('0:00');
    expect(PLAY_ART.morning.icon).toBe('cup');
    expect(PLAY_ART.workday.icon).toBe('laptop');
  });
});

describe('the Now Playing block\'s pure rules', () => {
  it('turns a fetched cover into an image source only for the three picture types Rust sends', () => {
    expect(artSrc({ mime: 'image/png', base64: 'iVBORw0KGgo=' })).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(artSrc({ mime: 'image/jpeg', base64: '/9j/4AAQ' })).toBe('data:image/jpeg;base64,/9j/4AAQ');
    expect(artSrc({ mime: 'image/webp', base64: 'UklGRg==' })).toBe('data:image/webp;base64,UklGRg==');
    for (const bad of [
      { mime: 'image/svg+xml', base64: 'PHN2Zz4=' },
      { mime: 'text/html', base64: 'PGI+' },
      { mime: 'image/png;base64,AAAA', base64: 'AAAA' },
      { mime: 'image/png', base64: '' },
      { mime: 'image/png', base64: 'AAAA" onerror="x' },
      { mime: 'image/png', base64: 'AA AA' },
      { mime: 'image/png', base64: 'AAAA\n' },
    ])
      expect(artSrc(bad)).toBeNull();
    expect(artSrc(null)).toBeNull();
    expect(artSrc(undefined)).toBeNull();
  });

  it('counts a track\'s position on from the read, never past the end, frozen when the read is not live', () => {
    const t = 1_000_000;
    expect(trackClock(181, 65, t, t, true)).toEqual({ posMs: 65_000, durMs: 181_000 });
    expect(trackClock(181, 65, t, t + 10_500, true)).toEqual({ posMs: 75_500, durMs: 181_000 });
    // Never past the end.
    expect(trackClock(181, 170, t, t + 60_000, true)).toEqual({ posMs: 181_000, durMs: 181_000 });
    // A page clock behind the read never moves it back.
    expect(trackClock(181, 65, t, t - 5_000, true)?.posMs).toBe(65_000);
    // Never counts on further than the stale limit past the read.
    expect(trackClock(86_400, 0, t, t + 10 * 60_000, true)?.posMs).toBe(TIME_ADVANCE_MAX_MS);
    // Not live: stops at the read's own position.
    expect(trackClock(181, 65, t, t + 30_000, false)?.posMs).toBe(65_000);
    // No length, no position or a zero length: no bar.
    expect(trackClock(null, 65, t, t, true)).toBeNull();
    expect(trackClock(181, null, t, t, true)).toBeNull();
    expect(trackClock(0, 0, t, t, true)).toBeNull();
  });

  it('says a refused skip in a sentence, and passes any other error on', () => {
    expect(skipSentence('cannot-skip')).toBe('This station cannot skip');
    expect(skipSentence('nothing-playing')).toBe('Nothing is playing');
    expect(skipSentence('Sonos could not do that')).toBeNull();
    expect(skipSentence('')).toBeNull();
  });

  const args = (over: Partial<Parameters<typeof musicView>[0]> = {}): Parameters<typeof musicView>[0] => ({
    s: { ...SUMMARY, speakers: SUMMARY.speakers.map((x) => (x.name === 'Den' || x.name === 'Porch' ? { ...x, state: 'playing' as const } : x)) },
    track: null,
    trackAt: 0,
    activeName: null,
    activeSlot: null,
    art: null,
    now: 0,
    live: true,
    ...over,
  });

  it('builds the music half from the Sonos read: the track, the cover, the length, where it plays, back and next only when offered', () => {
    const np = { speaker: 'Den', track: 'Song A', artist: 'Band B', duration: 200, position: 20, art: 'key-1' };
    const m = musicView(args({ s: { ...args().s, nowPlaying: np, canSkip: true, readAtMs: 1000 }, art: 'data:image/png;base64,AAAA', now: 6000 }))!;
    expect(m).toMatchObject({ title: 'Song A', artist: 'Band B', cover: 'data:image/png;base64,AAAA', where: 'Den, 2 speakers', canSkip: true });
    expect(m.clock).toEqual({ posMs: 25_000, durMs: 200_000 });
    expect(m.whereTip).toBe('Song A, Band B, on 2 speakers');
    expect(musicView(args({ s: { ...args().s, nowPlaying: np, canSkip: false } }))!.canSkip).toBe(false);
  });

  it('keeps the play this wall started as the title, and a station has no clock', () => {
    const np = { speaker: 'Den', track: 'Song A', artist: 'Band B', duration: null, position: null, art: null };
    const m = musicView(args({ s: { ...args().s, nowPlaying: np }, activeName: 'Evening', activeSlot: 'evening' }))!;
    expect(m).toMatchObject({ title: 'Evening', artist: null, slot: 'evening', clock: null });
    expect(musicView(args({ s: { ...args().s, nowPlaying: null } }))!.title).toBe('Music');
  });

  it('prefers a Spotify track on a house speaker, with its own cover and time', () => {
    const track = { title: 'Paper Lanterns', artist: 'The Quiet Hours', cover: 'https://i.scdn.co/x', where: 'Den, 2 speakers', progressMs: 65_000, durationMs: 200_000 };
    const m = musicView(args({ track, trackAt: 10_000, now: 15_000, s: { ...args().s, canSkip: true } }))!;
    expect(m).toMatchObject({ title: 'Paper Lanterns', artist: 'The Quiet Hours', cover: 'https://i.scdn.co/x', whereTip: 'Spotify on Den, 2 speakers', canSkip: true });
    expect(m.clock).toEqual({ posMs: 70_000, durMs: 200_000 });
  });

  it('has no music half when nothing plays', () => {
    const quiet = { ...args().s, speakers: args().s.speakers.map((x) => ({ ...x, state: x.input ? x.state : ('stopped' as const) })) };
    expect(musicView(args({ s: quiet }))).toBeNull();
  });
});
