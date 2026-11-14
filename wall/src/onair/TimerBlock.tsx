import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { tip } from '../ui/HoverTip';
import { elapsedMs, formatShowTime, RESET_CONFIRM_MS, startedLine } from './model';
import { useOnAirStore } from './store';

/**
 * The show timer: the big time, Start or Stop (Stop pauses), and Reset. Reset works only while
 * stopped, and asks for a second click within three seconds so a slip never loses the time.
 */
export function TimerBlock({ now }: { now: number }) {
  const saved = useOnAirStore((s) => s.saved);
  const start = useOnAirStore((s) => s.start);
  const stop = useOnAirStore((s) => s.stop);
  const reset = useOnAirStore((s) => s.reset);
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (saved.running) setConfirm(false);
  }, [saved.running]);

  const ms = elapsedMs(saved, now);
  const time = formatShowTime(ms);
  const nothing = !saved.running && ms === 0 && saved.firstStartAt === null;
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
  const resetTip = saved.running ? 'Stop the timer first to reset it' : nothing ? 'Nothing to reset yet' : confirm ? 'Click again to set the timer to 00:00 and go back to the first part' : `Set the timer to 00:00 and go back to the first part (asks again first)`;

  return (
    <div className="oa-timer">
      <span className="k oa-k">On air · show timer</span>
      <div className="oa-time-row">
        <span className="oa-time" data-running={saved.running ? 'true' : 'false'} role="timer" aria-label={`Show time ${time}`} {...tip(saved.running ? `Running since ${new Date(saved.startedAt ?? now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ms > 0 ? 'Stopped. Start carries on from here.' : 'Not started')}>
          {time}
        </span>
        <div className="oa-time-btns">
          {saved.running ? (
            <button type="button" className="oa-btn cy oa-go" onClick={stop} {...tip('Stop the timer (it keeps its time; Start carries on)')}>
              <IconPlayerPauseFilled size={20} aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button type="button" className="oa-btn cy oa-go" onClick={start} {...tip(ms > 0 ? `Carry on from ${time}` : 'Start the show timer')}>
              <IconPlayerPlayFilled size={20} aria-hidden="true" />
              Start
            </button>
          )}
          <button type="button" className={`oa-btn oa-reset${confirm ? ' confirm' : ''}`} aria-disabled={saved.running || nothing} onClick={onReset} {...tip(resetTip)}>
            {confirm ? 'Reset? Click again' : 'Reset'}
          </button>
        </div>
      </div>
      <span className="xs oa-started">{startedLine(saved, now)}</span>
    </div>
  );
}
