import { IconPin, IconPlus } from '@tabler/icons-react';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { overlayOwnsPointer } from '../ribbon/DrawerScrim';
import { tip } from '../ui/HoverTip';
import { previewTip } from './ZonesPreview';
import { isLayoutAction, layoutOffReason, useArrangeStatus } from './arrangeStatus';
import { errorText } from './deckModel';
import { useDeckStore } from './deckStore';
import { KeyIcon } from './keyIcons';
import { loadKeys } from './keysFeed';
import { KeyPicker } from './KeyPicker';
import { KeyMenu, type KeyMenuAction } from './KeyMenu';
import { keyboardOnMouseKey, useKeyPress } from './keyPress';
import { MAX_PINS } from './libraryModel';
import { tileSizeClass } from './keysModel';
import { useBrief } from './useBrief';
import { usePinEdits } from './usePinEdits';
import { makeKindOf, usePins } from './usePins';
import { runWallAction } from './wallActions';

/** Always five columns, so a pinned tile is the size of a Now tile whatever the count. */
const columns = (n: number) => Math.min(MAX_PINS, Math.max(1, n));

/**
 * "Always here": up to five keys that never change by themselves. They are the owner's
 * pins on this display (kept in local storage, checked against the library on read), else the
 * keys named in keys.json, else Thirds, Focus, Record 16:9, Snip and Hide screen. After a
 * layout key the heading says how many windows moved, with Undo for a minute. Right-click a
 * key (or the ContextMenu key) to swap it for any key of the library.
 */
