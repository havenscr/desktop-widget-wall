import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { IconBrandYoutube, IconCheck, IconChevronLeft, IconGripVertical, IconPencil, IconPlayerPlayFilled, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useSignalStore } from '../../signals/store';
import { tip } from '../../ui/HoverTip';
import { parseLink } from './links';
import { MAX_OWN_VIDEOS, useOwnLists, type OwnVideo } from './ownLists';
import { playOwn } from './ownPlay';
import { countText, DeleteAsk, metaText, OwnThumb, savedVideo, totalsText, useFadeBelow } from './OwnParts';
import { MAX_LABEL, type SavedItem } from './saved';
import { useWatchStore } from './store';
import { PASTE_ERROR_MS } from './ownShared';
import { useYtQueue } from '../ytmusic/queue';

/**
 * The playlist editor: the Watch card grown to 540 by 630 while a playlist of the owner's own is open. A head (back,
 * the name with its pencil, Done), a line with the totals and Delete and Play, the videos as rows of 56 px (a grip to
 * drag by, a number, a small picture, title and "channel · length", a remove button), two chips to add (what is
 * playing, one from the Watch list) and a field to paste a link.
 *
 * A row is put in order by dragging its grip (pointer events with pointer capture, never HTML drag and drop, so no
 * frame ever sees a drag) or with Alt and the arrow keys; Delete removes the focused row. Everything is written at
 * once, so closing (Done, the back arrow, Escape, leaving the Watch tab) needs no saving.
 */

export const ROW_H = 56;
const EDGE_PX = 36;
const SCROLL_STEP = 14;
const SCROLL_EVERY_MS = 30;

/** The refusal line for a pasted link that is not one video. */
export const PASTE_LINES = {
  playlist: 'A playlist holds videos. Paste a link to one video.',
  stream: 'A playlist holds videos. Save this one to the Watch list instead.',
} as const;

function typing(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el.matches('input, textarea, select');
}

interface Drag {
  from: number;
  slot: number;
  y: number;
}

function RenameField({ id, name, onDone }: { id: string; name: string; onDone: () => void }) {
  const [text, setText] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const save = () => {
    useWatchStore.getState().rename(`own:${id}`, text);
    onDone();
  };
  return (
    <input
      ref={ref}
      className="w-name-in own-name-in"
      value={text}
      maxLength={MAX_LABEL}
      aria-label="Name of the playlist"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
    />
  );
}

