import { useEffect, useRef, useState } from 'react';
import { IconChevronLeft, IconChevronRight, IconGitPullRequest, IconX } from '@tabler/icons-react';
import { STAGES } from '../agents/model';
import { invoke } from '../bridge/tauri';
import { agentsStale, agentsUntil, useAgentsStore } from '../agents/useAgents';
import { tip } from '../ui/HoverTip';
import { axisRange, dayBefore, isoDay, loadDay, loadDays, longDate, neighbours, recordRows, todayRows, totalsText, useDaysStore, type PanelRow } from './days';
import { hm, hourText, shortTime, wallHour } from './model';

const END_TONE: Record<string, string> = {
  merged: 'dim',
  'pull request open': 'mint',
  'pull request closed': 'faint',
  'carried over': 'cyan',
  'waiting on you': 'amber',
  'in review': 'mint',
  working: 'cyan',
  idle: 'faint',
  finished: 'dim',
};

const LEGEND_NAMES: Record<string, string> = { plan: 'Plan', build: 'Build', review: 'Review', pr: 'PR', live: 'Live' };

/** Skeleton rows while the first read is out: shapes, no numbers. */
function Skeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="at-row skel" aria-hidden="true">
          <span className="num" />
          <span className="at-name" />
          <span className="at-track" />
        </div>
      ))}
    </>
  );
}

/**
 * "Agents today", over the horizon: one row per session with its number, title, stage
 * coloured spans, pull request marks and an end word (merged, carried over, waiting on you,
 * in review), on an hour axis, and the day's totals. Today reads the live summary (the waits
 * are only there) with stage colours from today's saved record when the helper has one; the
 * day picker (Today, Yesterday, arrows through the recorded days) reads the helper's saved
 * record, which has no waits: a past day shows no wait spans and no wait total. With an older
 * helper (no record routes) the picker hides and Today still works. A stale answer is shown
 * with "as of" its time, never as live. Rows open their session; many rows scroll inside.
 * Escape, the close button or a click outside closes it.
 */
