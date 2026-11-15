import { IconAlertTriangle, IconBrightnessUp, IconBulb, IconLink, IconLinkOff, IconRefresh, IconSettings, IconTemperature, IconX } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { overlayOwnsPointer } from '../ribbon/DrawerScrim';
import { tip } from '../ui/HoverTip';
import { BRI_MAX, BRI_MIN, KELVIN_MAX, KELVIN_MIN, KELVIN_STEP, isLight, type Light, type Side } from './keyLights';
import { useToolsStore } from '../tools/store';
import { anyOn, downWord, kelvinColour, mismatched, savedDown, shown as shownLight, sideName, sideReading, singleLight, wordLine, working, withOn, type Snapshot } from './model';
import { Slider } from './Slider';
import { useKeyLights } from './store';

/** The drawer closes by itself after this long with no pointer over it, as the Tools drawer does. */
export const DRAWER_IDLE_MS = 120_000;

const pct = (v: number) => `${Math.round(v)}%`;
const kel = (v: number) => `${Math.round(v)} K`;

/** One brightness slider and one warmth slider, for one light or for both together. */
function Pair({ targets, down, light, label }: { targets: Side[]; down: boolean; light: Light | null; label: string }) {
  const target = targets.length === 2 ? 'both' : targets[0];
  const live = useKeyLights.getState;
  const send = (patch: { brightness?: number; kelvin?: number }) => {
    const s = live();
    const ws = working(s).filter((w) => targets.includes(w.side));
    // Linked lights that report different values: the first move sets both lights to the shown values and the move.
    const shownNow = shownLight(s);
    const whole = targets.length === 2 && mismatched(s) && shownNow ? { brightness: shownNow.brightness, kelvin: shownNow.kelvin, ...patch } : patch;
    void s.set(target, withOn(whole, ws));
  };
  return (
    <>
      <Slider
        label={`${label} brightness`}
        icon={<IconBrightnessUp size={20} />}
        value={light?.brightness ?? BRI_MIN}
        min={BRI_MIN}
        max={BRI_MAX}
        step={1}
        format={pct}
        down={down}
        sides={targets}
        onInput={(v) => send({ brightness: v })}
        tipText={`Brightness of ${label.toLowerCase()}, ${BRI_MIN} to ${BRI_MAX} percent. Moving it turns an off light on. The number after you let go is what the light reports.`}
      />
      <Slider
        label={`${label} warmth`}
        icon={<IconTemperature size={20} />}
        value={light?.kelvin ?? 4400}
        min={KELVIN_MIN}
        max={KELVIN_MAX}
        step={KELVIN_STEP}
        format={kel}
        warm
        down={down}
        sides={targets}
        onInput={(v) => send({ kelvin: v })}
        tipText={`Warmth of ${label.toLowerCase()}: ${KELVIN_MIN} K is warm, ${KELVIN_MAX} K is cool. The number after you let go is what the light reports.`}
      />
      <div className="st-scale st-line">
        <span>{KELVIN_MIN} K warm</span>
        <span>{KELVIN_MAX} K cool</span>
      </div>
    </>
  );
}

/** One light's column in split mode: its name, a word and Try again when it does not answer, then its sliders. */
function SideColumn({ snap, side }: { snap: Snapshot; side: Side }) {
  const word = downWord(snap, side);
  const r = sideReading(snap, side);
  const light = isLight(r) ? r : null;
  return (
    <div className="st-side" data-side={side} data-down={word ? '' : undefined}>
      <div className="st-side-hd">
        <span className={`st-side-name${word && word !== 'not-set-up' ? ' amber' : ''}`}>
          {sideName(side)}
          {word === 'not-set-up' ? ': not set up' : word ? ': not answering' : ''}
        </span>
        {word === 'not-set-up' ? (
          <button type="button" className="st-lk" onClick={() => useToolsStore.getState().openDrawer('keylights')} {...tip("Opens Tools at Key lights, where each light's address is typed once")}>
            <IconSettings size={18} aria-hidden="true" />
            Open Tools
          </button>
        ) : (
          word && (
            <button type="button" className="st-lk" onClick={() => void useKeyLights.getState().refresh()} {...tip(`${wordLine(side, word)}. Reads it again now.`)}>
              <IconRefresh size={18} aria-hidden="true" />
              Try again
            </button>
          )
        )}
      </div>
      <Pair targets={[side]} down={word !== null || light === null} light={light} label={`${sideName(side)} key light`} />
    </div>
  );
}

