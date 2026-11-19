import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { create } from 'zustand';
import { invoke, isTauri } from '../../bridge/tauri';
import { useAwake } from '../useNow';
import { SP_OFF, type SpStatus } from './stagepopModel';

/** The page reads the status this often as a safety net behind the `stagepop-state` event. */
export const STAGEPOP_POLL_MS = 5000;

export type SpCmd = { type: 'open' } | { type: 'close' } | { type: 'fullscreen'; on: boolean } | { type: 'mode'; key: string };

interface SpState {
  status: SpStatus;
  /** True after a command the add-on could not take; cleared by the next answer. */
  failed: boolean;
  read: () => Promise<void>;
  apply: (s: SpStatus) => void;
  send: (cmd: SpCmd) => Promise<void>;
}

export const useStagePop = create<SpState>((set, get) => ({
  status: SP_OFF,
  failed: false,
  read: async () => {
    try {
      set({ status: await invoke<SpStatus>('wall2_stagepop_status') });
    } catch {
      set({ status: SP_OFF });
    }
  },
  apply: (status) => set({ status, failed: false }),
  send: async (cmd) => {
    try {
      await invoke('wall2_stagepop_send', { cmd });
      set({ failed: false });
    } catch {
      set({ failed: true });
    }
    void get().read();
  },
}));

/** The one-time show and the new code. The code is returned to the caller and kept nowhere here. */
export const stagepopToken = (action: 'show' | 'new') => invoke<string>('wall2_stagepop_token', { action });
export const stagepopPlacement = (left: number, top: number) => invoke<void>('wall2_stagepop_placement_set', { left, top });

/** Reads the status and follows `stagepop-state` while the page shows and the display is on. */
export function useStagePopSync() {
  const awake = useAwake();
  useEffect(() => {
    if (!awake) return;
    let off = false;
    let stop: UnlistenFn | undefined;
    void useStagePop.getState().read();
    if (isTauri()) {
      listen<SpStatus>('stagepop-state', (e) => {
        if (!off) useStagePop.getState().apply(e.payload);
      }).then(
        (u) => (off ? u() : (stop = u)),
        () => {},
      );
    }
    const t = setInterval(() => void useStagePop.getState().read(), STAGEPOP_POLL_MS);
    return () => {
      off = true;
      clearInterval(t);
      stop?.();
    };
  }, [awake]);
}
