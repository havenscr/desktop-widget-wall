import { IconChevronLeft, IconX } from '@tabler/icons-react';
import { useEffect } from 'react';
import { tip } from '../ui/HoverTip';
import { askingLine, SOURCE_LINE } from './askModel';
import type { AskView } from './useBriefAsk';

/**
 * The 1A panel over the island: his question on top, then the answer, "Asking · N s" with Cancel, or one short error line.
 * Back returns to the feed (a question still on its way is dropped); Clear also forgets the earlier turns. Every string is
 * a React text node: no markdown, no HTML, no link, nothing in an attribute.
 */
export function AskPanel({ view, onBack, onClear }: { view: AskView; onBack: () => void; onClear: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onBack();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onBack]);
  return (
    <div className="meet-brief-detail meet-ask-panel">
      <div className="meet-brief-dhd">
        <button type="button" className="meet-btn" onClick={onBack} {...tip('Back to the list (Escape)')}>
          <IconChevronLeft size={20} aria-hidden="true" />
          Back
        </button>
        <button type="button" className="meet-btn" onClick={onClear} {...tip('Back, and forget the earlier questions')}>
          Clear
        </button>
      </div>
      <div className="meet-brief-dtitle meet-ask-q">{view.q}</div>
      {view.phase === 'asking' && (
        <div className="meet-ask-wait">
          <span className="meet-dimline">{askingLine(view.seconds)}</span>
          <button type="button" className="meet-btn" onClick={onBack}>
            <IconX size={20} aria-hidden="true" />
            Cancel
          </button>
        </div>
      )}
      {view.phase === 'error' && <span className="meet-notice meet-ask-err">{view.word}</span>}
      {view.phase === 'done' && (
        <>
          <div className="meet-brief-preview meet-ask-a">{view.a}</div>
          <div className="meet-ask-src meet-dimline">{SOURCE_LINE}</div>
        </>
      )}
    </div>
  );
}
