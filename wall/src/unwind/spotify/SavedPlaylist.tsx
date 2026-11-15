import { useCallback, useEffect, useRef, useState } from 'react';
import { IconPlayerPlayFilled } from '@tabler/icons-react';
import { spotify, type SpotifyItem, type SpotifyPlayback, type SpotifyTrack } from '../../music/spotify';
import { mediaTarget, useNowPlayingStore } from '../../music/store';
import { tip } from '../../ui/HoverTip';
import { useVisible } from '../../ui/useVisible';
import '../../styles/spotify-saved.css';
import { NOTHING_HEARD, NOTHING_QUEUED, PAGE_TAG_TIP, PAGE_TURN_OFF, PAGE_TURN_OFF_TIP, PAGE_TURN_ON, PAGE_TURN_ON_TIP, pageProblem, pageTag, WHILE_HEADINGS, WHILE_PLAYS, trackLength, type PageProblem } from './model';
import { PlayingBars } from './Tile';
import { QUEUE_POLL_MS, runSkips, skipPlan } from './UpNext';

/**
 * Playlists the owner saved but did not make (Spotify's app rules hide their songs from the Web API).
 * Two fallbacks live here: the songs read from the playlist's public web page (`usePublicList`, the
 * source tag `PageTag`), and the "while it plays" view (`WhilePlays`) that shows the song playing, the
 * queue and what was heard from the playlist, all inside Spotify's rules.
 */

export type PublicList = { state: 'idle' } | { state: 'reading' } | { state: 'ready'; items: SpotifyTrack[]; listed: number } | { state: 'failed'; problem: PageProblem };

/**
 * Reads the public page once per opening while `active` (the native cache answers repeats); `retry` asks again.
 * An answer that lands after the view left, or for an older item, is dropped.
 */
export function usePublicList(item: SpotifyItem, active: boolean): { list: PublicList; retry: () => void } {
  const [list, setList] = useState<PublicList>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);
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
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { list, retry };
}

/** The source line above the rows: where the list came from, "first N of M" when the page held only part, and the button that turns the page off. */
export function PageTag({ listed, total, onTurnOff }: { listed: number; total: number | null; onTurnOff: () => void }) {
  return (
    <li
      className="sp-hintline sp-source"
      {...tip(() => (
        <div className="sp-tipline">
          <span>{PAGE_TAG_TIP}</span>
        </div>
      ))}
    >
      {pageTag(listed, total)}
      <button
        type="button"
        className="sp-linkbtn"
        {...tip(() => (
          <div className="sp-tipline">
            <span>{PAGE_TURN_OFF_TIP}</span>
          </div>
        ))}
        onClick={onTurnOff}
      >
        {PAGE_TURN_OFF}
      </button>
    </li>
  );
}

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
            <span>{t.playable && !!t.id ? [t.artists, t.album, trackLength(t.durationMs)].filter(Boolean).join(' · ') : 'This song cannot be played here: it is a local file, or not available in this country.'}</span>
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
        <span className="sp-tlen">{trackLength(t.durationMs)}</span>
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
  heard: SpotifyTrack[];
}

const NOTHING: PlayingState = { playback: null, next: [], heard: [] };

/**
 * The page of a playlist whose songs Spotify will not list: only `line` (why there is no list) and what Play does,
 * until this playlist plays. Then "Playing now", "Up next in Spotify" (the queue, up to 20) and "Heard from this
 * playlist" (Spotify's recently played list filtered to it). Playback and the queue are read on open, when the song
 * changes and every 20 seconds while the page shows; the heard list on open and when the song changes. Nothing is read
 * while the page is hidden, and nothing is stored.
 */
export function WhilePlays({ item, line, onRetry, onTurnOn, onNote, onPlayFrom }: { item: SpotifyItem; line: string; onRetry?: () => void; onTurnOn?: () => void; onNote: (n: string | null) => void; onPlayFrom: (t: SpotifyTrack) => void }) {
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
        setState((s) => ({ ...s, playback: null, next: [] }));
        return;
      }
      let next: SpotifyTrack[] | null = null;
      try {
        const q = await spotify.queue();
        next = Array.isArray(q?.next) ? q.next : [];
      } catch {
        // Keep the last queue that was read.
      }
      if (live) setState((s) => ({ ...s, playback, next: next ?? s.next }));
    };
    void read();
    const id = setInterval(() => void read(), QUEUE_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [visible, title, item.id]);

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
  }, [visible, fromThis, title, item.id]);

  if (!fromThis || !state.playback?.track) {
    return (
      <li className="sp-empty">
        {line}
        {onRetry ? (
          <button type="button" className="sp-btn" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {onTurnOn ? (
          <button
            type="button"
            className="sp-btn"
            {...tip(() => (
              <div className="sp-tipline">
                <span>{PAGE_TURN_ON_TIP}</span>
              </div>
            ))}
            onClick={onTurnOn}
          >
            {PAGE_TURN_ON}
          </button>
        ) : null}
        <span className="sp-hintline">{WHILE_PLAYS}</span>
      </li>
    );
  }
  const now = state.playback.track;
  const heard = state.heard.filter((t) => !(now.id && t.id === now.id));
  const skip = (i: number) => {
    void skipTo(i, state.next.length).then((l) => {
      if (l && mounted.current) onNote(l);
    });
  };
  return (
    <>
      <li className="sp-sec" role="presentation">
        {WHILE_HEADINGS.now}
      </li>
      <TrackRow t={now} index={0} on still onPlay={() => undefined} />
      <li className="sp-sec" role="presentation">
        {WHILE_HEADINGS.next}
      </li>
      {state.next.length === 0 ? (
        <li className="sp-empty">{NOTHING_QUEUED}</li>
      ) : (
        state.next.map((t, i) => <TrackRow key={`next-${t.id ?? 'local'}-${i}`} t={t} index={i} on={false} onPlay={() => skip(i)} />)
      )}
      <li className="sp-sec" role="presentation">
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
