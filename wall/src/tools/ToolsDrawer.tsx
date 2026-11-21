import { IconBulb, IconHeartbeat, IconPalette, IconRefresh, IconUserCircle, IconX, type Icon } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { invoke } from '../bridge/tauri';
import { formatBuild, type BuildInfo } from '../clock/format';
import { clockText } from '../meet/model';
import { hover } from './hover';
import { LOOKS } from '../unwind/watch/looks';
import { useWatchStore } from '../unwind/watch/store';
import { useSceneWeather } from '../weather/sceneSetting';
import { errorText, isAbsent } from '../work/deckModel';
import { joinKeys, reloadKeys, useKeysFeedStore, type Read } from '../work/keysFeed';
import type { KeysSummary } from '../work/keysModel';
import { Accounts, LightSyncBlock } from './accounts';
import { useLightSync } from './lightSync';
import { BriefKeyRow } from './BriefKeyRow';
import { DeskToken } from './DeskToken';
import { StagePopTools } from './StagePop';
import { KeyLights } from './KeyLights';
import { readText, readUnmountedSources, retrySource, SOURCE_NAMES, useSources, type SourceId, type SourceRow } from './sources';
import { useKeyLights } from '../studio/store';
import { anySignInWaiting, GROUP_KEY, useRailStatus, useToolsStore, type ToolsFocus } from './store';
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

function Sources({ rows }: { rows: SourceRow[] }) {
  // Hook-held sources whose screen is not open are read once when the drawer opens, so the list is honest at a glance.
  useEffect(() => readUnmountedSources(), []);
  const byId = new Map<SourceId, SourceRow>(rows.map((r) => [r.id, r]));
  return (
    <div className="tools-block">
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
      <div className="tools-hint">{perKind ? 'Each source has its own look on Watch. Pick one here to use it for everything.' : 'How video sits in the sky on Watch'}</div>
    </div>
  );
}

