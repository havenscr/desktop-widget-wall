import { IconMessage } from '@tabler/icons-react';
import { useState } from 'react';
import { MAX_Q, PLACEHOLDER, PLACEHOLDER_FOLLOW } from './askModel';
import type { BriefAsk } from './useBriefAsk';
import { statusWord } from './askModel';

/**
 * The ask field in the island's foot, with the dim status words beside it. Focus sends nothing; Enter sends, Escape clears and
 * leaves. A disabled field shows its short reason in place of the prompt.
 */
export function AskBox({ ask }: { ask: BriefAsk }) {
  const [text, setText] = useState('');
  const word = statusWord(ask.health);
  const on = ask.gate.enabled;
  return (
    <>
      <label className="meet-ask" data-off={on ? undefined : 'true'}>
        <IconMessage size={20} aria-hidden="true" />
        <input
          type="text"
          className="meet-ask-in"
          aria-label="Ask about this meeting"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_Q}
          disabled={!on}
          value={on ? text : ''}
          placeholder={on ? (ask.hasTurns ? PLACEHOLDER_FOLLOW : PLACEHOLDER) : (ask.gate.reason ?? '')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (!on) return;
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (ask.send(text)) setText('');
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setText('');
              e.currentTarget.blur();
            }
          }}
        />
      </label>
      {word && <span className="meet-ask-status meet-dimline">{word}</span>}
    </>
  );
}
