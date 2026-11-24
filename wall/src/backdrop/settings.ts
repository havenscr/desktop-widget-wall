import { create } from 'zustand';
import type { PlaceId } from '../state/places';

/** The two animated skies: slow wide bands of colour, or soft swaying curtains. */
export type SkyStyle = 'wash' | 'aurora';

export interface SkySettings {
  style: SkyStyle;
  /** The pages the animated sky shows on. An empty list is the off switch. */
  places: PlaceId[];
}

export const SKY_KEY = 'wall2-sky';
export const SKY_STYLES: readonly { id: SkyStyle; name: string; hint: string }[] = [
  { id: 'wash', name: 'Colour wash', hint: 'Slow, wide bands of colour drifting across the sky. The quietest choice.' },
  { id: 'aurora', name: 'Aurora', hint: 'Soft curtains of light that sway and fold, like weather over the mountain.' },
];
/** Every page the sky can show on, in the order the chips run. The rail's own list has no Zen, Meet, On Air or Shelf, so the names are here. */
export const SKY_PLACES: readonly { id: PlaceId; name: string }[] = [
  { id: 'zen', name: 'Zen' },
  { id: 'work', name: 'Work' },
  { id: 'home', name: 'Home' },
  { id: 'unwind', name: 'Unwind' },
  { id: 'meet', name: 'Meet' },
  { id: 'onair', name: 'On Air' },
  { id: 'shelf', name: 'Shelf' },
];
export const DEFAULT_SKY: Readonly<SkySettings> = { style: 'wash', places: ['zen'] };

const STYLE_IDS = SKY_STYLES.map((s) => s.id);
const PLACE_IDS = SKY_PLACES.map((p) => p.id);

/** A stored value made safe: unknown styles and pages are dropped, so a bad value can never turn the sky on where it was not asked for. */
export function validateSky(raw: unknown): SkySettings {
  const v = raw && typeof raw === 'object' ? (raw as Partial<SkySettings>) : {};
  const style = STYLE_IDS.includes(v.style as SkyStyle) ? (v.style as SkyStyle) : DEFAULT_SKY.style;
  if (!Array.isArray(v.places)) return { style, places: [...DEFAULT_SKY.places] };
  // The list keeps the chips' own order and each page once.
  const places = PLACE_IDS.filter((id) => (v.places as unknown[]).includes(id));
  return { style, places };
}

function load(): SkySettings {
  try {
    return validateSky(JSON.parse(localStorage.getItem(SKY_KEY) || 'null'));
  } catch {
    return validateSky(null);
  }
}
function save(value: SkySettings): void {
  try {
    localStorage.setItem(SKY_KEY, JSON.stringify({ style: value.style, places: value.places }));
  } catch {
    // Storage may be unavailable: the setting then lasts until the wall restarts.
  }
}

interface SkyStore extends SkySettings {
  /** False once the graphics context could not be made or was lost: the sky stays off for the session. */
  available: boolean;
  setStyle: (style: SkyStyle) => void;
  togglePlace: (id: PlaceId) => void;
  markUnavailable: () => void;
}

/** The sky's setting, for the panel and the frame loop (`skySettings()` reads it with no render). */
export const useBackdropSettings = create<SkyStore>((set, get) => ({
  ...load(),
  available: true,
  setStyle: (style) => {
    const next = validateSky({ style, places: get().places });
    save(next);
    set({ style: next.style });
  },
  togglePlace: (id) => {
    const has = get().places.includes(id);
    const next = validateSky({ style: get().style, places: has ? get().places.filter((p) => p !== id) : [...get().places, id] });
    save(next);
    set({ places: next.places });
  },
  markUnavailable: () => set({ available: false }),
}));

export const skySettings = (): SkyStore => useBackdropSettings.getState();

/** Tests: read the stored setting again and make the sky available. */
export function resetSkyStore(): void {
  useBackdropSettings.setState({ ...load(), available: true });
}

/** True when the animated sky is switched on for this page (it may still be held back by a screen's claim or a lost context). */
export function skyListed(places: readonly PlaceId[], place: PlaceId): boolean {
  return places.includes(place);
}
