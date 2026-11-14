/** The Sonos summary Rust sends (`wall2_sonos_summary`), and the pure rules of the Sound block. */

export type SpeakerState = 'playing' | 'paused' | 'stopped' | 'transitioning' | 'offline' | 'unknown';

export interface SonosSpeaker {
  name: string;
  state: SpeakerState;
  volume: number | null;
  /** `lineIn` (the PC's own sound), `tv` or `other`; null when it plays its own queue. */
  input: 'lineIn' | 'tv' | 'other' | null;
  group: string | null;
  online: boolean;
}

export interface SonosGroup {
  id: string;
  coordinator: string;
  members: string[];
}

/** A speaker an action would leave or set above 40, or whose level is not known. */
export interface LoudSpeaker {
  name: string;
  /** The level the action sets (`sets`), else the level it is at now; null when not known. */
  level: number | null;
  sets: boolean;
}

export interface SonosPreset {
  id: string;
  name: string;
  /** The speakers are grouped the way this preset groups them right now. */
  active: boolean;
  /** The speakers that make applying it ask first; empty when one click is safe. */
  loud: LoudSpeaker[];
}

/** What a play answered: started, or skipped with a fixed reason (null when none known). */
export interface PlayResult {
  started: boolean;
  reason: string | null;
}

export interface MusicRoutine {
  key: string;
  name: string;
  favorite: string | null;
  volume: number | null;
}

export interface ControlRoutine {
  key: string;
  name: string;
  action: string;
  /** For a control that groups every speaker: the speakers that make it ask first. */
  loud: LoudSpeaker[];
}

export interface SleepTimer {
  id: string;
  endsAtMs: number | null;
  fadeMinutes: number | null;
}

export interface NowPlaying {
  speaker: string;
  track: string | null;
  artist: string | null;
}

export interface SonosSummary {
  speakers: SonosSpeaker[];
  groups: SonosGroup[];
  presets: SonosPreset[];
  music: MusicRoutine[];
  controls: ControlRoutine[];
  scenes: { id: string; name: string }[];
  sleepTimers: SleepTimer[];
  nowPlaying: NowPlaying | null;
  currentGroup: string | null;
  readAtMs: number;
}

export type VolumeTarget = { kind: 'speaker' | 'group'; id: string };

/** Quick-play buttons on the face; the rest sit under "More". */
export const FACE_MAX = 6;
/** Rust refuses to raise a speaker above this without `confirm: true`. */
export const SAFE_VOLUME = 40;
/** Rust's answer when a call needs the confirm. */
export const NEEDS_CONFIRM = 'needs-confirm';
export const SONOS_REFRESH_MS = 30_000;
/** Older than this, the block dims and writes stop (Rust refuses writes past the same two minutes). */
export const STALE_MS = 2 * 60_000;
export const SLEEP_CHOICES = [30, 60, 90] as const;
/** The last routine started from the wall: `{"key","at","group","seen"}` (see `markAfterRead`). */
export const LAST_PLAY_KEY = 'wall2-sonos-last-play';
/** "started N min ago" never outlives this. */
export const LAST_PLAY_MS = 60 * 60_000;
/** A read this soon after the start may not show the music yet; it does not clear the mark. */
export const START_GRACE_MS = 20_000;
/** After a write settles, the same control ignores clicks this long (one action, one write). */
export const LATCH_MS = 800;

/** "Night Owl Music" reads "Night Owl" on a button; a name that is only "Music" stays. */
export function chipLabel(name: string): string {
  const cut = name.replace(/\s+music$/i, '').replace(/^music\s+/i, '').trim();
  return cut || name;
}

export function splitRoutines(music: readonly MusicRoutine[]): { face: MusicRoutine[]; more: MusicRoutine[] } {
  return { face: music.slice(0, FACE_MAX), more: music.slice(FACE_MAX) };
}

export type Slot = 'morning' | 'workday' | 'day' | 'evening' | 'night';

