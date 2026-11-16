import { TEXT, type HomeState } from './homeStore';
import type { Group, GroupId, Preset, Studio } from './home';

/** What a Needs-a-zone group says in its `setTo` (the home app's words). */
export const NEEDS_ZONE = 'Needs a Hue zone';

export const ZONE_TIP = 'The home app needs a Hue zone for this light group. Its README says how.';
export const DARK_TIP = 'One room light stays on so the room is never dark around the monitor';

export const ABSENT_LINE = 'Presets and room lights: the home app does not offer them here yet.';
export const DOWN_LINE = 'The home app is not answering';
export const NOT_SET_UP_LINE = "To change these, type the home app's desk token in Tools.";
export const PRIVATE_LINE = 'The home app must be reached over https or the tailnet to take changes.';
export const PRIVATE_TIP = 'The home app is reached by a plain http address on the local network, and the wall will not send its desk token that way. Use an https or tailnet address for homeBaseUrl in feeds.json, then Check again.';
export const CHANGED_TIP =
  "The wall can see changes made from its own controls and from the office switch's brighter, dimmer and preset buttons. It cannot see changes made in the Hue app, by a voice assistant or in HomeKit.";
export const STALE_TIP = 'The home app could not read every light just now';

/** The preset that is on, if any. */
export const activePreset = (s: Studio | null): Preset | null => s?.presets.find((p) => p.active) ?? null;

/** The words on the active preset's chip: "On air, changed" while the home app says it changed. */
export const presetChipLabel = (p: Preset, changed: boolean): string => (p.active && changed ? `${p.label}, changed` : p.label);

/** The Work and Meet chip words for a preset that is on. */
export const chipPresetWord = (p: Preset | null, changed: boolean): string | null => (p ? `Lights: ${presetChipLabel(p, changed)}` : null);

export interface SummaryParts {
  /** Bold lead-in ("On air:", "No preset on."), then the plain rest. */
  lead: string;
  rest: string;
  /** The whole line for a tip, since the line itself is one line and may be cut. */
  full: string;
}

/**
 * The summary line when a preset is on ("<label>: <line>"), or when none is ("No preset on." then the key
 * light words already built). `changed` says only that something changed since it was set.
 */
export function summaryParts(studio: Studio, keyWords: string): SummaryParts {
  const p = activePreset(studio);
  if (!p) return { lead: 'No preset on.', rest: keyWords ? ` ${keyWords}` : '', full: `No preset on.${keyWords ? ` ${keyWords}` : ''}` };
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

/** The tile's state in one place: whether a click does anything, and what its tip says. */
export function tileState(studio: Studio, g: Group, canWrite: boolean): { disabled: boolean; dim: boolean; tip: string } {
  if (needsZone(g)) return { disabled: true, dim: true, tip: ZONE_TIP };
  const where = g.setTo ? `${g.label}: ${g.setTo}.` : `${g.label}.`;
  if (!g.reachable) return { disabled: !canWrite, dim: true, tip: `${where} Not answering: this is the last state the home app knew.` };
  if (!canWrite) return { disabled: true, dim: false, tip: `${where} To change it, the home app needs its desk token typed in Tools.` };
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
