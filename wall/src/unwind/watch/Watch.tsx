import { useState } from 'react';
import {
  IconExternalLink,
  IconMovie,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconSettings,
  IconSparkles,
  IconVolume,
  IconVolumeOff,
} from '@tabler/icons-react';
import { invoke } from '../../bridge/tauri';
import { useSignalStore } from '../../signals/store';
import { kindName, refKey, type WatchRef } from './links';
import { lookFor, lookName, nextLook, type LookId } from './looks';
import { PlayerFrame } from './PlayerFrame';
import { useWatchStore } from './store';
import { useStopRules } from './useStopRules';

export const WATCH_PANEL_ID = 'u-panel-watch';
export const WATCH_TAB_ID = 'u-tab-watch';

/** How long "Could not open the browser" stays under the video. */
export const OPEN_ERROR_MS = 5000;

/** Ask the wall to open this item on its own site; Rust checks the kind and id again and builds the address. */
export async function openInBrowser(ref: WatchRef): Promise<boolean> {
  try {
    await invoke('wall2_watch_open', { kind: ref.kind, id: ref.id });
    return true;
  } catch {
    return false;
  }
}

/** The gear beside the tabs: opens the settings sheet for how video is shown. */
export function WatchGear() {
  const open = useWatchStore((s) => s.sheet);
  return (
    <button
      type="button"
      className={`w-gear${open ? ' on' : ''}`}
      aria-label="How video is shown"
      title="How video is shown"
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => useWatchStore.getState().setSheet(!open)}
    >
      <IconSettings size={26} aria-hidden="true" />
    </button>
  );
}

/** The video in the scene, in its look, with the Look button (on hover) and Open in browser under it. */
function VideoStage({ item, look }: { item: WatchRef & { label: string }; look: LookId }) {
  const [openFailed, setOpenFailed] = useState(false);
  const open = async () => {
    setOpenFailed(false);
    if (!(await openInBrowser(item))) {
      setOpenFailed(true);
      setTimeout(() => setOpenFailed(false), OPEN_ERROR_MS);
    }
  };
  const lookBtn = (
    <button
      type="button"
      className="w-look"
      title={`Next look: ${lookName(nextLook(look))}`}
      aria-label={`Look: ${lookName(look)}. Next look: ${lookName(nextLook(look))}`}
      onClick={() => useWatchStore.getState().stepLook()}
    >
      <IconSparkles size={20} aria-hidden="true" />
      Look: {lookName(look)}
    </button>
  );
  return (
    <div className={`w-stage w-${look}`} data-look={look}>
      {look === 'feather' ? <div className="w-glow" aria-hidden="true" /> : null}
      {look === 'drivein' ? <div className="w-spill" aria-hidden="true" /> : null}
      <div className="w-screen">
        <PlayerFrame key={refKey(item)} item={item} title={item.label} />
      </div>
      {lookBtn}
      {look === 'drivein' ? (
        <>
          <i className="w-post l" aria-hidden="true" />
          <i className="w-post r" aria-hidden="true" />
        </>
      ) : null}
      <div className="w-under">
        <button type="button" className="w-open" title={`Opens this ${kindName(item.kind).toLowerCase()} in your web browser`} onClick={() => void open()}>
          <IconExternalLink size={20} aria-hidden="true" />
          Not playing? Open in browser
        </button>
        {openFailed ? (
          <span className="w-open-fail" role="alert">
            Could not open the browser
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The Watch tab's centre: what is on (kind, label, pause, mute, stop) on the left under the
 * tabs, and the video placed in the scene to its right in the chosen look. With nothing on it
 * says what to do and offers the first saved item. The stop rules run while this is mounted.
 */
export function WatchPanel() {
  useStopRules();
  const playing = useWatchStore((s) => s.playing);
  const saved = useWatchStore((s) => s.saved);
  const looks = useWatchStore((s) => s.looks);
  const paused = useWatchStore((s) => s.paused);
  const muted = useWatchStore((s) => s.muted);
  const stopped = useWatchStore((s) => s.stopped);
  const inCall = useSignalStore((s) => s.call !== null);
  const st = useWatchStore.getState();

  if (!playing) {
    const first = saved[0];
    return (
      <div className="w-panel" role="tabpanel" id={WATCH_PANEL_ID} aria-labelledby={WATCH_TAB_ID} data-state="idle">
        <div className="w-now">
          <span className="u-k">Watch</span>
          <div className="w-title w-none">Nothing on</div>
          <div className="w-sub">
            {stopped ? `${stopped} ` : ''}
            {first ? 'Pick something from your list, or paste another link there.' : 'Paste a YouTube or Twitch link into the list on the right to save it here.'}
          </div>
          {first ? (
            <button
              type="button"
              className="u-again w-start"
              disabled={inCall}
              title={inCall ? 'Video waits until the call ends' : `Play ${first.label}`}
              onClick={() => st.play(first)}
            >
              <IconPlayerPlayFilled size={24} aria-hidden="true" />
              <span className="u-ell">Play {first.label}</span>
            </button>
          ) : null}
        </div>
        {lookFor(looks, first?.kind ?? 'video') === 'drivein' ? (
          <div className="w-stage w-drivein w-empty" data-look="drivein" aria-hidden="true">
            <div className="w-screen">
              <IconMovie size={64} stroke={1.25} />
              <span>Nothing on the screen</span>
            </div>
            <i className="w-post l" />
            <i className="w-post r" />
          </div>
        ) : null}
      </div>
    );
  }

  const look = lookFor(looks, playing.kind);
  const youtube = playing.kind !== 'twitch';
  return (
    <div className="w-panel" role="tabpanel" id={WATCH_PANEL_ID} aria-labelledby={WATCH_TAB_ID} data-state="playing">
      <div className="w-now">
        <span className="u-k u-src">{kindName(playing.kind)}</span>
        <div className="w-title" title={playing.label}>
          {playing.label}
        </div>
        <div className="w-sub" title="It stops by itself when you leave Watch or Unwind, the screens go off, the wall sleeps or a call starts.">
          {youtube ? (paused ? 'Paused' : 'Playing on the wall') : 'Live on the wall'}
        </div>
        <div className="w-ctl">
          {youtube ? (
            <>
              <button
                type="button"
                className="u-rd big"
                aria-label={paused ? 'Play' : 'Pause'}
                title={paused ? 'Play' : 'Pause'}
                onClick={() => st.setPaused(!paused)}
              >
                {paused ? <IconPlayerPlayFilled size={40} aria-hidden="true" /> : <IconPlayerPauseFilled size={40} aria-hidden="true" />}
              </button>
              <button type="button" className="u-rd" aria-label={muted ? 'Sound on' : 'Mute'} title={muted ? 'Sound on' : 'Mute'} aria-pressed={muted} onClick={() => st.setMuted(!muted)}>
                {muted ? <IconVolumeOff size={28} aria-hidden="true" /> : <IconVolume size={28} aria-hidden="true" />}
              </button>
            </>
          ) : null}
          <button type="button" className={`u-rd${youtube ? '' : ' big'}`} aria-label="Stop" title="Stop and remove the video" onClick={() => st.stop()}>
            <IconPlayerStopFilled size={youtube ? 28 : 40} aria-hidden="true" />
          </button>
        </div>
      </div>
      <VideoStage item={playing} look={look} />
    </div>
  );
}
