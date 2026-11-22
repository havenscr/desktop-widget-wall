import {
  IconCamera,
  IconCopy,
  IconExternalLink,
  IconFiles,
  IconFilter,
  IconFolder,
  IconLink,
  IconPencil,
  IconPhoto,
  IconPin,
  IconSortAscending,
  IconSortDescending,
  IconTextScan2,
  IconTrash,
  IconVideo,
} from '@tabler/icons-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { invoke } from '../bridge/tauri';
import { hover } from '../tools/hover';
import { useBrief } from '../work/useBrief';
import { CapMenu, type CapMenuItem } from './CapMenu';
import {
  arrange,
  copyBitmap,
  FILTER_WORDS,
  FILTERS,
  formatSize,
  formatWhen,
  kindWord,
  SORTS,
  trimThumbs,
  useCaptures,
  usePref,
  useThumb,
  type Capture,
  type CaptureAction,
  type KindFilter,
} from './captures';

const GONE = 'File moved or deleted';
/** How long a trashed row stays hidden while the list still holds it; a file back in place after this is a restored one. */
export const BIN_HIDE_MS = 10_000;

/** Words for a failed action, by Rust's answer. */
function failure(e: unknown): string {
  const word = e instanceof Error ? e.message : String(e);
  if (word === 'missing') return GONE;
  if (word === 'not-installed') return 'ShareX is not installed';
  if (word === 'recycle-failed') return 'Could not move to the Recycle Bin';
  return 'Could not do that';
}

const DONE: Record<CaptureAction | 'image', string> = {
  open: 'Opened',
  copy: 'Copied',
  folder: 'Shown in File Explorer',
  path: 'Path copied',
  edit: 'Opened in ShareX',
  pin: 'Pinned to the screen',
  ocr: 'Reading the text',
  trash: 'Moved to the Recycle Bin',
  image: 'Copied',
};

/** A capture's picture, or a tile that says why there is none. `w` and `h` are the box in design pixels; a large one fills its box instead. */
function Pic({ c, w, h, large, lazy = false }: { c: Capture; w?: number; h?: number; large: boolean; lazy?: boolean }) {
  const thumb = useThumb(c, !lazy);
  const style = large ? undefined : { width: w, height: h };
  if (thumb.state === 'ready') return <img className={`cap-img${large ? ' fill' : ''}`} src={thumb.src} alt="" width={w} height={h} style={style} draggable={false} />;
  const icon = c.kind === 'video' ? <IconVideo size={large ? 56 : 28} stroke={1.6} aria-hidden="true" /> : <IconPhoto size={large ? 56 : 28} stroke={1.6} aria-hidden="true" />;
  let words = '';
  if (!c.exists) words = GONE;
  else if (thumb.state === 'big') words = 'Too big to preview';
  else if (thumb.state === 'failed') words = 'No preview';
  return (
    <span className={`cap-tile${c.kind === 'video' ? ' video' : ''}${large ? ' fill' : ''}`} style={style}>
      {icon}
      {large && words ? <span className="cap-tile-note">{words}</span> : null}
    </span>
  );
}

function Badge({ c }: { c: Capture }) {
  const word = kindWord(c);
  return word ? <span className={`cap-badge ${c.kind}`}>{word}</span> : null;
}

