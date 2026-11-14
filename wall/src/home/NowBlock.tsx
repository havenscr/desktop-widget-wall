import {
  IconChevronRight,
  IconDeviceSpeaker,
  IconDeviceTv,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconPlayerStopFilled,
} from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '../bridge/tauri';
import { tip } from '../ui/HoverTip';
import { useVisible } from '../ui/useVisible';
import { artSrc, clockMs, musicView, type ArtImage, type HouseTrack, type MusicView, type NowPlaying, type Slot, type SonosSummary } from './soundModel';
import { clock } from './useSonos';
import { timeOf, useWallVideo, wallVideoControls, type WallVideoView } from './wallVideo';

/** The cross-fade between layouts. */
export const NP_FADE_MS = 200;
/** How long the line "Open Watch to control this" stays after a message the frame did not take. */
export const NP_HINT_MS = 4000;
/** Shown (and said on hover) when the player frame did not take a back or next message. */
export const OPEN_WATCH_TO_CONTROL = 'Open Watch to control this';

type Layout = 'quiet' | 'music' | 'video' | 'both';

export interface NowBlockProps {
  s: SonosSummary;
  /** The page's clock as of the last Sonos read (it ticks every 15 seconds). */
  now: number;
  /** False while the read is not live (stale): the time bar stops. */
  live: boolean;
  /** A Spotify track on a house speaker, and when the read carrying its position landed. */
  track: HouseTrack | null;
  trackAt: number;
  /** The play this wall started (its name and art), while the music it started still plays. */
  activeSlot: Slot | null;
  activeName: string | null;
  locked: boolean;
  pauseAll: () => void;
  skip: (direction: 'next' | 'previous') => void;
  /** The quiet block's "Play <word>" button, and the suggested play's art. */
  playSuggested: ReactNode;
  suggestedSlot: Slot | null;
  /** The play art tile (Sound.tsx draws it) at an icon size. */
  playArt: (slot: Slot, size: number) => ReactNode;
}

const reducedMotion = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The cover Rust fetched for the playing track (null while there is none: the glyph tile shows). */
function useCover(np: NowPlaying | null): string | null {
  const key = np && np.art ? `${np.speaker}\u0000${np.track ?? ''}\u0000${np.artist ?? ''}` : null;
  const [got, setGot] = useState<{ key: string; src: string | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    invoke<ArtImage | null>('wall2_sonos_art')
      .then((a) => live && setGot({ key, src: artSrc(a) }))
      .catch(() => live && setGot({ key, src: null }));
    return () => {
      live = false;
    };
  }, [key]);
  return got && got.key === key ? got.src : null;
}

/** The clock, each second while `on` and the page shows (the time bar moves between reads); otherwise the last value. */
function useSecond(on: boolean): number {
  const visible = useVisible();
  const [t, setT] = useState(() => clock());
  useEffect(() => {
    if (!on || !visible) return;
    setT(clock());
    const id = setInterval(() => setT(clock()), 1000);
    return () => clearInterval(id);
  }, [on, visible]);
  return t;
}

/**
 * Keeps the layout that just went away on screen for `NP_FADE_MS` (fading out under the new one fading in), so the
 * block changes between layouts without a jump. Under reduced motion the change is at once. The held layer is
 * the last render's, drawn inert and hidden from assistive technology.
 */
function useCrossfade(kind: Layout, node: ReactNode): { leaving: { kind: Layout; node: ReactNode } | null } {
  const last = useRef<{ kind: Layout; node: ReactNode }>({ kind, node });
  const [leaving, setLeaving] = useState<{ kind: Layout; node: ReactNode } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { kind, node };
    if (prev.kind === kind || reducedMotion()) return;
    setLeaving(prev);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLeaving(null), NP_FADE_MS);
  }, [kind, node]);
  return { leaving: leaving && leaving.kind !== kind ? leaving : null };
}

