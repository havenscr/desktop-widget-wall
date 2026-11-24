import { useEffect } from 'react';
import { create } from 'zustand';
import { invoke } from '../../bridge/tauri';
import { useAwake } from '../useNow';

/** The page reads the recorder this often while On Air shows. */
export const RECORDER_POLL_MS = 5000;

interface RecorderState {
  /** True when a Camtasia Recorder window is open, false when none, null when the read failed or has not answered. */
  open: boolean | null;
  read: () => Promise<void>;
}

export const useRecorder = create<RecorderState>((set) => ({
  open: null,
  read: async () => {
    try {
      const r = await invoke<{ state: 'open' | 'none' | 'unknown' }>('wall2_recorder_status');
      set({ open: r.state === 'open' ? true : r.state === 'none' ? false : null });
    } catch {
      set({ open: null });
    }
  },
}));

export type RecorderWord = 'Not open' | 'Ready' | 'Recording' | 'Paused' | 'Not known';

/**
 * The one state word. A recording the wall sees wins (the recorder may go by a name the read does not
 * know); Paused is only the wall's own Pause press. Ready needs a recorder seen open and the mic and
 * camera read known, so an unknown never claims Ready.
 */
export function recorderWord(s: { open: boolean | null; recording: boolean; paused: boolean; known: boolean }): RecorderWord {
  if (s.recording) return s.paused ? 'Paused' : 'Recording';
  if (s.open === false) return 'Not open';
  if (s.open === true && s.known) return 'Ready';
  return 'Not known';
}

/** Reads the recorder while the page shows and the display is on. */
export function useRecorderSync() {
  const awake = useAwake();
  useEffect(() => {
    if (!awake) return;
    void useRecorder.getState().read();
    const t = setInterval(() => void useRecorder.getState().read(), RECORDER_POLL_MS);
    return () => clearInterval(t);
  }, [awake]);
}
