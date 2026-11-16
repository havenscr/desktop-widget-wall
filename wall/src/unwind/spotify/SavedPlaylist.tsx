import { useCallback, useEffect, useRef, useState } from 'react';
import { IconPlayerPlayFilled } from '@tabler/icons-react';
import { spotify, type SpotifyItem, type SpotifyPlayback, type SpotifyTrack } from '../../music/spotify';
import { mediaTarget, useNowPlayingStore } from '../../music/store';
import { tip } from '../../ui/HoverTip';
import { useVisible } from '../../ui/useVisible';
import '../../styles/spotify-saved.css';
import { moreInQueue, NOTHING_HEARD, NOTHING_QUEUED, PAGE_OFF_HINT, PAGE_RETRY_MS, PAGE_TERMS, PAGE_TRY_LATER, pageProblem, QUEUE_FAILED, WHILE_HEADINGS, WHILE_NEXT_ROWS, WHILE_PLAYS, trackLength, type PageProblem } from './model';
import { PlayingBars } from './Tile';
import { QUEUE_POLL_MS, runSkips, skipPlan } from './UpNext';

/**
 * Playlists the owner saved but did not make (Spotify's app rules hide their songs from the Web API).
 * Two fallbacks live here: the songs read from the playlist's public web page (`usePublicList`; the note
 * beside the playlist says so, and the switch lives in Tools), and the "while it plays" view (`WhilePlays`) that shows the song playing, the
 * queue and what was heard from the playlist, all inside Spotify's rules.
 */

export type PublicList = { state: 'idle' } | { state: 'reading' } | { state: 'ready'; items: SpotifyTrack[]; listed: number } | { state: 'failed'; problem: PageProblem };

/**
 * Reads the public page once per opening while `active` (the native cache answers repeats); `retry` asks again.
 * An answer that lands after the view left, or for an older item, is dropped.
 */
