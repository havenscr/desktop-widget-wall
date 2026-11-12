import { useEffect, useState } from 'react';
import { formatClock } from './format';

const systemNow = () => new Date();

/** Time as h:mm with AM or PM, date below. Updates on the minute. */
export function Clock({ now = systemNow }: { now?: () => Date }) {
  const [parts, setParts] = useState(() => formatClock(now()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const d = now();
      timer = setTimeout(tick, 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
    };
    const tick = () => {
      const next = formatClock(now());
      setParts((prev) =>
        prev.time === next.time && prev.meridiem === next.meridiem && prev.date === next.date
          ? prev
          : next,
      );
      schedule();
    };
    schedule();
    return () => clearTimeout(timer);
  }, [now]);

  return (
    <div>
      <div className="clk" role="group" aria-label={`${parts.time} ${parts.meridiem}`}>
        {parts.time}
        <small>{parts.meridiem}</small>
      </div>
      <div className="clk-date">{parts.date}</div>
    </div>
  );
}
