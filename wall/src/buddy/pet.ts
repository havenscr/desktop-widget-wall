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
}

export interface PetData {
  chatty: Chatty;
  cosmetic: Cosmetic;
  /** Distinct days she has been on the wall. */
  days: number;
  /** The last local date counted in `days`. */
  lastDay: string | null;
  today: Today;
}

export const PET_KEY = 'wall2.watt';

export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function emptyToday(date: string): Today {
  return { date, pets: 0, songs: 0, naps: 0, clovers: 0, focus: 0, agents: 0 };
}

export function defaultPet(now: number): PetData {
  return { chatty: 'sometimes', cosmetic: 'none', days: 0, lastDay: null, today: emptyToday(dayKey(now)) };
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Read the stored data, falling back to the defaults for anything missing or malformed. */
export function parsePet(raw: string | null, now: number): PetData {
  const base = defaultPet(now);
  if (!raw) return base;
  try {
    const v = JSON.parse(raw) as Partial<PetData> & { today?: Partial<Today> };
    const chatty: Chatty = v.chatty === 'off' || v.chatty === 'chatty' ? v.chatty : 'sometimes';
    const cosmetic: Cosmetic = COSMETICS.includes(v.cosmetic as Cosmetic) ? (v.cosmetic as Cosmetic) : 'none';
    const t: Partial<Today> = v.today ?? {};
    const today: Today =
      typeof t.date === 'string'
        ? { date: t.date, pets: count(t.pets), songs: count(t.songs), naps: count(t.naps), clovers: count(t.clovers), focus: count(t.focus), agents: count(t.agents) }
        : base.today;
    return { chatty, cosmetic, days: count(v.days), lastDay: typeof v.lastDay === 'string' ? v.lastDay : null, today };
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

/** Count today (a new day starts today's counts afresh and adds one to the days together). */
export function rollDay(d: PetData, now: number): PetData {
  const key = dayKey(now);
  let next = d;
  if (d.lastDay !== key) next = { ...next, days: next.days + 1, lastDay: key };
  if (next.today.date !== key) next = { ...next, today: emptyToday(key) };
  return next;
}

/** Add one to a count for today. */
export function bump(d: PetData, what: Exclude<keyof Today, 'date'>, now: number): PetData {
  const r = rollDay(d, now);
  return { ...r, today: { ...r.today, [what]: r.today[what] + 1 } };
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
