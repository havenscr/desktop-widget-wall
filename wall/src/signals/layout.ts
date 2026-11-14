import { create } from 'zustand';

/**
 * Where the recording chip goes, decided from what is on screen: the banner (which then carries
 * the chip itself) and the Agents header (which carries it on Work). Each part reports here.
 */
export const useChipLayout = create<{ banner: boolean; header: boolean }>(() => ({ banner: false, header: false }));
