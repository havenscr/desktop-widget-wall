import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref } from 'react';
import { IconCheck, IconDeviceDesktop, IconDeviceMobile, IconDeviceSpeaker, IconDeviceTv } from '@tabler/icons-react';
import { spotify, type SpotifyDevice } from '../../music/spotify';
import { useNowPlayingStore } from '../../music/store';
import { tip } from '../../ui/HoverTip';
import { useVisible } from '../../ui/useVisible';
import { deviceKindWord, problemLine, readDevices, spotifyProblem, useSpotifyDevices, useSpotifyStart, useSpotifyTarget } from './model';

export const PC_NAME = 'This PC';
const PC_LINE = 'Spotify is closed. The wall starts it.';
export const STALE_NOTE = 'Could not refresh, these may be out of date.';
export const LOCKED_CHIP = 'cannot be controlled from here';
export const DEVICES_FOOT = 'A phone or speaker shows here only while its Spotify is awake.';

interface Row {
  key: string;
  device: SpotifyDevice | null;
  name: string;
  line: string;
  on: boolean;
  dim: boolean;
}

function DeviceIcon({ kind, size }: { kind: string; size: number }) {
  const k = kind.toLowerCase();
  if (k === 'computer') return <IconDeviceDesktop size={size} stroke={1.8} aria-hidden="true" />;
  if (k === 'smartphone' || k === 'phone') return <IconDeviceMobile size={size} stroke={1.8} aria-hidden="true" />;
  if (k === 'tv') return <IconDeviceTv size={size} stroke={1.8} aria-hidden="true" />;
  return <IconDeviceSpeaker size={size} stroke={1.8} aria-hidden="true" />;
}

/**
 * The rows of the chooser, from Spotify's own device list: each player by its name and kind, the one
 * the music follows ticked (the owner's pick, else the active one). When no computer is listed, "This PC"
 * comes first: pressing Play there starts Spotify (the start flow already built).
 */
export function deviceRows(devices: SpotifyDevice[], picked: string | null, stale = false): Row[] {
  const pc = !devices.some((d) => d.kind.toLowerCase() === 'computer');
  const rows: Row[] = [];
  if (pc) rows.push({ key: 'pc', device: null, name: PC_NAME, line: PC_LINE, on: picked === '', dim: false });
  for (const d of devices) {
    // A list that could not be refreshed is not shown as live: no "playing now", no tick from the old active flag.
    const on = picked !== null ? d.id === picked : d.active && !stale;
    const word = deviceKindWord(d.kind);
    rows.push({
      key: d.id,
      device: d,
      name: d.name,
      line: d.restricted ? `${word}. Spotify does not allow control of it from here.` : d.active && !stale ? `${word}, playing now` : word,
      on,
      dim: !!d.restricted,
    });
  }
  return rows;
}

/**
 * The "Play on" round button (where the music plays) and its chooser: the owner's Spotify players, a tick on
 * the one in use. Choosing one moves the music there (the transfer command) when something plays, and
 * otherwise only makes it the target of the next Play. A device shows only while its Spotify is awake.
 * The card owns `open` (it closes the chooser on Escape and on its own closing).
 */
