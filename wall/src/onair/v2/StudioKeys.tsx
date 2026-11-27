import { IconAppWindow } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tip } from '../../ui/HoverTip';
import { keyboardOnMouseKey } from '../../work/keyPress';
import { resolveKey } from '../keyResolve';
import { useOnAirStore } from '../store';
import { statusStale } from '../ytlive';
import { useYtLive } from '../ytliveStore';
import { Head } from './Tiles';
import { agoText, needsConfirm, needsFind, NOTE_MS, refusalText, STUDIO_CONFIRM_MS, studioAnswerText, type DeviceState, type StudioKey } from './studioModel';
import { LABEL_MAX_PX, ADDON_ACTION, SLOT_INFO, fitLabel, loadSlots, measureLabel, saveSlots, slotLabel, toggleLabel, type ShownAction, type Slot } from './studioSlots';
import { ICON_WHEN_OFF, SLOT_ICON as ICON } from './studioIcons';
import { StudioPicker } from './StudioPicker';
import { useStudio } from './studioStore';
import { useDeckKeys } from './useDeckKeys';

/** Wall actions that are keys of the key library. */
const BRIEF_LONG_LIB = 'strip-dark-with-a-very-long-library-key-id-of-sixty-chars-x';
const LIB_ID: Partial<Record<ShownAction, string>> = { snip: 'snip', hide: 'strip-dark' };

/**
 * The studio keys box: eight equal keys in two rows of four. Each slot holds one action (StreamYard or
 * wall), chosen by right-click. Every key has one look; only the key sent last glows.
 */