function Rd({ label, tipText, big = false, disabled = false, onClick, children }: { label: string; tipText: string; big?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`np-rd${big ? ' big' : ''}`}
      aria-label={label}
      disabled={disabled}
      {...tip(tipText)}
      onClick={(e) => {
        if (e.detail > 1) return;
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

/** The 6 px time bar with its two times. */
function TimeBar({ posMs, durMs }: { posMs: number; durMs: number }) {
  return (
    <div className="np-prog" {...tip(() => `${clockMs(posMs)} of ${clockMs(durMs)}`)}>
      <span>{clockMs(posMs)}</span>
      <div>
        <i style={{ width: `${Math.round((posMs / durMs) * 100)}%` }} />
      </div>
      <span>{clockMs(durMs)}</span>
    </div>
  );
}

function Where({ text, tipText }: { text: string; tipText: string }) {
  return (
    <span className="np-where" {...tip(tipText)}>
      <IconDeviceSpeaker size={18} stroke={1.8} aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}

/** The glyph tile (no cover): the speaker, or the play this wall started. */
function MusicTile({ m, size, playArt }: { m: MusicView; size: number; playArt: NowBlockProps['playArt'] }) {
  if (m.cover) return <img className="np-cover" style={size === 92 ? { width: 92, height: 92, borderRadius: 18 } : undefined} src={m.cover} alt="" />;
  if (m.slot) return <span className={`np-slot${size === 92 ? ' sm' : ''}`}>{playArt(m.slot, size === 92 ? 38 : 57)}</span>;
  return (
    <span className={`np-cover blank${size === 92 ? ' sm' : ''}`} aria-hidden="true">
      <IconDeviceSpeaker size={size === 92 ? 38 : 57} stroke={1.5} />
    </span>
  );
}

function VideoTile({ size, tipText }: { size: number; tipText: string }) {
  return (
    <button type="button" className={`np-tile${size === 92 ? ' sm' : ''}`} aria-label="Open Watch" {...tip(tipText)} onClick={wallVideoControls.openWatch}>
      <IconDeviceTv size={size === 92 ? 38 : 57} stroke={1.5} aria-hidden="true" />
    </button>
  );
}

function MusicFull({ m, p }: { m: MusicView; p: NowBlockProps }) {
  return (
    <>
      <div className="np-top">
        <MusicTile m={m} size={136} playArt={p.playArt} />
        <div className="np-meta">
          <span className="np-k">Now playing</span>
          <b className="np-title" {...tip(m.title)}>
            {m.title}
          </b>
          {m.artist && (
            <span className="np-artist" {...tip(m.artist)}>
              {m.artist}
            </span>
          )}
        </div>
      </div>
      {m.clock ? (
        <TimeBar posMs={m.clock.posMs} durMs={m.clock.durMs} />
      ) : (
        <div className="np-mid">
          <Where text={m.where} tipText={m.whereTip} />
        </div>
      )}
      <div className="np-foot">
        {m.canSkip && (
          <Rd label="Previous track" tipText="Previous track" disabled={p.locked} onClick={() => p.skip('previous')}>
            <IconPlayerSkipBackFilled size={20} aria-hidden="true" />
          </Rd>
        )}
        <Rd label="Pause" tipText="Pause every Sonos speaker" big disabled={p.locked} onClick={p.pauseAll}>
          <IconPlayerPauseFilled size={24} aria-hidden="true" />
        </Rd>
        {m.canSkip && (
          <Rd label="Next track" tipText="Next track" disabled={p.locked} onClick={() => p.skip('next')}>
            <IconPlayerSkipForwardFilled size={20} aria-hidden="true" />
          </Rd>
        )}
        {m.clock && <Where text={m.where} tipText={m.whereTip} />}
      </div>
    </>
  );
}

/** One video control row: back, pause or play, next (playlist only), stop; with `open`, "Open Watch" at the right. */
function VideoButtons({ v, cut, setCut, open }: { v: WallVideoView; cut: boolean; setCut: () => void; open: boolean }) {
  const skip = (go: () => boolean) => () => {
    if (!go()) setCut();
  };
  const noPause = v.needsClick || !v.youtube;
  return (
    <>
      {v.youtube && v.list && (
        <Rd label="Previous video" tipText={cut ? OPEN_WATCH_TO_CONTROL : `Previous video. Item ${v.list.index + 1} of ${v.list.count}`} disabled={cut} onClick={skip(wallVideoControls.previous)}>
          <IconPlayerSkipBackFilled size={20} aria-hidden="true" />
        </Rd>
      )}
      {!noPause && (
        <Rd label={v.paused ? 'Play' : 'Pause'} tipText={v.paused ? 'Play the video' : 'Pause the video'} big onClick={wallVideoControls.togglePause}>
          {v.paused ? <IconPlayerPlayFilled size={24} aria-hidden="true" /> : <IconPlayerPauseFilled size={24} aria-hidden="true" />}
        </Rd>
      )}
      {v.youtube && v.list && (
        <Rd label="Next video" tipText={cut ? OPEN_WATCH_TO_CONTROL : `Next video. Item ${v.list.index + 1} of ${v.list.count}`} disabled={cut} onClick={skip(wallVideoControls.next)}>
          <IconPlayerSkipForwardFilled size={20} aria-hidden="true" />
        </Rd>
      )}
      <Rd label="Stop" tipText="Stop and remove the video" onClick={wallVideoControls.stop}>
        <IconPlayerStopFilled size={20} aria-hidden="true" />
      </Rd>
      {open && (
        <button type="button" className="np-open" {...tip('Open the Watch tab')} onClick={wallVideoControls.openWatch}>
          Open Watch
          <IconChevronRight size={18} aria-hidden="true" />
        </button>
      )}
    </>
  );
}

const CLICK_LINE = 'Click the video on Watch to start it';

function VideoFull({ v, hint, cut, setCut }: { v: WallVideoView; hint: boolean; cut: boolean; setCut: () => void }) {
  return (
    <>
      <div className="np-top">
        <VideoTile size={136} tipText="Open Watch" />
        <div className="np-meta">
          <span className="np-k wall">On the wall</span>
          <b className="np-title" {...tip(v.title)}>
            {v.title}
          </b>
          <span className={`np-artist${v.sub.length > 18 ? ' long' : ''}`}>{v.sub}</span>
        </div>
      </div>
      {hint ? (
        <div className="np-mid note" role="status">
          {OPEN_WATCH_TO_CONTROL}
        </div>
      ) : v.needsClick ? (
        <div className="np-mid note" role="status">
          {CLICK_LINE}
        </div>
      ) : v.time ? (
        <TimeBar posMs={v.time.pos * 1000} durMs={v.time.dur * 1000} />
      ) : null}
      <div className="np-foot">
        <VideoButtons v={v} cut={cut} setCut={setCut} open />
      </div>
    </>
  );
}

function Split({ v, m, p }: { v: WallVideoView; m: MusicView; p: NowBlockProps }) {
  const sub = v.sub.length <= 16 ? v.sub : v.shortSub;
  const line1 = v.needsClick ? 'Click the video on Watch' : v.time ? timeOf(v.time.pos, v.time.dur) : sub;
  const line2 = v.needsClick || v.time ? sub : '';
  const videoBtns = v.needsClick || !v.youtube ? 1 : 2;
  return (
    <>
      <div className="np-half" data-half="video">
        <VideoTile size={92} tipText="Open Watch" />
        <span className="np-k wall">On the wall</span>
        <b className="np-title" {...tip(v.title)}>
          {v.title}
        </b>
        <span className="np-l1" style={{ right: videoBtns * 50 }}>
          {line1}
        </span>
        {line2 && (
          <span className="np-l2" style={{ right: videoBtns * 50 }}>
            {line2}
          </span>
        )}
        <div className="np-btns">
          {!(v.needsClick || !v.youtube) && (
            <Rd label={v.paused ? 'Play' : 'Pause'} tipText={v.paused ? 'Play the video' : 'Pause the video'} big onClick={wallVideoControls.togglePause}>
              {v.paused ? <IconPlayerPlayFilled size={22} aria-hidden="true" /> : <IconPlayerPauseFilled size={22} aria-hidden="true" />}
            </Rd>
          )}
          <Rd label="Stop" tipText="Stop and remove the video" onClick={wallVideoControls.stop}>
            <IconPlayerStopFilled size={20} aria-hidden="true" />
          </Rd>
        </div>
      </div>
      <div className="np-hair" aria-hidden="true" />
      <div className="np-half" data-half="music">
        <MusicTile m={m} size={92} playArt={p.playArt} />
        <span className="np-k">Now playing</span>
        <b className="np-title" {...tip(m.title)}>
          {m.title}
        </b>
        <span className="np-l1" style={{ right: 50 }} {...tip(m.artist ?? m.whereTip)}>
          {m.artist ?? m.where}
        </span>
        {m.artist && (
          <span className="np-l2" style={{ right: 50 }} {...tip(m.whereTip)}>
            {m.where}
          </span>
        )}
        <div className="np-btns">
          <Rd label="Pause" tipText="Pause every Sonos speaker" big disabled={p.locked} onClick={p.pauseAll}>
            <IconPlayerPauseFilled size={22} aria-hidden="true" />
          </Rd>
        </div>
      </div>
    </>
  );
}

function Quiet({ p }: { p: NowBlockProps }) {
  return (
    <>
      <div className="np-top">
        {p.suggestedSlot ? (
          <span className="np-slot">{p.playArt(p.suggestedSlot, 57)}</span>
        ) : (
          <span className="np-cover blank" aria-hidden="true">
            <IconDeviceSpeaker size={57} stroke={1.5} />
          </span>
        )}
        <div className="np-meta">
          <span className="np-k">Sound</span>
          <b className="np-title">Nothing playing</b>
        </div>
      </div>
      <div className="np-mid note">{p.suggestedSlot ? 'Suggested for this hour' : 'Pick a play beside this'}</div>
      <div className="np-foot">{p.playSuggested}</div>
    </>
  );
}

/**
 * Now playing at the left of the Sound card: one block with three layouts that cross-fade. Music alone (a Spotify
 * track on a house speaker, or what the Sonos read knows): cover, title, artist, a time bar when a length is
 * known, and the controls at the foot. The wall's own video alone: the same block with its own controls and
 * "Open Watch". Both at once: two halves, the video above the music. Nothing playing: the quiet block with the
 * hour's suggestion. The block's box is the same in every layout (its layers fill it).
 */
export function NowBlock(p: NowBlockProps) {
  const video = useWallVideo();
  const cover = useCover(p.s.nowPlaying);
  const probe = musicView({ s: p.s, track: p.track, trackAt: p.trackAt, activeName: p.activeName, activeSlot: p.activeSlot, art: cover, now: p.now, live: p.live });
  const tick = useSecond(!!probe?.clock && p.live);
  const music = probe?.clock ? musicView({ s: p.s, track: p.track, trackAt: p.trackAt, activeName: p.activeName, activeSlot: p.activeSlot, art: cover, now: Math.max(p.now, tick), live: p.live }) : probe;
  // A back or next the frame did not take: the buttons stop, saying why, until another video is on.
  const videoKey = video ? `${video.kind}|${video.title}` : '';
  const [cutKey, setCutKey] = useState<string | null>(null);
  const [hintKey, setHintKey] = useState<string | null>(null);
  useEffect(() => {
    setCutKey(null);
    setHintKey(null);
  }, [videoKey]);
  useEffect(() => {
    if (!hintKey) return;
    const id = setTimeout(() => setHintKey(null), NP_HINT_MS);
    return () => clearTimeout(id);
  }, [hintKey]);
  const cut = video !== null && cutKey === videoKey;
  const setCut = () => {
    setCutKey(videoKey);
    setHintKey(videoKey);
  };
  const hint = video !== null && hintKey === videoKey;

  const kind: Layout = video && music ? 'both' : video ? 'video' : music ? 'music' : 'quiet';
  let node: ReactNode;
  if (video && music) node = <Split v={video} m={music} p={p} />;
  else if (video) node = <VideoFull v={video} hint={hint} cut={cut} setCut={setCut} />;
  else if (music) node = <MusicFull m={music} p={p} />;
  else node = <Quiet p={p} />;

  const { leaving } = useCrossfade(kind, node);
  return (
    <div className={`sound-np ${kind}`} aria-label="Now playing" data-layout={kind}>
      {leaving && (
        <div key={`out-${leaving.kind}`} className={`np-layer out np-${leaving.kind}`} aria-hidden="true" inert>
          {leaving.node}
        </div>
      )}
      <div key={kind} className={`np-layer np-${kind}${leaving ? ' in' : ''}`}>
        {node}
      </div>
    </div>
  );
}
