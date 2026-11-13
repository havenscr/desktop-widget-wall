import { useCallback, useEffect, useRef, useState } from 'react';
import { BRIEF_MS } from './deckModel';

/** A short result line that clears itself. */
export function useBrief(): [string | null, (text: string) => void] {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = useCallback((t: string) => {
    clearTimeout(timer.current);
    setText(t);
    timer.current = setTimeout(() => setText(null), BRIEF_MS);
  }, []);
  return [text, show];
}
