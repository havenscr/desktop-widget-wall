import { IconPlus } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { overlayOwnsPointer } from '../../ribbon/DrawerScrim';
import { KeyMenu, type KeyMenuAction } from '../../work/KeyMenu';
import { KeyPicker } from '../../work/KeyPicker';
import { KeyRename } from '../../work/KeyRename';
import { setPinName } from '../../work/pinNames';
import { usePinEdits } from '../../work/usePinEdits';
import { keyboardOnMouseKey, useKeyPress } from '../../work/keyPress';
import { isLayoutAction, layoutOffReason, useArrangeStatus } from '../../work/arrangeStatus';
import { KeyIcon } from '../../work/keyIcons';
import { loadKeys } from '../../work/keysFeed';
import { MAX_PINS } from '../../work/libraryModel';
import { tip } from '../../ui/HoverTip';
import { makeKindOf, usePins } from '../../work/usePins';
import { useBrief } from '../../work/useBrief';
import { previewTip } from '../../work/ZonesPreview';
import { useWorkLayerStore } from './layerStore';
import { canvasMeasure, labelCandidates, pickLabel, type Measure } from './shortLabel';

/**
 * One label for each key, chosen by measuring: the width a label may take is the first tile's inside width (a tile
 * is one fifth of the row, less its edge and padding), the font is the one the label is drawn in, and the measure waits
 * for the fonts to load. `measure` stands in for the canvas under test. Until it is measured the first candidate shows.
 */
