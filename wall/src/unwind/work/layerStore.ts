import { create } from 'zustand';

/**
 * Whether Unwind's work layer (the full timeline) is up. `shown` is written by `useWorkLayer`, read by the timeline.
 * `held` is written by the keys row while its menu, picker or rename popover is open: the layer then counts as active
 * and the Watch controls do not rest. `panel` is written by the timeline's ribbon while its Agents panel or Day drawer is open; each owner has its own flag, so one never undoes the other's hold.
 */
export const useWorkLayerStore = create<{ shown: boolean; held: boolean; panel: boolean }>(() => ({ shown: false, held: false, panel: false }));