export function PlayOn({ open, onOpen, chipRef }: { open: boolean; onOpen: (open: boolean) => void; chipRef: Ref<HTMLButtonElement> }) {
  const visible = useVisible();
  const title = useNowPlayingStore((s) => s.info?.title ?? '');
  const target = useSpotifyTarget((s) => s.target);
  const starting = useSpotifyStart((s) => s.starting);
  const rev = useSpotifyStart((s) => s.rev);
  const devices = useSpotifyDevices((s) => s.devices);
  const stale = useSpotifyDevices((s) => s.stale);
  const problem = useSpotifyDevices((s) => s.problem);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(() => readDevices(), []);
  // Read on mount, when the song changes (so the chip follows where it plays), after a start, and when the chooser opens.
  useEffect(() => {
    if (visible) void read();
  }, [visible, title, rev, read]);
  useEffect(() => {
    if (open) void read();
  }, [open, read]);
  // An outside press closes the chooser only (the card's own rules close the tall view).
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) onOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open, onOpen]);

  const active = devices?.find((d) => d.active && !d.restricted) ?? null;
  // The music plays on a player that does not allow control: its name, with the words.
  const locked = devices?.find((d) => d.active && d.restricted) ?? null;
  // While the wall starts Spotify the chip says where it will play (this PC); it reads the real device after.
  const label = starting ? PC_NAME : target ? target.name : active ? active.name : locked ? locked.name : PC_NAME;
  // With no target, no active player and nothing starting, the button says so and shows the generic speaker.
  const chosen = starting || !!target || !!active || !!locked;
  const name = chosen ? label : 'choose a device';
  const kind = starting ? 'Computer' : target ? target.kind : active ? active.kind : locked ? locked.kind : 'speaker';
  const lockedNow = !starting && !target && !active && !!locked;
  const rows = devices ? deviceRows(devices, target ? target.id : null, stale) : [];
  const [note, setNote] = useState<string | null>(null);

  const pick = async (row: Row) => {
    if (busy) return;
    setNote(null);
    if (!row.device) {
      useSpotifyTarget.getState().setTarget({ id: '', name: PC_NAME, kind: 'Computer' });
      onOpen(false);
      return;
    }
    const d = row.device;
    if (d.restricted) return;
    setBusy(true);
    try {
      let playing = false;
      if (!d.active) {
        const p = await spotify.playback().catch(() => null);
        playing = !!p && p.playing && !!p.track;
        if (playing) await spotify.transfer(d.id);
      }
      if (!mounted.current) return;
      useSpotifyTarget.getState().setTarget({ id: d.id, name: d.name, kind: d.kind });
      onOpen(false);
      if (playing) void read();
    } catch (e) {
      if (mounted.current) setNote(`Could not move the music. ${problemLine(spotifyProblem(e))}`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button.sp-device:not(:disabled)')];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  };

  return (
    <div className="sp-dev-wrap" ref={wrap}>
      <button
        ref={chipRef}
        type="button"
        className={`sp-dev${open ? ' on' : ''}${lockedNow ? ' locked' : ''}${chosen ? ' chosen' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Play on: ${name}${lockedNow ? `, ${LOCKED_CHIP}` : ''}`}
        {...tip(() => (
          <div className="sp-tipline">
            <b>Play on: {name}</b>
            <span>{lockedNow ? `${label} ${LOCKED_CHIP}.` : 'Click to choose which of your Spotify players plays.'}</span>
          </div>
        ))}
        onClick={() => onOpen(!open)}
      >
        <DeviceIcon kind={kind} size={20} />
      </button>
      {open ? (
        <div className={`sp-devices${stale ? ' stale' : ''}`} role="group" aria-label="Play on" onKeyDown={key}>
          <div className="sp-devk">Play on</div>
          {devices === null && !problem ? <div className="sp-device-empty">Looking for your players.</div> : null}
          {problem && devices === null ? <div className="sp-device-empty">{problem}</div> : null}
          {stale && devices !== null ? <div className="sp-device-note" role="status">{STALE_NOTE}</div> : null}
          {rows.map((r) => (
            <button key={r.key} type="button" className={`sp-device${r.on ? ' on' : ''}${r.dim ? ' dim' : ''}`} aria-pressed={r.on} disabled={r.dim} onClick={() => void pick(r)}>
              {r.device ? <DeviceIcon kind={r.device.kind} size={26} /> : <IconDeviceDesktop size={26} stroke={1.8} aria-hidden="true" />}
              <span>
                <b>{r.name}</b>
                <small>{r.line}</small>
              </span>
              {r.on ? <IconCheck size={22} stroke={2} aria-hidden="true" /> : null}
            </button>
          ))}
          {note ? <div className="sp-device-note">{note}</div> : null}
          <p className="sp-devfoot">{DEVICES_FOOT}</p>
        </div>
      ) : null}
    </div>
  );
}
