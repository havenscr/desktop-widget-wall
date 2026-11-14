import { IconRefresh, IconX } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { formatBuild, type BuildInfo } from '../clock/format';
import { clockText } from '../meet/model';
import { hover } from './hover';
import { LOOKS } from '../unwind/watch/looks';
import { useWatchStore } from '../unwind/watch/store';
import { errorText, isAbsent } from '../work/deckModel';
import { joinKeys, reloadKeys, useKeysFeedStore, type Read } from '../work/keysFeed';
import type { KeysSummary } from '../work/keysModel';
import { Accounts } from './accounts';
import { readText, readUnmountedSources, retrySource, SOURCE_NAMES, useSources, type SourceId, type SourceRow } from './sources';
import { anySignInWaiting, useToolsStore } from './store';
import { overlayOwnsPointer } from '../ribbon/DrawerScrim';

/** The drawer closes by itself after this long with no pointer over it. */
export const AUTO_CLOSE_MS = 120_000;
/** How long the Accounts ring shows after the drawer opens from a link. */
export const RING_MS = 2_000;

function SourceLine({ row }: { row: SourceRow }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const live = useRef(true);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      live.current = false;
      clearTimeout(noteTimer.current);
    },
    [],
  );
  // The button stays busy until the read itself settles (or its ceiling), so a click can never start a second read.
  const retry = () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    void retrySource(row.id).then((r) => {
      if (!live.current) return;
      setBusy(false);
      if (r.note) {
        setNote(r.note);
        clearTimeout(noteTimer.current);
        noteTimer.current = setTimeout(() => live.current && setNote(null), 5000);
      }
    });
  };
  const quiet = row.tone === 'ok' && !note;
  return (
    <li className="tools-row tools-src" data-tone={row.tone} data-source={row.id} {...hover(note ?? row.reason)}>
      <i className={`tools-dot ${row.tone}`} aria-hidden="true" />
      <span className="tools-srcname">{row.name}</span>
      <span className={quiet ? 'tools-line' : 'tools-line bad'} data-kind={note ? 'note' : 'time'}>
        {note ?? readText(row.at)}
      </span>
      <button type="button" className="tools-btn" disabled={busy} aria-label={`Retry ${row.name}`} onClick={retry}>
        <IconRefresh size={16} aria-hidden="true" />
        Retry
      </button>
    </li>
  );
}

function Sources() {
  const rows = useSources();
  // Hook-held sources whose screen is not open are read once when the drawer opens, so the list is honest at a glance.
  useEffect(() => readUnmountedSources(), []);
  const byId = new Map<SourceId, SourceRow>(rows.map((r) => [r.id, r]));
  return (
    <div className="tools-col">
      <div className="tools-head">
        <span className="tools-k">Sources</span>
        <span className="tools-faint">last good read</span>
      </div>
      <ul className="tools-list" aria-label="Sources">
        {SOURCE_NAMES.map(({ id }) => {
          const row = byId.get(id);
          return row ? <SourceLine key={id} row={row} /> : null;
        })}
      </ul>
    </div>
  );
}

function VideoLook() {
  const looks = useWatchStore((s) => s.looks);
  const setLooks = useWatchStore((s) => s.setLooks);
  const perKind = looks.mode === 'kind';
  return (
    <div>
      <div className="tools-k sm">Video look</div>
      <div className="tools-chips">
        {LOOKS.map((l) => {
          const on = !perKind && looks.all === l.id;
          return (
            <button key={l.id} type="button" className={on ? 'tools-chip on' : 'tools-chip'} aria-pressed={on} {...hover(l.hint)} onClick={() => setLooks({ ...looks, mode: 'one', all: l.id })}>
              {l.name}
            </button>
          );
        })}
      </div>
      <div className="tools-hint">{perKind ? 'A look per kind is set on Watch. Pick one here to use it for everything.' : 'How video sits in the sky on Watch'}</div>
    </div>
  );
}

/** Keys the file holds: the sets it names (not the built-in ones) and its pinned keys. */
export function fileKeyCount(s: KeysSummary): number {
  return s.sets.filter((x) => !x.id.startsWith('lib-')).reduce((n, x) => n + x.keys.length, 0) + s.filePins.length;
}

/** The keys file's one line, and whether it is a problem. */
export function keysLine(read: Read, at: number | null, reading = false): { text: string; bad: boolean; full?: string } {
  if (reading || read.status === 'loading') return { text: 'Reading keys.json', bad: false };
  if (read.status === 'absent') return { text: 'Keys are not available in this build', bad: false };
  if (read.status === 'problem') return { text: `keys.json refused: ${read.text}`, bad: true, full: `keys.json was refused, so the defaults are in use.\n${read.text}` };
  if (read.summary.source === 'default') return { text: 'No keys.json. Defaults in use', bad: false };
  const n = fileKeyCount(read.summary);
  return { text: `keys.json, ${n} ${n === 1 ? 'key' : 'keys'}${at !== null ? `, read ${clockText(at)}` : ''}`, bad: false };
}

