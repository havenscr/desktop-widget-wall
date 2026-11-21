import { IconPin, IconPlus } from '@tabler/icons-react';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { invoke } from '../bridge/tauri';
import { overlayOwnsPointer } from '../ribbon/DrawerScrim';
import { tip } from '../ui/HoverTip';
import { previewTip } from './ZonesPreview';
import { useVisible } from '../ui/useVisible';
import { isLayoutAction, layoutOffReason, useArrangeStatus } from './arrangeStatus';
import { errorText } from './deckModel';
import { useDeckStore } from './deckStore';
import { KeyIcon } from './keyIcons';
import { libIndex, pinKind } from './keyKind';
import { joinKeys, loadKeys, useKeysFeedStore } from './keysFeed';
import { KeyPicker } from './KeyPicker';
import { KeyMenu, type KeyMenuAction } from './KeyMenu';
import { keyboardOnMouseKey, useKeyPress } from './keyPress';
import { allKeys, FALLBACK_PINS, MAX_PINS, parsePins, PINS_CHANGED_EVENT, PINS_KEY, readPinsRaw, removePin, resolvePin, savePins, serializePins, swapPin, type LibGroup, type PinView } from './libraryModel';
import { tileSizeClass, type KeyInfo } from './keysModel';
import { useBrief } from './useBrief';
import { runWallAction } from './wallActions';

/** Always five columns, so a pinned tile is the size of a Now tile whatever the count. */
const columns = (n: number) => Math.min(MAX_PINS, Math.max(1, n));

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
/** The stored pins as a list of raw entries, or null when the text is not one. */
function storedEntries(raw: string | null): unknown[] | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** The ref a raw entry stands for, or null when it is neither a key reference nor a keys.json entry. */
function entryRef(e: unknown): string | null {
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null && !Array.isArray(e) && typeof (e as { ref?: unknown }).ref === 'string') return (e as { ref: string }).ref;
  return null;
}

/**
 * The raw index of each pin that resolves now, in order: slot n of the row is `result[n]`. It follows the
 * rules `parsePins` uses to keep an entry, so the nth slot is the nth kept entry.
 */
function resolvedSlots(entries: readonly unknown[], lib: readonly LibGroup[], filePins: readonly KeyInfo[]): number[] {
  const slots: number[] = [];
  const seen = new Set<string>();
  entries.forEach((e, i) => {
    const ref = entryRef(e);
    if (ref === null || seen.has(ref)) return;
    if (typeof e !== 'string') {
      const k = filePins[Number(ref.slice(5))];
      const o = e as { label?: unknown; action?: unknown };
      if (k && k.label === o.label && k.action === o.action) {
        seen.add(ref);
        slots.push(i);
      }
      return;
    }
    if (ref.startsWith('file:')) return;
    if (resolvePin(ref, lib, filePins)) {
      seen.add(ref);
      slots.push(i);
    }
  });
  return slots;
}

/**
 * The stored list with the pins that resolve replaced by `next` (a change of one slot, or an added one at the end),
 * and every other raw entry left as it was. Never longer than MAX_PINS: room for an added pin comes from the oldest
 * entries that do not resolve (not a keys.json pin while keys.json is loading; with no such room it returns null and
 * the Add is refused), so `parsePins` never sees a list too long to read.
 */
