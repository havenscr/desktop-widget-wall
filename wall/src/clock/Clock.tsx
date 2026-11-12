import { useEffect, useState } from 'react';
import { formatClock } from './format';

/** Time as h:mm with AM or PM, date below. Updates on the minute. */
export function Clock({ now = () => new Date() }: { now?: () => Date }) {
  const [parts, setParts] = useState(() => formatClock(now()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = now();
      setParts(formatClock(d));
      timer = setTimeout(tick, 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
    };
    tick();
    return () => clearTimeout(timer);
  }, [now]);

  return (
    <div>
      <div className="clk" aria-label={`${parts.time} ${parts.meridiem}`}>
        {parts.time}
        <small>{parts.meridiem}</small>
      </div>
      <div className="clk-date">{parts.date}</div>
    </div>
  );
}
