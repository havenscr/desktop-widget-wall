import { IconArrowLeft, IconArrowRight, IconMessageCircle, IconNotes, IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StudioBlock } from '../../studio/StudioBlock';
import { useSignalStore } from '../../signals/store';
import { tip } from '../../ui/HoverTip';
import { NotesCard } from '../NotesCard';
import { atLimit, clampIndex, elapsedMs, formatShowTime, partTime, RESET_CONFIRM_MS, startedLine } from '../model';
import { useOnAirStore } from '../store';
import { statusStale } from '../ytlive';
import { useChatPolling, useYtLive } from '../ytliveStore';
import { Comments } from './Comments';
import { ExpandButton, SplitHandle, useSplit } from './SplitHandle';
import { SPLIT_GAP, widths } from './splitModel';
import { clockText } from './time';
import { StudioKeys } from './StudioKeys';
import { Head } from './Tiles';
import { StudioStatus } from './StudioStatus';
import { useStudioPolling } from './studioStore';

/** The notes' size: one, the card is 436 wide and only Previous and Next sit under it. */
const LIVE_NOTE_SIZES = [27] as const;

/** The broadcast starts the timer once per start time; a Reset by hand is not undone by the next read. */
const autoStarted = new Set<number>();

/** The show timer. When the broadcast goes live and the timer is idle it starts by itself from the broadcast's start. */
function LiveTimer({ now }: { now: number }) {
  const saved = useOnAirStore((s) => s.saved);
  const start = useOnAirStore((s) => s.start);
  const stop = useOnAirStore((s) => s.stop);
  const reset = useOnAirStore((s) => s.reset);
  const startAt = useOnAirStore((s) => s.startAt);
  const status = useYtLive((s) => s.status);
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (saved.running) setConfirm(false);
  }, [saved.running]);
  const startedAt = status && status.state === 'live' && !statusStale(status, now) ? status.startedAt : null;
  useEffect(() => {
    if (startedAt === null || autoStarted.has(startedAt)) return;
    autoStarted.add(startedAt);
    startAt(startedAt, now);
    // Read the clock once when the start time arrives; later ticks never start it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, startAt]);
  const ms = elapsedMs(saved, now);
  const time = formatShowTime(ms);
  const full = atLimit(saved);
  const nothing = !saved.running && ms === 0 && saved.firstStartAt === null;
  const fromBroadcast = status?.state === 'live' && status.startedAt !== null && saved.firstStartAt !== null && Math.abs(saved.firstStartAt - status.startedAt) < 1500;
  const sub = nothing ? 'Not started. It starts with the broadcast, or press Start.' : fromBroadcast && saved.running ? `Started ${clockText(status!.startedAt!)}, when the broadcast went live.` : startedLine(saved, now);
  const onReset = () => {
    if (saved.running || nothing) return;
    if (confirm) {
      clearTimeout(timer.current);
      setConfirm(false);
      reset();
      return;
    }
    setConfirm(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setConfirm(false), RESET_CONFIRM_MS);
  };
  return (
    <div className="oa2-b oa2-timer oa2-showtimer" role="group" aria-label="Show timer">
      <Head label="Show timer" />
      <div className="oa-time-row">
        <span className="oa-time" data-running={saved.running ? 'true' : 'false'} role="timer" aria-label={`Show time ${time}`} {...tip(saved.running ? 'Counts from when the broadcast went live, or from when you pressed Start.' : 'Not running')}>
          {time}
        </span>
        <div className="oa-time-btns">
          {saved.running ? (
            <button type="button" className="oa-btn cy oa-go" aria-label="Stop timer" onClick={stop} {...tip('Stop the timer (it keeps its time; Start carries on)')}>
              <IconPlayerPauseFilled size={20} aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button type="button" className="oa-btn cy oa-go" aria-label="Start timer" aria-disabled={full} onClick={start} {...tip(full ? 'The timer stopped itself at 24 hours. Reset it to start again.' : ms > 0 ? `Carry on from ${time}` : 'Start the show timer')}>
              <IconPlayerPlayFilled size={20} aria-hidden="true" />
              Start
            </button>
          )}
          <button type="button" className={`oa-btn oa-reset${confirm ? ' confirm' : ''}`} aria-disabled={saved.running || nothing} onClick={onReset} {...tip(saved.running ? 'Stop the timer first to reset it' : nothing ? 'Nothing to reset yet' : 'Set the timer to 00:00 and go back to the first part (asks again first)')}>
            {confirm ? 'Reset? Click again' : 'Reset'}
          </button>
        </div>
      </div>
      <div className="oa2-sub" {...tip(sub)}>
        {sub}
      </div>
    </div>
  );
}

/** What YouTube says (live, stale, scheduled) and what the browser holds (camera and mic). */
function LiveChips({ now }: { now: number }) {
  const status = useYtLive((s) => s.status);
  const browserAv = useSignalStore((s) => s.browserAv);
  const call = useSignalStore((s) => s.call);
  const stale = status ? statusStale(status, now) : false;
  let yt: React.ReactNode = null;
  if (status?.state === 'live') {
    const since = status.startedAt !== null ? `, since ${clockText(status.startedAt)}` : '';
    const watching = status.viewers !== null ? `, ${status.viewers} watching` : '';
    yt = stale ? (
      <span className="oa2-chip" data-kind="stale">
        Live, as of {clockText(status.readAt ?? now)}
      </span>
    ) : (
      <span className="oa2-chip" data-kind="live">
        <i className="oa2-dot" data-mode="live" aria-hidden="true" />
        Live{watching}
        {since}
      </span>
    );
  } else if (status?.state === 'scheduled' && status.scheduledAt !== null) {
    const min = Math.max(0, Math.round((status.scheduledAt - now) / 60_000));
    yt = (
      <span className="oa2-chip" data-kind="stale">
        Scheduled, {clockText(status.scheduledAt)}, in {min} min
      </span>
    );
  } else if (status?.state === 'none') {
    yt = (
      <span className="oa2-chip" data-kind="stale">
        Nothing live on YouTube
      </span>
    );
  }
  const av = browserAv || call?.camera === true;
  return (
    <div className="oa2-b oa2-chips oa2-livechips">
      {yt}
      {av && (
        <span className="oa2-chip" data-kind="call">
          Camera and mic on
        </span>
      )}
    </div>
  );
}

/** The run of show as one small line: the part, the time left in it and two arrow buttons. Not drawn without parts. */
function RunLine({ now }: { now: number }) {
  const show = useOnAirStore((s) => s.show);
  const saved = useOnAirStore((s) => s.saved);
  const goPart = useOnAirStore((s) => s.goPart);
  const parts = show?.state === 'ok' ? show.parts : [];
  // Not drawn without parts (no file, a refused file, a failed read): the box stays in the DOM, hidden.
  if (parts.length === 0) return <div className="oa2-b oa2-runline" hidden />;
  const i = clampIndex(saved.partIndex, parts.length);
  const p = parts[i];
  const t = partTime(p, true, Math.max(0, elapsedMs(saved, now) - saved.partSinceMs));
  const line = `Part ${i + 1} of ${parts.length}: ${p.name}${t.text ? ` · ${t.text}` : ''}`;
  return (
    <div className="oa2-b oa2-runline" role="group" aria-label="Run of show">
      <span className="oa2-runline-t ellipsis" {...tip(line)}>
        {line}
      </span>
      <button type="button" className="oa-btn oa2-arrow" aria-label="Previous part" aria-disabled={i === 0} onClick={() => goPart(i - 1)} {...tip('Go back one part')}>
        <IconArrowLeft size={20} aria-hidden="true" />
      </button>
      <button type="button" className="oa-btn cy oa2-arrow" aria-label="Next part" aria-disabled={i >= parts.length - 1} onClick={() => goPart(i + 1)} {...tip('Go to the next part')}>
        <IconArrowRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Where the split area starts inside the frame. */
const SPLIT_X = 676;

/** A folded panel: 72 px wide, its count, and a click puts it back. */
function Rail({ kind, count, left, onClick }: { kind: 'comments' | 'notes'; count: number; left: number; onClick: () => void }) {
  const isC = kind === 'comments';
  const label = isC ? `${count} new comment${count === 1 ? '' : 's'} since you folded it. Show comments` : `${count} part${count === 1 ? '' : 's'} left. Show notes`;
  return (
    <button type="button" className={`panel oa2-b oa2-rail oa2-rail-${kind}`} style={{ left }} aria-label={label} onClick={onClick} {...tip(isC ? 'Show the comments' : 'Show the notes')}>
      {isC ? <IconMessageCircle size={22} aria-hidden="true" /> : <IconNotes size={22} aria-hidden="true" />}
      <span className="oa2-rail-n">{count}</span>
      <span className="oa2-rail-w">{isC ? 'new' : 'left'}</span>
    </button>
  );
}

/** The comments and the notes side by side, with the handle between them, or one of them folded to a rail. */
function SplitArea({ now }: { now: number }) {
  const status = useYtLive((s) => s.status);
  const chat = useYtLive((s) => s.chat);
  const show = useOnAirStore((s) => s.show);
  const saved = useOnAirStore((s) => s.saved);
  const entered = useRef(Date.now()).current;
  const key = status === null ? null : status.state === 'live' && status.startedAt !== null ? `yt-${status.startedAt}` : `page-${entered}`;
  const { mode, set } = useSplit(key);
  const w = widths(mode);
  const folded = mode === 'full' || mode === 'rail';
  // New comments since the panel folded: counted from ids kept in memory only, never the text.
  const [seen, setSeen] = useState<Set<string> | null>(null);
  const ids = useMemo(() => (chat?.messages ?? []).map((m) => m.id), [chat]);
  const commentsFolded = mode === 'rail';
  useEffect(() => {
    setSeen(commentsFolded ? new Set(ids) : null);
    // Taken once when the panel folds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsFolded]);
  const fresh = seen ? ids.filter((id) => !seen.has(id)).length : 0;
  const parts = show?.state === 'ok' ? show.parts : [];
  const left = parts.length === 0 ? 0 : parts.length - clampIndex(saved.partIndex, parts.length);
  const cLeft = SPLIT_X;
  const nLeft = SPLIT_X + w.comments + SPLIT_GAP;
  return (
    <>
      {mode === 'rail' ? (
        <Rail kind="comments" count={fresh} left={cLeft} onClick={() => set(620)} />
      ) : (
        <Comments now={now} style={{ left: cLeft, width: w.comments }} action={<ExpandButton expanded={mode === 'full'} what="comments" onClick={() => set(mode === 'full' ? 620 : 'full')} />} />
      )}
      {!folded && <SplitHandle comments={w.comments} left={cLeft + w.comments} onChange={set} />}
      {mode === 'full' ? (
        <Rail kind="notes" count={left} left={nLeft} onClick={() => set(620)} />
      ) : (
        <NotesCard
          title="Notes"
          sizes={LIVE_NOTE_SIZES}
          icon={<IconNotes size={20} aria-hidden="true" />}
          className="oa2-livenotes"
          style={{ left: nLeft, width: w.notes }}
          action={<ExpandButton expanded={mode === 'rail'} what="notes" onClick={() => set(mode === 'rail' ? 620 : 'rail')} />}
        />
      )}
    </>
  );
}

/**
 * The Live page: the show timer, the YouTube and camera chips, the run of show line, the comments (with the channel field in the
 * card), the notes, the studio keys, the studio status and the studio lights. The prompter's box stays empty until its own pull request.
 */
export function LivePage({ now }: { now: number }) {
  useChatPolling();
  useStudioPolling();
  return (
    <>
      <LiveTimer now={now} />
      <LiveChips now={now} />
      <StudioStatus now={now} />
      <RunLine now={now} />
      <SplitArea now={now} />
      <StudioKeys now={now} />
      <div className="oa2-b oa2-empty oa2-empty-prompter oa2-empty-live" aria-hidden="true" />
      <div className="oa2-b oa2-lights-live">
        <StudioBlock />
      </div>
    </>
  );
}