/** The part of the day a routine's name speaks for, from words in it; null for none. */
export function routineSlot(name: string): Slot | null {
  const n = name.toLowerCase();
  if (/\b(late night|night|sleep|bedtime)\b/.test(n)) return 'night';
  if (/\b(morning|sunrise|dawn|breakfast)\b/.test(n)) return 'morning';
  if (/\b(evening|sunset|dusk|dinner)\b/.test(n)) return 'evening';
  if (/\b(workday|work|focus)\b/.test(n)) return 'workday';
  if (/\b(day|daytime|midday|noon|afternoon)\b/.test(n)) return 'day';
  return null;
}

/** The slots that fit this hour, best first: morning 5 to 9, then the working day to 5 PM
 * (Workday first on a weekday), evening to 9 PM, night after. */
export function slotsFor(d: Date): Slot[] {
  const h = d.getHours();
  const weekday = d.getDay() >= 1 && d.getDay() <= 5;
  if (h < 5 || h >= 21) return ['night'];
  if (h < 9) return ['morning'];
  if (h < 17) return weekday ? ['workday', 'day'] : ['day', 'workday'];
  return ['evening'];
}

/** The five quick plays on the face, in this order, each with the word its tile shows. */
export const FACE_TILES = [
  { slot: 'morning', label: 'Morning' },
  { slot: 'day', label: 'Day' },
  { slot: 'evening', label: 'Evening' },
  { slot: 'night', label: 'Late night' },
  { slot: 'workday', label: 'Workday' },
] as const satisfies readonly { slot: Slot; label: string }[];

/** A routine's name for matching: lower case, "_" read as a space, runs of spaces as one. */
function plain(name: string): string {
  return name.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Each tile's own test of a routine name, by whole words: a letter or digit next to the
 * word breaks the match, a hyphen or space does not ("Day-Mix" is Day, "Morning1" is not
 * Morning). Day has explicit non-matches: "Workday" and "Work day" (those are Workday),
 * "Mid-day", "Midday", "Daytime" and "Day-time"; "Someday" and "Sunday" fail on the letter
 * before. Late night may be "late night", "late-night" or "latenight".
 */
const WORDS: Record<Slot, RegExp> = {
  morning: /(?<![a-z0-9])morning(?![a-z0-9])/,
  day: /(?<![a-z0-9])(?<!work[ -])(?<!mid-)day(?![a-z0-9])(?!-time)/,
  evening: /(?<![a-z0-9])evening(?![a-z0-9])/,
  night: /(?<![a-z0-9])late[ -]?night(?![a-z0-9])/,
  workday: /(?<![a-z0-9])work[ -]?day(?![a-z0-9])/,
};

/** True when the name carries the tile's word. */
export function tileMatches(slot: Slot, name: string): boolean {
  return WORDS[slot].test(plain(name));
}

export interface FaceTile {
  label: string;
  slot: Slot;
  routine: MusicRoutine;
}

/** Routine order for ties: by name (case-insensitive), then by key. */
function byName(a: MusicRoutine, b: MusicRoutine): number {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * The face's quick plays. In tile order, each tile takes the first routine, sorted by name,
 * that carries its own word and is not already on an earlier tile ("Morning workday" can
 * be Morning, and Workday then looks further). A word with no routine has no tile.
 */
export function faceTiles(music: readonly MusicRoutine[]): FaceTile[] {
  const sorted = [...music].sort(byName);
  const used = new Set<string>();
  const out: FaceTile[] = [];
  for (const t of FACE_TILES) {
    const routine = sorted.find((r) => !used.has(r.key) && tileMatches(t.slot, r.name));
    if (routine) {
      used.add(routine.key);
      out.push({ label: t.label, slot: t.slot, routine });
    }
  }
  return out;
}

/** The routines left for More: every music routine that is not on the face. */
export function moreRoutines(music: readonly MusicRoutine[], tiles: readonly FaceTile[]): MusicRoutine[] {
  const on = new Set(tiles.map((t) => t.routine.key));
  return music.filter((r) => !on.has(r.key));
}

/** The controls More lists: "Group all" is not offered, and Pause all has its own button. */
export function moreControls(controls: readonly ControlRoutine[]): ControlRoutine[] {
  return controls.filter((c) => c.action !== 'pauseAll' && c.action !== 'groupAll');
}

/** One of the three places the Where switch offers. */
export interface WherePlace {
  label: string;
  preset: SonosPreset;
}

/** The three Where choices: the words a preset's name starts with, and the label shown,
 * always exactly these (the owner's names), whatever else the preset's name says. */
const WHERE_WORDS: readonly { re: RegExp; label: string }[] = [
  { re: /^office\b/i, label: 'Office' },
  { re: /^all\s+speakers\b/i, label: 'All speakers' },
  { re: /^common\s+areas?\b/i, label: 'Common areas' },
];

/** "Office (Work)" reads "Office". */
export function whereLabel(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() || name;
}

/** Office, All speakers, Common areas, in that order: the presets whose names start so,
 * labelled with exactly those words (the preset's own id goes to the command). */
export function wherePlaces(presets: readonly SonosPreset[]): WherePlace[] {
  const out: WherePlace[] = [];
  for (const { re, label } of WHERE_WORDS) {
    const preset = [...presets].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id)).find((p) => re.test(p.name.trim()));
    if (preset) out.push({ label, preset });
  }
  return out;
}

