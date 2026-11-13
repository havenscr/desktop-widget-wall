import { useEffect, useLayoutEffect, useRef } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { invoke } from '../bridge/tauri';
import { cards, laneWaits, type OmniSummary } from '../agents/model';
import { focusSession } from '../agents/open';
import { agentsStale, useAgentsStore } from '../agents/useAgents';
import { tip } from '../ui/HoverTip';
import { agentCounts, daySegments, laneStateWord } from './AgentRow';
import { allDayBarText, hm, hourText, shortTime, spanText, wallHour, type Chip } from './model';

/** Pixels per hour in the agenda. */
const P = 40;

/** The agenda's hours: 8 AM to 6 PM, widened to the first and last meeting. */
export function agendaRange(items: readonly Chip[], now: number): { lo: number; hi: number } {
  let lo = 8;
  let hi = 18;
  for (const c of items) {
    lo = Math.min(lo, Math.floor(Math.max(0, wallHour(c.start, now))));
    hi = Math.max(hi, Math.ceil(Math.min(24, wallHour(c.end, now))));
  }
  return { lo, hi };
}

/** Lanes for the agenda: overlapping meetings side by side, each run as wide as its lanes need. */
export function agendaLanes(items: readonly Chip[]): { c: Chip; lane: number; lanes: number }[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: { c: Chip; lane: number; lanes: number }[] = [];
  let run: { c: Chip; lane: number; lanes: number }[] = [];
  let reach = -Infinity;
  const flush = () => {
    const n = Math.max(1, ...run.map((r) => r.lane + 1));
    for (const r of run) r.lanes = n;
    out.push(...run);
    run = [];
  };
  const ends: number[] = [];
  for (const c of sorted) {
    if (c.start >= reach && run.length > 0) {
      flush();
      ends.length = 0;
    }
    let lane = ends.findIndex((e) => e <= c.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = c.end;
    run.push({ c, lane, lanes: 1 });
    reach = Math.max(reach, c.end);
  }
  if (run.length > 0) flush();
  return out;
}

const RANK: Record<string, number> = { 'waiting on you': 0, working: 1 };

/**
 * The Day drawer, pulled up from the calm strip's handle (or a folded chip): 532 px over the
 * lower part of Work, never over the rail or the clock. Left, an agenda (8 AM to 6 PM, wider
 * when a meeting is outside it) with overlapping meetings side by side and the now line;
 * each meeting opens in Outlook, with Join where the calendar has a join link. Right, one row
 * per open session (needing the owner first, then working, then the rest): number, title,
 * state, its line, its day as a bar and the time worked; a click opens it in OmniGent. The
 * header's "Agents today" opens the panel. Escape, the handle, Close or a click outside
 * closes it.
 */
export function DayDrawer({
  chips,
  allDay,
  labels,
  now,
  scrollHour,
  onClose,
  onOpenPanel,
}: {
  chips: Chip[];
  allDay: Chip[];
  labels: Record<string, string>;
  now: number;
  scrollHour: number | null;
  onClose: () => void;
  onOpenPanel: (() => void) | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const agenda = useRef<HTMLDivElement>(null);
  const st = useAgentsStore();
  const { lo, hi } = agendaRange(chips, now);
  useLayoutEffect(() => {
    const el = agenda.current;
    if (!el) return;
    const h = scrollHour ?? wallHour(now, now) - 1;
    el.scrollTop = Math.max(0, (Math.min(hi, Math.max(lo, h)) - lo) * P - 12);
    // Only when it opens, or a chip asks for another hour.
  }, [scrollHour]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || t.closest('.rib-handle, .ev.fold, .hover-tip')) return;
      onClose();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', down);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('mousedown', down);
    };
  }, [onClose]);
  const s: OmniSummary | null = st.summary;
  const stale = agentsStale(st);
  const segs = daySegments(st, now);
  const list = s ? cards(s) : [];
  const rows = list
    .map((l, i) => ({ l, num: i + 1, word: laneStateWord(l) }))
    .sort((a, b) => (RANK[a.word] ?? 2) - (RANK[b.word] ?? 2) || a.num - b.num);
  const nowH = wallHour(now, now);
  const barLo = Math.min(6, ...segs.map((g) => Math.floor(wallHour(g.start, now))).filter((h) => h >= 0));
  const barHi = Math.max(barLo + 1, nowH);
  const bx = (ms: number) => ((Math.min(barHi, Math.max(barLo, wallHour(ms, now))) - barLo) / (barHi - barLo)) * 100;
  const counts = s ? agentCounts(s) : null;
  const dateText = new Date(now).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const lanes = agendaLanes(chips);
  return (
    <div className="day-drawer" ref={ref} role="dialog" aria-label="Day">
      <button type="button" className="rib-handle in-drawer" aria-label="Close the Day drawer" onClick={onClose} {...tip('Close the Day drawer')}>
        <i />
      </button>
      <div className="dd-head">
        <span className="dd-k">Day</span>
        <span className="dd-date">{dateText}</span>
        {allDay.length > 0 && (
          <span className="dd-allday" {...tip(() => <>{allDay.map((c) => <span key={c.key} className="tip-s">{c.title}{c.accountId && labels[c.accountId] ? `, ${labels[c.accountId]}` : ''}</span>)}</>)}>
            {allDayBarText(allDay)}
          </span>
        )}
        <button type="button" className="dd-close" onClick={onClose} {...tip('Close the Day drawer (Escape)')}>
          <IconChevronDown stroke={1.8} aria-hidden="true" />
          Close
        </button>
      </div>
      <div className="dd-body">
        <div className="dd-agenda" ref={agenda}>
          <div className="dd-grid" style={{ height: (hi - lo) * P + 16 }}>
            {Array.from({ length: hi - lo + 1 }, (_, i) => (
              <div key={i} className="dd-hour" style={{ top: i * P }}>
                <span>{hourText(lo + i)}</span>
                <i />
              </div>
            ))}
            <div className="dd-blocks">
              {chips.length === 0 && <span className="dd-none">No meetings today</span>}
              {lanes.map(({ c, lane, lanes: n }) => {
                const top = (Math.max(lo, wallHour(c.start, now)) - lo) * P + 1;
                const height = Math.max(22, (Math.min(hi, wallHour(c.end, now)) - Math.max(lo, wallHour(c.start, now))) * P - 3);
                const account = c.accountId ? (labels[c.accountId] ?? null) : null;
                const short = height < 32;
                return (
                  <div
                    key={c.key}
                    className={`dd-ev ${c.state}${c.live ? ' live' : ''}${c.canOpen ? ' open' : ''}${short ? ' short' : ''}`}
                    style={{ top, height, left: `calc(${(lane / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 6px)` }}
                    role={c.canOpen ? 'button' : undefined}
                    tabIndex={c.canOpen ? 0 : undefined}
                    aria-label={`${c.title}, ${spanText(c.start, c.end)}${c.canOpen ? '. Opens it in Outlook' : ''}`}
                    onClick={c.canOpen ? () => invoke('wall2_open_event', { key: c.key }).catch(() => undefined) : undefined}
                    {...tip(() => (
                      <>
                        <span className="tip-t">{c.title}</span>
                        <span className="tip-s">
                          {spanText(c.start, c.end)}
                          {account ? `, ${account}` : ''}
                        </span>
                        {c.canOpen && <span className="tip-k">Click to open it in Outlook</span>}
                      </>
                    ))}
                  >
                    <b>{c.title}</b>
                    <span className="dd-t">
                      {shortTime(c.start)} to {shortTime(c.end)}
                    </span>
                    {c.canJoin && c.end > now && (
                      <button
                        type="button"
                        className="dd-join"
                        onClick={(e) => {
                          e.stopPropagation();
                          invoke('wall2_meet_join', { key: c.key }).catch(() => undefined);
                        }}
                        {...tip('Join the meeting')}
                      >
                        Join
                      </button>
                    )}
                  </div>
                );
              })}
              {nowH >= lo && nowH <= hi && <i className="dd-now" style={{ top: (nowH - lo) * P }} aria-hidden="true" />}
            </div>
          </div>
        </div>
        <div className={`dd-agents${stale ? ' stale' : ''}`}>
          <div className="dd-ag-head">
            {onOpenPanel ? (
              <button type="button" className="dd-k link" onClick={onOpenPanel} {...tip('Open Agents today: every session of the day, and earlier days')}>
                Agents today
              </button>
            ) : (
              <span className="dd-k">Agents today</span>
            )}
            {counts && (
              <span className="dd-counts">
                {counts.total} sessions
                {counts.need > 0 && (
                  <>
                    , <span className="need">{counts.need} need you</span>
                  </>
                )}
                , {counts.working} working, {counts.idle} idle{stale ? ', may be out of date' : ''}
              </span>
            )}
            <span className="dd-axis">
              {Array.from({ length: Math.floor(barHi) - Math.ceil(barLo) + 1 }, (_, i) => Math.ceil(barLo) + i)
                .filter((h) => h % 2 === 0 && barHi - h > 0.4)
                .map((h) => (
                  <span key={h} style={{ left: `${((h - barLo) / (barHi - barLo)) * 100}%` }}>
                    {hourText(h)}
                  </span>
                ))}
            </span>
          </div>
          <div className="dd-rows">
            {!s && <span className="dd-none">{st.status === 'loading' ? '' : st.status === 'unconfigured' ? 'Agents not set up' : 'Agents not reachable'}</span>}
            {s && rows.length === 0 && <span className="dd-none">No open sessions</span>}
            {rows.map(({ l, num, word }) => {
              const mine = segs.filter((g) => g.lane === l.id);
              const work = mine.filter((g) => g.kind === 'run' || g.kind === 'past').reduce((t, g) => t + g.end - g.start, 0);
              const wait = mine.filter((g) => g.kind === 'wait').reduce((t, g) => t + g.end - g.start, 0);
              const tone = laneWaits(l) ? 'need' : word === 'working' ? 'working' : '';
              return (
                <button
                  key={l.id}
                  type="button"
                  className="dd-row"
                  disabled={!s?.linksAvailable}
                  onClick={() => focusSession(l.id)}
                  aria-label={`${num}. ${l.title}, ${word}. Opens it in OmniGent`}
                  {...tip(() => (
                    <>
                      <span className="tip-t">{l.title}</span>
                      <span className="tip-s">
                        {word}, worked {hm(work)} today{wait > 0 ? `, waited on you ${hm(wait)}` : ''}
                      </span>
                      {s?.linksAvailable && <span className="tip-k">Click to open it in OmniGent</span>}
                    </>
                  ))}
                >
                  <span className="num">{num}</span>
                  <span className="dd-name">{l.title}</span>
                  <span className={`dd-pill ${tone}`}>{word}</span>
                  <span className="dd-line">{l.line}</span>
                  <span className="dd-bar">
                    {mine.map((g) => (
                      <i key={g.key} className={g.kind} style={{ left: `${bx(g.start)}%`, width: `max(4px, ${bx(g.end) - bx(g.start)}%)` }} />
                    ))}
                  </span>
                  <span className="dd-time">{hm(work)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