export function PinnedRow() {
  const pinState = usePins();
  const { read, lib, libFailed, retryLib, filePins, pins } = pinState;
  const arrange = useArrangeStatus();
  const [brief, showBrief] = useBrief();
  const { press, onKeyDown } = useKeyPress(showBrief, loadKeys);
  const applied = useDeckStore((s) => s.applied);
  const [clock, setClock] = useState(() => Date.now());
  const [picker, setPicker] = useState<number | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  /** Whether the open menu came from the keyboard (the ContextMenu key or Shift+F10). */
  const menuByKey = useRef(false);
  const [busy, setBusy] = useState(false);
  // Hide Undo when its minute is up.
  useEffect(() => {
    if (!applied || applied.until <= clock) return;
    const id = setTimeout(() => setClock(Date.now()), applied.until - clock + 20);
    return () => clearTimeout(id);
  }, [applied, clock]);
  useEffect(() => {
    if (applied) setClock(Date.now());
  }, [applied]);

  const kindOf = makeKindOf(lib);
  if (read.status === 'absent') return null;

  const undoShown = applied !== null && applied.until > clock;
  const { choose: chooseKey, moveSlot, removeSlot, reset: resetKeys } = usePinEdits(pinState);
  const choose = (slot: number, ref: string) => {
    chooseKey(slot, ref);
    setPicker(null);
  };
  const reset = () => {
    resetKeys();
    setPicker(null);
  };
  const openPicker = (slot: number) => {
    if (overlayOwnsPointer()) return;
    setMenu(null);
    setPicker(slot);
  };
  const onContext = (slot: number) => (e: MouseEvent) => {
    e.preventDefault();
    if (overlayOwnsPointer()) return;
    menuByKey.current = false;
    setMenu(slot);
  };
  const onKey = (slot: number, action: string | null) => (e: KeyboardEvent) => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      if (overlayOwnsPointer()) return;
      menuByKey.current = true;
      setMenu(slot);
      return;
    }
    onKeyDown(action)(e);
  };
  const undo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      showBrief(await runWallAction('layout:undo'));
    } catch (e) {
      showBrief(errorText(e) || 'Could not undo');
    } finally {
      setBusy(false);
    }
  };

  const heading = brief ? (
    <span className="deck-brief-l" role="status" title={brief}>
      {brief}
    </span>
  ) : undoShown && applied ? (
    <span className="deck-brief-l" role="status" title={applied.text}>
      {applied.text}
    </span>
  ) : (
    <span className="k row">
      Always here
      <IconPin size={16} stroke={1.8} className="deck-pin" aria-hidden="true" />
    </span>
  );

  return (
    <section className="pinned deck-row" aria-label="Always here">
      <div className="row sb deck-hd">
        {heading}
        <span className="deck-hd-r">
          {undoShown && (
            <button
              type="button"
              className="deck-mini"
              disabled={busy}
              {...tip('Put the windows the last layout moved back where they were (for one minute)')}
              onKeyDown={onKeyDown(null)}
              onClick={() => void undo()}
            >
              Undo
            </button>
          )}
        </span>
      </div>
      {pins.length === 0 && lib === null ? (
        <div className="s deck-quiet row sb" {...tip(libFailed ? 'The key library could not be read. Try again, or restart the wall if this stays.' : 'Reading the key library')}>
          <span>{libFailed ? 'Keys not available' : lib === null ? 'Loading keys' : 'No keys pinned'}</span>
          {libFailed && (
            <button type="button" className="deck-mini" onClick={retryLib}>
              Try again
            </button>
          )}
        </div>
      ) : (
        <div className={`deck-tiles pin-tiles ${tileSizeClass(pins.length + (pins.length < MAX_PINS ? 1 : 0))}`} style={{ gridTemplateColumns: `repeat(${columns(pins.length + (pins.length < MAX_PINS ? 1 : 0))}, minmax(0, 1fr))` }}>
          {pins.map((p, i) => {
            const layoutOff = isLayoutAction(p.action) && arrange !== true;
            const sel = undoShown && applied?.action === p.action && p.action !== null;
            const where = { name: p.group ?? 'the app in front', general: p.group === null };
            const runPin = (detail: number) => {
              if (layoutOff || !p.runnable || keyboardOnMouseKey(p.action, detail)) return;
              const [kind, id] = [p.ref.slice(0, 4), p.ref.slice(4)];
              const call = kind === 'lib:' ? ({ command: 'wall2_keys_send_library', args: { id } } as const) : ({ command: 'wall2_keys_send', args: { setId: 'pinned', index: Number(p.ref.slice(5)) } } as const);
              void press(`pin:${p.ref}`, detail, call, p.label, p.action, where, false);
            };
            const actions: KeyMenuAction[] = [
              { id: 'run', label: 'Run it now', disabled: layoutOff || !p.runnable, help: p.runnable ? `Sends ${p.label} once, right now.` : `${p.label} cannot run: ${p.how}.` },
              { id: 'left', label: 'Move left', disabled: i === 0, help: i === 0 ? 'Already first.' : `Swaps ${p.label} with the key on its left.` },
              { id: 'right', label: 'Move right', disabled: i === pins.length - 1, help: i === pins.length - 1 ? 'Already last.' : `Swaps ${p.label} with the key on its right.` },
              { id: 'replace', label: 'Replace with another key', help: `Pick a key from the library to take ${p.label}'s place. A key already in Always here swaps places with it.` },
              { id: 'remove', label: 'Remove from Always here', help: `Takes ${p.label} off the Always here row. It stays in the key library.` },
            ];
            return (
              <div className="key-tile-wrap" key={p.ref} data-ref={p.ref}>
              <button
                type="button"
                className={`deck-tile key-tile pin-tile${layoutOff || !p.runnable ? ' off' : ''}${sel ? ' sel' : ''}`}
                aria-label={p.name ?? p.label}
                data-kind={layoutOff || !p.runnable ? undefined : kindOf(p)}
                aria-disabled={layoutOff || !p.runnable || undefined}
                {...previewTip(
                  p.action,
                  layoutOff,
                  layoutOff
                    ? layoutOffReason(arrange)
                    : !p.runnable
                      ? `${p.label}: ${p.how}. Right-click to take it out of Always here.`
                      : `${p.label}${p.group ? ` (${p.group})` : ''}${p.kind === 'check' ? ', a shortcut to check on your PC' : ''}.${p.how ? ` ${p.how}.` : ''} Right-click for more.`,
                )}
                onContextMenu={onContext(i)}
                onKeyDown={onKey(i, p.action)}
                onClick={(e) => runPin(e.detail)}
              >
                <KeyIcon name={p.icon} size={20} />
                <span className="deck-lbl">{p.name ?? p.label}</span>
              </button>
              {menu === i && (
                <KeyMenu
                  title={`${p.label}, in Always here`}
                  actions={actions}
                  byKeyboard={menuByKey.current}
                  onClose={() => setMenu(null)}
                  onChoose={(id, _action, detail) => {
                    if (id === 'run') runPin(detail);
                    if (id === 'left') moveSlot(i, i - 1);
                    if (id === 'right') moveSlot(i, i + 1);
                    if (id === 'replace') openPicker(i);
                    if (id === 'remove') removeSlot(i);
                  }}
                />
              )}
              </div>
            );
          })}
          {pins.length < MAX_PINS && (
            <button type="button" className="deck-tile key-tile add-key" aria-label="Add a key" {...tip(`Add a key to Always here. ${pins.length} of ${MAX_PINS} used.`)} onClick={() => openPicker(pins.length)}>
              <IconPlus size={20} aria-hidden="true" />
              <span className="deck-lbl">Add a key</span>
            </button>
          )}
        </div>
      )}
      {picker !== null && lib && (
        <KeyPicker lib={lib} filePins={filePins} pins={pins.map((p) => p.ref)} slot={picker} adding={picker >= pins.length} onChoose={(ref) => choose(picker, ref)} onReset={reset} onClose={() => setPicker(null)} />
      )}
    </section>
  );
}
