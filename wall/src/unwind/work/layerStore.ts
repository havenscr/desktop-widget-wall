import { create } from 'zustand';

/**
 * Whether Unwind's work layer (the full timeline) is up. `shown` is written by `useWorkLayer`, read by the timeline.
 * `held` is written by the keys row while its menu, picker or rename popover is open: the layer then counts as active
 * and the Watch controls do not rest.
 */
export const useWorkLayerStore = create<{ shown: boolean; held: boolean }>(() => ({ shown: false, held: false }));
