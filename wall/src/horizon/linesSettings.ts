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

function load(): LinesSettings {
  let value: LinesSettings;
  try { value = validateLines(JSON.parse(localStorage.getItem(LINES_KEY) || 'null')); } catch { value = { ...DEFAULT_LINES }; }
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search);
    const type = q.get('lines'), lively = q.get('lively'), smooth = q.get('smooth'), height = q.get('lheight'), colours = q.get('lcol'), rest = q.get('lrest');
    value = validateLines({ ...value, ...(type ? { type } : {}), ...(lively ? { lively: Number(lively) } : {}), ...(smooth ? { smooth: Number(smooth) } : {}), ...(height ? { height: Number(height) } : {}), ...(colours ? { colours } : {}), ...(rest ? { rest } : {}) });
  }
  return value;
}
function save(value: LinesSettings) { try { localStorage.setItem(LINES_KEY, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ } }

interface LinesStore extends LinesSettings {
  setLines: (next: Partial<LinesSettings>) => void;
  reset: () => void;
}

export const useLinesStore = create<LinesStore>((set) => ({
  ...load(),
  setLines: (next) => set((state) => { const value = validateLines({ ...state, ...next }); save(value); return value; }),
  reset: () => set(() => { const value = { ...DEFAULT_LINES }; save(value); return value; }),
}));

export const lineSettings = (): LinesSettings => useLinesStore.getState();

export function resetLinesStore(): void { useLinesStore.setState({ ...load() }); }

export const LINE_PRESETS = {
  calm: { lively: 22, smooth: 72, height: 60 },
  dancing: { lively: 50, smooth: 50, height: 104 },
  wild: { lively: 88, smooth: 28, height: 180 },
} as const;
