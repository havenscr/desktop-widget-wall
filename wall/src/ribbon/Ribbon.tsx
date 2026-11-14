import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { IconBolt, IconCalendar, IconHome } from '@tabler/icons-react';
import { invoke } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { openTask } from '../tasks/model';
import { hideTip, pinTip, tip } from '../ui/HoverTip';
import { AgentRow, agentBoxes } from './AgentRow';
import { useAgentsStore } from '../agents/useAgents';
import { useVisible } from '../ui/useVisible';
import { allDayBarText, allDayChips, HANDLE_W, handleX, labelBox, allDayText, allDayWidth, calmLayout, chipLayout, chips, dueLabelSpan, isLate, dueMarks, focusBars, hourLabels, msToNextMinute, needle, needleTip, overlapsAny, skyGradient, spanText, sunLabels, ticks, type Chip, type FoldChip, type MoreChip } from './model';
import { AgentsToday } from './AgentsToday';
import { DayDrawer } from './DayDrawer';
import { DayLip } from './DayLip';
import { sunTimes } from './sun';
import { useDayFeed } from './useDayEvents';
import { useDueTaskFeed } from './useDueTasks';

export type RibbonKind = 'work' | 'home';

const TICKS = ticks();

/** Asks Rust to open the event in Outlook; Rust holds the link behind the key. */
function openEvent(key: string): void {
  invoke('wall2_open_event', { key }).catch(() => undefined);
}

/** The "+N" chip's hover: every event it holds, and what a click does. */
function MoreTip({ m, labels }: { m: MoreChip; labels: Record<string, string> }) {
  return (
    <>
      <span className="tip-t">{m.items.length} more at this time</span>
      {m.items.map((c) => (
        <span key={c.key} className="tip-s">
          {c.title}, {spanText(c.start, c.end)}
          {c.accountId && labels[c.accountId] ? `, ${labels[c.accountId]}` : ''}
        </span>
      ))}
      {m.items.some((c) => c.canOpen) && <span className="tip-k">Click to pick one to open in Outlook</span>}
    </>
  );
}

/** The list a click on a "+N" chip pins: each event a button that opens it in Outlook. */
function MorePick({ m, labels }: { m: MoreChip; labels: Record<string, string> }) {
  return (
    <>
      <span className="tip-t">Open in Outlook</span>
      {m.items.map((c) => (
        <button
          key={c.key}
          type="button"
          className="tip-pick"
          disabled={!c.canOpen}
          onClick={() => {
            hideTip(true);
            openEvent(c.key);
          }}
        >
          {c.title}, {spanText(c.start, c.end)}
          {c.accountId && labels[c.accountId] ? `, ${labels[c.accountId]}` : ''}
          {c.canOpen ? '' : ' (no link)'}
        </button>
      ))}
    </>
  );
}

/** A chip's hover card: title, time and account, and what a click does. */
function ChipTip({ c, account }: { c: Chip; account: string | null }) {
  return (
    <>
      <span className="tip-t">{c.title}</span>
      <span className="tip-s">
        {spanText(c.start, c.end)}
        {account ? `, ${account}` : ''}
      </span>
      {c.canOpen && <span className="tip-k">Click to open it in Outlook</span>}
    </>
  );
}

/** The "N all day" chip's hover: each all-day event with its account. */
function AllDayTip({ items, labels }: { items: Chip[]; labels: Record<string, string> }) {
  return (
    <>
      <span className="tip-t">{allDayText(items.length)}</span>
      {items.map((c) => (
        <span key={c.key} className="tip-s">
          {c.title}
          {c.accountId && labels[c.accountId] ? `, ${labels[c.accountId]}` : ''}
        </span>
      ))}
      {items.some((c) => c.canOpen) && <span className="tip-k">{items.length === 1 ? 'Click to open it in Outlook' : 'Click to pick one to open in Outlook'}</span>}
    </>
  );
}

/** A folded chip's hover: each meeting of the run with its times. */
function FoldTip({ f }: { f: FoldChip }) {
  return (
    <>
      <span className="tip-t">{f.items.length} meetings overlap</span>
      {f.items.map((c) => (
        <span key={c.key} className="tip-s tip-row">
          <span>{c.title}</span>
          <span className="tip-when">{spanText(c.start, c.end)}</span>
        </span>
      ))}
      <span className="tip-k">Click to see them in the Day drawer</span>
    </>
  );
}

