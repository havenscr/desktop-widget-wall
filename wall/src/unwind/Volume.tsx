import { useCallback, useEffect, useRef, useState } from 'react';
import { IconVolume } from '@tabler/icons-react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { clampVolume, playingSession, volumeLevel, type AudioSession } from './model';

export const SESSIONS_POLL_MS = 3000;
/** While dragging, a move is sent at most this often; the last one is always sent. */
export const VOLUME_DEBOUNCE_MS = 100;
/** After a move, polls do not move the slider back for this long. */
export const HOLD_MS = 1500;

interface SessionsPayload {
  sessions?: AudioSession[];
}

/** A session together with the source label it was found for. */
interface Found {
  source: string;
  session: AudioSession;
}

interface Pending {
  name: string;
  level: number;
}

function send(p: Pending): void {
  void invoke('set_audio_session_volume', { sessionName: p.name, level: p.level }).catch(() => {});
}

/**
 * The playing app's audio session and its volume (0 to 1). Polls `get_audio_sessions`
 * while visible and `sourceApp` is set. The session is tied to the source it was found
 * for: when the source changes it is dropped at once and the slider hides until a read
 * for the new source answers, so a move can never reach the previous app. `set` moves the
 * slider at once and sends `set_audio_session_volume` at most every 100 ms, always ending
 * on the last value (also on unmount and on a source change). If the session goes away
 * mid-drag the unsent move is dropped.
 */
export function useAppVolume(sourceApp: string | null | undefined) {
  const visible = useVisible();
  const [found, setFound] = useState<Found | null>(null);
  const [value, setValue] = useState(0);
  const mounted = useRef(true);
  const heldUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<Pending | null>(null);
  const lastSent = useRef(-Infinity);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const p = pending.current;
    pending.current = null;
    if (p) {
      lastSent.current = Date.now();
      send(p);
    }
  }, []);

  const drop = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    pending.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flush();
    };
  }, [flush]);

  // Only a session found for the current source counts.
  const session = found && sourceApp && found.source === sourceApp ? found.session : null;

  useEffect(() => {
    // A new source (or none): finish the move meant for the old app, then forget its session.
    flush();
    setFound(null);
    if (!visible || !sourceApp) return;
    let stopped = false;
    const read = async () => {
      try {
        const r = await invoke<SessionsPayload>('get_audio_sessions');
        if (stopped || !mounted.current) return;
        const s = playingSession(Array.isArray(r?.sessions) ? r.sessions : [], sourceApp);
        if (!s) drop();
        setFound(s ? { source: sourceApp, session: s } : null);
        if (s && Date.now() >= heldUntil.current) setValue(clampVolume(s.volume / 100));
      } catch {
        if (stopped || !mounted.current) return;
        drop();
        setFound(null);
      }
    };
    void read();
    const id = setInterval(() => void read(), SESSIONS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [visible, sourceApp, flush, drop]);

  const set = useCallback(
    (v: number) => {
      if (!session) return;
      const next = clampVolume(v);
      setValue(next);
      heldUntil.current = Date.now() + HOLD_MS;
      pending.current = { name: session.name, level: volumeLevel(next) };
      if (timer.current !== undefined) return;
      const wait = lastSent.current + VOLUME_DEBOUNCE_MS - Date.now();
      if (wait <= 0) flush();
      else timer.current = setTimeout(flush, wait);
    },
    [session, flush],
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
