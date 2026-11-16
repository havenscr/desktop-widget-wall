import { IconShieldExclamation } from '@tabler/icons-react';
import { usePlaceStore } from '../state/places';
import { tip } from '../ui/HoverTip';
import { alarmChipText, useOpenAlarms } from './useSecurity';

/**
 * One quiet chip, "1 network alert" or "N network alerts", that switches to Home where the
 * network card lists them. Shows only from a current good security read (never stale data).
 * `period` ends the words with a full stop, for Unwind's status line of sentences; `compact`
 * shows the dot and the count alone (a tight header), with the words in the hover. `mark` shows a
 * shield and the count alone (Unwind's capsule, at the wall's left edge, so its card starts at the button's left edge instead of reaching over the rail), the words in the hover and the label.
 */
export function AlarmChip({ className, period = false, compact = false, mark = false }: { className: string; period?: boolean; compact?: boolean; mark?: boolean }) {
  const n = useOpenAlarms();
  if (n <= 0) return null;
  const text = alarmChipText(n);
  return (
    <button
      type="button"
      className={`${className} alarm-chip`}
      aria-label={`${text}. Show them on Home`}
      onClick={() => usePlaceStore.getState().setActive('home')}
      {...tip(`${compact || mark ? `${text}. ` : ''}${n === 1 ? 'An alert is' : `${n} alerts are`} open on the home network. Click to see ${n === 1 ? 'it' : 'them'} on Home.`, mark ? { align: 'start' } : undefined)}
    >
      {mark ? <IconShieldExclamation size={20} stroke={1.7} aria-hidden="true" /> : <i className="alarm-dot" aria-hidden="true" />}
      {compact || mark ? n : period ? `${text}.` : text}
    </button>
  );
}
