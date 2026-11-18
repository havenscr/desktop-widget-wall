import { IconChevronRight, IconPin } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hideTip, tip } from '../../ui/HoverTip';
import { useListenSource } from '../spotify/model';
import { closeLibraryMenu, placeBox, useLibraryMenu, type OpenLibraryMenu } from './libraryMenuModel';
import { PinArtSquare } from './PinArt';
import { displayPins, makeLibraryPin, pinKey, pinnedAt, usePins } from './pins';
import { useWatchStore } from './store';
import { useMenuLife } from './useMenuLife';

/** The place chooser: Pin 1, 2 and 3, each with its art and name or "Empty". One click writes there and closes; no question, no undo. */
function PlaceChooser({ menu }: { menu: OpenLibraryMenu }) {
  const places = usePins((s) => s.places);
  const saved = useWatchStore((s) => s.saved);
  const shown = displayPins(places, saved);
  const pin = makeLibraryPin(menu.entry);
  // Pinned elsewhere while the chooser was open: the menu says so instead of closing without a word.
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <div className="u-pin-menu-title" title={menu.name}>
        Pin {menu.name} in place of
      </div>
      {shown.map((s, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          onClick={() => {
            const at = pin ? pinnedAt(usePins.getState().places, pinKey(pin)) : -1;
            if (at >= 0) {
              setNote(`Already pinned in Pin ${at + 1}`);
              return;
            }
            if (pin) usePins.getState().pinLibrary(i, pin);
            closeLibraryMenu(true);
          }}
        >
          <span className="u-lib-chooser-label">Pin {i + 1}</span>
          {s ? <PinArtSquare shown={s} badge={false} /> : <i className="u-lib-empty" aria-hidden="true" />}
          <span>{s ? s.name : 'Empty'}</span>
        </button>
      ))}
      {note ? (
        <div className="u-pin-menu-note" role="status">
          {note}
        </div>
      ) : null}
    </>
  );
}

/** The one library menu, drawn fixed on the strip so no card clips it. Mounted once at the app root. */
export function LibraryMenuLayer() {
  const menu = useLibraryMenu((s) => s.open);
  if (!menu) return null;
  return <Box key={menu.id} menu={menu} />;
}

function Box({ menu }: { menu: OpenLibraryMenu }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState(menu.view);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const places = usePins((s) => s.places);
  const pin = makeLibraryPin(menu.entry);
  const at = pin ? pinnedAt(places, pinKey(pin)) : -1;
  const close = (restore: boolean) => closeLibraryMenu(restore);
  const onKeyDown = useMenuLife(ref, close, menu.byKeyboard, view);

  // The tile's or row's hover card goes, and stays away while the menu is open.
  useEffect(() => hideTip(true), []);
  // Measured before paint so the box never shows off the strip; re-placed when its height changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(placeBox(menu.at, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight));
  }, [menu.at, view]);
  // It closes when its source leaves the page, when the source's list scrolls, and when the music card changes source.
  useEffect(() => {
    const gone = new MutationObserver(() => {
      if (!menu.source.isConnected) closeLibraryMenu(false);
    });
    gone.observe(document.body, { childList: true, subtree: true });
    const scrolled = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && t.contains(menu.source) && !ref.current?.contains(t)) closeLibraryMenu(false);
    };
    document.addEventListener('scroll', scrolled, true);
    const unsub = useListenSource.subscribe((s, p) => {
      if (s.source !== p.source) closeLibraryMenu(false);
    });
    return () => {
      gone.disconnect();
      document.removeEventListener('scroll', scrolled, true);
      unsub();
    };
  }, [menu.source]);

  const act = (a: OpenLibraryMenu['actions'][number]) => () => {
    closeLibraryMenu(a.restore !== false);
    a.run();
  };
  const pinRow = () => {
    if (!pin) return { label: 'Cannot be pinned', tipText: "This item's address is not one the wall can keep.", off: true };
    if (at >= 0) return { label: `Pinned in Pin ${at + 1}`, tipText: 'Right-click it on the left to remove it.', off: true };
    return { label: 'Pin to the left', tipText: null, off: false };
  };
  const row = pinRow();
  const keyBox = (e: React.KeyboardEvent) => {
    onKeyDown(e);
    if (e.key === 'ArrowLeft' && view === 'chooser' && !menu.chooserOnly) {
      e.preventDefault();
      setView('actions');
      // Back on the Pin row.
      requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('.u-lib-pinrow')?.focus());
    }
    if (e.key === 'ArrowRight' && view === 'actions' && !row.off && document.activeElement?.classList.contains('u-lib-pinrow')) {
      e.preventDefault();
      setView('chooser');
    }
  };
  return (
    <div
      ref={ref}
      className={`u-pin-menu u-lib-menu${view === 'chooser' ? ' u-lib-chooser' : ''}`}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      role="menu"
      aria-label={`Options for ${menu.name}`}
      onKeyDown={keyBox}
      onContextMenu={(e) => e.preventDefault()}
    >
      {view === 'chooser' ? (
        <PlaceChooser menu={menu} />
      ) : (
        <>
          <div className="u-pin-menu-title">{menu.name}</div>
          {menu.actions.map((a) => (
            <button key={a.id} type="button" role="menuitem" onClick={act(a)}>
              {a.icon}
              <span>{a.label}</span>
              {a.chevron ? <IconChevronRight className="u-lib-chev" size={18} aria-hidden="true" /> : null}
            </button>
          ))}
          <div className="u-lib-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="u-lib-pinrow"
            aria-disabled={row.off ? 'true' : undefined}
            data-disabled={row.off ? '' : undefined}
            {...(row.tipText ? tip(row.tipText) : {})}
            onClick={() => {
              if (!row.off) setView('chooser');
            }}
          >
            <IconPin size={20} aria-hidden="true" />
            <span>{row.label}</span>
            {row.off ? null : <IconChevronRight className="u-lib-chev" size={18} aria-hidden="true" />}
          </button>
        </>
      )}
    </div>
  );
}