function KeysFile() {
  const read = useKeysFeedStore((s) => s.read);
  const [at, setAt] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // The shared read runs while the drawer is open, so the line is current.
  useEffect(() => joinKeys(), []);
  useEffect(() => {
    if (read.status === 'ready') setAt(Date.now());
    setReading(false);
  }, [read]);
  const line = keysLine(read, at, reading);
  // The note clears on the next success and on Reload; closing the drawer drops it with the section.
  const open = () => {
    invoke('wall2_open_keys_file').then(
      () => setNote(null),
      (e) => setNote(errorText(e) === 'not-configured' ? 'No config folder on this PC' : 'Could not open the file'),
    );
  };
  const reload = () => {
    setNote(null);
    setReading(true);
    reloadKeys();
  };
  const absent = read.status === 'absent' || isAbsent(read.status === 'problem' ? read.text : '');
  return (
    <div>
      <div className="tools-head">
        <span className="tools-k sm">Keys file</span>
        {!absent && (
          <span className="tools-pair">
            <button type="button" className="tools-btn" {...hover(read.status === 'ready' && read.summary.source === 'default' ? 'Opens the folder where keys.json goes' : 'Opens keys.json in your editor')} onClick={open}>
              Open
            </button>
            <button type="button" className="tools-btn" {...hover('Read keys.json again now')} onClick={reload}>
              Reload
            </button>
          </span>
        )}
      </div>
      <div className={line.bad ? 'tools-line bad one' : 'tools-line one'} {...(line.full ? hover(line.full) : {})}>
        {line.text}
      </div>
      {note && <div className="tools-note bad">{note}</div>}
    </div>
  );
}

function BuildStamp() {
  const [build, setBuild] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    invoke<BuildInfo>('wall2_build_info').then(
      (b) => live && setBuild(formatBuild(b)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="tools-foot">
      <span className="tools-faint">{build ?? 'Build unknown'}</span>
      <span className="tools-faint">Accounts and sources moved here from the screens</span>
    </div>
  );
}

function Drawer() {
  const close = useToolsStore((s) => s.close);
  const focus = useToolsStore((s) => s.focus);
  const opened = useToolsStore((s) => s.opened);
  const ref = useRef<HTMLElement>(null);
  const [ring, setRing] = useState(focus === 'accounts');
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startIdle = useMemo(() => {
    const start = (): void => {
      clearTimeout(idle.current);
      // A browser sign-in waiting holds the drawer open: the pointer is on the browser, not on the drawer.
      idle.current = setTimeout(() => (anySignInWaiting() ? start() : close()), AUTO_CLOSE_MS);
    };
    return start;
  }, [close]);

  // Ring the Accounts section for 2 seconds when opened from a link.
  useEffect(() => {
    if (focus !== 'accounts') {
      setRing(false);
      return;
    }
    setRing(true);
    const id = setTimeout(() => setRing(false), RING_MS);
    return () => clearTimeout(id);
  }, [focus, opened]);

  // Escape or a click outside closes it (the Tools button toggles itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || overlayOwnsPointer()) return;
      // Take the key: in fullscreen the same press must not also leave fullscreen.
      e.preventDefault();
      close();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (overlayOwnsPointer() || !t || ref.current?.contains(t) || t.closest('.rb[aria-label="Tools"]') || t.closest('.hover-tip')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [close]);

  // Closes by itself after 2 minutes with no pointer over it.
  useEffect(() => {
    startIdle();
    return () => clearTimeout(idle.current);
  }, [startIdle]);

  return (
    <section ref={ref} className="tools-drawer" aria-label="Tools" onPointerEnter={() => clearTimeout(idle.current)} onPointerLeave={startIdle}>
      <div className="tools-top">
        <span className="tools-k tx">Tools</span>
        <button type="button" className="tools-x" aria-label="Close Tools" onClick={close}>
          <IconX size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="tools-cols">
        <div className="tools-col left">
          <div className={ring ? 'tools-block ring' : 'tools-block'} data-section="accounts">
            <div className="tools-k sm">Accounts</div>
            <Accounts />
          </div>
          <VideoLook />
          <KeysFile />
        </div>
        <Sources />
      </div>
      <BuildStamp />
    </section>
  );
}

/** The Tools drawer, over the right third of any place. Mounted once; its contents exist only while it is open. */
export function ToolsDrawer() {
  const open = useToolsStore((s) => s.open);
  return open ? <Drawer /> : null;
}
