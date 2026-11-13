import { useEffect, useState, type ReactNode } from 'react';
import { invoke } from '../bridge/tauri';
import { formatBuild, formatClock, type BuildInfo } from './format';

const systemNow = () => new Date();

let buildLine: Promise<string | null> | null = null;
/** Asked once per run; a failure just means no build line. */
function loadBuildLine(): Promise<string | null> {
  buildLine ??= invoke<BuildInfo>('wall2_build_info').then(formatBuild, () => null);
  return buildLine;
}

/** Tests only: ask for the build again. */
export function resetBuildLine(): void {
  buildLine = null;
}

/** Time as h:mm with AM or PM, date below. Updates on the minute. `children` follow the date on its line. */
export function Clock({ now = systemNow, children }: { now?: () => Date; children?: ReactNode }) {
  const [parts, setParts] = useState(() => formatClock(now()));

  const [build, setBuild] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadBuildLine().then((line) => live && setBuild(line));
    return () => {
      live = false;
    };
  }, []);

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
    <div title={[`${parts.time} ${parts.meridiem}, ${parts.date}`, build].filter(Boolean).join('\n')}>
      <div className="clk" role="group" aria-label={`${parts.time} ${parts.meridiem}`}>
        {parts.time}
        <small>{parts.meridiem}</small>
      </div>
      <div className="clk-date">
        <span>{parts.date}</span>
        {children}
      </div>
    </div>
  );
}
