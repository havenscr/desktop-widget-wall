import { useEffect } from 'react';
import { create } from 'zustand';
import { invoke } from '../../bridge/tauri';
import { useAwake } from '../useNow';
import type { PickStatus, Sent, StudioAnswer, StudioKey } from './studioModel';

/** How often the pick status is read while the Live page shows and the display is on. */
export const STUDIO_POLL_MS = 3000;

const EMPTY: PickStatus = { state: 'none', browser: null };

/** What the wall knows about the studio window, and the last key it sent. In memory only: no title, handle or id ever arrives here. */
interface StudioState {
  status: PickStatus;
  /** What the wall sent last. It says nothing about what is live. */
  sent: Sent | null;
  read: () => Promise<void>;
  pick: () => Promise<void>;
  send: (key: StudioKey, confirm: boolean) => Promise<void>;
  /** A scene, mute or camera key, sent through the Stage Pop-out add-on. Never throws: a failure is an answer with a reason. */
  studio: (action: 'scene' | 'mute' | 'camera', name?: string) => Promise<StudioAnswer>;
  reset: () => void;
}

export const useStudio = create<StudioState>((set, get) => ({
  status: EMPTY,
  sent: null,
  read: async () => {
    try {
      set({ status: await invoke<PickStatus>('wall2_studio_pick_status') });
    } catch {
      set({ status: EMPTY });
    }
  },
  pick: async () => {
    try {
      await invoke('wall2_studio_pick_start');
    } catch {
      // The status read shows what happened.
    }
    await get().read();
  },
  send: async (key, confirm) => {
    const a = await invoke<{ sent: StudioKey; at: number }>('wall2_studio_key', { key, confirm });
    set({ sent: { key: a.sent, at: a.at } });
    void get().read();
  },
  studio: async (action, name) => {
    try {
      return await invoke<StudioAnswer>('wall2_stagepop_studio', { action, name: action === 'scene' ? name : null });
    } catch {
      return { ok: false, reason: 'failed' };
    }
  },
  reset: () => set({ status: EMPTY, sent: null }),
}));

/** Reads the pick status while the Live page shows and the display is on; faster while a pick waits. */
export function useStudioPolling() {
  const awake = useAwake();
  const read = useStudio((s) => s.read);
  const waiting = useStudio((s) => s.status.state === 'waiting');
  useEffect(() => {
    if (!awake) return;
    void read();
    const t = setInterval(() => void read(), waiting ? 1000 : STUDIO_POLL_MS);
    return () => clearInterval(t);
  }, [awake, read, waiting]);
}