export function StudioKeys({ now }: { now: number }) {
  // A library key's press settles here: it glows only when it went through.
  const pending = useRef<{ id: string; slot: number; gen: number } | null>(null);
  // Bumped for a slot whenever it is reassigned or relabelled, so a press still in flight cannot light it afterwards.
  const gens = useRef<number[]>([]);
  const genOf = (i: number) => gens.current[i] ?? 0;
  const [last, setLast] = useState<{ slot: number } | null>(null);
  // The scene on stage: the last scene key sent. It stays lit while later keys come and go as the last action.
  const [stage, setStage] = useState<{ slot: number } | null>(null);
  const done = useCallback((id: string, ok: boolean) => {
    const p = pending.current;
    if (!p || p.id !== id) return;
    pending.current = null;
    if (ok && p.gen === (gens.current[p.slot] ?? 0)) setLast({ slot: p.slot });
  }, []);
  const keys = useDeckKeys(done);
  const mark = useOnAirStore((s) => s.mark);
  const marking = useOnAirStore((s) => s.marking);
  const status = useStudio((s) => s.status);
  const sent = useStudio((s) => s.sent);
  const send = useStudio((s) => s.send);
  const studio = useStudio((s) => s.studio);
  const pick = useStudio((s) => s.pick);
  const yt = useYtLive((s) => s.status);
  const live = yt?.state === 'live' && !statusStale(yt, now);
  // The last mic and camera state the add-on reported; null until it has. An answer without a state leaves it as it was.
  const [devices, setDevices] = useState<{ mute: DeviceState | null; camera: DeviceState | null }>({ mute: null, camera: null });
  const [slots, setSlots] = useState<Slot[]>(loadSlots);
  const [picker, setPicker] = useState<number | null>(null);
  // The add-on's answer, shown on the key for a moment; `n` makes each answer a new element so its fade starts over.
  const [note, setNote] = useState<{ slot: number; text: string; ok: boolean; n: number } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const noteN = useRef(0);
  const [armed, setArmed] = useState<{ slot: number; action: ShownAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(noteTimer.current);
    },
    [],
  );
  // End show only runs while the show is live; the key is read at press time, not from a stale render.
  const liveNow = useRef(live);
  liveNow.current = live;
  const findNow = needsFind(status.state);

  /** A reassigned or relabelled slot starts clean: no pending confirm, no glow. */
  const change = (i: number, next: Slot) => {
    gens.current[i] = genOf(i) + 1;
    clearTimeout(timer.current);
    setArmed(null);
    setLast((l) => (l && l.slot === i ? null : l));
    setStage((g) => (g && g.slot === i ? null : g));
    setSlots((cur) => {
      const out = cur.map((s, j) => (j === i ? next : s));
      saveSlots(out);
      return out;
    });
  };

  /** Closes the picker and puts the focus back on the key it was opened from. */
  const closePicker = () => {
    const i = picker;
    setPicker(null);
    if (i !== null) requestAnimationFrame(() => tiles.current[i]?.focus());
  };

  const press = async (slot: number, action: ShownAction, detail: number, label: string) => {
    // A click that is part of a double click never counts, and neither does one while a send runs.
    if (detail > 1 || busy.current) return;
    // Development review only: any press answers with a library key id of 59 characters, for the never cut rule on the result line (`?brieflong=1`).
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('brieflong') === '1') {
      keys.showBrief(`No runnable library key "${BRIEF_LONG_LIB}"`);
      return;
    }
    const gen = genOf(slot);
    const addon = ADDON_ACTION[action];
    if (addon) {
      busy.current = true;
      try {
        // The full scene name from SLOT_INFO goes, never the label: the label is only a display name the user may
        // edit, while the full name is the scene's real name in StreamYard.
        const a = await studio(addon, addon === 'scene' ? SLOT_INFO[action].full : undefined);
        const t = studioAnswerText(a, addon);
        if (addon === 'mute' || addon === 'camera') {
          // A miss can still land late, so the state is unknown again. The older add-on answers "already" with no state: that means off.
          const next: DeviceState | null | undefined = !a.ok ? null : a.state === 'on' || a.state === 'off' ? a.state : a.reason === 'already' ? 'off' : undefined;
          if (next !== undefined) setDevices((d) => ({ ...d, [addon]: next }));
        }
        // A sent key names its scene or button; a miss gives the whole reason alone, so the line always fits.
        keys.showBrief(a.ok ? `${SLOT_INFO[action].full}: ${t.full}` : t.full);
        if (gen === genOf(slot)) {
          clearTimeout(noteTimer.current);
          noteN.current += 1;
          setNote({ slot, text: t.short, ok: a.ok, n: noteN.current });
          noteTimer.current = setTimeout(() => setNote(null), NOTE_MS);
          if (a.ok) {
            setLast({ slot });
            if (SLOT_INFO[action].scene) setStage({ slot });
          }
        }
      } finally {
        busy.current = false;
      }
      return;
    }
    if (action === 'mark') {
      const before = useOnAirStore.getState().marks;
      await mark(undefined);
      const st = useOnAirStore.getState();
      if (st.marksNote === null && st.marks !== before && gen === genOf(slot)) setLast({ slot });
      return;
    }
    const lib = LIB_ID[action];
    if (lib) {
      const k = keys.groups ? resolveKey(lib, keys.groups) : null;
      if (!k) {
        keys.showBrief(keys.groups ? `No runnable library key "${lib}"` : 'The key library is not ready');
        return;
      }
      if (keyboardOnMouseKey(k.action, detail)) return;
      pending.current = { id: `onair:${k.id}`, slot, gen };
      void keys.press(`onair:${k.id}`, detail, { command: 'wall2_keys_send_library', args: { id: k.id } }, label, k.action, k.where, false);
      return;
    }
    const key = action as StudioKey;
    if (action === 'end' && !liveNow.current) {
      keys.showBrief('End show works only while the show is live');
      return;
    }
    if (needsConfirm(key) && !(armed && armed.slot === slot && armed.action === action)) {
      setArmed({ slot, action });
      keys.showBrief(`${SLOT_INFO[action].full}? Click again`);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(null), STUDIO_CONFIRM_MS);
      return;
    }
    clearTimeout(timer.current);
    setArmed(null);
    busy.current = true;
    try {
      await send(key, needsConfirm(key));
      if (gen === genOf(slot)) setLast({ slot });
    } catch (e) {
      keys.showBrief(refusalText(e));
    } finally {
      busy.current = false;
    }
  };

  const tile = (slot: Slot, i: number) => {
    // While the show is live the Go live key is the End show key.
    const action: ShownAction = slot.a === 'golive' && live ? 'end' : slot.a;
    const dev = action === 'mute' || action === 'camera' ? devices[action] : null;
    const face = toggleLabel(action, dev);
    // A toggle key shows what pressing it does now, so its name follows the face.
    const info = face ? { ...SLOT_INFO[action], label: face, full: face } : SLOT_INFO[action];
    const I = (dev === 'off' && ICON_WHEN_OFF[action]) || ICON[action];
    const isArmed = armed !== null && armed.slot === i && armed.action === action;
    const full = isArmed ? 'Click again' : face ?? slotLabel({ a: action, l: slot.l });
    const shownNote = note !== null && note.slot === i ? note : null;
    const text = fitLabel(full, LABEL_MAX_PX, measureLabel);
    // The accessible name uses the whole label, never the fitted one, and always holds the words drawn on the key.
    const custom = !isArmed && !!SLOT_INFO[action].scene && !!slot.l;
    const base = custom ? `${full}, ${info.full}` : info.full;
    const name = isArmed ? `${info.full}? Click again` : base.includes(text) ? base : `${text}, ${base}`;
    let help: string;
    if (ADDON_ACTION[action]) help = `${info.full} in StreamYard, through the Stage Pop-out add-on. The add-on must be connected and the studio open in Firefox. Right-click to change the key.`;
    else if (needsConfirm(action as StudioKey)) help = `${info.full} in StreamYard. Click twice within 3 seconds. StreamYard is then sent the key twice. Right-click to change the key.`;
    else if (info.group === 'wall') help = `${info.full}. Right-click to change the key.`;
    else help = `Send the ${info.full} hotkey to the StreamYard window in use. Right-click to change the key.`;
    const lib = LIB_ID[action];
    const libAction = lib && keys.groups ? (resolveKey(lib, keys.groups)?.action ?? null) : null;
    const onKey = keys.onKeyDown(libAction);
    return (
      <button
        key={i}
        ref={(el) => {
          tiles.current[i] = el;
        }}
        type="button"
        className="deck-tile key-tile oa2-sk"
        data-armed={isArmed ? 'true' : undefined}
        data-last={last !== null && last.slot === i ? 'true' : undefined}
        data-stage={stage !== null && stage.slot === i ? 'true' : undefined}
        data-key={action}
        data-skind={info.kind}
        data-note={shownNote ? (shownNote.ok ? 'ok' : 'miss') : undefined}
        data-slot={i}
        aria-label={name}
        aria-busy={action === 'mark' ? marking : undefined}
        onKeyDown={(e) => {
          // The Context Menu key and Shift+F10 open the picker, as a right-click does.
          if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault();
            setPicker(i);
            return;
          }
          onKey(e);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setPicker(i);
        }}
        onClick={(e) => void press(i, action, e.detail, full)}
        {...tip(help)}
      >
        <I size={22} stroke={1.8} aria-hidden="true" />
        <span className="deck-lbl oa2-sklbl" key={shownNote ? 'n' + shownNote.n : 'l'}>
          {shownNote ? shownNote.text : text}
        </span>
      </button>
    );
  };

  const right = useMemo(() => (sent ? `Sent: ${SLOT_INFO[sent.key].full}, ${agoText(sent.at, now)}` : 'No key sent yet'), [sent, now]);
  const action = (
    <button type="button" className={findNow ? 'oa-btn cy oa2-hdbtn' : 'oa-btn oa2-hdbtn'} onClick={() => void pick()} {...tip('Then click the StreamYard browser window within 10 seconds. Use it when the wall chose the wrong window.')}>
      <IconAppWindow size={20} aria-hidden="true" />
      Find window
    </button>
  );

  return (
    <div className="oa2-b oa2-studiokeys" role="group" aria-label="Studio keys">
      <Head label="Studio keys" brief={keys.brief} right={right} action={action} />
      <div className="oa2-skgrid">{slots.map(tile)}</div>
      {picker !== null && (
        <StudioPicker
          slot={slots[picker]}
          index={picker}
          onChoose={(a) => {
            change(picker, { a });
            closePicker();
          }}
          onLabel={(l) => change(picker, { a: slots[picker].a, l: l.trim() || undefined })}
          onClose={closePicker}
        />
      )}
    </div>
  );
}