/** The routine marked as the hour's suggestion: the first of the hour's slots that has a tile. */
export function suggestedKey(music: readonly MusicRoutine[], d: Date): string | null {
  const tiles = faceTiles(music);
  for (const slot of slotsFor(d)) {
    const hit = tiles.find((t) => t.slot === slot);
    if (hit) return hit.routine.key;
  }
  return null;
}

/** The preset whose name starts with "Office" first, the rest in the service's order. */
export function orderPresets(presets: readonly SonosPreset[]): SonosPreset[] {
  const i = presets.findIndex((p) => /^office/i.test(p.name.trim()));
  if (i <= 0) return [...presets];
  return [presets[i], ...presets.slice(0, i), ...presets.slice(i + 1)];
}

export function speakerByName(s: SonosSummary, name: string): SonosSpeaker | undefined {
  return s.speakers.find((sp) => sp.name === name);
}

/** The speakers the group slider moves: online and not on line-in (that is the PC's sound). */
export function groupMusicSpeakers(s: SonosSummary, groupId: string | null): SonosSpeaker[] {
  const g = s.groups.find((x) => x.id === groupId);
  if (!g) return [];
  return g.members
    .map((m) => speakerByName(s, m))
    .filter((sp): sp is SonosSpeaker => !!sp && sp.online && sp.input !== 'lineIn');
}

/** The group speakers a step really moves: those with a level reading (see `groupTargets`). */
export function groupMovers(s: SonosSummary, groupId: string | null): SonosSpeaker[] {
  return groupMusicSpeakers(s, groupId).filter((sp) => typeof sp.volume === 'number');
}

/** "3 of 4 speakers changed" when a step leaves a music speaker out for want of a level; else "". */
export function leftOutNote(s: SonosSummary, groupId: string | null): string {
  const all = groupMusicSpeakers(s, groupId).length;
  const moved = groupMovers(s, groupId).length;
  return moved < all ? `${moved} of ${all} speakers changed` : '';
}

/** The group slider's value: the rounded mean of its speakers; null with none known. */
export function groupVolume(s: SonosSummary): number | null {
  const vols = groupMusicSpeakers(s, s.currentGroup)
    .map((sp) => sp.volume)
    .filter((v): v is number => typeof v === 'number');
  if (vols.length === 0) return null;
  return Math.round(vols.reduce((a, b) => a + b, 0) / vols.length);
}

/** "Den and 4 more" for a group of five, the name alone for one. */
export function groupLabel(s: SonosSummary): string | null {
  const sps = groupMovers(s, s.currentGroup);
  if (sps.length === 0) return null;
  const g = s.groups.find((x) => x.id === s.currentGroup)!;
  const lead = sps.some((sp) => sp.name === g.coordinator) ? g.coordinator : sps[0].name;
  return sps.length === 1 ? lead : `${lead} and ${sps.length - 1} more`;
}

/** Any target level above 40 asks first, whatever the last read said the speaker is at. */
export function needsConfirm(levels: readonly number[]): boolean {
  return levels.some((l) => l > SAFE_VOLUME);
}

