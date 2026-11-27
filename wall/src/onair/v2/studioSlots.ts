/** The eight studio keys: which action each slot holds, its label, and how a label is fitted to a key. */
export type SlotAction = 'scene1' | 'scene2' | 'scene3' | 'scene4' | 'mute' | 'camera' | 'share' | 'golive' | 'solo' | 'two' | 'mark' | 'snip' | 'hide';
/** What a key can show: a slot's action, or End show, which only ever stands in for Go live while the show is live. */
export type ShownAction = SlotAction | 'end';

export interface Slot {
  a: SlotAction;
  /** A label the user typed; only scene keys take one. */
  l?: string;
}

export interface SlotInfo {
  /** The short name drawn on the key. */
  label: string;
  /** The full name, for the tooltip and the picker. */
  full: string;
  group: 'streamyard' | 'wall';
  /** A scene key: its label can be edited. */
  scene?: true;
  /** The colour kind of the key; keys of no kind keep the base key colour. */
  kind?: StudioKind;
}

/** The colour kinds of the studio keys. The stylesheet colours each kind by data-skind. */
export type StudioKind = 'scene' | 'mic' | 'camera' | 'mark' | 'golive';

export const SLOT_INFO: Record<ShownAction, SlotInfo> = {
  scene1: { label: 'Speaker', full: 'Full Screen Speaker', group: 'streamyard', scene: true, kind: 'scene' },
  scene2: { label: 'Presenter', full: 'Presenter View', group: 'streamyard', scene: true, kind: 'scene' },
  scene3: { label: '2 Person', full: '2 Person Presenter View', group: 'streamyard', scene: true, kind: 'scene' },
  scene4: { label: 'Screenshare', full: 'Screenshare', group: 'streamyard', scene: true, kind: 'scene' },
  mute: { label: 'Mute mic', full: 'Mute mic', group: 'streamyard', kind: 'mic' },
  camera: { label: 'Camera off', full: 'Camera off', group: 'streamyard', kind: 'camera' },
  share: { label: 'Share', full: 'Share', group: 'streamyard' },
  golive: { label: 'Go live', full: 'Go live', group: 'streamyard', kind: 'golive' },
  end: { label: 'End show', full: 'End show', group: 'streamyard', kind: 'golive' },
  solo: { label: 'Solo', full: 'Solo', group: 'streamyard' },
  two: { label: 'Two up', full: 'Two up', group: 'streamyard' },
  mark: { label: 'Mark a moment', full: 'Mark a moment', group: 'wall', kind: 'mark' },
  snip: { label: 'Snip', full: 'Snip', group: 'wall' },
  hide: { label: 'Hide screen', full: 'Hide screen', group: 'wall' },
};

/** The picker's order: the StreamYard group, then the Wall group. */
export const PICKER_ORDER: Record<'streamyard' | 'wall', SlotAction[]> = {
  streamyard: ['scene1', 'scene2', 'scene3', 'scene4', 'mute', 'camera', 'share', 'golive', 'solo', 'two'],
  wall: ['mark', 'snip', 'hide'],
};

/** The wall's studio command for each key that goes through the Stage Pop-out add-on. */
export const ADDON_ACTION: Partial<Record<ShownAction, 'scene' | 'mute' | 'camera'>> = {
  scene1: 'scene',
  scene2: 'scene',
  scene3: 'scene',
  scene4: 'scene',
  mute: 'mute',
  camera: 'camera',
};

export const SLOT_COUNT = 8;
export const SLOTS_KEY = 'wall2-studio-slots';
export const MAX_LABEL = 16;

export const DEFAULT_SLOTS: readonly Slot[] = [
  { a: 'scene1' },
  { a: 'scene2' },
  { a: 'scene3' },
  { a: 'scene4' },
  { a: 'mute' },
  { a: 'camera' },
  { a: 'mark' },
  { a: 'golive' },
];

/** The face of a toggle key from the last known state: Mute mic or Unmute mic, Camera off or Camera on. Other keys have none. */
export function toggleLabel(action: ShownAction, state: 'on' | 'off' | null): string | null {
  if (action === 'mute') return state === 'off' ? 'Unmute mic' : 'Mute mic';
  if (action === 'camera') return state === 'off' ? 'Camera on' : 'Camera off';
  return null;
}

export const slotLabel = (s: { a: ShownAction; l?: string }): string => (SLOT_INFO[s.a].scene && s.l ? s.l : SLOT_INFO[s.a].label);

/** The stored slots, or the defaults when nothing valid is stored. One bad entry throws the whole value away. */
export function parseSlots(raw: string | null): Slot[] {
  const defaults = DEFAULT_SLOTS.map((s) => ({ ...s }));
  if (!raw) return defaults;
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v) || v.length !== SLOT_COUNT) return defaults;
    const out: Slot[] = [];
    for (const e of v) {
      if (typeof e !== 'object' || e === null) return defaults;
      const { a, l } = e as { a?: unknown; l?: unknown };
      if (typeof a !== 'string' || !Object.prototype.hasOwnProperty.call(SLOT_INFO, a)) return defaults;
      // End show is not a key of its own: an old stored one becomes Go live, which shows End show while live.
      const action = (a === 'end' ? 'golive' : a) as SlotAction;
      if (l !== undefined && typeof l !== 'string') return defaults;
      const label = typeof l === 'string' ? l.trim().slice(0, MAX_LABEL) : '';
      out.push(SLOT_INFO[action].scene && label ? { a: action, l: label } : { a: action });
    }
    return out;
  } catch {
    return defaults;
  }
}

export function loadSlots(): Slot[] {
  try {
    return parseSlots(localStorage.getItem(SLOTS_KEY));
  } catch {
    return parseSlots(null);
  }
}

export function saveSlots(slots: readonly Slot[]): void {
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
  } catch {
    // Storage may be blocked; the keys still work for this session.
  }
}

/**
 * Shortens a label until it measures within `maxPx`: drop words from the end, then cut letters and
 * add an ellipsis. It never returns more than one line of text and never wraps.
 */
export function fitLabel(text: string, maxPx: number, measure: (s: string) => number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (measure(t) <= maxPx) return t;
  const words = t.split(' ');
  while (words.length > 1) {
    words.pop();
    const s = words.join(' ');
    if (measure(s) <= maxPx) return s;
  }
  let w = words[0] ?? '';
  while (w.length > 1) {
    w = w.slice(0, -1);
    const s = `${w}…`;
    if (measure(s) <= maxPx) return s;
  }
  return '…';
}

let ctx: CanvasRenderingContext2D | null | undefined;
/** Width of a label at 16 px in the wall's body font; a rough per letter guess where there is no canvas (tests). */
export function measureLabel(s: string): number {
  if (ctx === undefined) {
    try {
      ctx = /jsdom/i.test(navigator.userAgent) ? null : document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
  }
  if (!ctx) return s.length * 8.5;
  ctx.font = `500 16px ${getComputedStyle(document.body).getPropertyValue('--body') || 'sans-serif'}`;
  return ctx.measureText(s).width;
}

/** The widest a label may be on a key: the key is about 149 px wide with 8 px of padding each side. */
export const LABEL_MAX_PX = 128;
