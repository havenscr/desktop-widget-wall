import { create } from 'zustand';

export type LineType = 'mountains' | 'bars' | 'ribbon' | 'sparks' | 'skyline';
export type LineColours = 'look' | 'floor' | 'sunset' | 'ice' | 'mint';
export type LineRest = 'ridgelevels' | 'flat';

export interface LinesSettings {
  type: LineType;
  lively: number;
  smooth: number;
  height: number;
  colours: LineColours;
  reflection: boolean;
  rest: LineRest;
}

export const DEFAULT_LINES: Readonly<LinesSettings> = {
  type: 'mountains', lively: 50, smooth: 50, height: 104,
  colours: 'look', reflection: true, rest: 'ridgelevels',
};
export const LINES_KEY = 'wall2-lines';

const TYPES: LineType[] = ['mountains', 'bars', 'ribbon', 'sparks', 'skyline'];
const COLOURS: LineColours[] = ['look', 'floor', 'sunset', 'ice', 'mint'];
const RESTS: LineRest[] = ['ridgelevels', 'flat'];
const bounded = (v: unknown, lo: number, hi: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function validateLines(value: unknown): LinesSettings {
  const v = value && typeof value === 'object' ? value as Partial<LinesSettings> : {};
  return {
    type: TYPES.includes(v.type as LineType) ? v.type as LineType : DEFAULT_LINES.type,
    lively: bounded(v.lively, 0, 100, DEFAULT_LINES.lively),
    smooth: bounded(v.smooth, 0, 100, DEFAULT_LINES.smooth),
    height: bounded(v.height, 20, 220, DEFAULT_LINES.height),
    colours: COLOURS.includes(v.colours as LineColours) ? v.colours as LineColours : DEFAULT_LINES.colours,
    reflection: typeof v.reflection === 'boolean' ? v.reflection : DEFAULT_LINES.reflection,
    rest: RESTS.includes(v.rest as LineRest) ? v.rest as LineRest : DEFAULT_LINES.rest,
  };
}

/** The stored setting, validated; the defaults when nothing (or nothing readable) is stored. */
function load(): LinesSettings {
  try {
    return validateLines(JSON.parse(localStorage.getItem(LINES_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_LINES };
  }
}
function save(value: LinesSettings): void {
  try {
    localStorage.setItem(LINES_KEY, JSON.stringify(value));
  } catch {
    // Storage may be unavailable: the setting then lasts until the wall restarts.
  }
}

interface LinesStore extends LinesSettings {
  setLines: (next: Partial<LinesSettings>) => void;
  reset: () => void;
}

/** One setting for the lines everywhere music plays. The frame reads it with `lineSettings()`, never through a render. */
export const useLinesStore = create<LinesStore>((set) => ({
  ...load(),
  setLines: (next) =>
    set((state) => {
      const value = validateLines({ ...state, ...next });
      save(value);
      return value;
    }),
  reset: () =>
    set(() => {
      const value = { ...DEFAULT_LINES };
      save(value);
      return value;
    }),
}));

export const lineSettings = (): LinesSettings => useLinesStore.getState();

/** Tests: read the stored setting again. */
export function resetLinesStore(): void {
  useLinesStore.setState({ ...load() });
}

/** The presets: each sets the three sliders (the notes' table). */
export const LINE_PRESETS = {
  calm: { lively: 22, smooth: 72, height: 60 },
  dancing: { lively: 50, smooth: 50, height: 104 },
  wild: { lively: 88, smooth: 28, height: 180 },
} as const;
export type LinePreset = keyof typeof LINE_PRESETS;

/** The preset whose three slider values the setting has, or null. */
export function activePreset(s: Pick<LinesSettings, 'lively' | 'smooth' | 'height'>): LinePreset | null {
  for (const key of Object.keys(LINE_PRESETS) as LinePreset[]) {
    const p = LINE_PRESETS[key];
    if (s.lively === p.lively && s.smooth === p.smooth && s.height === p.height) return key;
  }
  return null;
}
