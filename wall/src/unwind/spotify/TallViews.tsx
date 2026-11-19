import { useCallback, useEffect, useRef, useState } from 'react';
import { spotify, type SpotifyQueue } from '../../music/spotify';
import { useNowPlayingStore } from '../../music/store';
import { tip } from '../../ui/HoverTip';
import { useVisible } from '../../ui/useVisible';
import { Cover } from './Cover';
import { problemLine, spotifyProblem, trackLength, useSpotifyNow, type SpotifyProblem } from './model';
import { PlayingBars } from './Tile';
import { QUEUE_POLL_MS } from './UpNext';

/** The honest line Up next shows in the tall view (the Web API cannot reorder or remove). */
export const QUEUE_NOTE = 'Spotify sets the order. A click skips ahead to that song.';

/**
 * Up next as its own view: the song playing, then the songs that follow (the bridge gives at most
 * ten). A click skips ahead to that song with Spotify's next command (the row number is the number of skips). Read when it opens, when the song changes and every
 * 20 seconds while it shows; a busy answer keeps the rows it has.
 */
export function QueueView() {
  const visible = useVisible();
  const title = useNowPlayingStore((s) => s.info?.title ?? '');
  const [queue, setQueue] = useState<SpotifyQueue | null>(null);
  const [problem, setProblem] = useState<SpotifyProblem | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const read = useCallback(() => {
    spotify.queue().then(
      (q) => {
        if (q?.current?.id) useSpotifyNow.setState({ id: q.current.id });
        if (!mounted.current) return;
        setQueue(q ?? null);
        setProblem(null);
        setLoading(false);
      },
      (e) => {
        if (!mounted.current) return;
        const p = spotifyProblem(e);
        if (p !== 'busy') setQueue(null);
        setProblem(p === 'busy' ? null : p);
        setLoading(false);
      },
    );
  }, []);
  useEffect(() => {
    if (!visible) return;
    read();
    const id = setInterval(read, QUEUE_POLL_MS);
    return () => clearInterval(id);
  }, [visible, title, read]);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(id);
  }, [note]);

  const next = queue && queue.current && Array.isArray(queue.next) ? queue.next : [];
  // A click skips ahead by Spotify's own next command on the player it reports, so it works wherever the music plays
  // (the row number is the number of skips, never more than the queue holds), then the queue is read again.
  const skip = (index: number) => {
    const skips = Math.min(index + 1, next.length);
    void (async () => {
      try {
        for (let i = 0; i < skips; i++) await spotify.next();
      } catch (e) {
        if (mounted.current) setNote(`Could not skip. ${problemLine(spotifyProblem(e))}`);
      }
      if (mounted.current) read();
    })();
  };
  if (problem && !queue) {
    return (
      <div className="sp-empty">
        {problemLine(problem)}
        <button type="button" className="sp-btn" onClick={() => { setLoading(true); read(); }}>
          Retry
        </button>
      </div>
    );
  }
  if (loading && !queue) return <div className="sp-empty" aria-busy="true">Reading the queue.</div>;
  if (!queue || !queue.current) return <div className="sp-empty">Nothing is queued. Start a song and what follows shows here.</div>;
  const cur = queue.current;
  return (
    <div className="sp-queue">
      <div className="sp-qhead">
        <span className="sp-gk">Playing now</span>
        <span className="sp-qnote">{note ?? QUEUE_NOTE}</span>
      </div>
      <div className="sp-qlist" role="list">
        <div className="sp-qrow on" role="listitem" aria-current="true">
          <span className="sp-qn">
            <PlayingBars />
          </span>
          <Cover src={cur.thumbUrl ?? cur.imageUrl} size={36} />
          <span className="sp-qname">{cur.name}</span>
          <span className="sp-qart">{cur.artists}</span>
          <span className="sp-qlen">{trackLength(cur.durationMs)}</span>
        </div>
        {next.length === 0 ? <div className="sp-gnone">Nothing follows this song.</div> : null}
        {next.map((t, i) => (
          <button
            key={`${t.id ?? 'local'}-${i}`}
            type="button"
            role="listitem"
            className="sp-qrow"
            aria-disabled={!t.playable}
            {...tip(() => (
              <div className="sp-tipline">
                <b>{t.name}</b>
                <span>{[t.artists, t.album, trackLength(t.durationMs)].filter(Boolean).join(' · ')}</span>
                <em>{t.playable ? 'Click to skip ahead to this song' : 'This song cannot be played here'}</em>
              </div>
            ))}
            onClick={() => t.playable && skip(i)}
          >
            <span className="sp-qn">{i + 1}</span>
            <Cover src={t.thumbUrl ?? t.imageUrl} size={36} />
            <span className="sp-qname">{t.name}</span>
            <span className="sp-qart">{t.artists}</span>
            <span className="sp-qlen">{trackLength(t.durationMs)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
