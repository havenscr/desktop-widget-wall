import { IconFolder } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '../bridge/tauri';
import { hover } from '../tools/hover';
import { tip } from '../ui/HoverTip';
import { useBrief } from '../work/useBrief';
import { fileLook } from './fileIcon';
import { canPreview, PREVIEW_DELAY_MS, recentWhen, useRecentFiles, type RecentFile } from './recent';

/** Words for a failed Open or Folder, by Rust's answer. */
function failure(e: unknown): string {
  const word = e instanceof Error ? e.message : String(e);
  return word === 'missing' ? 'File moved or deleted' : 'Could not do that';
}

/** The preview card on show: what it says and where it sits, in the stage's design pixels. */
interface Shown {
  id: string;
  name: string;
  when: string;
  url: string;
  left: number;
  top: number;
  host: Element | null;
}

/** Where a preview wanted by a row goes: right of the card, level with the row, inside the 2560 by 720 stage. */
interface Want {
  file: RecentFile;
  left: number;
  top: number;
  host: Element | null;
}

const STAGE_H = 720;
const PREVIEW_GAP = 16;
const PREVIEW_BOX_H = 360;
const NONE_MS = 30_000;

/** The row's place for its preview, from the real boxes, undone from the stage's scale. */
function placeFor(row: HTMLElement): { left: number; top: number; host: Element | null } {
  const stage = row.closest('.stage');
  const card = (row.closest('.rf-card') ?? row).getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const s = stage ? stage.getBoundingClientRect() : { left: 0, top: 0, width: 0 };
  const scale = stage && s.width > 0 ? s.width / 2560 : 1;
  const mid = (r.top + r.height / 2 - s.top) / scale;
  return {
    left: (card.right - s.left) / scale + PREVIEW_GAP,
    top: Math.min(STAGE_H - PREVIEW_BOX_H - 20, Math.max(20, mid - PREVIEW_BOX_H / 2)),
    host: stage,
  };
}

/** The Shelf's Recent files card: the last 20 files opened, newest first, five rows in view and the rest a scroll away. A row opens the file; its Folder button shows it in File Explorer. */
export function RecentCard() {
  const { status, items } = useRecentFiles();
  const [brief, show] = useBrief();
  const act = (command: 'wall2_recent_open' | 'wall2_recent_folder', id: string, done: string) => {
    invoke(command, { id }).then(
      () => show(done),
      (e: unknown) => show(failure(e)),
    );
  };

  const [shown, setShown] = useState<Shown | null>(null);
  const cache = useRef(new Map<string, string>());
  const noneUntil = useRef(new Map<string, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wanted = useRef<Want | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const reveal = useCallback((w: Want, url: string) => {
    if (url.startsWith('data:image/')) setShown({ id: w.file.id, name: w.file.name, when: recentWhen(w.file.modified), url, left: w.left, top: w.top, host: w.host });
  }, []);

  /** Asks for the wanted row's thumbnail, one request at a time; an answer for a row the pointer has left is kept but not drawn. */
  const fetchFor = useCallback(
    (w: Want) => {
      const known = cache.current.get(w.file.id);
      if (known !== undefined) {
        reveal(w, known);
        return;
      }
      if ((noneUntil.current.get(w.file.id) ?? 0) > Date.now()) return;
      if (busy.current) return;
      busy.current = true;
      invoke<string>('wall2_recent_preview', { id: w.file.id }).then(
        (url) => url,
        () => 'none',
      ).then((url) => {
        busy.current = false;
        if (typeof url === 'string' && url.startsWith('data:image/')) cache.current.set(w.file.id, url);
        else noneUntil.current.set(w.file.id, Date.now() + NONE_MS);
        if (!alive.current) return;
        const now = wanted.current;
        if (now) fetchFor(now);
      });
    },
    [reveal],
  );

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    wanted.current = null;
    setShown(null);
  }, []);

  const shownId = shown?.id;
  useEffect(() => {
    if (shownId !== undefined && !items.some((f) => f.id === shownId)) hide();
  }, [items, shownId, hide]);

  const rest = (f: RecentFile, row: HTMLElement, delay: number) => {
    hide();
    if (!canPreview(f.name)) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const p = placeFor(row);
      const w = { file: f, left: p.left, top: p.top, host: p.host };
      wanted.current = w;
      fetchFor(w);
    }, delay);
  };

  let body;
  if (status === 'error') body = <p className="shelf-note">Recent files unavailable</p>;
  else if (status === 'ready' && items.length === 0) body = <p className="shelf-note">No recent files</p>;
  else if (status === 'loading') body = null;
  else {
    body = (
      <ul className="rf-rows" onScroll={hide}>
        {items.map((f) => {
          const { Icon, color } = fileLook(f.name);
          const tp = hover(`Open "${f.name}" in its default app`);
          return (
          <li key={f.id} className="rf-row" onPointerEnter={(e: PointerEvent<HTMLLIElement>) => rest(f, e.currentTarget, PREVIEW_DELAY_MS)} onPointerLeave={hide}>
            <button
              type="button"
              className="rf-open"
              onClick={() => act('wall2_recent_open', f.id, 'Opened')}
              onPointerDown={hide}
              {...tp}
              onFocus={(e: FocusEvent<HTMLButtonElement>) => {
                tp.onFocus?.(e);
                if (e.currentTarget.matches(':focus-visible')) rest(f, e.currentTarget.closest('.rf-row') as HTMLElement, 0);
              }}
              onBlur={() => {
                tp.onBlur?.();
                hide();
              }}
            >
              <span className="rf-icon" style={{ color }}>
                <Icon size={22} stroke={1.75} aria-hidden="true" />
              </span>
              <span className="rf-name">{f.name}</span>
              <span className="rf-when">{recentWhen(f.modified)}</span>
            </button>
            <button type="button" className="rf-folder" aria-label={`Show ${f.name} in File Explorer`} onClick={() => act('wall2_recent_folder', f.id, 'Shown in File Explorer')} {...tip('Show in File Explorer')}>
              <IconFolder size={20} stroke={1.8} aria-hidden="true" />
            </button>
          </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="shelf-card rf-card" aria-label="Recent files">
      <div className="k">
        Recent files{' '}
        <span className="shelf-sub" role="status">
          {brief ?? (status === 'ready' && items.length > 0 ? 'newest first' : 'last opened')}
        </span>
      </div>
      {body}
      {shown ? (shown.host ? createPortal(<Preview shown={shown} />, shown.host) : <Preview shown={shown} />) : null}
    </section>
  );
}

/** The preview card: the thumbnail fitted into a box, the file name and the time under it. It lets the pointer through. */
function Preview({ shown }: { shown: Shown }) {
  return (
    <div className="rf-preview" style={{ left: shown.left, top: shown.top }} aria-hidden="true">
      <img className="rf-preview-img" src={shown.url} alt="" />
      <b className="rf-preview-name">{shown.name}</b>
      <span className="rf-preview-when">{shown.when}</span>
    </div>
  );
}
