import { isLight, type Light, type Reading, type Side, type Word } from './keyLights';

/** What the page knows about the two lights. A side not read yet is null. */
export interface Snapshot {
  /** Which sides have a saved address; null until the first answer, `failed` when it could not be asked. */
  status: { left: boolean; right: boolean; unreadable?: boolean } | null | 'failed';
  left: Reading | null;
  right: Reading | null;
}

/**
 * - `checking`: nothing answered yet
 * - `unavailable`: the setup could not be read at all (not the native app)
 * - `unset`: no address saved for either light
 * - `live`: both lights answered
 * - `one`: one light answered, the other did not (or is not set up)
 * - `none`: neither light answered
 */
export type View = 'checking' | 'unavailable' | 'unset' | 'live' | 'one' | 'none';

export const SIDES: readonly Side[] = ['left', 'right'];

/** A side's reading, with a side that has no saved address read as `not-set-up`. */
export function sideReading(s: Snapshot, side: Side): Reading | null {
  if (s.status === 'failed' || s.status === null) return s[side];
  if (!s.status[side]) return 'not-set-up';
  return s[side];
}

export function viewOf(s: Snapshot): View {
  if (s.status === 'failed') return 'unavailable';
  if (s.status === null) return 'checking';
  if (!s.status.left && !s.status.right) return 'unset';
  const r = SIDES.map((side) => sideReading(s, side));
  const lights = r.filter(isLight).length;
  if (lights === 2) return 'live';
  if (r.some((x) => x === null)) return lights === 1 ? 'one' : 'checking';
  return lights === 1 ? 'one' : 'none';
}

/** The sides that answered, with their state. */
export function working(s: Snapshot): { side: Side; light: Light }[] {
  const out: { side: Side; light: Light }[] = [];
  for (const side of SIDES) {
    const r = sideReading(s, side);
    if (isLight(r)) out.push({ side, light: r });
  }
  return out;
}

/** The word a side is down with, or null when it answered or has not been read yet. */
export function downWord(s: Snapshot, side: Side): Word | null {
  const r = sideReading(s, side);
  return typeof r === 'string' ? r : null;
}

/** The Key lights switch is on when either answering light is on. */
export const anyOn = (s: Snapshot): boolean => working(s).some((w) => w.light.on);

/** The two answering lights report different brightness or warmth. */
export function mismatched(s: Snapshot): boolean {
  const w = working(s);
  return w.length === 2 && (w[0].light.brightness !== w[1].light.brightness || w[0].light.kelvin !== w[1].light.kelvin);
}

/** The light the Linked sliders show: the left one, else whichever answers. */
export function shown(s: Snapshot): Light | null {
  return working(s)[0]?.light ?? null;
}

/** The brightness the key lights show on a level bar: the mean of the lights that answered, or null with none. */
export function keyLevel(s: Snapshot): number | null {
  const w = working(s);
  return w.length ? Math.round(w.reduce((a, x) => a + x.light.brightness, 0) / w.length) : null;
}

/** The knob colour for a warmth: warm amber under 3600 K, cream to 5200 K, cool white above. */
export function kelvinColour(kelvin: number): string {
  return kelvin < 3600 ? '#ffc98a' : kelvin < 5200 ? '#ffe7c7' : '#e2ecff';
}

const cap = (side: Side) => (side === 'left' ? 'Left' : 'Right');
export const sideName = (side: Side): string => `${cap(side)}`;

/** A word in plain English for a line about one light. */
export function wordLine(side: Side, word: Word): string {
  const who = `The ${side} key light`;
  switch (word) {
    case 'not-set-up':
      return `${who} is not set up`;
    case 'other-model':
      return `${who} answers differently than expected`;
    case 'timeout':
      return `${who} is too slow to answer`;
    default:
      return `${who} is not answering`;
  }
}

/** The sides that have an address saved and do not answer (a side with no address is not one of them). */
export function savedDown(s: Snapshot): { side: Side; word: Word }[] {
  const out: { side: Side; word: Word }[] = [];
  for (const side of SIDES) {
    const w = downWord(s, side);
    if (w !== null && w !== 'not-set-up') out.push({ side, word: w });
  }
  return out;
}

/** Exactly one light is set up and it answers: the other has no address. */
export const singleLight = (s: Snapshot): boolean => working(s).length === 1 && SIDES.some((side) => downWord(s, side) === 'not-set-up');

