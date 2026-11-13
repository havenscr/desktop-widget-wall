import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type WheelEvent } from 'react';
import { invoke } from '../bridge/tauri';
import { tip } from '../ui/HoverTip';
import { useVisible } from '../ui/useVisible';
import { errorText, isAbsent } from './deckModel';
import { KeyIcon } from './keyIcons';
import {
  acceptsFront,
  AUTO,
  effectiveMode,
  headingFor,
  readMode,
  saveMode,
  sendReason,
  shownSet,
  stepSet,
  type KeysSummary,
  type Mode,
  type SetInfo,
} from './keysModel';
import { useBrief } from './useBrief';

/** How often the row asks which app is in front. */
export const KEYS_POLL_MS = 2_000;
/** The wheel steps at most this often, so one turn of the wheel moves one set. */
export const WHEEL_GAP_MS = 250;
/** A row shows at most this many keys. */
const MAX_KEYS = 8;

type Read = { status: 'loading' } | { status: 'absent' } | { status: 'ready'; summary: KeysSummary } | { status: 'problem'; text: string };

function useKeysSummary(): { read: Read; refresh: () => void } {
  const visible = useVisible();
  const [read, setRead] = useState<Read>({ status: 'loading' });
  const refreshRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    const load = () =>
      invoke<KeysSummary>('wall2_keys_summary').then(
        (summary) => live && setRead({ status: 'ready', summary }),
        (e) => live && setRead(isAbsent(e) ? { status: 'absent' } : { status: 'problem', text: errorText(e) }),
      );
    refreshRef.current = () => void load();
    void load();
    const id = setInterval(load, KEYS_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [visible]);
  return { read, refresh: useCallback(() => refreshRef.current(), []) };
}

/** Columns for n keys: one row up to five, then two rows. */
export const columnsFor = (n: number): number => (n <= 5 ? Math.max(n, 1) : n === 6 ? 3 : 4);

/**
 * The key deck under the Big screen row. Auto (the default) shows the set for the app in
 * front, else the general set. The arrows or the wheel step to another set and turn Hold on:
 * the row then stays on that set until Auto is clicked. A key is only sent when the set's own
 * rule accepts the app in front; the Rust side checks that again and refuses with a fixed
 * word. The page sends a set id and a key index, never a chord.
 */
export function Keys() {
  const { read, refresh } = useKeysSummary();
  const [mode, setModeState] = useState<Mode>(readMode);
  const [brief, showBrief] = useBrief();
  const sending = useRef(false);
  const lastWheel = useRef(0);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    saveMode(m);
  }, []);

  // A held set that left keys.json goes back to Auto, here and in storage.
  useEffect(() => {
    if (read.status === 'ready' && mode.hold && effectiveMode(mode, read.summary.sets) === AUTO) setMode(AUTO);
  }, [read, mode, setMode]);

  if (read.status === 'loading' || read.status === 'absent') return null;
  if (read.status === 'problem') {
    return (
      <section className="keys deck-row" aria-label="Keys">
        <div className="row sb deck-hd">
          <span className="k">Keys</span>
        </div>
        <div className="s deck-quiet" {...tip(`${read.text}. Fix keys.json in the app's config folder; the wall never writes it.`)}>
          keys.json has a problem
        </div>
      </section>
    );
  }

  const { summary } = read;
  const m = effectiveMode(mode, summary.sets);
  const set = shownSet(summary, m);
  const hold = m.hold;

  const stepTo = (dir: 1 | -1) => {
    const next = stepSet(summary, set, dir);
    if (next) setMode({ hold: true, setId: next.id });
  };
  const onWheel = (e: WheelEvent) => {
    if (summary.sets.length < 2 || e.deltaY === 0) return;
    const now = Date.now();
    if (now - lastWheel.current < WHEEL_GAP_MS) return;
    lastWheel.current = now;
    stepTo(e.deltaY > 0 ? 1 : -1);
  };

  const send = async (s: SetInfo, index: number) => {
    if (sending.current) return;
    sending.current = true;
    try {
      await invoke('wall2_keys_send', { setId: s.id, index });
      showBrief(`${s.keys[index].label} sent${s.general ? '' : ` to ${s.name}`}`);
    } catch (e) {
      showBrief(sendReason(e, s, hold));
    } finally {
      sending.current = false;
      refresh();
    }
  };

  const controls = (
    <span className="deck-hd-r">
      {brief && (
        <span className="xs deck-brief" role="status">
          {brief}
        </span>
      )}
      {summary.sets.length > 1 && (
        <>
          <button type="button" className="deck-arrow" aria-label="Previous set" {...tip('Show the previous set of keys and hold it')} onClick={() => stepTo(-1)}>
            <IconChevronLeft size={20} stroke={2} aria-hidden="true" />
          </button>
          <button type="button" className="deck-arrow" aria-label="Next set" {...tip('Show the next set of keys and hold it')} onClick={() => stepTo(1)}>
            <IconChevronRight size={20} stroke={2} aria-hidden="true" />
          </button>
        </>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={!hold}
        className={`deck-auto${hold ? '' : ' on'}`}
        {...tip(hold ? 'Holding this set. Click to follow the app in front again.' : 'Following the app in front. Step to another set to hold it.')}
        onClick={() => hold && setMode(AUTO)}
      >
        <i aria-hidden="true" />
        Auto
      </button>
    </span>
  );

  // Nothing to show: no set of its own, no general set (or nothing in front yet).
  if (!set) {
    const idle = summary.front === 'idle';
    return (
      <section className="keys deck-row" aria-label="Keys" onWheel={onWheel}>
        <div className="row sb deck-hd">
          <span className="k">Keys</span>
          {controls}
        </div>
        <div
          className="s deck-quiet"
          {...tip(
            idle
              ? 'Click into a program and its keys show here. Sets come from keys.json.'
              : `Add a set for ${summary.exe ?? 'this app'} to keys.json (match it by its .exe file name), or a general set with "match": "*" for every app.`,
          )}
        >
          {idle ? 'Work in another app and its keys show here' : 'No keys for this app'}
        </div>
      </section>
    );
  }

  const keys = set.keys.slice(0, MAX_KEYS);
  const ok = acceptsFront(summary, set);
  return (
    <section className="keys deck-row" aria-label={headingFor(set)} onWheel={onWheel}>
      <div className="row sb deck-hd">
        <span className="k ellipsis">{headingFor(set)}</span>
        {controls}
      </div>
      <div className={`deck-tiles keys-tiles${keys.length > 5 ? ' two' : ''}`} style={{ gridTemplateColumns: `repeat(${columnsFor(keys.length)}, 1fr)` }}>
        {keys.map((k, i) => (
          <button
            key={`${set.id}-${i}`}
            type="button"
            className={`deck-tile key-tile${hold && !ok ? ' off' : ''}`}
            aria-label={k.label}
            {...tip(
              hold && !ok
                ? `${k.label}: the app in front is not ${set.name}, so this would send nothing`
                : set.general
                  ? `Send ${k.label} to the app in front`
                  : `Send ${k.label} to ${set.name}`,
            )}
            onClick={() => void send(set, i)}
          >
            <KeyIcon name={k.icon} />
            <span className="deck-lbl">{k.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