export function OwnEditor({ id }: { id: string }) {
  const entry = useWatchStore((s) => s.saved.find((i) => i.kind === 'own' && i.id === id));
  const list = useOwnLists((s) => s.lists[id]);
  const playing = useWatchStore((s) => s.playing);
  const report = useWatchStore((s) => s.report);
  const saved = useWatchStore((s) => s.saved);
  const failed = useYtQueue((s) => s.failed);
  const inCall = useSignalStore((s) => s.call !== null);
  const [renaming, setRenaming] = useState(false);
  const [asking, setAsking] = useState(false);
  const [picking, setPicking] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const flags = useRef({ asking: false });
  const focusId = useRef<string | null>(null);
  const lastY = useRef(0);
  const moveRef = useRef<(y: number) => void>(() => {});
  const dragging = drag !== null;
  flags.current.asking = asking;
  const items = list?.items ?? [];
  const fade = useFadeBelow(scroller, items.length * 2 + (picking ? 1 : 0));

  useEffect(() => () => clearTimeout(errTimer.current), []);
  // A playlist that no longer exists (deleted, or its entry gone) closes the editor.
  useEffect(() => {
    if (!entry) useOwnLists.getState().setOpen(null);
  }, [entry]);

  // Escape (not in a field, no drag) closes the editor and never stops the video; a drag in progress is put back first.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (dragRef.current) {
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = null;
        setDrag(null);
        return;
      }
      if (flags.current.asking || typing(e.target instanceof Element ? e.target : null) || document.querySelector('[role="menu"]')) return;
      e.preventDefault();
      useOwnLists.getState().setOpen(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Near the list's top or bottom edge a drag scrolls it; the one timer runs only during a drag.
  useEffect(() => {
    if (!dragging) return;
    const timer = setInterval(() => {
      const box = scroller.current;
      if (!box) return;
      const r = box.getBoundingClientRect();
      const scale = box.offsetWidth > 0 && r.width > 0 ? r.width / box.offsetWidth : 1;
      const y = lastY.current;
      if (y < r.top + EDGE_PX * scale) box.scrollTop -= SCROLL_STEP;
      else if (y > r.bottom - EDGE_PX * scale) box.scrollTop += SCROLL_STEP;
      else return;
      moveRef.current(y);
    }, SCROLL_EVERY_MS);
    return () => clearInterval(timer);
  }, [dragging]);

  // After a keyboard move or a removal the focus goes to the row it belongs to.
  useLayoutEffect(() => {
    const want = focusId.current;
    if (!want) return;
    focusId.current = null;
    scroller.current?.querySelector<HTMLElement>(`[data-vid="${want}"]`)?.focus();
  });

  const showError = (line: string) => {
    setError(line);
    clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setError(null), PASTE_ERROR_MS);
  };
  if (!entry || !list) return null;
  const own = useOwnLists.getState();
  const name = entry.label;
  const totals = totalsText(items);
  const have = new Set(items.map((i) => i.id));
  const single = playing && playing.kind === 'video' ? playing : null;

  const add = (v: OwnVideo): boolean => {
    const refused = own.addVideo(id, v);
    if (refused) {
      showError(refused);
      return false;
    }
    return true;
  };
  const addPlaying = () => {
    if (!single) return;
    const v: OwnVideo = { id: single.id };
    if (report.title) v.title = report.title;
    if (report.channel) v.channel = report.channel;
    if (report.duration !== null && report.duration > 0) v.seconds = report.duration;
    add(v);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseLink(text);
    if (!parsed.ok) return showError(parsed.error);
    // A `list=` beside a video is ignored here: no offer.
    if (parsed.ref.kind === 'video') {
      if (add({ id: parsed.ref.id })) {
        setText('');
        setError(null);
      }
      return;
    }
    showError(parsed.ref.kind === 'playlist' ? PASTE_LINES.playlist : PASTE_LINES.stream);
  };

  const playTip = items.length === 0 ? 'Add a video first' : inCall ? 'Video waits until the call ends' : `Play ${name}`;
  const startPlay = () => {
    own.setOpen(null);
    playOwn(id);
  };

  // What the "What is playing" chip says and does.
  let playingTip = 'Add the video that is playing, with its name and length';
  let playingOff = false;
  if (!playing) {
    playingTip = 'Nothing is playing';
    playingOff = true;
  } else if (playing.kind !== 'video') {
    playingTip = 'Only a video can go in a playlist';
    playingOff = true;
  } else if (have.has(playing.id)) {
    playingTip = 'Already in this playlist';
    playingOff = true;
  } else if (items.length >= MAX_OWN_VIDEOS) {
    playingTip = `This playlist is full (${MAX_OWN_VIDEOS})`;
    playingOff = true;
  }

  // Dragging by the grip.
  const slotAt = (clientY: number): { slot: number; y: number } => {
    const box = scroller.current;
    const w = wrap.current;
    if (!box || !w) return { slot: 0, y: 0 };
    const r = box.getBoundingClientRect();
    const scale = box.offsetWidth > 0 && r.width > 0 ? r.width / box.offsetWidth : 1;
    const cy = (clientY - r.top) / scale + box.scrollTop;
    const wr = w.getBoundingClientRect();
    return { slot: Math.max(0, Math.min(items.length, Math.round(cy / ROW_H))), y: (clientY - wr.top) / scale };
  };
  const onGripDown = (i: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || items.length < 2) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a browser without pointer capture still follows the events that reach the grip */
    }
    lastY.current = e.clientY;
    const at = slotAt(e.clientY);
    const d = { from: i, slot: at.slot, y: at.y };
    dragRef.current = d;
    setDrag(d);
  };
  const moveTo = (clientY: number) => {
    if (!dragRef.current) return;
    lastY.current = clientY;
    const at = slotAt(clientY);
    const d = { from: dragRef.current.from, slot: at.slot, y: at.y };
    dragRef.current = d;
    setDrag(d);
  };
  moveRef.current = moveTo;
  const onGripMove = (e: PointerEvent<HTMLButtonElement>) => moveTo(e.clientY);
  const endDrag = (commit: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || !commit) return;
    const to = d.slot > d.from ? d.slot - 1 : d.slot;
    if (to !== d.from) own.move(id, d.from, to);
  };

  const keyRow = (i: number, v: OwnVideo) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
      // Only a move that happens needs the focus kept on the row (a no-op would leave the flag to steal focus later).
      if (to < 0 || to >= items.length) return;
      focusId.current = v.id;
      own.move(id, i, to);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      focusId.current = (items[i + 1] ?? items[i - 1])?.id ?? null;
      own.removeVideo(id, v.id);
    }
  };

  const rows = items.map((v, i) => {
    const bad = failed.get(v.id);
    const lone = bad === 'embed' ? 'Plays only on YouTube' : bad === 'removed' ? 'No longer on YouTube' : null;
    const meta = lone ?? (v.title ? metaText(v) : ['named once it has played', v.seconds !== undefined ? metaText({ id: v.id, seconds: v.seconds }) : ''].filter(Boolean).join(' · '));
    const title = v.title ?? 'YouTube video';
    return (
      <div
        key={v.id}
        role="listitem"
        tabIndex={0}
        data-vid={v.id}
        aria-label={`${i + 1}. ${title}`}
        className={`own-v two w-own-row${drag?.from === i ? ' ghosted' : ''}${bad ? ' bad' : ''}`}
        onKeyDown={keyRow(i, v)}
      >
        <button
          type="button"
          className="own-grip"
          tabIndex={-1}
          aria-label={`Move ${title}`}
          {...tip('Drag to put it in order. With the row selected, Alt and the arrow keys move it.')}
          onPointerDown={onGripDown(i)}
          onPointerMove={onGripMove}
          onPointerUp={() => endDrag(true)}
          onPointerCancel={() => endDrag(false)}
        >
          <IconGripVertical size={20} aria-hidden="true" />
        </button>
        <span className="own-i">{i + 1}</span>
        <OwnThumb id={v.id} />
        <span className="own-tt" {...tip([title, meta].filter(Boolean).join(' · '))}>
          <span className="own-t">{title}</span>
          <span className="own-s w-sub2">{meta}</span>
        </span>
        <button
          type="button"
          className="w-mini"
          aria-label={`Remove ${title}`}
          {...tip('Remove from the playlist')}
          onClick={() => {
            focusId.current = (items[i + 1] ?? items[i - 1])?.id ?? null;
            own.removeVideo(id, v.id);
          }}
        >
          <IconX size={18} aria-hidden="true" />
        </button>
      </div>
    );
  });

  // The Watch list's saved single videos, each with a plus or a check.
  const pickable: SavedItem[] = saved.filter((i) => i.kind === 'video');
  const picker = (
    <div className="own-vlist fade more own-picker" role="list">
      {pickable.length === 0 ? <p className="own-none">No single videos are saved in the Watch list yet.</p> : null}
      {pickable.map((item) => {
        const has = have.has(item.id);
        return (
          <div key={item.id} role="listitem" className="own-v">
            <IconBrandYoutube size={22} aria-hidden="true" className="own-pk" />
            <span className="own-t">{item.label}</span>
            <button
              type="button"
              className="w-mini"
              aria-label={has ? `${item.label} is in the playlist` : `Add ${item.label}`}
              aria-disabled={has || undefined}
              {...tip(has ? 'Already in this playlist' : 'Add to the playlist')}
              onClick={() => (has ? undefined : add(savedVideo(item)))}
            >
              {has ? <IconCheck size={18} aria-hidden="true" /> : <IconPlus size={18} aria-hidden="true" />}
            </button>
          </div>
        );
      })}
    </div>
  );

  const line = drag ? Math.max(0, drag.slot * ROW_H - (scroller.current?.scrollTop ?? 0)) : 0;
  const ghostVideo = drag ? items[drag.from] : undefined;
  return (
    <div className="own-wrap">
      <div className="own-head">
        <button
          type="button"
          className="own-back"
          aria-label={picking ? 'Back to the playlist' : 'Back to the Watch list'}
          {...tip(picking ? 'Back to the playlist' : 'Back to the Watch list')}
          onClick={() => (picking ? setPicking(false) : own.setOpen(null))}
        >
          <IconChevronLeft size={20} aria-hidden="true" />
        </button>
        {renaming ? (
          <RenameField id={id} name={name} onDone={() => setRenaming(false)} />
        ) : (
          <>
            <span className="own-name u-ell" {...tip(name)}>
              {name}
            </span>
            <button type="button" className="w-mini" aria-label={`Rename ${name}`} {...tip(`Rename ${name}`)} onClick={() => setRenaming(true)}>
              <IconPencil size={18} aria-hidden="true" />
            </button>
          </>
        )}
        <button type="button" className="own-btn cy own-done" {...tip('Close the editor: every change is already saved')} onClick={() => own.setOpen(null)}>
          <IconCheck size={16} aria-hidden="true" />
          Done
        </button>
      </div>
      {asking ? (
        <div className="own-line">
          <DeleteAsk name={name} count={items.length} onDelete={() => own.deleteList(id)} onKeep={() => setAsking(false)} />
        </div>
      ) : (
        <div className="own-line">
          <span className="own-totals" {...(totals.partial ? tip('Lengths are learned as each video plays') : {})}>
            {totals.text}
          </span>
          <span className="own-right">
            <button type="button" className="own-btn quiet" {...tip(`Delete ${name} and its videos`)} onClick={() => setAsking(true)}>
              <IconTrash size={16} aria-hidden="true" />
              Delete
            </button>
            <button type="button" className="own-btn" disabled={items.length === 0 || inCall} {...tip(playTip)} onClick={startPlay}>
              <IconPlayerPlayFilled size={14} aria-hidden="true" />
              Play
            </button>
          </span>
        </div>
      )}
      <div className="own-vwrap" ref={wrap}>
        {picking ? (
          picker
        ) : (
          <div className={`own-vlist fade${fade.more ? ' more' : ''}`} role="list" aria-label={`Videos in ${name}`} ref={scroller} onScroll={fade.check}>
            {items.length === 0 ? <p className="own-none">Nothing here yet. Add what is playing, a video from the Watch list, or paste a link.</p> : null}
            {rows}
          </div>
        )}
        {drag && ghostVideo ? (
          <>
            <div className="own-line-drop" style={{ top: line }} aria-hidden="true" />
            <div className="own-ghost" style={{ top: Math.max(0, drag.y - ROW_H / 2) }} aria-hidden="true">
              <span className="own-grip hot">
                <IconGripVertical size={20} aria-hidden="true" />
              </span>
              <OwnThumb id={ghostVideo.id} />
              <span className="own-tt">
                <span className="own-t">{ghostVideo.title ?? 'YouTube video'}</span>
                <span className="own-s w-sub2">{metaText(ghostVideo)}</span>
              </span>
            </div>
          </>
        ) : null}
      </div>
      <div className="own-chips">
        <button type="button" className="own-chip" aria-disabled={playingOff || undefined} {...tip(playingTip)} onClick={() => (playingOff ? undefined : addPlaying())}>
          <IconPlus size={16} aria-hidden="true" />
          What is playing
        </button>
        <button type="button" className="own-chip" aria-pressed={picking} {...tip('Pick from the videos saved in the Watch list')} onClick={() => setPicking(true)}>
          <IconPlus size={16} aria-hidden="true" />
          From the Watch list
        </button>
      </div>
      <form className="w-field own-field" onSubmit={submit}>
        <input
          className="w-paste"
          value={text}
          placeholder="Paste a video link"
          aria-label="Paste a video link"
          spellCheck={false}
          autoComplete="off"
          maxLength={4096}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="w-add" disabled={!text.trim()} {...tip('Add this video to the playlist')}>
          Add
        </button>
      </form>
      {error ? (
        <div className="w-err own-err" role="alert">
          {error}
        </div>
      ) : null}
      <span className="w-vh" aria-live="polite">
        {countText(items.length)}
      </span>
    </div>
  );
}
