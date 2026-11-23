import { TEXT, type HomeState } from './homeStore';
import type { Group, GroupId, HomeWord, Preset, Studio } from './home';

/** What a Needs-a-zone group says in its `setTo` (the home app's words). */
export const NEEDS_ZONE = 'Needs a Hue zone';

export const ZONE_TIP = 'The home app needs a Hue zone for this light group. Its README says how.';
export const DARK_TIP = 'One room light stays on so the room is never dark around the monitor';

export const ABSENT_LINE = 'Presets and room lights: the home app does not offer them here yet.';
export const DOWN_LINE = 'The home app is not answering';
export const NOT_SET_UP_LINE = "These lights are view only here. To switch them from the wall, add the home app's desk token in Tools.";
export const PRIVATE_LINE = 'The home app must be reached on this PC or the tailnet to take changes.';
export const PRIVATE_TIP = 'The home app address is not this PC or a tailnet address, so the wall will not send its desk token there. Use a loopback or tailnet address for homeBaseUrl in feeds.json, then Check again.';
export const CHANGED_TIP =
  "The wall can see changes made from its own controls and from the office switch's brighter, dimmer and preset buttons. It cannot see changes made in the Hue app, by a voice assistant or in HomeKit.";
export const STALE_TIP = 'The home app could not read every light just now';

/** The preset that is on, if any. */
export const activePreset = (s: Studio | null): Preset | null => s?.presets.find((p) => p.active) ?? null;

/** The words on the active preset's chip: "On air, changed" while the home app says it changed. */
export const presetChipLabel = (p: Preset, changed: boolean): string => (p.active && changed ? `${p.label}, changed` : p.label);

/** The Work and Meet chip words for a preset that is on. */
export const chipPresetWord = (p: Preset | null, changed: boolean): string | null => (p ? `Lights: ${presetChipLabel(p, changed)}` : null);

export const NORMAL_LIT_TIP = 'Normal: the room is on its regular routines.';

/**
 * The name of the preset that is held: the one the row shows as on, else the name the home app puts in its Back to
 * normal line for a switch preset such as Gaming ("Room back to how it was before Gaming, key lights off"), else null.
 */
export function heldName(studio: Studio): string | null {
  const p = activePreset(studio);
  if (p) return p.label;
  const m = /^Room back to how it was before (.+), key lights off$/.exec(studio.normalLine ?? '');
  return m ? m[1]! : null;
}

/** The Normal chip: lit while nothing is held (the home app says there is nothing to end). A read that failed lights nothing. */
export function normalState(studio: Studio, usable: boolean, heldName: string | null): { lit: boolean; tip: string } {
  const lit = usable && !studio.canNormal;
  if (lit) return { lit, tip: NORMAL_LIT_TIP };
  return { lit, tip: `Normal: ends ${heldName ?? 'the held preset'}, and the room goes back to its regular routines.` };
}

export interface SummaryParts {
  /** Bold lead-in ("On air:", "Normal:"), then the plain rest. */
  lead: string;
  rest: string;
  /** The whole line for a tip, since the line itself is one line and may be cut. */
  full: string;
}

/**
 * The summary line when a preset is on ("<label>: <line>"), or when none is ("Normal: regular routines." then the key
 * light words already built). `changed` says only that something changed since it was set.
 */
export function summaryParts(studio: Studio, keyWords: string): SummaryParts {
  const p = activePreset(studio);
  if (!p && studio.canNormal) {
    const n = heldName(studio);
    const lead = n ? `${n}.` : 'A preset is on.';
    return { lead, rest: keyWords ? ` ${keyWords}` : '', full: `${lead}${keyWords ? ` ${keyWords}` : ''}` };
  }
  if (!p) return { lead: 'Normal:', rest: ` regular routines.${keyWords ? ` ${keyWords}` : ''}`, full: `Normal: regular routines.${keyWords ? ` ${keyWords}` : ''}` };
  if (studio.changed) return { lead: `${p.label}, changed`, rest: ' since it was set', full: `${p.label}, changed since it was set` };
  return { lead: `${p.label}:`, rest: p.line ? ` ${p.line}` : '', full: `${p.label}${p.line ? `: ${p.line}` : ''}` };
}

