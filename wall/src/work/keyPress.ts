import { useCallback, type KeyboardEvent } from 'react';
import { invoke } from '../bridge/tauri';
import { sendReason, type SetInfo } from './keysModel';
import { useGuard } from './useGuard';
import { ActionError, runWallAction } from './wallActions';

/** What a key says when Rust ran its action itself (nothing is left for the page to run). */
const RUST_DONE: Record<string, string> = { lock: 'Locking the PC', 'displays:off': 'Screens going to sleep' };

/** Mouse keys: they never run from the keyboard, so the Space or Enter that wakes the screens or follows an unlock cannot run them again. */
export const MOUSE_ONLY = new Set(['lock', 'displays:off']);

/** True for a click that came from the keyboard (detail 0) on a key that is mouse only. */
export const keyboardOnMouseKey = (action: string | null, detail: number): boolean => action !== null && MOUSE_ONLY.has(action) && detail === 0;

/** Where a key goes, for the words of a refusal: the set's name, or "the app in front". */
export type Where = Pick<SetInfo, 'name' | 'general'>;

/** The command a key press calls: a set's key by id and index, or a library key by id. */
export type Call = { command: 'wall2_keys_send'; args: { setId: string; index: number } } | { command: 'wall2_keys_send_library'; args: { id: string } };

/**
 * Presses one key: asks Rust, and when Rust answers with a wall action name runs that action
 * through the control that already does it. One press is one action (double click, key repeat
 * and a second click while one runs are ignored). Every result is one short line.
 */
export function useKeyPress(show: (text: string) => void, refresh: () => void) {
  const guard = useGuard();
  const press = useCallback(
    (id: string, detail: number, call: Call, label: string, action: string | null, where: Where, hold: boolean) =>
      guard.run(id, detail, async () => {
        try {
          const answer = await invoke<string | null>(call.command, call.args);
          if (typeof answer === 'string') show(await runWallAction(answer));
          else if (action && RUST_DONE[action]) {
            show(RUST_DONE[action]);
            // Rust ran it and the wall stays in front: the tile must not keep the focus.
            (document.activeElement as HTMLElement | null)?.blur?.();
          }
          else show(`${label} sent${where.general ? '' : ` to ${where.name}`}`);
        } catch (e) {
          show(e instanceof ActionError ? e.message : sendReason(e, where, hold));
        } finally {
          refresh();
        }
      }),
    [guard, show, refresh],
  );
  /** Key handler for a tile: held keys never repeat, and a mouse-only key ignores Space and Enter. */
  const onKeyDown = (action: string | null) => (e: KeyboardEvent) => {
    if (action !== null && MOUSE_ONLY.has(action) && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      return;
    }
    guard.onKeyDown(e);
  };
  return { press, onKeyDown };
}