export function usePublicList(item: SpotifyItem, active: boolean): { list: PublicList; retry: () => void; retryReady: boolean } {
  const [list, setList] = useState<PublicList>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const [retryReady, setRetryReady] = useState(false);
  useEffect(() => {
    if (!active) return;
    let live = true;
    setList({ state: 'reading' });
    spotify.publicPage(item.id).then(
      (page) => {
        if (!live) return;
        const items = Array.isArray(page?.items) ? page.items : [];
        setList({ state: 'ready', items, listed: typeof page?.listed === 'number' ? page.listed : items.length });
      },
      (e) => live && setList({ state: 'failed', problem: pageProblem(e) }),
    );
    return () => {
      live = false;
    };
  }, [item.id, active, attempt]);
  // The wall keeps a failure for a minute (so a broken page is not hammered): Retry comes back after it, not before.
  useEffect(() => {
    setRetryReady(false);
    if (list.state !== 'failed' || (list.problem !== 'connection' && list.problem !== 'failed')) return;
    const timer = setTimeout(() => setRetryReady(true), PAGE_RETRY_MS);
    return () => clearTimeout(timer);
  }, [list, item.id]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { list, retry, retryReady };
}

/** A song's length, or nothing when it is unknown (the page may not give one): never "0:00". */
const length = (ms: number) => (ms > 0 ? trackLength(ms) : '');

/** One song row, as the playlist page draws every song. `still`: the song playing now, which does nothing when clicked. */
export function TrackRow({ t, index, on, onPlay, still = false }: { t: SpotifyTrack; index: number; on: boolean; onPlay: (t: SpotifyTrack) => void; still?: boolean }) {
  const ok = t.playable && !!t.id && !still;
  return (
    <li>
      <button
        type="button"
        className={`sp-track${on ? ' on' : ''}${t.playable && !!t.id ? '' : ' off'}`}
        aria-disabled={!ok}
        aria-current={on ? 'true' : undefined}
        {...tip(() => (
          <div className="sp-tipline">
            <b>{t.name}</b>
            <span>{t.playable && !!t.id ? [t.artists, t.album, length(t.durationMs)].filter(Boolean).join(' · ') : 'This song cannot be played here: it is a local file, or not available in this country.'}</span>
          </div>
        ))}
        onClick={() => {
          if (ok) onPlay(t);
        }}
      >
        <span className="sp-n">
          {on ? (
            <PlayingBars />
          ) : (
            <>
              <span className="sp-num">{index + 1}</span>
              {ok && <IconPlayerPlayFilled className="sp-hov" size={16} aria-hidden="true" />}
            </>
          )}
        </span>
        <span className="sp-tname">{t.name}</span>
        <span className="sp-tart">{t.artists}</span>
        <span className="sp-tlen">{length(t.durationMs)}</span>
      </button>
    </li>
  );
}

/** What a click on the n-th queued row does: the same skips Up next sends (a queued song may be one the owner added by hand, so nothing starts the playlist). The line to show, or null. */
async function skipTo(index: number, queued: number): Promise<string | null> {
  // Captured when the click starts, so every skip of this click goes the same way to the same session.
  const target = mediaTarget();
  const reported = await spotify.playback().catch(() => null);
  const plan = skipPlan(index, queued, !!reported);
  if (plan.kind === 'none') return plan.line;
  return runSkips(plan.skips, reported ? { via: 'spotify' } : { via: 'key', target });
}

interface PlayingState {
  playback: SpotifyPlayback | null;
  next: SpotifyTrack[];
  /** The last queue read failed: the old rows are dropped (a click would skip by a stale position) until a read succeeds. */
  queueFailed: boolean;
  heard: SpotifyTrack[];
}

const NOTHING: PlayingState = { playback: null, next: [], queueFailed: false, heard: [] };

/** What the page says about the public page, once, above everything else: why there is no list, and Retry. */
export interface PageStatus {
  line: string;
  /** "Try again in a minute." shows until Retry comes back. */
  tryLater?: boolean;
  onRetry?: () => void;
  /** The switch is off: the terms and where the switch is. */
  off?: boolean;
}

/**
 * The page of a playlist whose songs Spotify will not list: `status` (why there is no list, with Retry) and what Play does, until this playlist plays. Then "Playing now" (or "Paused"), "Up next in Spotify" (the first
 * 8 of the queue, and one line for the rest) and "Heard from this playlist" (Spotify's recently played list filtered to
 * it). Playback and the queue are read on open, when the song changes and every 20 seconds while the page shows; the
 * heard list on open and when the playing song changes. Nothing is read while the page is hidden, and nothing is stored.
 */
export function WhilePlays({ item, status, onNote, onPlayFrom, onUpNext }: { item: SpotifyItem; status: PageStatus; onNote: (n: string | null) => void; onPlayFrom: (t: SpotifyTrack) => void; onUpNext?: () => void }) {
  const title = useNowPlayingStore((s) => s.info?.title ?? '');
  const visible = useVisible();
  const [state, setState] = useState<PlayingState>(NOTHING);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const fromThis = state.playback?.playlistId === item.id && !!state.playback.track;
  const nowId = state.playback?.track?.id ?? null;

  useEffect(() => {
    if (!visible) return;
    let live = true;
    const read = async () => {
      let playback: SpotifyPlayback | null = null;
      try {
        playback = (await spotify.playback()) ?? null;
      } catch {
        // A failed read shows the line only.
      }
      if (!live) return;
      if (!playback || playback.playlistId !== item.id || !playback.track) {
        setState((s) => ({ ...s, playback: null, next: [], queueFailed: false }));
        return;
      }
      let next: SpotifyTrack[] | null = null;
      try {
        const q = await spotify.queue();
        next = Array.isArray(q?.next) ? q.next : [];
      } catch {
        // The rows from the last read are dropped below: a click on one would skip by a stale position.
      }
      if (live) setState((s) => ({ ...s, playback, next: next ?? [], queueFailed: next === null }));
    };
    void read();
    const id = setInterval(() => void read(), QUEUE_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [visible, title, item.id]);

  // The heard list follows the playing song's id from the playback read (so it also moves when the playlist plays on a phone or a speaker).
  useEffect(() => {
    if (!visible || !fromThis) return;
    let live = true;
    spotify.heard(item.id).then(
      (heard) => live && setState((s) => ({ ...s, heard: Array.isArray(heard) ? heard : [] })),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [visible, fromThis, nowId, item.id]);

  const buttons = (
    <>
      {status.onRetry ? (
        <button type="button" className="sp-btn" onClick={status.onRetry}>
          Retry
        </button>
      ) : null}
    </>
  );
  const notes = (
    <>
      {status.tryLater && !status.onRetry ? <span className="sp-hintline">{PAGE_TRY_LATER}</span> : null}
      {status.off ? <span className="sp-hintline">{PAGE_TERMS}</span> : null}
      {status.off ? <span className="sp-hintline">{PAGE_OFF_HINT}</span> : null}
    </>
  );

  if (!fromThis || !state.playback?.track) {
    return (
      <li className="sp-empty">
        {status.line}
        {buttons}
        {notes}
        <span className="sp-hintline">{WHILE_PLAYS}</span>
      </li>
    );
  }
  const now = state.playback.track;
  const heard = state.heard.filter((t) => !(now.id && t.id === now.id));
  const shown = state.next.slice(0, WHILE_NEXT_ROWS);
  const more = state.next.length - shown.length;
  const skip = (i: number) => {
    void skipTo(i, state.next.length).then((l) => {
      if (l && mounted.current) onNote(l);
    });
  };
  return (
    <>
      <li className="sp-hintline sp-source">
        {status.line}
        {buttons}
        {notes}
      </li>
      <li className="sp-sec" role="heading" aria-level={3}>
        {state.playback.playing ? WHILE_HEADINGS.now : WHILE_HEADINGS.paused}
      </li>
      <TrackRow t={now} index={0} on still onPlay={() => undefined} />
      <li className="sp-sec" role="heading" aria-level={3}>
        {WHILE_HEADINGS.next}
      </li>
      {state.queueFailed ? (
        <li className="sp-empty">{QUEUE_FAILED}</li>
      ) : shown.length === 0 ? (
        <li className="sp-empty">{NOTHING_QUEUED}</li>
      ) : (
        shown.map((t, i) => <TrackRow key={`next-${t.id ?? 'local'}-${i}`} t={t} index={i} on={false} onPlay={() => skip(i)} />)
      )}
      {more > 0 ? (
        <li className="sp-hintline sp-source">
          {onUpNext ? (
            <button type="button" className="sp-linkbtn" onClick={onUpNext}>
              {moreInQueue(more)}
            </button>
          ) : (
            moreInQueue(more)
          )}
        </li>
      ) : null}
      <li className="sp-sec" role="heading" aria-level={3}>
        {WHILE_HEADINGS.heard}
      </li>
      {heard.length === 0 ? (
        <li className="sp-empty">{NOTHING_HEARD}</li>
      ) : (
        heard.map((t, i) => <TrackRow key={`heard-${t.id ?? 'local'}-${i}`} t={t} index={i} on={false} onPlay={onPlayFrom} />)
      )}
    </>
  );
}