/** Where a group step puts each music speaker with a known level (clamped 0 to 100). */
export function groupTargets(s: SonosSummary, step: number): { name: string; level: number }[] {
  return groupMusicSpeakers(s, s.currentGroup)
    .filter((sp) => typeof sp.volume === 'number')
    .map((sp) => ({ name: sp.name, level: Math.min(100, Math.max(0, (sp.volume as number) + step)) }));
}

/** "Studio is at 100. Group anyway?" from the speakers that make an action ask first. */
export function loudText(list: readonly LoudSpeaker[], verb: string): string {
  const parts = list.map((x) => (x.sets ? `it sets ${x.name} to ${x.level}` : x.level === null ? `${x.name}'s level is not known` : `${x.name} is at ${x.level}`));
  const text = parts.join('; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}. ${verb} anyway?`;
}

/** The running sleep timer that ends soonest; one that ended over a minute ago is gone. */
export function soonestTimer(timers: readonly SleepTimer[], now: number): SleepTimer | null {
  const live = timers.filter((t) => typeof t.endsAtMs !== 'number' || t.endsAtMs >= now - 60_000);
  live.sort((a, b) => (a.endsAtMs ?? Infinity) - (b.endsAtMs ?? Infinity));
  return live[0] ?? null;
}

const STATE_WORD: Record<SpeakerState, string> = {
  playing: 'Playing',
  paused: 'Paused',
  stopped: 'Stopped',
  transitioning: 'Starting',
  offline: 'Offline',
  unknown: 'No status',
};

/** A speaker's line in the Speakers list: "Playing", "Paused", "Offline". */
export function speakerState(sp: SonosSpeaker): string {
  return STATE_WORD[sp.state] ?? 'No status';
}

/** "PC audio" for line-in, "TV" for a TV input, null otherwise. */
export function inputWord(sp: SonosSpeaker): string | null {
  if (sp.input === 'lineIn') return 'PC audio';
  if (sp.input === 'tv') return 'TV';
  return null;
}

/** Speakers playing music (not an input). */
export function musicPlaying(s: SonosSummary): SonosSpeaker[] {
  return s.speakers.filter((sp) => sp.state === 'playing' && sp.input === null);
}

/** The line beside "Where": what plays and where, or that nothing does. */
export function nowLine(s: SonosSummary): string {
  const on = musicPlaying(s);
  const np = s.nowPlaying;
  const track = np?.track ? [np.track, np.artist].filter(Boolean).join(', ') : null;
  if (on.length === 0) return 'Nothing playing';
  const where = on.length === 1 ? `on ${on[0].name}` : `on ${on.length} speakers`;
  return track ? `${track}, ${where}` : `Playing ${where}`;
}

/** Minutes left on a sleep timer, never below zero; null when its end is unknown. */
export function sleepLeft(t: SleepTimer, now: number): number | null {
  if (typeof t.endsAtMs !== 'number') return null;
  return Math.max(0, Math.ceil((t.endsAtMs - now) / 60_000));
}

/** "started just now", "started 5 min ago", "started 2 h ago". */
export function startedText(at: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - at) / 60_000));
  if (mins < 1) return 'started just now';
  if (mins < 60) return `started ${mins} min ago`;
  return `started ${Math.floor(mins / 60)} h ago`;
}

