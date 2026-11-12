import { useCallback, useEffect, useRef, useState } from 'react';
import { IconVolume } from '@tabler/icons-react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { clampVolume, playingSession, volumeLevel, type AudioSession } from './model';

export const SESSIONS_POLL_MS = 3000;
/** Slider moves are sent at most this often. */
export const VOLUME_DEBOUNCE_MS = 100;
/** After a move, polls do not move the slider back for this long. */
export const HOLD_MS = 1500;

interface SessionsPayload {
  sessions?: AudioSession[];
}

/**
 * The playing app's audio session and its volume (0 to 1). Polls `get_audio_sessions`
 * while visible and `sourceApp` is set. `set` moves the slider at once and sends
 * `set_audio_session_volume` for that session, debounced at 100 ms.
 */
export function useAppVolume(sourceApp: string | null | undefined) {
  const visible = useVisible();
  const [session, setSession] = useState<AudioSession | null>(null);
  const [value, setValue] = useState(0);
  const mounted = useRef(true);
  const heldUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<{ name: string; level: number } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!visible || !sourceApp) {
      setSession(null);
      return;
    }
    let stopped = false;
    const read = async () => {
      try {
        const r = await invoke<SessionsPayload>('get_audio_sessions');
        if (stopped || !mounted.current) return;
        const s = playingSession(Array.isArray(r?.sessions) ? r.sessions : [], sourceApp);
        setSession(s);
        if (s && Date.now() >= heldUntil.current) setValue(clampVolume(s.volume / 100));
      } catch {
        if (!stopped && mounted.current) setSession(null);
      }
    };
    void read();
    const id = setInterval(() => void read(), SESSIONS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [visible, sourceApp]);

  const set = useCallback(
    (v: number) => {
      if (!session) return;
      const next = clampVolume(v);
      setValue(next);
      heldUntil.current = Date.now() + HOLD_MS;
      pending.current = { name: session.name, level: volumeLevel(next) };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const p = pending.current;
        pending.current = null;
        if (p) void invoke('set_audio_session_volume', { sessionName: p.name, level: p.level }).catch(() => {});
      }, VOLUME_DEBOUNCE_MS);
    },
    [session],
  );

  return { session, value, set };
}

/** The volume slider beside the transport. Nothing at all when the playing app's session is not found. */
export function Volume({ sourceApp }: { sourceApp: string | null | undefined }) {
  const { session, value, set } = useAppVolume(sourceApp);
  if (!session) return null;
  const pct = Math.round(value * 100);
  return (
    <label className="u-vol">
      <IconVolume size={30} stroke={1.8} aria-hidden="true" />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        aria-label={`${sourceApp} volume`}
        aria-valuetext={`${pct} percent`}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => set(Number(e.currentTarget.value))}
      />
    </label>
  );
}
