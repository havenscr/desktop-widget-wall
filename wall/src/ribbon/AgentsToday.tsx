import { useEffect, useRef, useState } from 'react';
import { IconAlertTriangle, IconChevronLeft, IconChevronRight, IconGitPullRequest, IconX } from '@tabler/icons-react';
import { STAGES } from '../agents/model';
import { invoke } from '../bridge/tauri';
import { agentsStale, agentsUntil, useAgentsStore } from '../agents/useAgents';
import { tip } from '../ui/HoverTip';
import { useBusyToday } from './AgentRow';
import { busyLevels, busyStep, knownLimit, shortSpan, stepsFor, stepWords, timeBySteps, type BusySpan } from './busy';
import { axisRange, dayBefore, dayStart, isoDay, loadDay, loadDays, longDate, neighbours, recordRows, todayRows, totalsText, useDaysStore, type PanelRow } from './days';
import { useBehindDrawer } from './DrawerScrim';
import { hm, hourText, shortTime, wallHour } from './model';

const END_TONE: Record<string, string> = {
  merged: 'dim',
  'pull request open': 'mint',
  'pull request closed': 'faint',
  'carried over': 'cyan',
  'waiting on you': 'amber',
  'in review': 'mint',
  working: 'cyan',
  'helpers working': 'mint',
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

const HOUR_MS = 3_600_000;

/** "9:36 AM" for an hour of the day shown (0 to 24). */
function clockAt(h: number): string {
  const m = Math.round(h * 60);
  const hh = Math.floor(m / 60) % 24;
  return `${hh % 12 || 12}:${String(m % 60).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}
/** The "Sessions busy at once" row: bar height for each step (one, two, three, at the limit, over it). */
const BAND_H = [0, 6, 11, 16, 21, 28];

/**
 * "Busy at once" under the heading: the time spent at each count of sessions working at once
 * (each with its colour swatch), and how long it was over the limit. Its tooltip says what is
 * counted: today the live day log's runs (a session and its helpers count once, waiting does
 * not count). A past day's saved record cannot tell running from waiting (it has stage spans
 * only), so there the line reads "Open at once", counts every session with a recorded span, and
 * never says "over your limit": it only says the most that were open at once.
 */
function BusyLine({ spans, limit, today }: { spans: BusySpan[]; limit: number; today: boolean }) {
  const by = timeBySteps(spans, limit);
  const over = today && by[5] >= 60_000;
  const peak = busyLevels(spans).reduce((m, l) => Math.max(m, l.count), 0);
  const rule = today
    ? 'Counts sessions working at once: runs in the live day log of parent and standalone sessions; a session and its helpers count once, waiting does not count.'
    : 'Sessions open at once, from the saved record. The record has stage spans only, with no runs and no waits, so every session with a recorded span counts, working or not.';
  return (
    <div
      className="at-busy"
      {...tip(() => (
        <>
          <span className="tip-t">{today ? 'Busy at once today' : 'Open at once, from the saved record'}</span>
          <span className="tip-s">{rule}</span>
          {today && <span className="tip-s">Your limit is {limit}, from the agents helper.</span>}
        </>
      ))}
    >
      <span className="at-busy-k">{today ? 'Busy at once' : 'Open at once'}</span>
      {stepsFor(limit).map((st) => (
        <span key={st} className="at-busy-s">
          <i className={`sw b${today ? st : Math.min(3, st)}`} aria-hidden="true" />
          <span className="w">{today ? stepWords(st, limit) : stepWords(st, limit).replace('over', 'more than')}</span>
          <b className={by[st] >= 60_000 ? (today && st === 5 ? 'over' : '') : 'none'}>{shortSpan(by[st])}</b>
        </span>
      ))}
      <span className={`at-busy-sum${over ? ' over' : ''}`}>
        {over && <IconAlertTriangle stroke={2} aria-hidden="true" />}
        {today
          ? over
            ? `Over your limit of ${limit} for ${shortSpan(by[5])} today`
            : `Never over your limit of ${limit} today`
          : `Up to ${peak} open at once, from the saved record`}
      </span>
    </div>
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
 * Escape, the close button or a click outside closes it; behind it the page is dimmed and inert (see DrawerScrim).
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
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  // The page behind is dimmed and inert; a click on the scrim (DrawerScrim) closes the panel.
  useBehindDrawer(ref, onClose, 'opener');

  const read = days.records[shown];
  const busyT = useBusyToday(now);
  const stale = agentsStale(st);
  const until = agentsUntil(st) ?? now;
  let rows: PanelRow[] | null = null;
  let note = '';
  if (isToday) {
    if (st.summary) rows = todayRows(busyT?.summary ?? st.summary, read?.record ?? null, now, Math.min(now, until), st.skewMs, busyT?.ends);
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
  // Busy at once: today from the live working spans (one rule with the meter and the strip),
  // a past day from its record's spans (hours from that day's midnight). The limit is the
  // helper's, as the meter reads it; with no live answer there is no limit to measure against.
  const limit = knownLimit(st.summary?.slots.limit);
  const base = isToday ? dayStart(today) : 0;
  const busySpans: BusySpan[] = isToday ? (busyT?.spans ?? []) : (rows ?? []).flatMap((r) => r.spans.map((x) => ({ id: r.id, start: x.from * HOUR_MS, end: x.to * HOUR_MS })));
  const showBusy = limit !== null && rows !== null && rows.length > 0;
  const lim = limit ?? 0;
  // One bar per stretch at the same step (over the limit is one hatched stretch, whatever the count).
  const band: { from: number; to: number; step: number; lo: number; hi: number }[] = [];
  for (const l of showBusy ? busyLevels(busySpans) : []) {
    const from = (l.start - base) / HOUR_MS;
    const to = (l.end - base) / HOUR_MS;
    // A past day's record cannot tell working from waiting, so it never draws against the limit:
    // plain steps only (no amber at the limit, no red or hatch over it).
    const step = isToday ? busyStep(l.count, lim) : Math.min(3, busyStep(l.count, lim));
    const last = band[band.length - 1];
    if (last && last.step === step && Math.abs(last.to - from) < 1e-9) {
      last.to = to;
      last.lo = Math.min(last.lo, l.count);
      last.hi = Math.max(last.hi, l.count);
    } else band.push({ from, to, step, lo: l.count, hi: l.count });
  }
  return (
    <div className={`agents-today${isToday && stale ? ' stale' : ''}${isToday ? '' : ' past'}`} ref={ref} role="dialog" aria-label="Agents today" tabIndex={-1}>
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
      {showBusy && <BusyLine spans={busySpans} limit={lim} today={isToday} />}
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
        {showBusy && (
          <div className="at-band">
            <span className="at-band-k">{isToday ? 'Sessions busy at once' : 'Sessions open at once'}</span>
            <span className="at-track">
              {band.map((b) => (
                <i
                  key={b.from}
                  className={`b${b.step}`}
                  style={{ left: `${tx(b.from)}%`, width: `max(2px, calc(${tx(b.to) - tx(b.from)}% - 1px))`, height: BAND_H[b.step] }}
                  {...tip(`${clockAt(b.from)} to ${clockAt(b.to)}: ${b.lo === b.hi ? b.hi : `${b.lo} to ${b.hi}`} ${isToday ? 'working' : 'open'} at once${isToday && b.hi > lim ? `, over your limit of ${lim}` : ''}`)}
                />
              ))}
              {isToday && <i className="at-limit" style={{ bottom: 3 + BAND_H[4] }} aria-hidden="true" />}
            </span>
            <span className="at-band-note">{isToday ? `dashed line: your limit of ${lim}` : 'from the saved record'}</span>
          </div>
        )}
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
