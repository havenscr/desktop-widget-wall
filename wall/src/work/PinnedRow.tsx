import { IconPin } from '@tabler/icons-react';
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { invoke } from '../bridge/tauri';
import { tip } from '../ui/HoverTip';
import { useVisible } from '../ui/useVisible';
import { isLayoutAction, layoutOffReason, useArrangeStatus } from './arrangeStatus';
import { errorText } from './deckModel';
import { useDeckStore } from './deckStore';
import { KeyIcon } from './keyIcons';
import { libIndex, pinKind } from './keyKind';
import { joinKeys, loadKeys, useKeysFeedStore } from './keysFeed';
import { KeyPicker } from './KeyPicker';
import { keyboardOnMouseKey, useKeyPress } from './keyPress';
import { allKeys, FALLBACK_PINS, MAX_PINS, parsePins, PINS_KEY, readPinsRaw, resolvePin, savePins, serializePins, swapPin, type LibGroup, type PinView } from './libraryModel';
import { useBrief } from './useBrief';
import { runWallAction } from './wallActions';

/** Always five columns, so a pinned tile is the size of a Now tile whatever the count. */
const columns = (_n: number) => MAX_PINS;

/** The library, read once; null while it loads or when it cannot be read. */
function useLibrary(): { lib: LibGroup[] | null; failed: boolean; retry: () => void } {
  const [lib, setLib] = useState<LibGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    invoke<LibGroup[]>('wall2_keys_library').then(
      (g) => {
        if (!live) return;
        setLib(Array.isArray(g) ? g : null);
        setFailed(!Array.isArray(g));
      },
      () => live && (setLib(null), setFailed(true)),
    );
    return () => {
      live = false;
    };
  }, [tries]);
  return { lib, failed, retry: () => (setFailed(false), setTries((n) => n + 1)) };
}

/**
 * "Always here": up to five keys that never change by themselves. They are the owner's
 * pins on this display (kept in local storage, checked against the library on read), else the
 * keys named in keys.json, else Thirds, Focus, Record 16:9, Snip and Hide screen. After a
 * layout key the heading says how many windows moved, with Undo for a minute. Right-click a
 * key (or the ContextMenu key) to swap it for any key of the library.
 */
export function PinnedRow() {
  const visible = useVisible();
  useEffect(() => (visible ? joinKeys() : undefined), [visible]);
  const read = useKeysFeedStore((s) => s.read);
  const { lib, failed: libFailed, retry: retryLib } = useLibrary();
  const arrange = useArrangeStatus();
  const [brief, showBrief] = useBrief();
  const { press, onKeyDown } = useKeyPress(showBrief, loadKeys);
  const applied = useDeckStore((s) => s.applied);
  const [clock, setClock] = useState(() => Date.now());
  const [raw, setRaw] = useState<string | null>(readPinsRaw);
  const [picker, setPicker] = useState<number | null>(null);
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

  const summary = read.status === 'ready' ? read.summary : null;
  const filePins = summary?.filePins ?? [];
  const defaults = summary?.defaultPins ?? FALLBACK_PINS;
  const kept = lib ? parsePins(raw, lib, filePins) : null;
  const refs = kept ?? defaults;
  const pins: PinView[] = lib ? refs.map((r) => resolvePin(r, lib, filePins)).filter((p): p is PinView => p !== null).slice(0, MAX_PINS) : [];
  const byId = lib ? allKeys(lib) : null;
  const index = lib ? libIndex(lib) : null;
  const kindOf = (p: PinView) => {
    const hit = p.ref.startsWith('lib:') ? byId?.get(p.ref.slice(4)) : undefined;
    return pinKind(p.ref, hit ? { group: hit.group.id, action: hit.key.action } : null, { action: p.action, label: p.label }, index);
  };
  if (read.status === 'absent') return null;

  const undoShown = applied !== null && applied.until > clock;
  const choose = (slot: number, ref: string) => {
    const next = swapPin(pins.map((p) => p.ref), slot, ref);
    const text = serializePins(next, filePins);
    try {
      localStorage.setItem(PINS_KEY, text);
    } catch {
      // Storage may be blocked; the choice then lasts until the page reloads.
    }
    setRaw(text);
    setPicker(null);
  };
  const reset = () => {
    savePins(null);
    setRaw(null);
    setPicker(null);
  };
  const openPicker = (slot: number) => setPicker(slot);
  const onContext = (slot: number) => (e: MouseEvent) => {
    e.preventDefault();
    openPicker(slot);
  };
  const onKey = (slot: number, action: string | null) => (e: KeyboardEvent) => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      openPicker(slot);
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
      {pins.length === 0 ? (
        <div className="s deck-quiet row sb" {...tip(libFailed ? 'The key library could not be read. Try again, or restart the wall if this stays.' : 'Reading the key library')}>
          <span>{libFailed ? 'Keys not available' : lib === null ? 'Loading keys' : 'No keys pinned'}</span>
          {libFailed && (
            <button type="button" className="deck-mini" onClick={retryLib}>
              Try again
            </button>
          )}
        </div>
      ) : (
        <div className="deck-tiles pin-tiles" style={{ gridTemplateColumns: `repeat(${columns(pins.length)}, minmax(0, 1fr))` }}>
          {pins.map((p, i) => {
            const layoutOff = isLayoutAction(p.action) && arrange !== true;
            const sel = undoShown && applied?.action === p.action && p.action !== null;
            const where = { name: p.group ?? 'the app in front', general: p.group === null };
            return (
              <button
                key={p.ref}
                type="button"
                className={`deck-tile key-tile pin-tile${layoutOff ? ' off' : ''}${sel ? ' sel' : ''}`}
                aria-label={p.label}
                data-kind={layoutOff ? undefined : kindOf(p)}
                aria-disabled={layoutOff || undefined}
                aria-haspopup="dialog"
                {...tip(
                  layoutOff
                    ? layoutOffReason(arrange)
                    : `${p.label}${p.group ? ` (${p.group})` : ''}${p.kind === 'check' ? ', a shortcut to check on your PC' : ''}. ${p.how}. Right-click to change this key.`,
                )}
                onContextMenu={onContext(i)}
                onKeyDown={onKey(i, p.action)}
                onClick={(e) => {
                  if (layoutOff || keyboardOnMouseKey(p.action, e.detail)) return;
                  const [kind, id] = [p.ref.slice(0, 4), p.ref.slice(4)];
                  const call = kind === 'lib:' ? ({ command: 'wall2_keys_send_library', args: { id } } as const) : ({ command: 'wall2_keys_send', args: { setId: 'pinned', index: Number(p.ref.slice(5)) } } as const);
                  void press(`pin:${p.ref}`, e.detail, call, p.label, p.action, where, false);
                }}
              >
                <KeyIcon name={p.icon} size={20} />
                <span className="deck-lbl">{p.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {picker !== null && lib && (
        <KeyPicker lib={lib} filePins={filePins} pins={pins.map((p) => p.ref)} slot={picker} onChoose={(ref) => choose(picker, ref)} onReset={reset} onClose={() => setPicker(null)} />
      )}
    </section>
  );
}
