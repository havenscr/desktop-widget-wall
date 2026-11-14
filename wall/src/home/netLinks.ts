import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';

const FAIL_MS = 3000;

export interface LinkAvailability {
  security: boolean;
  portal: boolean;
}

/** Which links Rust can open; read again after each security read. */
export function useLinks(refresh: number): LinkAvailability {
  const [avail, setAvail] = useState<LinkAvailability>({ security: false, portal: false });
  useEffect(() => {
    let live = true;
    invoke<LinkAvailability>('wall2_links')
      .then((a) => live && setAvail(a))
      .catch(() => live && setAvail({ security: false, portal: false }));
    return () => {
      live = false;
    };
  }, [refresh]);
  return avail;
}

/** Open the home app's Security page or the Firewalla portal (Rust opens them); a failure shows "Could not open" for 3 seconds. */
export function useOpenLink(): { open: (kind: 'security' | 'portal') => void; failed: boolean } {
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const open = useCallback((kind: 'security' | 'portal') => {
    invoke('wall2_open_link', { kind }).catch(() => {
      setFailed(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setFailed(false), FAIL_MS);
    });
  }, []);
  return { open, failed };
}