/** "3 min ago" for the dimmed block's age line. */
export function ageWords(at: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - at) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} h ago`;
}

/**
 * The "started N min ago" mark: which routine, when, and once a read has shown the music,
 * which group played it (`seen`).
 */
export interface PlayMark {
  key: string;
  at: number;
  group: string | null;
  seen: boolean;
}

/**
 * The mark after a read, or null to clear it for good. It stays only while what plays is
 * evidently what the wall started: past 60 minutes it goes; a read with nothing playing
 * clears it (except the first reads within 20 seconds of the start, before the music
 * shows); an unseen mark older than that grace clears whatever plays; the first read that shows music records its group, and a later read with a
 * different group, or no group to tell by, clears it.
 */
export function markAfterRead(mark: PlayMark | null, s: SonosSummary, now: number): PlayMark | null {
  if (!mark) return null;
  if (now - mark.at > LAST_PLAY_MS || now < mark.at - 60_000) return null;
  const playing = musicPlaying(s).length > 0;
  // A mark never seen playing and older than the grace is stale (an app restart long after
  // the start), even when something plays now: it must not attach to that.
  if (!mark.seen && now - mark.at >= START_GRACE_MS) return null;
  if (!playing) return !mark.seen ? mark : null;
  if (!s.currentGroup) return null;
  if (!mark.seen) return { ...mark, group: s.currentGroup, seen: true };
  return mark.group === s.currentGroup ? mark : null;
}

export function readLastPlay(): PlayMark | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_PLAY_KEY) ?? 'null') as Partial<PlayMark> | null;
    if (raw && typeof raw.key === 'string' && typeof raw.at === 'number') {
      return { key: raw.key, at: raw.at, group: typeof raw.group === 'string' ? raw.group : null, seen: raw.seen === true };
    }
  } catch {
    /* storage can be blocked */
  }
  return null;
}

/** Saves the mark, or clears the stored one for null. */
export function writeLastPlay(mark: PlayMark | null): void {
  try {
    if (mark) localStorage.setItem(LAST_PLAY_KEY, JSON.stringify(mark));
    else localStorage.removeItem(LAST_PLAY_KEY);
  } catch {
    /* storage can be blocked; the mark is a convenience */
  }
}

// Section: home round two (play art, now playing at the left)

/** Each play's colour (as `r,g,b` for the wash) and its line icon, as drawn (art A). */
export const PLAY_ART: Record<Slot, { rgb: string; icon: 'cup' | 'headphones' | 'lamp' | 'moon' | 'laptop' }> = {
  morning: { rgb: '255,194,77', icon: 'cup' },
  day: { rgb: '53,230,234', icon: 'headphones' },
  evening: { rgb: '255,61,154', icon: 'lamp' },
  night: { rgb: '154,123,255', icon: 'moon' },
  workday: { rgb: '93,242,182', icon: 'laptop' },
};

/** The Spotify playback read, as `wall/src/music/spotify.ts` types it (fields this block uses). */
export interface PlaybackRead {
  playing: boolean;
  device: { name: string; kind: string } | null;
  track: { name: string; artists: string; durationMs: number; imageUrl: string | null; thumbUrl: string | null } | null;
  progressMs: number;
}

export interface HouseTrack {
  title: string;
  artist: string;
  cover: string | null;
  /** "Den, 4 speakers": the speaker Spotify names and how many play in its group. */
  where: string;
  progressMs: number;
  durationMs: number;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What Spotify plays, only when it plays on a house speaker: its device name is a Sonos
 * speaker (or a group's lead) that the Sonos read shows playing. A track on this PC, or on a
 * speaker the Sonos read shows quiet, is never shown as the house playing.
 */
export function houseTrack(p: PlaybackRead | null, s: SonosSummary): HouseTrack | null {
  if (!p || !p.playing || !p.device || !p.track) return null;
  if (/^computer$/i.test(p.device.kind)) return null;
  const name = p.device.name;
  const group = s.groups.find((g) => same(g.coordinator, name) || g.members.some((m) => same(m, name)));
  const members = group ? group.members.map((m) => speakerByName(s, m)).filter((sp): sp is SonosSpeaker => !!sp) : s.speakers.filter((sp) => same(sp.name, name));
  if (members.length === 0) return null;
  const on = members.filter((sp) => sp.online && sp.state === 'playing' && sp.input === null);
  if (on.length === 0) return null;
  const lead = members.find((sp) => same(sp.name, name))?.name ?? name;
  return {
    title: p.track.name,
    artist: p.track.artists,
    cover: p.track.thumbUrl ?? p.track.imageUrl,
    where: on.length === 1 ? lead : `${lead}, ${on.length} speakers`,
    progressMs: Math.max(0, p.progressMs),
    durationMs: Math.max(0, p.track.durationMs),
  };
}

/** "1:22" for a progress time. */
export function clockMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Office, 4 speakers" for what plays without a track (the Sonos read alone). */
export function playingWhere(s: SonosSummary): string | null {
  const on = musicPlaying(s);
  if (on.length === 0) return null;
  const g = s.groups.find((x) => x.id === s.currentGroup);
  const lead = g && on.some((sp) => sp.name === g.coordinator) ? g.coordinator : on[0].name;
  return on.length === 1 ? lead : `${lead}, ${on.length} speakers`;
}