/** What is open over Work: nothing, the Day drawer (at an hour), or the Agents today panel. */
type Overlay = { kind: 'drawer'; hour: number | null } | { kind: 'panel' } | null;

/** The calendar row: 30 px from 33 for a single lane; stacked lanes share 31 to 65 with a 2 px gap. */
const ROW_TOP = 31;
const ROW_SPAN = 34;
const LANE_GAP = 2;

/** Top and height of lane `lane` of `lanes`, or null for the single full-height lane (the stylesheet's). */
export function laneBox(lane: number, lanes: number): { top: number; height: number } | null {
  if (lanes <= 1) return null;
  const height = (ROW_SPAN - (lanes - 1) * LANE_GAP) / lanes;
  return { top: ROW_TOP + lane * (height + LANE_GAP), height };
}

/** What row 2 holds, as the tooltip on its icon. */
/** The lip starts this far into the strip (inside its rounded corners). */
const LIP_INSET = 24;

const ROW2_TIP: Record<RibbonKind, string> = {
  work: 'Agent activity and tasks due today',
  home: 'Home tasks due today',
};

/** The needle's clock: the time now, refreshed on each whole minute while the page is visible. */
function useMinute(now: () => number): number {
  const visible = useVisible();
  const [t, setT] = useState(now);
  useEffect(() => {
    if (!visible) return;
    setT(now());
    let id: ReturnType<typeof setTimeout>;
    const step = () => {
      setT(now());
      id = setTimeout(step, msToNextMinute(now()));
    };
    id = setTimeout(step, msToNextMinute(now()));
    return () => clearTimeout(id);
  }, [visible, now]);
  return t;
}

/**
 * The day ribbon along the bottom of Work, Home and Meet (concept `.rib`): hours from
 * 6 AM to 12 AM over the day's sky, sunrise and sunset, today's calendar on row 1, the
 * focus bar from today's sessions (Work and Meet; Home has none, as in the concept), and
 * the needle with the time. Row 2 carries a cyan diamond for each of the next three tasks
 * due at a time today (Work and Meet: tasks without the home tag; Home: with it), and on
 * Work the agent lanes' day (`AgentRow`) under them; the house schedule joins it later.
 * Each row's icon has a tooltip naming the row. A row says it is empty only when that is
 * known: "No meetings today" after a good calendar read with nothing today ("Calendar not
 * available" when no account could be read), "Nothing scheduled at home" after a good task
 * read with nothing due, "No agent activity yet" when the helper answered (fresh) with an
 * empty day and the task read was good with nothing due. Before a read, after a failed
 * one, or when a feed is not set up, the row shows nothing.
 */
