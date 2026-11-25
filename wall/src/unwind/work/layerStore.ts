import { create } from 'zustand';

/** Whether Unwind's work layer (the full timeline) is up. Written by `useWorkLayer`, read by the timeline. */
export const useWorkLayerStore = create<{ shown: boolean }>(() => ({ shown: false }));