function replaceResolved(entries: readonly unknown[], slots: readonly number[], next: readonly string[], filePins: readonly KeyInfo[], filesLoading: boolean): unknown[] | null {
  const one = (ref: string): unknown => (JSON.parse(serializePins([ref], filePins)) as unknown[])[0];
  const out = [...entries];
  slots.forEach((at, k) => {
    if (k < next.length) out[at] = one(next[k]);
  });
  for (let k = slots.length; k < next.length; k++) out.push(one(next[k]));
  const live = new Set(slots);
  // A keys.json pin is not given up while keys.json is still being read: it may resolve in a moment.
  const loading = (e: unknown) => filesLoading && (entryRef(e) ?? '').startsWith('file:');
  let excess = out.length - MAX_PINS;
  const kept = out.filter((e, at) => {
    if (excess > 0 && at < entries.length && !live.has(at) && !loading(e)) {
      excess--;
      return false;
    }
    return true;
  });
  // Every place is held by a pin that resolves or may yet: the Add is refused, as with five resolving pins.
  return excess > 0 ? null : kept;
}

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
  const [menu, setMenu] = useState<number | null>(null);
  /** Whether the open menu came from the keyboard (the ContextMenu key or Shift+F10). */
  const menuByKey = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const changed = () => setRaw(readPinsRaw());
    window.addEventListener(PINS_CHANGED_EVENT, changed);
    return () => window.removeEventListener(PINS_CHANGED_EVENT, changed);
  }, []);

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
  const keep = (next: string[]) => keepText(serializePins(next, filePins));
  const keepText = (text: string) => {
    try {
      localStorage.setItem(PINS_KEY, text);
    } catch {
      // Storage may be blocked; the choice then lasts until the page reloads.
    }
    setRaw(text);
  };
  // The stored list, when it is a well formed one: an Add or a Remove edits it in place so a reference that
  // does not resolve right now (a file list still loading, a key the library lacks today) is kept, not dropped.
  const stored = lib && kept !== null ? storedEntries(raw) : null;
  const rawSlots = lib && stored ? resolvedSlots(stored, lib, filePins) : null;
  const choose = (slot: number, ref: string) => {
    const next = swapPin(pins.map((p) => p.ref), slot, ref);
    if (stored && rawSlots) {
      const text = replaceResolved(stored, rawSlots, next, filePins, read.status === 'loading');
      if (text) keepText(JSON.stringify(text));
    } else keep(next);
    setPicker(null);
  };
  const removeSlot = (slot: number) => {
    if (stored && rawSlots && slot < rawSlots.length) keepText(JSON.stringify(stored.filter((_e, i) => i !== rawSlots[slot])));
    else keep(removePin(pins.map((pin) => pin.ref), slot));
  };
  const reset = () => {
    savePins(null);
    setRaw(null);
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
              if (layoutOff || keyboardOnMouseKey(p.action, detail)) return;
              const [kind, id] = [p.ref.slice(0, 4), p.ref.slice(4)];
              const call = kind === 'lib:' ? ({ command: 'wall2_keys_send_library', args: { id } } as const) : ({ command: 'wall2_keys_send', args: { setId: 'pinned', index: Number(p.ref.slice(5)) } } as const);
              void press(`pin:${p.ref}`, detail, call, p.label, p.action, where, false);
            };
            const actions: KeyMenuAction[] = [
              { id: 'run', label: 'Run it now', disabled: layoutOff, help: `Sends ${p.label} once, right now.` },
              { id: 'remove', label: 'Remove from Always here', help: `Takes ${p.label} off the Always here row. It stays in the key library.` },
            ];
            return (
              <div className="key-tile-wrap" key={p.ref}>
              <button
                type="button"
                className={`deck-tile key-tile pin-tile${layoutOff ? ' off' : ''}${sel ? ' sel' : ''}`}
                aria-label={p.label}
                data-kind={layoutOff ? undefined : kindOf(p)}
                aria-disabled={layoutOff || undefined}
                {...previewTip(
                  p.action,
                  layoutOff,
                  layoutOff
                    ? layoutOffReason(arrange)
                    : `${p.label}${p.group ? ` (${p.group})` : ''}${p.kind === 'check' ? ', a shortcut to check on your PC' : ''}.${p.how ? ` ${p.how}.` : ''} Right-click for more.`,
                )}
                onContextMenu={onContext(i)}
                onKeyDown={onKey(i, p.action)}
                onClick={(e) => runPin(e.detail)}
              >
                <KeyIcon name={p.icon} size={20} />
                <span className="deck-lbl">{p.label}</span>
              </button>
              {menu === i && (
                <KeyMenu
                  title={`${p.label}, in Always here`}
                  actions={actions}
                  byKeyboard={menuByKey.current}
                  onClose={() => setMenu(null)}
                  onChoose={(id, _action, detail) => {
                    if (id === 'run') runPin(detail);
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
