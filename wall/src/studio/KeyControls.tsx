import { IconAlertTriangle, IconBrightnessUp, IconLink, IconLinkOff, IconRefresh, IconSettings, IconTemperature } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';
import { BRI_MAX, BRI_MIN, KELVIN_MAX, KELVIN_MIN, KELVIN_STEP, isLight, type Light, type Side } from './keyLights';
import { useToolsStore } from '../tools/store';
import { anyOn, downWord, kelvinColour, mismatched, savedDown, shown as shownLight, sideName, sideReading, singleLight, wordLine, working, withOn, type Snapshot } from './model';
import { Slider } from './Slider';
import { useKeyLights } from './store';

const pct = (v: number) => `${Math.round(v)}%`;
const kel = (v: number) => `${Math.round(v)} K`;

/** One brightness slider and one warmth slider, for one light or for both together. */
export function Pair({ targets, down, light, label }: { targets: Side[]; down: boolean; light: Light | null; label: string }) {
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
export function SideColumn({ snap, side }: { snap: Snapshot; side: Side }) {
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

/**
 * The key lights' controls: a header (with the switch in the sheet; the card's switch is on the tile), then the
 * linked pair, each light by itself, or the one light there is. The sheet and the card show the same thing.
 */
export function KeyPanel({ withSwitch }: { withSwitch: boolean }) {
  const status = useKeyLights((s) => s.status);
  const left = useKeyLights((s) => s.left);
  const right = useKeyLights((s) => s.right);
  const linked = useKeyLights((s) => s.linked);
  const snap: Snapshot = { status, left, right };
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
  return (
      <div className="st-d-keys" data-split={split ? '' : undefined}>
        <div className="st-k-hd">
          {withSwitch && (
            target ? (
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
          ))}
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
  );
}