export function Ribbon({ kind, now = Date.now }: { kind: RibbonKind; now?: () => number }) {
  const visible = useVisible();
  const t = useMinute(now);
  const day = useDayFeed(visible);
  const events = day.events;
  const due = useDueTaskFeed(kind, visible);
  const tasks = due.tasks;
  const sessions = useFocusStore((s) => s.sessions);
  const sun = sunTimes(t);
  const n = needle(t);
  const Row2 = kind === 'home' ? IconHome : IconBolt;
  const calm = kind === 'work';
  const dayChips = chips(events, t);
  const allDay = allDayChips(events, t);
  // Home keeps its lanes; Work and Meet fold overlapping meetings into one chip.
  const lay = calm ? { shown: [] as Chip[], more: [] as MoreChip[], allDay: null } : chipLayout(dayChips, allDay.length > 0 ? allDayWidth(allDay.length) : 0);
  const fold = calm ? calmLayout(dayChips, t) : { singles: [] as Chip[], folds: [] as FoldChip[] };
  const shown = calm ? fold.singles : lay.shown;
  const allDayBox = lay.allDay ? laneBox(lay.allDay.lane, lay.allDay.lanes) : null;
  const marks = dueMarks(tasks, t);
  // On Work, a due label that would sit on the activity bar or the agents line shows only its
  // diamond (the label moves to the hover), so neither is drawn over the other. Read from the
  // shared store: the agent row owns the poll.
  const agents = useAgentsStore();
  const boxes = calm ? agentBoxes(agents, t) : [];
  const [overlay, setOverlay] = useState<Overlay>(null);
  const close = useCallback(() => setOverlay(null), []);
  // The panel needs the helper: hidden when it is not set up.
  const canPanel = calm && agents.status !== 'unconfigured';
  const openPanel = useCallback(() => setOverlay({ kind: 'panel' }), []);
  // The handle keeps off the hour and sun labels and the needle's time pill.
  const handleLeft = handleX([...hourLabels(n.x).map((l) => labelBox(l.x, l.text)), ...sunLabels(sun, t, n.x).map((l) => labelBox(l.x, l.text, 9)), labelBox(n.x, n.text, 11)]);
  const openDrawer = useCallback((hour: number | null) => setOverlay((o) => (o?.kind === 'drawer' && hour === null ? null : { kind: 'drawer', hour })), []);
  // The handle moves between the strip and the drawer's top edge: keyboard focus goes with it.
  const lipFocus = useRef(false);
  const toggleByLip = useCallback(
    (byKey: boolean) => {
      lipFocus.current = byKey;
      openDrawer(null);
    },
    [openDrawer],
  );
  return (
    <>
      <section className={`${isLate(t) ? 'rib late' : 'rib'}${calm && allDay.length > 0 ? ' has-allday' : ''}`} data-kind={kind} aria-label="Today">
        <i className="skyb" style={{ background: skyGradient(sun, t) }} aria-hidden="true" />
        <div aria-hidden="true">
          {TICKS.map((x) => (
            <i key={x} className="tk" style={{ left: x }} />
          ))}
          {hourLabels(n.x).map((l) => (
            <span key={l.x} className="hl" style={{ left: l.x }}>
              {l.text}
            </span>
          ))}
          {sunLabels(sun, t, n.x).map((l) => (
            <span key={l.text} className="hl sun" style={{ left: l.x }}>
              {l.text}
            </span>
          ))}
        </div>
        <span className="li" style={{ top: 38 }} title="Today's calendar" aria-label="Today's calendar" role="img">
          <IconCalendar stroke={1.8} aria-hidden="true" />
        </span>
        {dayChips.length === 0 && allDay.length === 0 && day.calendar !== 'unknown' && (
          <span className="li-empty" style={{ top: 38 }}>
            {day.calendar === 'ok' ? 'No meetings today' : 'Calendar not available'}
          </span>
        )}
        <span className="li" style={{ top: 70 }} title={ROW2_TIP[kind]} aria-label={ROW2_TIP[kind]} role="img">
          <Row2 stroke={1.8} aria-hidden="true" />
        </span>
        {kind === 'home' && due.known && marks.length === 0 && (
          <span className="li-empty" style={{ top: 70 }}>
            Nothing scheduled at home
          </span>
        )}
        {lay.more.map((m) => (
          <button
            key={m.key}
            type="button"
            className="ev more"
            style={{ left: m.x, width: m.width }}
            aria-label={`${m.items.length} more at this time: ${m.items.map((c) => c.title).join(', ')}`}
            {...tip(() => <MoreTip m={m} labels={day.labels} />)}
            onClick={(e) => {
              if (m.items.some((c) => c.canOpen)) pinTip(e.currentTarget, () => <MorePick m={m} labels={day.labels} />);
            }}
          >
            +{m.items.length}
          </button>
        ))}
        {lay.allDay && (
          <button
            type="button"
            className={`ev allday${lay.allDay.lanes > 1 ? ` s${Math.min(3, lay.allDay.lanes)}` : ''}`}
            style={{ left: lay.allDay.x, width: lay.allDay.width, ...(allDayBox ?? {}) }}
            aria-label={`${allDayText(allDay.length)}: ${allDay.map((c) => c.title).join(', ')}`}
            {...tip(() => <AllDayTip items={allDay} labels={day.labels} />)}
            onClick={(e) => {
              const open = allDay.filter((c) => c.canOpen);
              if (allDay.length === 1 && open.length === 1) openEvent(open[0].key);
              else if (open.length > 0) pinTip(e.currentTarget, () => <MorePick m={{ key: 'allday', x: 0, width: 0, items: allDay }} labels={day.labels} />);
            }}
          >
            {lay.allDay.lanes >= 3 ? allDay.length : allDayText(allDay.length)}
          </button>
        )}
        {calm && allDay.length > 0 && (
          <button
            type="button"
            className="adbar"
            aria-label={`${allDayText(allDay.length)}: ${allDay.map((c) => c.title).join(', ')}`}
            {...tip(() => <AllDayTip items={allDay} labels={day.labels} />)}
            onClick={(e) => {
              const open = allDay.filter((c) => c.canOpen);
              if (allDay.length === 1 && open.length === 1) openEvent(open[0].key);
              else if (open.length > 0) pinTip(e.currentTarget, () => <MorePick m={{ key: 'allday', x: 0, width: 0, items: allDay }} labels={day.labels} />);
            }}
          >
            {allDayBarText(allDay)}
          </button>
        )}
        {fold.folds.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`ev fold${f.items.every((c) => c.state === 'past') ? ' past' : ''}`}
            style={{ left: f.x, width: f.width }}
            aria-label={`${f.count}: ${f.items.map((c) => `${c.title}, ${spanText(c.start, c.end)}`).join('; ')}. Opens the Day drawer`}
            onClick={() => openDrawer(f.hour)}
            {...tip(() => <FoldTip f={f} />)}
          >
            <b className="fold-n">{f.count}</b>
            <span className="fold-t">{f.items.map((c) => c.title).join(', ')}</span>
          </button>
        ))}
        {shown.map((c) => {
          const account = c.accountId ? (day.labels[c.accountId] ?? null) : null;
          const box = laneBox(c.lane, c.lanes);
          const cls = `${c.state}${c.live ? ' live' : ''}${c.lanes > 1 ? ` s${Math.min(3, c.lanes)}` : ''}`;
          return (
            <Fragment key={c.key}>
              {c.narrow && c.beside !== null && (
                <span className={`ev-side ${cls}`} style={{ left: c.x + c.width + 6, width: c.beside, ...(box ?? {}) }} aria-hidden="true">
                  {c.title}
                </span>
              )}
              <div
                className={`ev ${cls}${c.canOpen ? ' open' : ''}`}
                style={{ left: c.x, width: c.width, ...(box ?? {}) }}
                role={c.canOpen ? 'button' : undefined}
                tabIndex={c.canOpen ? 0 : undefined}
                aria-label={`${c.title}, ${spanText(c.start, c.end)}${account ? `, ${account}` : ''}${c.canOpen ? '. Opens it in Outlook' : ''}`}
                onClick={c.canOpen ? () => openEvent(c.key) : undefined}
                onKeyDown={
                  c.canOpen
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openEvent(c.key);
                        }
                      }
                    : undefined
                }
                {...tip(() => <ChipTip c={c} account={account} />)}
              >
                {c.narrow ? null : c.title}
              </div>
            </Fragment>
          );
        })}
        {calm && <AgentRow now={t} dueCount={due.known ? marks.length : null} onOpenPanel={canPanel ? openPanel : undefined} />}
        {calm &&
          focusBars(sessions, t).map((b) => (
            <i key={b.x} className="fo" style={{ left: b.x, width: b.width }} aria-hidden="true" />
          ))}
        {marks.map((d) => {
          const bare = overlapsAny(dueLabelSpan(d), boxes);
          return (
            <div
              key={d.key}
              className={`due${bare ? ' bare' : ''}`}
              style={{ left: d.x }}
              role="button"
              tabIndex={0}
              aria-label={`Due ${d.time}: ${d.title}. Opens the task`}
              onClick={() => openTask(d.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openTask(d.key);
                }
              }}
              {...tip(() => (
                <>
                  <span className="tip-t">{d.title}</span>
                  <span className="tip-s">Due at {d.time}</span>
                  <span className="tip-k">Click to open it in the task app</span>
                </>
              ))}
            >
              <i aria-hidden="true" />
              {!bare && (
                <>
                  <span className="n">{d.title}</span>
                  <span aria-hidden="true">, {d.time}</span>
                </>
              )}
            </div>
          );
        })}
        <div className="ndl" style={{ left: n.x }}>
          <b {...tip(() => needleTip(dayChips, t, day.calendar === 'ok'))}>{n.text}</b>
        </div>
      </section>
      {calm && overlay?.kind !== 'drawer' && <DayLip open={false} x={handleLeft + HANDLE_W / 2 - LIP_INSET} onToggle={toggleByLip} focusOnMount={lipFocus.current} />}
      {calm && overlay?.kind === 'drawer' && (
        <DayDrawer
          chips={dayChips}
          allDay={allDay}
          labels={day.labels}
          now={t}
          scrollHour={overlay.hour}
          onClose={close}
          onOpenPanel={canPanel ? openPanel : null}
          lip={<DayLip open x={null} onToggle={toggleByLip} focusOnMount={lipFocus.current} />}
        />
      )}
      {calm && overlay?.kind === 'panel' && <AgentsToday now={t} onClose={close} />}
    </>
  );
}
