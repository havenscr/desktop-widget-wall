import { useEffect, useRef, useState } from 'react';
import { IconAddressBook } from '@tabler/icons-react';
import { personAction, personContact } from '../bridge/meetBrief';
import { ADDRESS_LINES, CONTACT_FAIL_LINE, usePersonAddress } from './personDetailsModel';

/**
 * The address line and the Open contact card key for the person card. Mount it where the card opens, so a mount is
 * the owner's click: `<PersonDetails personKey={p.key} onAirLive={onAirLive} />`. The address is plain text in state only,
 * dropped on unmount, on a new key and when On Air turns live. The contact key renders only when Rust says it is available.
 */
export function PersonDetails({ personKey, onAirLive }: { personKey: string | null; onAirLive: boolean }) {
  const view = usePersonAddress(personKey, onAirLive);
  const [contact, setContact] = useState(false);
  const [fail, setFail] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current += 1;
    const mine = epoch.current;
    setContact(false);
    setFail(false);
    if (!personKey) return;
    personContact(personKey).then(
      (c) => {
        if (epoch.current === mine && c?.available === true) setContact(true);
      },
      () => undefined,
    );
    return () => {
      epoch.current += 1;
    };
  }, [personKey]);
  const open = async () => {
    if (!personKey) return;
    const mine = epoch.current;
    setFail(false);
    try {
      await personAction(personKey, 'contact');
    } catch {
      if (epoch.current === mine) setFail(true);
    }
  };
  if (!personKey) return null;
  const line = view.kind === 'address' ? view.address : view.kind === 'none' ? null : ADDRESS_LINES[view.kind];
  return (
    <div className="meet-pdet">
      {line !== null && (
        <div className="meet-pdet-addr" data-kind={view.kind} role="status">
          {line}
        </div>
      )}
      {contact && (
        <div className="meet-pcard-acts">
          <button type="button" className="meet-pcard-act" onClick={open}>
            <IconAddressBook size={26} aria-hidden="true" />
            <span>Open contact card</span>
          </button>
        </div>
      )}
      {fail && <div className="meet-pcard-line">{CONTACT_FAIL_LINE}</div>}
    </div>
  );
}
