import { useEffect, useRef, useState } from 'react';
import { IconChevronRight } from '@tabler/icons-react';
import type { YtVideo } from '../../music/youtube';
import { tip } from '../../ui/HoverTip';
import { fetchMood, openDefaultMood, loadAllForYou, loadForYou, moodBudgetLine, pickMood, setForYouView, useForYou, useMoods, whenWords } from './forYouStore';
import { useVisible } from '../../ui/useVisible';
import { lengthText } from './model';
import { playFrom } from './queue';
import { TileSkeletons, YtEmpty, YtState, YtThumb, gridKey } from './YtParts';

/** The eight mood words (vote 2A). A click shows that mood's music: a YouTube search, kept 7 days, 10 searches a week. */
export const MOODS = ['Focus', 'Energize', 'Relax', 'Sleep', 'Chill', 'Workout', 'Party', 'Romance'] as const;
export const MOOD_TIP = 'Shows music for this mood from YouTube. It uses one of 10 mood searches a week; a mood you already opened this week costs none.';
/** Tiles on a shelf at rest. */
export const SHELF = 4;
export const EMPTY_FOR_YOU = 'Nothing played here yet. A video you play on the wall shows up here for 30 days.';

function PlayedTile({ v, line, onPlay }: { v: YtVideo; line: string; onPlay: () => void }) {
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
        <span className="sp-tline yt-count">{line}</span>
      </button>
    </div>
  );
}

/** The open mood's shelf: four tiles and See all, like the shelf under it; a spent budget or a problem is one calm line. */
function MoodShelfView({ mood }: { mood: string }) {
  const shelf = useMoods((m) => m.byMood[mood]);
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [mood]);
  if (!shelf || shelf.loading) return (
    <section className="yt-shelf" aria-label={mood}>
      <div className="yt-shelfhead"><span className="yt-shelfname">{mood}</span></div>
      <TileSkeletons count={SHELF} />
    </section>
  );
  const shown = all ? shelf.rows : shelf.rows.slice(0, SHELF);
  const body = shelf.problem ? (
    <YtState problem={shelf.problem} onRetry={() => void fetchMood(mood)} />
  ) : shelf.backAt !== null && shelf.rows.length === 0 ? (
    <YtEmpty text={moodBudgetLine(shelf.backAt)} />
  ) : shelf.rows.length === 0 ? (
    <YtEmpty text="Nothing came back for this mood." />
  ) : (
    <div className="yt-grid">
      {shown.map((v, i) => (
        <PlayedTile key={v.id} v={v} line={v.channel} onPlay={() => playFrom(shown, i, { list: 'mood', mood })} />
      ))}
    </div>
  );
  return (
    <section className="yt-shelf" aria-label={mood}>
      <div className="yt-shelfhead">
        <span className="yt-shelfname">{mood}</span>
        <span className="yt-shelfsub">music from YouTube</span>
        {shelf.rows.length > SHELF ? (
          <button type="button" className="yt-seeall" onClick={() => setAll(!all)}>
            {all ? 'Back to the shelf' : <>See all <IconChevronRight size={20} aria-hidden="true" /></>}
          </button>
        ) : null}
      </div>
      {body}
    </section>
  );
}

/**
 * The For you tab: the mood chip row on top, then shelves, each a heading with a grey line saying where it comes
 * from, one row of four tiles and "See all", which shows the whole shelf in the library's own grid. Under the chips a
 * clicked mood shows its own shelf (`pickMood`); the one that is always there is "Played on the wall" (last 30 days): what the wall itself played (see `forYouStore.ts`). A tile plays that video, and the ones
 * after it in the shelf, on the wall.
 */
export function ForYou({ tall }: { tall: boolean }) {
  const s = useForYou();
  const openMood = useMoods((m) => m.open);
  const [all, setAll] = useState(false);
  const visible = useVisible();
  // With no mood open the tab opens the default one, once per mount and only while it is on screen.
  const asked = useRef(false);
  useEffect(() => {
    if (!visible || asked.current) return;
    asked.current = true;
    openDefaultMood();
  }, [visible]);
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
          <PlayedTile key={v.id} v={v} line={whenWords(s.at.get(v.id))} onPlay={() => playFrom(shown, i, { list: 'played' })} />
        ))}
      </div>
      {all && s.loading ? <TileSkeletons count={SHELF} /> : null}
    </>
  );
  return (
    <div className="yt-foryou">
      <div className="yt-chips" role="group" aria-label="Moods">
        {MOODS.map((m) => (
          <button key={m} type="button" className="yt-chip" aria-pressed={openMood === m} onClick={() => void pickMood(m)} {...tip(MOOD_TIP)}>
            {m}
          </button>
        ))}
      </div>
      <div className="yt-scroll" data-tall={tall ? 'true' : 'false'}>
        {openMood ? <MoodShelfView mood={openMood} /> : null}
        <section className="yt-shelf" aria-label="Played on the wall">
          <div className="yt-shelfhead">
            <span className="yt-shelfname">Played on the wall</span>
            <span className="yt-shelfsub">last 30 days</span>
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
