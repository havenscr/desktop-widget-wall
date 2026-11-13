import type { Chatty } from './chatter';

/**
 * Watt's little life, kept on this PC only (`localStorage`): how chatty she is, which cosmetic she
 * wears, the days she has been here, and today's counts. Nothing here can make her sad, hungry or
 * gone: the counts only colour her mood and her hover card.
 */
export type Mood = 'content' | 'happy' | 'sleepy' | 'curious';

/** Cosmetics, unlocked by days together. `none` is always there. */
export type Cosmetic = 'none' | 'bow' | 'star' | 'cape';
export const COSMETICS: readonly Cosmetic[] = ['none', 'bow', 'star', 'cape'];
/** Days together each cosmetic needs. */
export const UNLOCK_DAYS: Readonly<Record<Cosmetic, number>> = { none: 0, bow: 1, star: 3, cape: 7 };

export interface Today {
  /** Local date, `YYYY-MM-DD`. */
  date: string;
  pets: number;
  songs: number;
  naps: number;
  clovers: number;
  focus: number;
  /** Agents she saw finish. */
  agents: number;
  /** Clovers grown today (at most two; one when the wall starts after the second time). */
  grown: number;
}

/** The places Watt can be told to stay on. */
export const STAY_PLACES = ['work', 'home', 'meet', 'unwind'] as const;
export type StayPlace = (typeof STAY_PLACES)[number];
/** Where he was told to stay: the place, the left edge x on the stage and the local date it was set. */
export interface Stay {
  place: StayPlace;
  x: number;
  date: string;
}
/** The widest stage x a stored Stay may name. */
export const MAX_STAY_X = 2560;

export interface PetData {
  chatty: Chatty;
  cosmetic: Cosmetic;
  /** Distinct days she has been on the wall. */
  days: number;
  /** The last local date counted in `days`. */
  lastDay: string | null;
  today: Today;
  /** The Stay trick: kept until switched off, a place change or the day ends. */
  stay: Stay | null;
}

export const PET_KEY = 'wall2.watt';

export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function emptyToday(date: string): Today {
  return { date, pets: 0, songs: 0, naps: 0, clovers: 0, focus: 0, agents: 0, grown: 0 };
}

export function defaultPet(now: number): PetData {
  return { chatty: 'sometimes', cosmetic: 'none', days: 0, lastDay: null, today: emptyToday(dayKey(now)), stay: null };
}

/** A stored value longer than this is not ours: ignored before it is parsed. */
export const MAX_RAW = 4096;
/** Upper bounds for the counts and the days together. */
export const MAX_COUNT = 9999;
export const MAX_DAYS = 36500;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const count = (v: unknown, max = MAX_COUNT) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.floor(v)) : 0);
const date = (v: unknown): string | null => (typeof v === 'string' && DATE.test(v) ? v : null);

/**
 * Read the stored data, falling back to the defaults for anything missing, malformed, oversized
 * or out of range. A worn cosmetic that is not unlocked yet is taken off.
 */
export function parsePet(raw: string | null, now: number): PetData {
  const base = defaultPet(now);
  if (!raw || raw.length > MAX_RAW) return base;
  try {
    const v = JSON.parse(raw) as Partial<PetData> & { today?: Partial<Today> };
    if (!v || typeof v !== 'object') return base;
    const chatty: Chatty = v.chatty === 'off' || v.chatty === 'chatty' ? v.chatty : 'sometimes';
    const days = count(v.days, MAX_DAYS);
    const worn = COSMETICS.includes(v.cosmetic as Cosmetic) ? (v.cosmetic as Cosmetic) : 'none';
    const cosmetic: Cosmetic = unlocked(worn, days) ? worn : 'none';
    const t: Partial<Today> = v.today && typeof v.today === 'object' ? v.today : {};
    // A stored date later than today means the clock was wrong when it was written: it is reset to
    // today (the days are kept), so the count cannot stall until the calendar catches up.
    const key = dayKey(now);
    const tDate0 = date(t.date);
    const tDate = tDate0 !== null && tDate0 <= key ? tDate0 : null;
    const lastDay0 = date(v.lastDay);
    const lastDay = lastDay0 !== null && lastDay0 > key ? key : lastDay0;
    const today: Today = tDate
      ? { date: tDate, pets: count(t.pets), songs: count(t.songs), naps: count(t.naps), clovers: count(t.clovers), focus: count(t.focus), agents: count(t.agents), grown: count(t.grown, 2) }
      : base.today;
    // A Stay is kept only when it is whole: a known place, an x on the stage, today's date.
    const sv = (v as { stay?: unknown }).stay as Partial<Stay> | null | undefined;
    const stay: Stay | null =
      sv && typeof sv === 'object' && STAY_PLACES.includes(sv.place as StayPlace) && typeof sv.x === 'number' && Number.isFinite(sv.x) && sv.x >= 0 && sv.x <= MAX_STAY_X && date(sv.date) === key
        ? { place: sv.place as StayPlace, x: sv.x, date: key }
        : null;
    return { chatty, cosmetic, days, lastDay, today, stay };
  } catch {
    return base;
  }
}