/** The other room light group: Behind monitor and Overhead keep one on. */
const OTHER: Partial<Record<GroupId, GroupId>> = { behindMonitor: 'overhead', overhead: 'behindMonitor' };

export function needsZone(g: Group): boolean {
  return !g.canSwitch || g.setTo === NEEDS_ZONE;
}

/** Turning this room light off would leave both room lights off: the wall does not send it. */
export function wouldBeDark(studio: Studio, g: Group): boolean {
  const other = OTHER[g.id];
  if (!other || !g.on) return false;
  const o = studio.groups.find((x) => x.id === other);
  // The other one off, or not there to ask: the home app would answer "Room would be dark" too.
  return !o || !o.on;
}

/**
 * What a failed studio read says, by its word. Only an unreachable home app is "not answering"; a light that
 * did not answer, a busy home app and an unreadable answer each get their own words.
 */
export function awayWords(word: HomeWord | null): { head: string; text: string; tip: string } {
  switch (word) {
    case 'not-answering':
      return { head: 'A light did not answer the home app.', text: 'The switch waits for the next read.', tip: 'a light did not answer the home app. The switch waits for the next read' };
    case 'busy':
      return { head: 'The home app is busy.', text: 'The switch waits for the next read.', tip: 'the home app is busy. The switch waits for the next read' };
    case 'failed':
      return { head: 'The home app sent an answer the wall could not read.', text: 'Nothing here can be changed until it does.', tip: 'the home app sent an answer the wall could not read' };
    case 'unreachable':
      return { head: 'The home app is not answering.', text: 'Nothing here can be changed until it does.', tip: 'the home app is not answering' };
    default:
      return { head: 'The home app could not be read.', text: 'Nothing here can be changed until it can.', tip: 'the home app could not be read' };
  }
}

/** Words that mean a read was tried and failed. Absent or configuration words are not here: the tile keeps its own specific tip. */
const FAILED_READ_WORDS: readonly HomeWord[] = ['not-answering', 'busy', 'failed', 'unreachable', 'unknown'];
export const isFailedRead = (word: HomeWord | null): boolean => word !== null && FAILED_READ_WORDS.includes(word);

/** The tile's state in one place: whether a click does anything, and what its tip says. */
export function tileState(studio: Studio, g: Group, canWrite: boolean): { disabled: boolean; dim: boolean; tip: string } {
  if (needsZone(g)) return { disabled: true, dim: true, tip: ZONE_TIP };
  const where = g.setTo ? `${g.label}: ${g.setTo}.` : `${g.label}.`;
  if (!g.reachable) return { disabled: !canWrite, dim: true, tip: `${where} Not answering: this is the last state the home app knew.` };
  if (!canWrite) return { disabled: true, dim: false, tip: `${where} To switch it from the wall, add the home app's desk token in Tools.` };
  if (wouldBeDark(studio, g)) return { disabled: true, dim: false, tip: `${where} ${DARK_TIP}.` };
  return { disabled: false, dim: false, tip: `${where} Click to turn it ${g.on ? 'off' : 'on'}.` };
}

/** What replaces the preset row and tiles when there is nothing to offer or the home app is away. */
export type HomeLine = { text: string; tone: 'plain' | 'amber'; action: 'checkAgain' | 'tryAgain' | 'openTools' | null; tip: string } | null;

/** The one line for the summary slot while the home part is not usable, or null when the studio summary shows. */
export function homeLine(s: Pick<HomeState, 'studio' | 'readWord' | 'readDone' | 'sticky' | 'note'>): HomeLine {
  if (s.note) return { text: s.note, tone: 'amber', action: null, tip: s.note };
  if (s.sticky === 'home-not-set-up') return { text: TEXT.homeNotSetUp, tone: 'amber', action: 'tryAgain', tip: TEXT.homeNotSetUp };
  if (s.sticky === 'forbidden') return { text: TEXT.forbidden, tone: 'amber', action: 'openTools', tip: TEXT.forbidden };
  return null;
}
