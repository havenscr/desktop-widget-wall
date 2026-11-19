import { useEffect, useState } from 'react';
import { IconChevronRight } from '@tabler/icons-react';
import type { YtVideo } from '../../music/youtube';
import { tip } from '../../ui/HoverTip';
import { loadAllForYou, loadForYou, setForYouView, useForYou, whenWords } from './forYouStore';
import { useVisible } from '../../ui/useVisible';
import { lengthText } from './model';
import { playFrom } from './queue';
import { TileSkeletons, YtEmpty, YtState, YtThumb, gridKey } from './YtParts';

/** The eight mood words (vote 2A). The chips only show for now: the searches behind them arrive in a later change. */
export const MOODS = ['Focus', 'Energize', 'Relax', 'Sleep', 'Chill', 'Workout', 'Party', 'Romance'] as const;
export const MOOD_TIP = 'Mood playlists arrive in a later update';
/** Tiles on a shelf at rest. */
export const SHELF = 4;
export const EMPTY_FOR_YOU = 'Nothing played here yet. A video you play on the wall shows up here for 30 days.';

function PlayedTile({ v, at, onPlay }: { v: YtVideo; at: number | undefined; onPlay: () => void }) {
  const when = whenWords(at);
  const card = tip(() => (
    <div className="sp-tipline">
      <b>{v.title}</b>
      <span>{[v.channel, v.seconds > 0 ? lengthText(v.seconds) : ''].filter(Boolean).join(' · ')}</span>
      <span>Click to play it on the wall</span>
    </div>
  ));
  return (
    <div className="sp-tilebox">
      <button type="button" className="sp-tile yt-tile" onKeyDown={gridKey} {...card} onClick={onPlay}>
        <YtThumb src={v.thumb} className="sp-tilecover yt-cover" />
        <span className="sp-tname2">{v.title}</span>
        <span className="sp-tline yt-count">{when}</span>
      </button>
    </div>
  );
}

/**
 * The For you tab: the mood chip row on top, then shelves, each a heading with a grey line saying where it comes
 * from, one row of four tiles and "See all", which shows the whole shelf in the library's own grid. For now the
 * one shelf is "Back to": what the wall itself played (see `forYouStore.ts`). A tile plays that video, and the ones
 * after it in the shelf, on the wall.
 */
export function ForYou({ tall }: { tall: boolean }) {
  const s = useForYou();
  const [all, setAll] = useState(false);
  const visible = useVisible();
  // The shelf tells the store when it is on screen, so a play written meanwhile reads again only then.
  useEffect(() => {
    setForYouView(visible, all);
    return () => setForYouView(false, false);
  }, [visible, all]);
  useEffect(() => {
    if (all) void loadAllForYou();
  }, [all]);
  const first = s.rows.length === 0;
  const more = s.rows.length > SHELF || s.rest.length > 0;
  const shown = all ? s.rows : s.rows.slice(0, SHELF);
  const skeleton = <TileSkeletons count={SHELF} />;
  const body = s.problem && first ? (
    <YtState problem={s.problem} onRetry={() => void loadForYou(true)} />
  ) : !s.loaded && first ? (
    skeleton
  ) : s.loaded && first && !s.loading ? (
    <YtEmpty text={EMPTY_FOR_YOU} />
  ) : first ? (
    skeleton
  ) : (
    <>
      <div className="yt-grid">
        {shown.map((v, i) => (
          <PlayedTile key={v.id} v={v} at={s.at.get(v.id)} onPlay={() => playFrom(shown, i, { list: 'played' })} />
        ))}
      </div>
      {all && s.loading ? <TileSkeletons count={SHELF} /> : null}
    </>
  );
  return (
    <div className="yt-foryou">
      <div className="yt-chips" role="group" aria-label="Moods">
        {MOODS.map((m) => (
          <button key={m} type="button" className="yt-chip" aria-disabled="true" tabIndex={-1} onClick={(e) => e.preventDefault()} {...tip(MOOD_TIP)}>
            {m}
          </button>
        ))}
      </div>
      <div className="yt-scroll" data-tall={tall ? 'true' : 'false'}>
        <section className="yt-shelf" aria-label="Back to">
          <div className="yt-shelfhead">
            <span className="yt-shelfname">Back to</span>
            <span className="yt-shelfsub">what the wall played</span>
            {all ? (
              <button type="button" className="yt-seeall" onClick={() => {
                  setAll(false);
                  // A play made on See all marked the shelf stale: read it now that the list is short again.
                  void loadForYou();
                }}>
                Back to the shelf
              </button>
            ) : more ? (
              <button type="button" className="yt-seeall" onClick={() => setAll(true)}>
                See all <IconChevronRight size={20} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {body}
          {all && s.problem && !first ? <YtState problem={s.problem} onRetry={() => void loadAllForYou()} /> : null}
        </section>
      </div>
    </div>
  );
}