/** The switch for rain and wind from the forecast on the mountains and on Watt (on by default; kept across restarts). It sits in the Display group. */
function SceneWeather() {
  const on = useSceneWeather((s) => s.on);
  const setOn = useSceneWeather((s) => s.setOn);
  return (
    <div className="tools-weather">
      <div className="tools-head">
      <span className="tools-k sm" {...hover('Rain and wind from your forecast, on the mountains and on Watt. Off under reduced motion.')}>
        Weather in the scene
      </span>
      </div>
      <div className="tools-chips">
        <button type="button" className={on ? 'tools-chip on' : 'tools-chip'} aria-pressed={on} {...hover('Show rain and wind from the forecast on the mountains and on Watt')} onClick={() => setOn(true)}>
          On
        </button>
        <button type="button" className={!on ? 'tools-chip on' : 'tools-chip'} aria-pressed={!on} {...hover('Keep the scene and Watt as on a dry day')} onClick={() => setOn(false)}>
          Off
        </button>
      </div>
      <div className="tools-hint">Rain and wind from your forecast.</div>
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
  return <span className="tools-faint tools-build">{build ?? 'Build unknown'}</span>;
}

/** The groups' panels. Each stays mounted while the drawer is open (only the open one is shown), so every read, sign-in wait and rail line keeps running. */
interface PanelProps {
  ringed: (section: ToolsFocus) => boolean;
}

function AccountsPanel({ ringed }: PanelProps) {
  return (
    <div className={ringed('accounts') ? 'tools-block tools-ringed' : 'tools-block'} data-section="accounts">
      <Accounts />
      <BriefKeyRow />
    </div>
  );
}

function HealthPanel() {
  const rows = useSources();
  const keys = useKeysFeedStore((s) => s.read);
  const bad = rows.filter((r) => r.tone === 'warn' || r.tone === 'down').length + (keys.status === 'problem' ? 1 : 0);
  useRailStatus('health', bad === 0 ? 'All fresh' : `${bad} need a look`, bad === 0 ? 'ok' : 'warn');
  return (
    <>
      <Sources rows={rows} />
      <KeysFile />
    </>
  );
}

function LightsPanel({ ringed }: PanelProps) {
  const opened = useToolsStore((s) => s.opened);
  const ls = useLightSync(opened);
  const keyStatus = useKeyLights((s) => s.saved ?? s.status);
  const set = keyStatus === null || keyStatus === 'failed' ? 0 : Number(keyStatus.left) + Number(keyStatus.right);
  let line: { text: string; tone: 'ok' | 'warn' | 'none' };
  if (ls.pairing) line = { text: 'Hue pairing', tone: 'none' };
  else if (ls.failed || ls.status?.bridgeChanged) line = { text: ls.failed ? 'Could not check' : 'Bridge changed', tone: 'warn' };
  else if (ls.status?.paired) line = { text: 'Hue paired', tone: 'none' };
  else line = { text: set === 0 ? 'Nothing set up' : set === 1 ? '1 key light set' : '2 key lights set', tone: 'none' };
  useRailStatus('lights', line.text, line.tone);
  return (
    <>
      <KeyLights ringed={ringed('keylights')} />
      <LightSyncBlock ls={ls} />
      <DeskToken ringed={ringed('desktoken')} />
      <StagePopTools ringed={ringed('stagepop')} />
    </>
  );
}

function DisplayPanel() {
  const on = useSceneWeather((s) => s.on);
  useRailStatus('display', on ? 'Weather on' : 'Weather off', 'none');
  return (
    <>
      <SceneWeather />
      <VideoLook />
    </>
  );
}

/** One rail entry's group. Adding an option to the drawer is one new entry here (and its panel above). */
export interface ToolsGroup {
  id: Exclude<ToolsFocus, null | 'keylights' | 'desktoken' | 'stagepop'>;
  name: string;
  icon: Icon;
  tip: string;
  /** The ring targets inside the group: a link that names one opens the group. */
  sections: Exclude<ToolsFocus, null>[];
  Panel: ComponentType<PanelProps>;
}

export const GROUPS: readonly ToolsGroup[] = [
  { id: 'accounts', name: 'Accounts', icon: IconUserCircle, tip: 'Calendar, Spotify and YouTube sign-ins', sections: ['accounts'], Panel: AccountsPanel },
  { id: 'health', name: 'Health', icon: IconHeartbeat, tip: 'When each source was last read, and the keys file', sections: [], Panel: HealthPanel },
  { id: 'lights', name: 'Lights and home', icon: IconBulb, tip: 'Key lights, Light sync, the home app token and the stage pop-out', sections: ['keylights', 'desktoken', 'stagepop'], Panel: LightsPanel },
  { id: 'display', name: 'Display', icon: IconPalette, tip: 'Weather in the scene and the video look', sections: [], Panel: DisplayPanel },
];

/** The group a focus names: a group id, or a section inside a group. */
export function groupOf(focus: ToolsFocus): ToolsGroup['id'] | null {
  if (!focus) return null;
  return GROUPS.find((g) => g.id === focus || g.sections.includes(focus))?.id ?? null;
}

function rememberedGroup(): ToolsGroup['id'] | null {
  try {
    const v = localStorage.getItem(GROUP_KEY);
    return GROUPS.find((g) => g.id === v)?.id ?? null;
  } catch {
    return null;
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(GROUP_KEY, id);
  } catch {
    /* A blocked store only means the choice is not kept. */
  }
}

/** The section a link named stays ringed for 2 seconds; a group id rings nothing. */
function useRinging(focus: ToolsFocus, opened: number): ToolsFocus {
  const [on, setOn] = useState<ToolsFocus>(focus);
  useEffect(() => {
    setOn(focus);
    if (!focus) return;
    const id = setTimeout(() => setOn(null), RING_MS);
    return () => clearTimeout(id);
  }, [focus, opened]);
  return on;
}

function Drawer() {
  const close = useToolsStore((s) => s.close);
  const focus = useToolsStore((s) => s.focus);
  const opened = useToolsStore((s) => s.opened);
  const ref = useRef<HTMLElement>(null);
  const ringing = useRinging(focus, opened);
  const ringed = (section: ToolsFocus) => section !== null && ringing === section;
  const rail = useToolsStore((s) => s.rail);
  // A group whose panel has not reported in 15 s reads Could not check, never Checking for good.
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setStale(true), 15000);
    return () => clearTimeout(id);
  }, []);
  // A link opens the group it names; otherwise the group this viewer had open last.
  const [group, setGroup] = useState<ToolsGroup['id']>(() => groupOf(focus) ?? rememberedGroup() ?? GROUPS[0].id);
  useEffect(() => {
    const g = groupOf(focus);
    if (g) setGroup(g);
  }, [focus, opened]);
  useEffect(() => remember(group), [group]);
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = GROUPS[(i + step + GROUPS.length) % GROUPS.length];
    setGroup(next.id);
    tabs.current[next.id]?.focus();
  };
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startIdle = useMemo(() => {
    const start = (): void => {
      clearTimeout(idle.current);
      // A browser sign-in waiting holds the drawer open: the pointer is on the browser, not on the drawer.
      idle.current = setTimeout(() => (anySignInWaiting() ? start() : close()), AUTO_CLOSE_MS);
    };
    return start;
  }, [close]);

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
        <BuildStamp />
        <button type="button" className="tools-x" aria-label="Close Tools" onClick={close}>
          <IconX size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="tools-body">
        <div className="tools-rail" role="tablist" aria-label="Tools groups" aria-orientation="vertical">
          {GROUPS.map((g, i) => {
            const st = rail[g.id] ?? (stale ? { text: 'Could not check', tone: 'warn' as const } : { text: 'Checking', tone: 'none' as const });
            const Ico = g.icon;
            return (
              <button
                key={g.id}
                ref={(el) => {
                  tabs.current[g.id] = el;
                }}
                type="button"
                role="tab"
                id={`tools-tab-${g.id}`}
                aria-selected={group === g.id}
                aria-controls={`tools-panel-${g.id}`}
                tabIndex={group === g.id ? 0 : -1}
                className={group === g.id ? 'tools-tab on' : 'tools-tab'}
                data-group={g.id}
                {...hover(g.tip)}
                onClick={() => setGroup(g.id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                <Ico size={22} aria-hidden="true" />
                <span className="tools-tabtext">
                  <span className="tools-tabname">{g.name}</span>
                  <span className={st.tone === 'warn' ? 'tools-tabline bad' : 'tools-tabline'} data-rail-status={g.id}>
                    {st.text}
                  </span>
                </span>
                <i className={`tools-dot ${st.tone}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        {GROUPS.map((g) => (
          <div key={g.id} className="tools-panel" role="tabpanel" id={`tools-panel-${g.id}`} aria-labelledby={`tools-tab-${g.id}`} hidden={group !== g.id}>
            <div className="tools-k tools-ptitle">{g.name}</div>
            <g.Panel ringed={ringed} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** The Tools drawer, over the right third of any place. Mounted once; its contents exist only while it is open. */
export function ToolsDrawer() {
  const open = useToolsStore((s) => s.open);
  return open ? <Drawer /> : null;
}
