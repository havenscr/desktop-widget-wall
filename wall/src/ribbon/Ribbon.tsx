import { useEffect, useState } from 'react';
import { IconBolt, IconCalendar, IconHome } from '@tabler/icons-react';
import { useFocusStore } from '../focus/store';
import { AgentRow } from './AgentRow';
import { useVisible } from '../ui/useVisible';
import { chips, dueMarks, focusBars, hourLabels, msToNextMinute, needle, skyGradient, sunLabels, ticks } from './model';
import { sunTimes } from './sun';
import { useDayEvents } from './useDayEvents';
import { useDueTasks } from './useDueTasks';

export type RibbonKind = 'work' | 'home';

const TICKS = ticks();

/** What row 2 holds, as the tooltip on its icon. */
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
 * Each row's icon has a tooltip naming the row, and an empty row says so beside its icon
 * ("No meetings today", "No agent activity yet", "Nothing scheduled at home").
 */
export function Ribbon({ kind, now = Date.now }: { kind: RibbonKind; now?: () => number }) {
  const visible = useVisible();
  const t = useMinute(now);
  const events = useDayEvents(visible);
  const tasks = useDueTasks(kind, visible);
  const sessions = useFocusStore((s) => s.sessions);
  const sun = sunTimes(t);
  const n = needle(t);
  const Row2 = kind === 'home' ? IconHome : IconBolt;
  const dayChips = chips(events, t);
  const marks = dueMarks(tasks, t);
  return (
    <section className="rib" data-kind={kind} aria-label="Today">
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
      {dayChips.length === 0 && (
        <span className="li-empty" style={{ top: 38 }}>
          No meetings today
        </span>
      )}
      <span className="li" style={{ top: 70 }} title={ROW2_TIP[kind]} aria-label={ROW2_TIP[kind]} role="img">
        <Row2 stroke={1.8} aria-hidden="true" />
      </span>
      {kind === 'home' && marks.length === 0 && (
        <span className="li-empty" style={{ top: 70 }}>
          Nothing scheduled at home
        </span>
      )}
      {dayChips.map((c) => (
        <div
          key={c.key}
          className={`ev ${c.state}${c.live ? ' live' : ''}${c.lane ? ' l2' : ''}`}
          style={{ left: c.x, width: c.width }}
          title={c.title}
          aria-label={c.narrow ? c.title : undefined}
        >
          {c.narrow ? null : c.title}
        </div>
      ))}
      {kind === 'work' && <AgentRow now={t} dueCount={marks.length} />}
      {kind === 'work' &&
        focusBars(sessions, t).map((b) => (
          <i key={b.x} className="fo" style={{ left: b.x, width: b.width }} aria-hidden="true" />
        ))}
      {marks.map((d) => (
        <div key={d.key} className="due" style={{ left: d.x }} title={d.title} aria-label={`Due ${d.time}: ${d.title}`}>
          <i aria-hidden="true" />
          <span className="n">{d.title}</span>
          <span aria-hidden="true">, {d.time}</span>
        </div>
      ))}
      <div className="ndl" style={{ left: n.x }}>
        <b>{n.text}</b>
      </div>
    </section>
  );
}
