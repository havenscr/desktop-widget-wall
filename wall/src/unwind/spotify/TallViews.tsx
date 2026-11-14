import { useCallback, useEffect, useRef, useState } from 'react';
import { spotify, type SpotifyItem, type SpotifyQueue } from '../../music/spotify';
import { useNowPlayingStore } from '../../music/store';
import { tip } from '../../ui/HoverTip';
import { useVisible } from '../../ui/useVisible';
import { Cover } from './Cover';
import { problemLine, spotifyProblem, trackLength, useSpotifyNow, type SpotifyProblem } from './model';
import { Tile, PlayingBars } from './Tile';
import { QUEUE_POLL_MS, runSkips, skipPlan } from './UpNext';

/** The honest line Up next shows in the tall view (the Web API cannot reorder or remove). */
export const QUEUE_NOTE = 'Spotify sets the order. A click skips ahead to that song.';

/**
 * Search in groups (the tall view): songs on the left, albums and playlists, three tiles each, on the
 * right. A song plays on a click; an album or playlist opens its songs, with the same details card
 * the library tiles have.
 */
export function SearchGroups({
  items,
  isNow,
  onPlay,
  onOpen,
  onShuffle,
}: {
  items: SpotifyItem[];
  isNow: (t: { id: string | null; name: string; artists?: string | null }) => boolean;
  onPlay: (item: SpotifyItem) => void;
  onOpen: (item: SpotifyItem) => void;
  onShuffle: (item: SpotifyItem) => void;
}) {
  const tracks = items.filter((i) => i.kind === 'track');
  const albums = items.filter((i) => i.kind === 'album');
  const playlists = items.filter((i) => i.kind === 'playlist');
  const tiles = (list: SpotifyItem[], none: string) =>
    list.length === 0 ? (
      <div className="sp-gnone">{none}</div>
    ) : (
      <div className="sp-grid sp-grid3" role="list">
        {list.map((item, i) => (
          <Tile key={`${item.kind}-${item.id}-${i}`} item={item} kindWord={false} onOpen={() => onOpen(item)} onPlay={() => onPlay(item)} onShuffle={() => onShuffle(item)} />
        ))}
      </div>
    );
  return (
    <div className="sp-groups">
      <div className="sp-group songs">
        <span className="sp-gk">Songs</span>
        {tracks.length === 0 ? (
          <div className="sp-gnone">No songs found.</div>
        ) : (
          <div className="sp-gscroll" role="list">
            {tracks.map((item, i) => {
              const on = isNow({ id: item.id, name: item.name, artists: item.subtitle });
              return (
                <button
                  key={`${item.id}-${i}`}
                  type="button"
                  role="listitem"
                  className={`sp-li${on ? ' on' : ''}`}
                  aria-label={`Play ${item.name}${item.subtitle ? ` by ${item.subtitle}` : ''}`}
                  {...tip(() => (
                    <div className="sp-tipline">
                      <b>{item.name}</b>
                      <span>{item.subtitle ?? 'Song'}</span>
                      <em>Click to play</em>
                    </div>
                  ))}
                  onClick={() => onPlay(item)}
                >
                  <Cover src={item.thumbUrl ?? item.imageUrl} size={40} />
                  <span className="sp-text">
                    <span className="sp-li-n">{item.name}</span>
                    <span className="sp-li-a">{on ? 'Playing now' : item.subtitle ?? ''}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="sp-group side">
        <div className="sp-gscroll">
          <span className="sp-gk">Albums</span>
          {tiles(albums, 'No albums found.')}
          <span className="sp-gk second">Playlists</span>
          {tiles(playlists, 'No playlists found.')}
        </div>
      </div>
    </div>
  );
}

/**
 * Up next as its own view: the song playing, then the songs that follow (the bridge gives at most
 * ten). A click skips ahead to that song through Windows, exactly as the left wing's Up next does,
 * and says so when it cannot (see `skipPlan`). Read when it opens, when the song changes and every
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
  const skip = (index: number) => {
    const plan = skipPlan(index, next.length);
    if (plan.kind === 'none') {
      setNote(plan.line);
      return;
    }
    void runSkips(plan.skips).then((line) => {
      if (line && mounted.current) setNote(line);
    });
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