export function loadPet(now: number): PetData {
  try {
    return parsePet(window.localStorage.getItem(PET_KEY), now);
  } catch {
    return defaultPet(now);
  }
}

export function savePet(d: PetData): void {
  try {
    window.localStorage.setItem(PET_KEY, JSON.stringify(d));
  } catch {
    /* storage blocked: she simply forgets */
  }
}

/**
 * Count today: a local date later than any seen before adds one day together and starts today's
 * counts afresh. A date that is not later (the clock or the time zone stepped back) changes
 * nothing, so stepping back and forward again adds no days and wipes nothing.
 */
export function rollDay(d: PetData, now: number): PetData {
  const key = dayKey(now);
  let next = d;
  if (d.lastDay === null || key > d.lastDay) next = { ...next, days: Math.min(MAX_DAYS, next.days + 1), lastDay: key };
  if (key > next.today.date) next = { ...next, today: emptyToday(key) };
  return next;
}

/** Add one to a count for today. */
export function bump(d: PetData, what: Exclude<keyof Today, 'date'>, now: number): PetData {
  const r = rollDay(d, now);
  return { ...r, today: { ...r.today, [what]: Math.min(MAX_COUNT, r.today[what] + 1) } };
}

export function unlocked(c: Cosmetic, days: number): boolean {
  return days >= UNLOCK_DAYS[c];
}

/** What feeds the mood. */
export interface MoodInput {
  /** Local hour and minute. */
  hour: number;
  minute: number;
  today: Today;
  playing: boolean;
  /** Clear or mostly clear weather from a fresh reading. */
  goodWeather: boolean;
  /** Something new to look at: an ask waiting, a call soon, a clover on the ground. */
  novelty: boolean;
}

/**
 * Her mood, one word. Late evening (from 8:30 PM) and the first half hour after waking make her
 * sleepy; something new makes her curious; music, pets, finished focus and good weather add up to
 * happy; otherwise content. It never goes lower than content.
 */
export function moodOf(m: MoodInput): Mood {
  const mins = m.hour * 60 + m.minute;
  if (mins >= 20 * 60 + 30 || mins < 7 * 60) return 'sleepy';
  if (m.novelty) return 'curious';
  const lift = (m.playing ? 1 : 0) + Math.min(2, m.today.pets) + Math.min(2, m.today.focus) + (m.goodWeather ? 1 : 0) + Math.min(1, m.today.clovers);
  return lift >= 3 ? 'happy' : 'content';
}

const NUM = ['no', 'once', 'twice', 'three times', 'four times', 'five times'];
const num = (n: number) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] ?? String(n);
const times = (n: number) => NUM[n] ?? `${n} times`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Two honest lines about today for the hover card, from the counts that are not zero ("Napped
 * twice.", "Danced to nine songs."). Fewer counts give fewer lines; none gives a quiet line.
 */
export function todayLines(t: Today): string[] {
  const out: string[] = [];
  if (t.songs > 0) out.push(`Danced to ${num(t.songs)} song${t.songs === 1 ? '' : 's'}.`);
  if (t.focus > 0) out.push(`Read through ${num(t.focus)} focus session${t.focus === 1 ? '' : 's'}.`);
  if (t.pets > 0) out.push(`Petted ${times(t.pets)}.`);
  if (t.naps > 0) out.push(`Napped ${times(t.naps)}.`);
  if (t.clovers > 0) out.push(`Ate ${num(t.clovers)} clover${t.clovers === 1 ? '' : 's'}.`);
  if (t.agents > 0) out.push(`Watched ${num(t.agents)} agent${t.agents === 1 ? '' : 's'} finish.`);
  if (out.length === 0) return ['Quiet day so far.'];
  return out.slice(0, 2).map(cap);
}

export const MOOD_WORD: Readonly<Record<Mood, string>> = { content: 'Content', happy: 'Happy', sleepy: 'Sleepy', curious: 'Curious' };