/** Fine tune: the key lights' sliders, linked or one light at a time. Mounted by whoever opens it (On Air, the Work chip). */
export function StudioDrawer() {
  const status = useKeyLights((s) => s.status);
  const left = useKeyLights((s) => s.left);
  const right = useKeyLights((s) => s.right);
  const linked = useKeyLights((s) => s.linked);
  const note = useKeyLights((s) => s.note);
  const snap: Snapshot = { status, left, right };
  const ref = useRef<HTMLElement>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = () => useKeyLights.getState().setDrawer(false);

  // Focus goes into the drawer when it opens and back to the control that opened it when it closes.
  useEffect(() => {
    const node = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.querySelector<HTMLElement>('.st-x')?.focus();
    return () => {
      const now = document.activeElement;
      // Not taken from a control the pointer or a key has already moved focus to.
      if (opener?.isConnected && (!now || now === document.body || node?.contains(now))) opener.focus();
    };
  }, []);
  // Tab stays inside while it is open.
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? [])];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const now = document.activeElement;
    if (e.shiftKey && (now === first || !ref.current?.contains(now))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (now === last || !ref.current?.contains(now))) {
      e.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || overlayOwnsPointer()) return;
      e.preventDefault();
      close();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (overlayOwnsPointer() || !t || ref.current?.contains(t) || t.closest('[data-st-opener]') || t.closest('.hover-tip')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, []);
  const startIdle = () => {
    clearTimeout(idle.current);
    idle.current = setTimeout(close, DRAWER_IDLE_MS);
  };
  useEffect(() => {
    startIdle();
    return () => clearTimeout(idle.current);
  }, []);

  const w = working(snap);
  // A light with an address that does not answer splits the pair by itself, so its side can say so.
  // A side with no address is not that: it is a setup to do, and one light on its own has nothing to link.
  const forcedSplit = savedDown(snap).length > 0;
  const lone = singleLight(snap);
  const split = forcedSplit || (!linked && !lone);
  const on = anyOn(snap);
  const mismatch = !split && mismatched(snap);
  const first = shownLight(snap);
  const target = w.length === 2 ? 'both' : (w[0]?.side ?? null);

  const host = document.querySelector('.stage') ?? document.body;
  return createPortal(
    <section ref={ref} className="st-drawer" aria-label="Studio lights" onKeyDown={trap} onPointerEnter={() => clearTimeout(idle.current)} onPointerLeave={startIdle}>
      <div className="st-d-top">
        <IconBulb size={22} className="st-bulb" aria-hidden="true" />
        <span className="k st-title">Studio lights</span>
        <span className="st-office">Office only</span>
        <button type="button" className="st-x" aria-label="Close Studio lights" onClick={close}>
          <IconX size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="st-d-keys" data-split={split ? '' : undefined}>
        <div className="st-k-hd">
          {target ? (
            <button
              type="button"
              role="switch"
              aria-checked={on}
              className="st-swbtn"
              onClick={() => void useKeyLights.getState().set(target, { on: !on })}
              {...tip(on ? 'Turns the key lights off' : 'Turns the key lights on')}
            >
              <i className={`st-sw${on ? ' on' : ''}`} style={{ ['--c' as string]: kelvinColour(first?.kelvin ?? 4400) }} aria-hidden="true">
                <i />
              </i>
            </button>
          ) : (
            <i className="st-sw dis" aria-hidden="true">
              <i />
            </i>
          )}
          <span className="st-h">Key lights</span>
          <span className="st-spacer" />
          {lone ? null : (
          <button
            type="button"
            className={`st-lk${split ? '' : ' on'}`}
            aria-pressed={!split}
            disabled={forcedSplit}
            onClick={() => useKeyLights.getState().setLinked(!linked)}
            {...tip(
              forcedSplit
                ? 'Only one light answers, so each light shows by itself'
                : split
                  ? 'Click to move both lights together again'
                  : 'Both lights move together. Click to set the left and the right one by themselves.',
            )}
          >
            {split ? <IconLinkOff size={18} aria-hidden="true" /> : <IconLink size={18} aria-hidden="true" />}
            {split ? 'Split' : 'Linked'}
          </button>
          )}
        </div>
        {lone ? (
          <>
            <Pair targets={[w[0].side]} down={false} light={w[0].light} label={`${sideName(w[0].side)} key light`} />
            <div className="st-line st-hint st-lone">
              <span>
                The {w[0].side === 'left' ? 'right' : 'left'} key light is not set up.
              </span>
              <button type="button" className="st-lk" onClick={() => useToolsStore.getState().openDrawer('keylights')} {...tip("Opens Tools at Key lights, where each light's address is typed once")}>
                <IconSettings size={18} aria-hidden="true" />
                Open Tools
              </button>
            </div>
          </>
        ) : split ? (
          <div className="st-sides">
            <SideColumn snap={snap} side="left" />
            <SideColumn snap={snap} side="right" />
          </div>
        ) : (
          <>
            <Pair targets={['left', 'right']} down={first === null} light={first} label="Both key lights" />
            {mismatch ? (
              <div className="st-line st-mismatch" role="status" {...tip('The two lights report different values. The sliders show the left light. The first move sets both.')}>
                <IconAlertTriangle size={18} aria-hidden="true" />
                Not matched: the left light is shown. The first move sets both.
              </div>
            ) : (
              <div className="st-line st-hint">Left and right move together. Click Linked to set each one.</div>
            )}
          </>
        )}
      </div>
      {note && (
        <div className="st-line st-note amber" role="status">
          {note}
        </div>
      )}
      <div className="st-line st-quiet">Presets and room lights come with a later home app change.</div>
      <div className="st-d-foot st-line">
        <span>Range {KELVIN_MIN} K to {KELVIN_MAX} K, the maker&apos;s figure</span>
        <span>Esc or a click outside closes it</span>
      </div>
    </section>,
    host,
  );
}
