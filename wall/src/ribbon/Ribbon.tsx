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
        <IconCalendar className="li" style={{ top: 38 }} stroke={1.8} />
        <Row2 className="li" style={{ top: 70 }} stroke={1.8} />
      </div>
      {chips(events, t).map((c) => (
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
      {kind === 'work' && <AgentRow now={t} />}
      {kind === 'work' &&
        focusBars(sessions, t).map((b) => (
          <i key={b.x} className="fo" style={{ left: b.x, width: b.width }} aria-hidden="true" />
        ))}
      {dueMarks(tasks, t).map((d) => (
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
