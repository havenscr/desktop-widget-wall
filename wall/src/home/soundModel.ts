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

export interface SonosPreset {
  id: string;
  name: string;
  /** The speakers are grouped the way this preset groups them right now. */
  active: boolean;
  /** Applying it sets a speaker above 40 (not counting line-in), so it asks first. */
  loud: boolean;
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
/** Older than this, the block dims and writes stop (Rust's own limit is ten minutes). */
export const STALE_MS = 2 * 60_000;
export const SLEEP_CHOICES = [30, 60, 90] as const;
/** The last routine started from the wall: `{"key":"...","at":<ms>}`. */
export const LAST_PLAY_KEY = 'wall2-sonos-last-play';
/** How long "started N min ago" stays on the routine started last. */
export const LAST_PLAY_MS = 3 * 3_600_000;

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

/** Would setting these speakers to `level` raise any of them above 40? Then ask first. */
export function needsConfirm(speakers: readonly SonosSpeaker[], level: number): boolean {
  return level > SAFE_VOLUME && speakers.some((sp) => (sp.volume ?? 0) < level);
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

export function readLastPlay(): { key: string; at: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_PLAY_KEY) ?? 'null') as unknown;
    if (raw && typeof raw === 'object' && typeof (raw as { key?: unknown }).key === 'string' && typeof (raw as { at?: unknown }).at === 'number') {
      return raw as { key: string; at: number };
    }
  } catch {
    /* storage can be blocked */
  }
  return null;
}

export function writeLastPlay(key: string, at: number): void {
  try {
    localStorage.setItem(LAST_PLAY_KEY, JSON.stringify({ key, at }));
  } catch {
    /* storage can be blocked; the mark is a convenience */
  }
}