/** One row of the list. Its picture is asked for only once the row is near the visible part of the list. */
function Row({ c, selected, onPick, onMenu }: { c: Capture; selected: boolean; onPick: () => void; onMenu: (e: MouseEvent) => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '240px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const word = kindWord(c);
  const when = formatWhen(c.time);
  const detail = c.exists ? [when, word].filter(Boolean).join(' · ') : GONE;
  const label = c.app || c.title || c.fileName;
  return (
    <button
      ref={ref}
      type="button"
      className={`cap-row${c.exists ? '' : ' gone'}${selected ? ' sel' : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onPick}
      onContextMenu={onMenu}
      {...hover(c.exists ? `Show "${c.title || c.fileName}" large. Right-click for more.` : `${GONE}. Show it large.`)}
    >
      <Pic c={c} w={96} h={54} large={false} lazy={!near} />
      <span className="cap-rt">
        <b>{label}</b>
        <span>{detail}</span>
      </span>
    </button>
  );
}

type MenuState = { kind: 'filter'; x: number; y: number } | { kind: 'capture'; id: string; x: number; y: number };
const MENU_W = 400;
const FILTER_W = 190;

/** The card's list of what a right-click offers. Everything but Copy path and the folder needs the file to exist; the ShareX rows and Copy image need a picture. */
function captureItems(c: Capture): CapMenuItem[] {
  const ok = c.exists;
  const pic = ok && c.kind === 'image';
  return [
    { id: 'image', label: 'Copy image', Icon: IconPhoto, disabled: !pic, help: 'Copy the picture itself to the clipboard (pictures only, not GIFs or recordings)' },
    { id: 'copy', label: 'Copy as file', Icon: IconFiles, disabled: !ok, help: 'Copy the capture as a file, ready to paste into a chat, an email or a folder' },
    { id: 'path', label: 'Copy path', Icon: IconLink, disabled: !ok, help: 'Copy the full path of the file as text' },
    { id: 'open', label: 'Open', Icon: IconExternalLink, rule: true, disabled: !ok, help: 'Open in its default app, on the main monitor in the lower right quarter' },
    { id: 'edit', label: 'Edit in ShareX', Icon: IconPencil, disabled: !pic, help: 'Open the ShareX image editor on this picture' },
    { id: 'pin', label: 'Pin to screen', Icon: IconPin, disabled: !pic, help: 'Pin this picture on top of everything with ShareX' },
    { id: 'ocr', label: 'Copy text (OCR)', Icon: IconTextScan2, disabled: !pic, help: 'Read the text in this picture with ShareX; its window has the copy button' },
    { id: 'folder', label: 'Show in folder', Icon: IconFolder, rule: true, disabled: !ok, help: 'Show this capture in File Explorer' },
    { id: 'trash', label: 'Move to Recycle Bin', Icon: IconTrash, disabled: !ok, confirm: 'Click again to move to Recycle Bin', help: 'Move this file to the Windows Recycle Bin. It asks once more here before it moves.' },
  ];
}

/** The Shelf's Captures card: the picked capture large on the left, every capture as a row that never moves on the right. */
export function CapturesCard() {
  const { status, items, reload } = useCaptures();
  const [picked, setPicked] = useState<string | null>(null);
  const [sort, setSort] = usePref('wall.captures.sort', SORTS, 'newest');
  const [filter, setFilter] = usePref<KindFilter>('wall.captures.filter', FILTERS, 'all');
  const [menu, setMenu] = useState<MenuState | null>(null);
  // Rows hidden after a trash, by id and the time they were hidden.
  const [binned, setBinned] = useState<Record<string, number>>({});
  const funnelWasOpen = useRef(false);
  const [brief, show] = useBrief();
  const card = useRef<HTMLElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const [atEnd, setAtEnd] = useState(false);

  const kept = items.filter((c) => !(c.id in binned));
  const shown = arrange(kept, sort, filter);
  const big = shown.find((c) => c.id === picked) ?? shown[0];
  // A pick that is not in the shown list (filtered away, gone from the list) is dropped, so the big one
  // falls to the first row and coming back to All does not jump to the old pick.
  useEffect(() => {
    if (status === 'ready' && picked !== null && !shown.some((c) => c.id === picked)) setPicked(null);
  }, [items, sort, filter, binned, status]); // eslint-disable-line react-hooks/exhaustive-deps
  // A hidden row is shown again once a refresh no longer lists it (forget it) or lists it back in place
  // after BIN_HIDE_MS (it was restored).
  useEffect(() => {
    setBinned((b) => {
      const now = Date.now();
      const next: Record<string, number> = {};
      for (const [id, at] of Object.entries(b)) {
        const c = items.find((x) => x.id === id);
        if (c && !(c.exists && now - at >= BIN_HIDE_MS)) next[id] = at;
      }
      return Object.keys(next).length === Object.keys(b).length ? b : next;
    });
  }, [items]);
  useEffect(() => trimThumbs(shown.map((c) => c.id)), [items, sort, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkEnd = () => {
    const el = list.current;
    if (el) setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 4);
  };
  useEffect(checkEnd, [shown.length, filter, sort]);

  const act = (c: Capture, action: CaptureAction) => {
    invoke('wall2_captures_act', { id: c.id, action }).then(
      () => {
        show(DONE[action]);
        if (action === 'trash') {
          setBinned((b) => ({ ...b, [c.id]: Date.now() }));
          reload();
        }
      },
      (e: unknown) => show(failure(e)),
    );
  };

  /** Menu corner in the card's own pixels (the card may be scaled), kept inside the card. */
  const corner = (clientX: number, clientY: number, height: number, width = MENU_W) => {
    const el = card.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const k = r.width / el.offsetWidth || 1;
    const x = Math.min(Math.max(6, (clientX - r.left) / k), el.offsetWidth - width - 6);
    const y = Math.min(Math.max(6, (clientY - r.top) / k), el.offsetHeight - height - 6);
    return { x, y };
  };
  const openCaptureMenu = (c: Capture) => (e: MouseEvent) => {
    e.preventDefault();
    setMenu({ kind: 'capture', id: c.id, ...corner(e.clientX, e.clientY, 9 * 38 + 24) });
  };
  const openFilterMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const k = (card.current?.getBoundingClientRect().width ?? 1) / (card.current?.offsetWidth || 1);
    setMenu({ kind: 'filter', ...corner(b.right - FILTER_W * k, b.bottom + 6 * k, 4 * 38 + 12, FILTER_W) });
  };

  const choose = (c: Capture, id: string) => {
    if (id === 'image') {
      copyBitmap(c).then(
        () => show(DONE.image),
        () => show('Could not copy'),
      );
      return;
    }
    act(c, id as CaptureAction);
  };

  let body;
  if (status === 'notfound') body = <p className="shelf-note">ShareX history not found on this PC</p>;
  else if (status === 'error') body = <p className="shelf-note">Could not read the ShareX history</p>;
  else if (status === 'ready' && items.length === 0) body = <p className="shelf-note">No captures yet. Use the keys beside this card.</p>;
  else if (status === 'ready' && !big) body = <p className="shelf-note">{`No ${FILTER_WORDS[filter].toLowerCase()} captures yet`}</p>;
  else if (!big) body = null;
  else {
    const name = big.title || big.fileName;
    const when = formatWhen(big.time);
    const line = [big.app, when, big.exists ? formatSize(big.size) : ''].filter(Boolean).join(' · ');
    body = (
      <div className="cap-hero">
        <div className="cap-big">
          <div className="cap-pic-wrap">
            {big.exists ? (
              <button
                type="button"
                className="cap-pic"
                onClick={() => (big.kind === 'image' ? choose(big, 'image') : act(big, 'copy'))}
                onContextMenu={openCaptureMenu(big)}
                {...hover(big.kind === 'image' ? `Copy the picture "${name}" to the clipboard. Right-click for more.` : `Copy "${name}" to the clipboard as a file. Right-click for more.`)}
              >
                <Pic c={big} large />
              </button>
            ) : (
              <div className="cap-pic gone" onContextMenu={openCaptureMenu(big)} {...hover(GONE)}>
                <Pic c={big} large />
              </div>
            )}
            <Badge c={big} />
            <p className="cap-chip" role="status">
              {brief ?? ''}
            </p>
          </div>
          <div className="cap-bt">
            <b {...hover(name)}>{name}</b>
            <span {...hover(line || big.fileName)}>{big.exists ? line : GONE}</span>
          </div>
          {big.exists ? (
            <div className="cap-acts">
              <button type="button" className="cap-act" onClick={() => act(big, 'copy')} {...hover('Copy this capture to the clipboard as a file, ready to paste into a chat, an email or a folder')}>
                <IconCopy size={20} stroke={1.8} aria-hidden="true" />
                Copy
              </button>
              <button type="button" className="cap-act" onClick={() => act(big, 'open')} {...hover('Open this capture in its default app, on the main monitor in the lower right quarter')}>
                <IconExternalLink size={20} stroke={1.8} aria-hidden="true" />
                Open
              </button>
              <button type="button" className="cap-act" onClick={() => act(big, 'folder')} {...hover('Show this capture in File Explorer')}>
                <IconFolder size={20} stroke={1.8} aria-hidden="true" />
                Folder
              </button>
            </div>
          ) : null}
        </div>
        <div ref={list} className={`cap-rows${atEnd ? ' end' : ''}`} role="group" aria-label="Captures" onScroll={checkEnd}>
          {shown.map((c) => (
            <Row key={c.id} c={c} selected={c.id === big.id} onPick={() => setPicked(c.id)} onMenu={openCaptureMenu(c)} />
          ))}
        </div>
      </div>
    );
  }

  const SortIcon = sort === 'newest' ? IconSortDescending : IconSortAscending;
  const sortWord = sort === 'newest' ? 'Newest first' : 'Oldest first';
  const menuCapture = menu?.kind === 'capture' ? shown.find((c) => c.id === menu.id) ?? items.find((c) => c.id === menu.id) : undefined;
  const filterItems: CapMenuItem[] = FILTERS.map((f) => ({ id: f, label: FILTER_WORDS[f], ticked: f === filter, help: f === 'all' ? 'Show every kind of capture' : `Show only ${FILTER_WORDS[f].toLowerCase()} captures` }));

  return (
    <section ref={card} className={`shelf-card shelf-captures${menu ? ' menu-open' : ''}`} aria-label="Captures">
      <div className="k">
        <IconCamera size={22} stroke={1.8} aria-hidden="true" /> Captures <span className="shelf-sub">{`ShareX, ${sortWord.toLowerCase()}`}</span>
        <span className="cap-tools">
          <button
            type="button"
            className="cap-tool"
            aria-label={`${sortWord}. Press to switch.`}
            onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}
            {...hover(`${sortWord}. Click for ${sort === 'newest' ? 'oldest' : 'newest'} first.`)}
          >
            <SortIcon size={22} stroke={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`cap-tool${filter === 'all' ? '' : ' on'}`}
            aria-label={`Show: ${FILTER_WORDS[filter]}. Press to choose.`}
            aria-haspopup="menu"
            onPointerDown={() => {
              // The menu's own outside-press close runs first; remember it was open so the click that follows closes, not reopens.
              funnelWasOpen.current = menu?.kind === 'filter';
            }}
            onClick={(e) => {
              const was = funnelWasOpen.current;
              funnelWasOpen.current = false;
              if (was) setMenu(null);
              else openFilterMenu(e);
            }}
            {...hover(`Showing: ${FILTER_WORDS[filter]}. Click to show all, images, video or GIFs.`)}
          >
            <IconFilter size={22} stroke={1.8} aria-hidden="true" />
          </button>
        </span>
      </div>
      {body}
      {menu?.kind === 'filter' ? (
        <CapMenu
          key="filter"
          label="Show captures"
          items={filterItems}
          x={menu.x}
          y={menu.y}
          width={FILTER_W}
          onChoose={(id) => setFilter(id as KindFilter)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {menu?.kind === 'capture' && menuCapture ? (
        <CapMenu key={menu.id} label="Capture options" items={captureItems(menuCapture)} x={menu.x} y={menu.y} onChoose={(id) => choose(menuCapture, id)} onClose={() => setMenu(null)} />
      ) : null}
    </section>
  );
}