/** What neither light answering says: the same word on both sides names the cause when it is a known one. */
export function noneTitle(s: Snapshot): string {
  const down = savedDown(s);
  // Only one light is set up and it fails: name it.
  if (down.length === 1) return wordLine(down[0].side, down[0].word);
  const a = downWord(s, 'left');
  const b = downWord(s, 'right');
  if (a === 'other-model' && b === 'other-model') return 'Key lights answer differently than expected';
  return 'Key lights are not answering';
}

/** The one line under the switch: what the lights are doing, or what is wrong with one. Never a claim beyond what they reported. */
export function summaryLine(s: Snapshot): { text: string; tone: 'plain' | 'amber' } {
  const v = viewOf(s);
  if (v === 'checking') return { text: 'Asking the key lights', tone: 'plain' };
  if (v === 'unavailable') return { text: 'Key lights are not available in this build', tone: 'plain' };
  if (v === 'unset') return { text: 'Key lights: type their addresses in Tools', tone: 'plain' };
  if (v === 'none') {
    const down = savedDown(s);
    if (down.length === 1) return { text: `${wordLine(down[0].side, down[0].word)}. Check it is on and on this network.`, tone: 'amber' };
    const other = downWord(s, 'left') === 'other-model' && downWord(s, 'right') === 'other-model';
    return { text: other ? 'Both lights answered, but not in a way the wall knows.' : 'Neither light answered. Check they are on and on this network.', tone: 'amber' };
  }
  const w = working(s);
  if (v === 'one') {
    const down = SIDES.find((side) => downWord(s, side) !== null) ?? 'right';
    // A side with no address is not a fault: it is a setup left to do.
    if (downWord(s, down) === 'not-set-up') return { text: `The ${down} key light is not set up. Add it in Tools.`, tone: 'plain' };
    return { text: `${wordLine(down, downWord(s, down) ?? 'no-answer')}. The other one works.`, tone: 'amber' };
  }
  if (!anyOn(s)) return { text: 'Key lights are off', tone: 'plain' };
  if (mismatched(s)) return { text: `Left ${w[0].light.brightness}%, ${w[0].light.kelvin} K. Right ${w[1].light.brightness}%, ${w[1].light.kelvin} K`, tone: 'plain' };
  return { text: `Key lights ${w[0].light.brightness}%, ${w[0].light.kelvin} K`, tone: 'plain' };
}

/** The Work chip's words, or null when the chip is hidden (the key lights are not set up). */
export function chipWord(s: Snapshot, compact = false): string | null {
  const v = viewOf(s);
  if (v === 'checking' || v === 'unavailable' || v === 'unset') return null;
  const w = working(s);
  // Compact, the chip gives way first when the header is tight: "Lights 60%", "Lights on", "Lights off".
  const head = compact ? 'Lights' : 'Lights: key lights';
  if (w.length === 0) return `${head} not answering`;
  if (!anyOn(s)) return `${head} off`;
  if (w.length === 2 && !mismatched(s)) return `${head} ${w[0].light.brightness}%`;
  return `${head} on`;
}

/** A patch for a slider move: it turns an off light on, as the light's own app does. */
export function withOn<T extends { brightness?: number; kelvin?: number }>(patch: T, targets: { light: Light }[]): T & { on?: boolean } {
  return targets.some((t) => !t.light.on) ? { ...patch, on: true } : patch;
}

/** How far the light's own rounding may sit from what was asked and still count as taken. */
export const BRI_TOLERANCE = 2;
export const KELVIN_TOLERANCE = 100;

/**
 * A write the light accepted but did not take: for some field that was asked for, the read back
 * still equals the value from before the write and is not within the light's rounding of the request.
 * A read back that moved part of the way, or to within rounding of the request, is a success.
 */
export function notTaken(before: Light, asked: { on?: boolean; brightness?: number; kelvin?: number }, after: Light): boolean {
  if (asked.on !== undefined && after.on === before.on && after.on !== asked.on) return true;
  if (asked.brightness !== undefined && after.brightness === before.brightness && Math.abs(after.brightness - asked.brightness) > BRI_TOLERANCE) return true;
  if (asked.kelvin !== undefined && after.kelvin === before.kelvin && Math.abs(after.kelvin - asked.kelvin) > KELVIN_TOLERANCE) return true;
  return false;
}