export function AgentsToday({ now, onClose }: { now: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const today = isoDay(now);
  const [shown, setShown] = useState(today);
  // A refused open says so here instead of doing nothing.
  const [openFailed, setOpenFailed] = useState(false);
  useEffect(() => {
    if (!openFailed) return;
    const id = setTimeout(() => setOpenFailed(false), 8000);
    return () => clearTimeout(id);
  }, [openFailed]);
  const open = (r: PanelRow) => {
    setOpenFailed(false);
    const call = r.openDate ? invoke('wall2_focus_day_session', { id: r.id, date: r.openDate }) : invoke('wall2_focus_omnigent', { id: r.id });
    call.catch(() => setOpenFailed(true));
  };
  const st = useAgentsStore();
  const days = useDaysStore();
  const isToday = shown === today;
  useEffect(() => {
    void loadDays();
  }, []);
  useEffect(() => {
    void loadDay(shown);
  }, [shown]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || t.closest('.ag-line, .dd-k.link, .rib .agent-row, .hover-tip')) return;
      onClose();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', down);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('mousedown', down);
    };
  }, [onClose]);

  const read = days.records[shown];
  const stale = agentsStale(st);
  const until = agentsUntil(st) ?? now;
  let rows: PanelRow[] | null = null;
  let note = '';
  if (isToday) {
    if (st.summary) rows = todayRows(st.summary, read?.record ?? null, now, Math.min(now, until), st.skewMs);
    note = !st.summary
      ? st.status === 'loading'
        ? ''
        : 'The agents helper is not answering'
      : stale
        ? `As of ${shortTime((st.freshAt ?? st.okAt ?? now) as number)}, may be out of date`
        : 'Click a row to open its session';
  } else if (read && (read.record || !read.failed)) {
    rows = read.record ? recordRows(read.record, now) : [];
    note = read.failed ? `As of ${shortTime(read.at)}, the last read failed` : 'From the saved record of the day';
  } else if (read?.failed) {
    note = 'Could not read the saved record of this day';
  }
  const loading = rows === null && !(read?.failed && !isToday) && (isToday ? st.status === 'loading' : true);
  const picker = days.status === 'ok' && days.days.length > 0;
  // Quiet stamps for saved data that could not be refreshed; live summary data stays live.
  const stamps: string[] = [];
  if (picker && days.listFailedAt !== null && days.listAt !== null) stamps.push(`saved days as of ${shortTime(days.listAt)}`);
  if (isToday && read?.failed && read.record) stamps.push(`stage colours as of ${shortTime(read.at)}`);
  const foot = openFailed ? 'Could not open that session' : [note, ...stamps].filter(Boolean).join('; ');
  const nb = neighbours(days.days, shown, today);
  const yesterday = dayBefore(today);
  const hasYesterday = days.days.some((d) => d.date === yesterday);
  const nowHour = wallHour(now, now);
  const axis = axisRange(rows ?? [], isToday, nowHour);
  const tx = (h: number) => ((Math.min(axis.hi, Math.max(axis.lo, h)) - axis.lo) / (axis.hi - axis.lo)) * 100;
  const hours: number[] = [];
  for (let h = axis.lo; h <= axis.hi; h += axis.step) hours.push(h);
  const noWait = !isToday;
  return (
    <div className={`agents-today${isToday && stale ? ' stale' : ''}`} ref={ref} role="dialog" aria-label="Agents today">
      <div className="at-head">
        <span className="at-k">Agents{picker ? '' : ' today'}</span>
        {picker && (
          <div className="at-pick">
            <button type="button" className="at-arrow" disabled={!nb.prev} aria-label="Earlier day" onClick={() => nb.prev && setShown(nb.prev)} {...tip(nb.prev ? longDate(nb.prev) : 'No earlier saved day')}>
              <IconChevronLeft stroke={1.8} aria-hidden="true" />
            </button>
            <div className="at-seg">
              <button type="button" className={isToday ? 'on' : ''} onClick={() => setShown(today)} {...tip(longDate(today))}>
                Today
              </button>
              <button type="button" className={shown === yesterday ? 'on' : ''} disabled={!hasYesterday} onClick={() => setShown(yesterday)} {...tip(hasYesterday ? longDate(yesterday) : 'No saved record of yesterday')}>
                Yesterday
              </button>
            </div>
            <button type="button" className="at-arrow" disabled={!nb.next} aria-label="Later day" onClick={() => nb.next && setShown(nb.next)} {...tip(nb.next ? (nb.next === today ? 'Today' : longDate(nb.next)) : 'This is today')}>
              <IconChevronRight stroke={1.8} aria-hidden="true" />
            </button>
            <span className="at-date">{longDate(shown)}</span>
          </div>
        )}
        <span className="at-legend" aria-hidden="true">
          {STAGES.map((k) => (
            <span key={k}>
              <i style={{ background: `var(--st-${k})` }} />
              {LEGEND_NAMES[k]}
            </span>
          ))}
          {isToday && (
            <>
              <span>
                <i style={{ background: 'var(--cyan)' }} />
                Running
              </span>
              <span>
                <i style={{ background: 'var(--amber)' }} />
                Waits on you
              </span>
            </>
          )}
          <span>
            <IconGitPullRequest stroke={1.8} />
            Pull request
          </span>
        </span>
        <button type="button" className="at-close" aria-label="Close" onClick={onClose} {...tip('Close (Escape)')}>
          <IconX stroke={1.8} aria-hidden="true" />
        </button>
      </div>
      <div className="at-axis" aria-hidden="true">
        {hours.map((h) => (
          <span key={h} style={{ left: `${tx(h)}%` }}>
            {hourText(h)}
          </span>
        ))}
      </div>
      <div className="at-rows">
        <div className="at-grid" aria-hidden="true">
          {hours.map((h) => (
            <i key={h} style={{ left: `${tx(h)}%` }} />
          ))}
          {isToday && rows && rows.length > 0 && <i className="at-now" style={{ left: `${tx(Math.min(nowHour, wallHour(until, now)))}%` }} />}
        </div>
        {loading && <Skeleton />}
        {rows && rows.length === 0 && <span className="at-none">{isToday ? 'No agent activity yet today' : 'No sessions recorded on this day'}</span>}
        {!loading && !rows && <span className="at-none">{note}</span>}
        {rows?.map((r) => (
          <button
            key={r.id}
            type="button"
            className="at-row"
            onClick={() => open(r)}
            aria-label={`${r.num}. ${r.title}, ${r.end}. Opens it in OmniGent`}
            {...tip(() => (
              <>
                <span className="tip-t">{r.title}</span>
                <span className="tip-s">
                  {r.end}, worked {hm(r.workMs)}
                  {!noWait && r.waitMs > 0 ? `, waited on you ${hm(r.waitMs)}` : ''}
                </span>
                <span className="tip-k">Click to open it in OmniGent</span>
              </>
            ))}
          >
            <span className="num">{r.num}</span>
            <span className="at-name">{r.title}</span>
            <span className="at-track">
              {r.spans
                .filter((x) => !(noWait && x.kind === 'wait'))
                .map((x, i) => (
                  <i key={i} className={`at-sg ${x.kind}`} style={{ left: `${tx(x.from)}%`, width: `max(4px, calc(${tx(x.to) - tx(x.from)}% - 2px))` }} />
                ))}
              {r.pr !== null && r.prAt !== null && (
                <span className="at-pr" style={{ left: `${tx(r.prAt)}%` }}>
                  <IconGitPullRequest stroke={1.8} aria-hidden="true" />
                  PR {r.pr}
                </span>
              )}
            </span>
            <span className={`at-end t-${END_TONE[r.end] ?? 'dim'}`}>{r.end}</span>
            <span className="at-time">{hm(r.workMs)}</span>
          </button>
        ))}
      </div>
      <div className="at-foot">
        <span>{rows && rows.length > 0 ? totalsText(rows, isToday) : ''}</span>
        <span className={`at-note${openFailed ? ' warn' : ''}`}>{rows || openFailed ? foot : ''}</span>
      </div>
    </div>
  );
}
