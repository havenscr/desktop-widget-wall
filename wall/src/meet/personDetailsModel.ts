import { useEffect, useRef, useState } from 'react';
import { personAddress } from '../bridge/meetBrief';

/** What the address line shows. `address` is the only state that holds the text, and it never leaves the component. */
export type AddressView = { kind: 'none' } | { kind: 'wait' } | { kind: 'address'; address: string } | { kind: 'onair' } | { kind: 'gone' } | { kind: 'failed' };

export const ADDRESS_LINES = {
  wait: 'Looking up the address',
  onair: 'Address hidden while on air',
  gone: 'This meeting changed; open the card again',
  failed: 'No address to show',
} as const;

export const CONTACT_FAIL_LINE = 'Could not open the contact';

/** The reject word of a failed command (a string from Rust); anything else is no word. */
export function errorWord(e: unknown): string {
  return typeof e === 'string' ? e : '';
}

/** Map a rejection to a view. Unknown words and failures are `failed`. */
export function viewForError(e: unknown): AddressView {
  const w = errorWord(e);
  if (w === 'on-air') return { kind: 'onair' };
  if (w === 'gone') return { kind: 'gone' };
  return { kind: 'failed' };
}

/**
 * Ask for the address once when the card mounts with a key (the click that opened it), never while On Air is live.
 * A late answer after the key changed, after unmount or after On Air went live is dropped. Turning live drops the
 * text from state at once.
 */
export function usePersonAddress(personKey: string | null, onAirLive: boolean): AddressView {
  const [view, setView] = useState<AddressView>({ kind: 'none' });
  const liveRef = useRef(onAirLive);
  liveRef.current = onAirLive;
  useEffect(() => {
    if (!personKey) {
      setView({ kind: 'none' });
      return;
    }
    if (liveRef.current) {
      setView({ kind: 'onair' });
      return;
    }
    let current = true;
    setView({ kind: 'wait' });
    personAddress(personKey).then(
      (a) => {
        if (!current || liveRef.current) return;
        setView(typeof a?.address === 'string' && a.address ? { kind: 'address', address: a.address } : { kind: 'failed' });
      },
      (e: unknown) => {
        if (current) setView(liveRef.current ? { kind: 'onair' } : viewForError(e));
      },
    );
    return () => {
      current = false;
      setView({ kind: 'none' });
    };
  }, [personKey]);
  useEffect(() => {
    if (onAirLive && personKey) setView({ kind: 'onair' });
  }, [onAirLive, personKey]);
  return view;
}
