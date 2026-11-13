import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { isAbsent } from './deckModel';

/** How often the rows check that a big screen is still there. */
export const STATUS_MS = 60_000;

/** True: a big screen is there. False: the wall is the only monitor. 'absent': the commands do not exist here. null: not known yet. */
export type ArrangeStatus = boolean | 'absent' | null;

export function useArrangeStatus(): ArrangeStatus {
  const visible = useVisible();
  const [status, setStatus] = useState<ArrangeStatus>(null);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    const read = () =>
      invoke<boolean>('wall2_arrange_status').then(
        (ok) => live && setStatus(ok === true),
        (e) => live && setStatus(isAbsent(e) ? 'absent' : false),
      );
    void read();
    const id = setInterval(read, STATUS_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [visible]);
  return status;
}

/** The layout keys (not Undo) need a big screen. */
export const isLayoutAction = (a: string | null): boolean => a !== null && a.startsWith('layout:') && a !== 'layout:undo';

/** Why a layout key is off. */
export function layoutOffReason(s: ArrangeStatus): string {
  return s === 'absent' ? 'Window layouts need the Windows app' : s === null ? 'Looking for the big screen' : 'There is no big screen: the wall is the only monitor';
}