function useFittedLabels(labels: readonly string[], names: readonly string[], measure?: Measure) {
  const tilesRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ avail: number; measure: Measure | null }>({ avail: 0, measure: null });
  const key = labels.join('\n');
  const nameKey = names.join('\n');
  useLayoutEffect(() => {
    let live = true;
    const read = () => {
      const tile = tilesRef.current?.querySelector<HTMLElement>('.u-key:not(.empty)');
      if (!tile || !live) return;
      const cs = getComputedStyle(tile);
      const avail = tile.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
      const m = measure ?? (avail > 0 ? canvasMeasure(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`) : null);
      setFit((f) => (f.avail === avail && f.measure === m ? f : { avail, measure: m }));
    };
    read();
    void document.fonts?.ready.then(read);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    if (tilesRef.current) ro?.observe(tilesRef.current);
    return () => {
      live = false;
      ro?.disconnect();
    };
  }, [key, measure]);
  const words = useMemo(
    () =>
      key.split('\n').map((l, i, all) => {
        const cands = labelCandidates(l, all, nameKey.split('\n')[i] || undefined);
        return fit.measure ? pickLabel(cands, fit.avail, fit.measure) : cands[0]!;
      }),
    [key, nameKey, fit],
  );
  return { tilesRef, words, fit };
}

/** How long a menu, the picker or the rename popover takes to fade out once it is closed. */
export const KEYS_FADE_MS = 180;

/**
 * Keeps what it shows for `KEYS_FADE_MS` after `children` becomes null, with `out` on its class, so a closing menu fades
 * instead of being cut. The wrapper draws nothing itself (`display: contents`); the stylesheet fades its child.
 */
function Fade({ children }: { children: ReactNode }) {
  const [kept, setKept] = useState<ReactNode>(children);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (children) {
      setKept(children);
      setOut(false);
      return;
    }
    setOut(true);
    const t = setTimeout(() => setKept(null), KEYS_FADE_MS);
    return () => clearTimeout(t);
  }, [children]);
  return kept ? <div className={`u-fade${out ? ' out' : ''}`}>{kept}</div> : null;
}

/**
 * The "Always here" keys under the Watch list, shown with the work layer: the same five keys, pressed the same way
 * (one press is one action, a key that only runs from a click ignores Enter and Space), and changed the way they are
 * on Work. A right-click (or the ContextMenu key, or Shift+F10) opens the key's menu: run it now, move it left or
 * right, replace it, rename it, take it off. On an empty place the menu has Add a key, and a click adds one at once.
 * The picker fills the right wing; the menu and the rename popover open upward. While one is open the layer is held
 * up (`held`), so it neither hides nor lets the Watch controls rest. A name shows here and on Work, one per key.
 * The row fades with the layer, and under the Watch list while that grows (unwind-work.css). Hidden, it is `inert`,
 * so it takes no click or Tab stop.
 */
export function UnwindKeys({ measure }: { measure?: Measure } = {}) {
  const shown = useWorkLayerStore((s) => s.shown);
  const pinState = usePins(shown);
  const { read, lib, pins, filePins } = pinState;
  const edits = usePinEdits(pinState);
  const arrange = useArrangeStatus();
  const [brief, showBrief] = useBrief();
  const { press, onKeyDown } = useKeyPress(showBrief, loadKeys);
  const kindOf = makeKindOf(lib);
  const { tilesRef, words, fit } = useFittedLabels(
    pins.map((p) => p.label),
    pins.map((p) => p.name ?? ''),
    measure,
  );
  // A slot at or past the last key is an empty place.
  const [menu, setMenu] = useState<number | null>(null);
  const [picker, setPicker] = useState<number | null>(null);
  const [rename, setRename] = useState<number | null>(null);
  const menuByKey = useRef(false);
  const open = menu !== null || picker !== null || rename !== null;
  useEffect(() => {
    useWorkLayerStore.setState({ held: open });
    return () => useWorkLayerStore.setState({ held: false });
  }, [open]);
  // The layer going away (the sheet opens, the place changes) takes whatever was open with it.
  useEffect(() => {
    if (!shown) {
      setMenu(null);
      setPicker(null);
      setRename(null);
    }
  }, [shown]);
  if (read.status === 'absent' || !lib) return null;
  const refs = pins.map((p) => p.ref);
  const openPicker = (slot: number) => {
    if (overlayOwnsPointer()) return;
    setMenu(null);
    setRename(null);
    setPicker(slot);
  };
  const onContext = (slot: number) => (e: MouseEvent) => {
    e.preventDefault();
    if (overlayOwnsPointer()) return;
    menuByKey.current = false;
    setPicker(null);
    setRename(null);
    setMenu(slot);
  };
  const onKey = (slot: number, action: string | null) => (e: KeyboardEvent) => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      if (overlayOwnsPointer()) return;
      menuByKey.current = true;
      setPicker(null);
      setRename(null);
      setMenu(slot);
      return;
    }
    onKeyDown(action)(e);
  };
  const focusTile = (slot: number) => requestAnimationFrame(() => tilesRef.current?.querySelectorAll<HTMLElement>('.key-tile')[slot]?.focus());
  const menuPin = menu !== null ? pins[menu] : undefined;
  const renamePin = rename !== null ? pins[rename] : undefined;
  const menuNode =
    menu === null ? null : menuPin && menu < pins.length ? (
      <KeyMenu
        key={`menu-${menuPin.ref}`}
        title={menuPin.name ?? menuPin.label}
        byKeyboard={menuByKey.current}
        onClose={() => setMenu(null)}
        actions={pinActions(menuPin, menu, pins.length, isLayoutAction(menuPin.action) && arrange !== true)}
        onChoose={(id, _action, detail) => {
          if (id === 'run') runPin(menuPin, detail);
          if (id === 'left') edits.moveSlot(menu, menu - 1);
          if (id === 'right') edits.moveSlot(menu, menu + 1);
          if (id === 'replace') openPicker(menu);
          if (id === 'rename') setRename(menu);
          if (id === 'remove') edits.removeSlot(menu);
        }}
      />
    ) : (
      <KeyMenu
        key="menu-empty"
        title="An empty place"
        byKeyboard={menuByKey.current}
        onClose={() => setMenu(null)}
        actions={[{ id: 'add', label: 'Add a key', help: `Pick a key from the library for Always here. ${pins.length} of ${MAX_PINS} used.` }]}
        onChoose={() => openPicker(pins.length)}
      />
    );
  const renameNode =
    renamePin && rename !== null ? (
      <KeyRename
        key={`rename-${renamePin.ref}`}
        title={renamePin.label}
        initial={renamePin.name ?? ''}
        avail={fit.avail}
        measure={fit.measure}
        onSave={(name) => {
          setPinName(renamePin.ref, name);
          setRename(null);
          focusTile(rename);
        }}
        onReset={() => {
          setPinName(renamePin.ref, '');
          setRename(null);
          focusTile(rename);
        }}
        onClose={() => {
          setRename(null);
          focusTile(rename);
        }}
      />
    ) : null;
  const pickerNode =
    picker !== null ? (
      <KeyPicker
        lib={lib}
        filePins={filePins}
        pins={refs}
        slot={picker}
        adding={picker >= pins.length}
        onChoose={(ref) => {
          edits.choose(picker, ref);
          setPicker(null);
        }}
        onReset={() => {
          edits.reset();
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    ) : null;

  function runPin(p: (typeof pins)[number], detail: number) {
    const layoutOff = isLayoutAction(p.action) && arrange !== true;
    if (layoutOff || !p.runnable || keyboardOnMouseKey(p.action, detail)) return;
    const [kind, id] = [p.ref.slice(0, 4), p.ref.slice(4)];
    const call = kind === 'lib:' ? ({ command: 'wall2_keys_send_library', args: { id } } as const) : ({ command: 'wall2_keys_send', args: { setId: 'pinned', index: Number(p.ref.slice(5)) } } as const);
    const where = { name: p.group ?? 'the app in front', general: p.group === null };
    void press(`pin:${p.ref}`, detail, call, p.label, p.action, where, false);
  }

  return (
    <section className="u-keys" data-shown={shown ? '' : undefined} inert={!shown} aria-label="Always here keys" data-testid="u-keys">
      <div className="u-keys-tiles" ref={tilesRef}>
        {pins.map((p, i) => {
          const layoutOff = isLayoutAction(p.action) && arrange !== true;
          const off = layoutOff || !p.runnable;
          const shownName = p.name ?? p.label;
          return (
            <div className="key-tile-wrap u-key-wrap" key={p.ref} data-ref={p.ref}>
              <button
                type="button"
                className={`deck-tile key-tile u-key${off ? ' off' : ''}`}
                data-kind={off ? undefined : kindOf(p)}
                aria-label={shownName}
                aria-disabled={off || undefined}
                {...previewTip(p.action, layoutOff, layoutOff ? layoutOffReason(arrange) : !p.runnable ? `${shownName}: ${p.how}. Right-click to take it out of Always here.` : `${shownName}${p.group ? ` (${p.group})` : ''}.${p.how ? ` ${p.how}.` : ''} Right-click for more.`)}
                onContextMenu={onContext(i)}
                onKeyDown={onKey(i, p.action)}
                onClick={(e) => runPin(p, e.detail)}
              >
                <KeyIcon name={p.icon} size={22} />
                <span className="u-key-l">{words[i]}</span>
              </button>
              <Fade>{menu === i ? menuNode : null}</Fade>
            </div>
          );
        })}
        {Array.from({ length: Math.max(0, MAX_PINS - pins.length) }, (_, i) => (
          <div className="key-tile-wrap u-key-wrap" key={`empty-${i}`}>
            <button
              type="button"
              className="deck-tile key-tile u-key empty"
              aria-label="Add a key"
              {...tip(`An empty place. Click to add a key to Always here, or right-click for more. ${pins.length} of ${MAX_PINS} used.`)}
              onContextMenu={onContext(pins.length + i)}
              onKeyDown={onKey(pins.length + i, null)}
              onClick={() => openPicker(pins.length)}
            >
              <IconPlus size={22} aria-hidden="true" />
            </button>
            <Fade>{menu === pins.length + i ? menuNode : null}</Fade>
          </div>
        ))}
      </div>
      <Fade>{renameNode}</Fade>
      <Fade>{pickerNode}</Fade>
      <div className="u-keys-line" role="status">
        {brief}
      </div>
    </section>
  );
}

/** The rows of a key's menu, the same as the Work row's, with Rename after Replace. */
function pinActions(p: { label: string; name?: string; runnable: boolean; how: string }, i: number, count: number, layoutOff: boolean): KeyMenuAction[] {
  const n = p.name ?? p.label;
  return [
    { id: 'run', label: 'Run it now', disabled: layoutOff || !p.runnable, help: p.runnable ? `Sends ${n} once, right now.` : `${n} cannot run: ${p.how}.` },
    { id: 'left', label: 'Move left', disabled: i === 0, help: i === 0 ? 'Already first.' : `Swaps ${n} with the key on its left.` },
    { id: 'right', label: 'Move right', disabled: i === count - 1, help: i === count - 1 ? 'Already last.' : `Swaps ${n} with the key on its right.` },
    { id: 'replace', label: 'Replace with another key', help: `Pick a key from the library to take ${n}'s place. A key already in Always here swaps places with it.` },
    { id: 'rename', label: 'Rename...', help: `Give ${n} a name of your own. It shows here and on Work.` },
    { id: 'remove', label: 'Remove from Always here', help: `Takes ${n} off the Always here row. It stays in the key library.` },
  ];
}
