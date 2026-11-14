import { useEffect, useRef, useState } from 'react';
import { invoke } from '../../bridge/tauri';
import { spotify, type SpotifyTrack } from '../../music/spotify';
import { isQuiet } from '../../music/model';
import { playerName, sourceKey } from '../../music/players';
import { refreshNowPlaying, useNowPlayingStore } from '../../music/store';
import { useToolsStore } from '../../tools/store';
import { tip } from '../../ui/HoverTip';
import { useVisible } from '../../ui/useVisible';
import { Cover } from './Cover';
import { playProblemLine, spotifyProblem, trackLength, upNextPlan, useLastContext, useListenSource, useSpotifyNow } from './model';
import { useSpotifyStatus } from './status';

/** How often the queue is read while Up next shows (and again when the track changes). */
export const QUEUE_POLL_MS = 20_000;
export const UP_NEXT_ROWS = 3;

/**
 * Up next (8B), in the left wing under the toggles: the next three tracks with their covers,
 * title and artist. A click plays that track without ever replacing the queue: in its list when
 * that list is what plays, else by skipping forward when Spotify is the current player, else it
 * says "Open its list to play it" (see `upNextPlan`). Hover shows the album and the length. Hidden with YouTube Music
 * chosen, with Spotify not set up, and when nothing is queued; signed out it says where to sign in.
 */
export function UpNext() {
  const source = useListenSource((s) => s.source);
  const status = useSpotifyStatus((s) => s.status);
  const title = useNowPlayingStore((s) => s.info?.title ?? '');
  const visible = useVisible();
  const [next, setNext] = useState<SpotifyTrack[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);
  const ready = source === 'spotify' && !!status && status.setup && status.signedIn;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!ready || !visible) return;
    const read = () =>
      spotify.queue().then(
        (q) => {
          if (q?.current?.id) useSpotifyNow.setState({ id: q.current.id });
          if (mounted.current) setNext(Array.isArray(q?.next) && q.current ? q.next.slice(0, UP_NEXT_ROWS) : []);
        },
        // Busy keeps what shows (it is still the queue); anything else hides the rows.
        (e) => mounted.current && spotifyProblem(e) !== 'busy' && setNext([]),
      );
    void read();
    const id = setInterval(() => void read(), QUEUE_POLL_MS);
    return () => clearInterval(id);
  }, [ready, visible, title]);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(id);
  }, [note]);

  if (source !== 'spotify' || !status || !status.setup) return null;
  if (!status.signedIn) {
    return (
      <div className="u-next">
        <span className="u-k">Up next</span>
        <button type="button" className="u-next-signin" title="Open Tools, where Spotify is signed in" onClick={() => useToolsStore.getState().openDrawer('accounts')}>
          Sign in to Spotify in Tools to see what is next
        </button>
      </div>
    );
  }
  if (next.length === 0) return null;

  const play = async (t: SpotifyTrack, index: number) => {
    // What plays now decides the path (see `upNextPlan`); a failed read means "unknown", never a guess.
    const playback = await spotify.playback().catch(() => null);
    const info = useNowPlayingStore.getState().info;
    const spotifyIsCurrent = !isQuiet(info) && playerName(sourceKey(info)) === 'Spotify';
    const plan = upNextPlan(t.id, index, useLastContext.getState(), playback?.track?.id ?? null, spotifyIsCurrent);
    try {
      if (plan.kind === 'context') await spotify.play('track', plan.offsetId, { context: plan.context, offsetId: plan.offsetId });
      else if (plan.kind === 'skip') for (let i = 0; i < plan.skips; i++) await invoke('media_next');
      else {
        if (mounted.current) setNote(plan.line);
        return;
      }
      void refreshNowPlaying();
    } catch (e) {
      if (mounted.current) setNote(playProblemLine(spotifyProblem(e)));
    }
  };

  return (
    <div className="u-next" aria-label="Up next">
      <span className="u-k">Up next</span>
      <ol className="u-next-list">
        {next.map((t, i) => (
          <li key={`${t.id ?? 'local'}-${i}`}>
            <button
              type="button"
              className="u-next-row"
              disabled={!t.playable}
              {...tip(() => (
                <div className="sp-tipline">
                  <b>{t.name}</b>
                  <span>
                    {[t.album, trackLength(t.durationMs)].filter(Boolean).join(' · ')}
                    {t.playable ? '' : ' · cannot be played here'}
                  </span>
                </div>
              ))}
              onClick={() => void play(t, i)}
            >
              <Cover src={t.thumbUrl} size={48} />
              <span className="u-next-t">{t.name}</span>
              <span className="u-next-a">{t.artists}</span>
            </button>
          </li>
        ))}
      </ol>
      {note ? <div className="u-next-note">{note}</div> : null}
    </div>
  );
}
