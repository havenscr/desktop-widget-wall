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

/** The routine marked as the hour's suggestion: the face's first, then "More". */
export function suggestedKey(music: readonly MusicRoutine[], d: Date): string | null {
  for (const slot of slotsFor(d)) {
    const hit = music.find((r) => routineSlot(r.name) === slot);
    if (hit) return hit.key;
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
  const sps = groupMusicSpeakers(s, s.currentGroup);
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
 * shows); the first read that shows music records its group, and a later read with a
 * different group, or no group to tell by, clears it.
 */
export function markAfterRead(mark: PlayMark | null, s: SonosSummary, now: number): PlayMark | null {
  if (!mark) return null;
  if (now - mark.at > LAST_PLAY_MS || now < mark.at - 60_000) return null;
  const playing = musicPlaying(s).length > 0;
  if (!playing) return !mark.seen && now - mark.at < START_GRACE_MS ? mark : null;
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
