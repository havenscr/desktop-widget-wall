import { IconAlertTriangle, IconFileText } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';
import { useOnAirStore } from './store';

/** Why the run of show has nothing to list: the Open file failure, a failed read, the refused reason (such as the size limit), no file or no parts. Null while the first read is going, or when all is well. */
type Show = ReturnType<typeof useOnAirStore.getState>['show'];

function problemOf(show: Show, showError: string | null, showNote: string | null): string | null {
  if (showNote) return showNote;
  if (!show) return showError;
  if (show.state === 'refused') return show.reason ?? 'run-of-show.txt was refused';
  if (show.state === 'missing') return 'No run-of-show.txt yet';
  if (show.state === 'ok' && show.parts.length === 0) return 'run-of-show.txt has no notes yet';
  return showError;
}

/** The problem as a hook, so a change in the store redraws it. */
export function useShowProblem(): string | null {
  const show = useOnAirStore((s) => s.show);
  const showError = useOnAirStore((s) => s.showError);
  const showNote = useOnAirStore((s) => s.showNote);
  return problemOf(show, showError, showNote);
}

/** One line with the problem and an Open file button that makes or opens run-of-show.txt. */
export function ShowProblem({ text, className }: { text: string; className?: string }) {
  const open = useOnAirStore((s) => s.open);
  return (
    <div className={`oa2-showproblem${className ? ` ${className}` : ''}`} role="status">
      <span className="oa2-showproblem-t amber ellipsis" {...tip(`${text}. Fix the file, save it, then reload.`)}>
        <IconAlertTriangle size={20} aria-hidden="true" />
        {text}
      </span>
      <button type="button" className="oa-btn sm" onClick={() => void open('show')} {...tip('Open run-of-show.txt in the default editor (a starter file is made only when there is none)')}>
        <IconFileText size={20} aria-hidden="true" />
        Open file
      </button>
    </div>
  );
}
