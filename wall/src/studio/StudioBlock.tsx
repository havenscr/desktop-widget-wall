import { IconAdjustmentsHorizontal, IconAlertTriangle, IconBulb, IconRefresh, IconSettings } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';
import { useToolsStore } from '../tools/store';
import { StudioDrawer } from './StudioDrawer';
import { anyOn, kelvinColour, noneTitle, savedDown, singleLight, summaryLine, viewOf, working, type Snapshot } from './model';
import { useKeyLights } from './store';
import { useKeyLightPolling } from './useKeyLightPolling';

/** The Key lights switch: on when either light is on; a click turns every answering light on or off. */
export function turnTargets(s: Snapshot): 'left' | 'right' | 'both' | null {
  const w = working(s);
  if (w.length === 2) return 'both';
  return w[0]?.side ?? null;
}

/** Studio lights on On Air: the key lights' switch, Fine tune, and one line of what is not built yet. */
export function StudioBlock() {
  const left = useKeyLights((s) => s.left);
  const right = useKeyLights((s) => s.right);
  const status = useKeyLights((s) => s.status);
  const note = useKeyLights((s) => s.note);
  const drawer = useKeyLights((s) => s.drawer);
  const snap: Snapshot = { status, left, right };
  useKeyLightPolling();

  const v = viewOf(snap);
  const sum = note ? { text: note, tone: 'amber' as const } : summaryLine(snap);
  const target = turnTargets(snap);
  const on = anyOn(snap);
  const knob = kelvinColour(working(snap)[0]?.light.kelvin ?? 4400);
  // A side with no address is a setup to do, not a fault: no warning on the tile.
  const warnTile = v === 'one' && savedDown(snap).length > 0;
  const checkAgain = () => void useKeyLights.getState().refresh();
  const flip = () => {
    if (target) void useKeyLights.getState().set(target, { on: !on });
  };

  let tile;
  let action;
  if (v === 'none') {
    tile = (
      <span className="st-tg warn" aria-disabled="true" {...tip('Neither key light answered the last read. Check that both are plugged in and on the same network, then Check again.')}>
        <IconAlertTriangle size={20} aria-hidden="true" />
        <span>{noneTitle(snap)}</span>
      </span>
    );
    action = (
      <button type="button" className="st-chip" onClick={checkAgain} {...tip('Reads both key lights again now')}>
        <IconRefresh size={20} aria-hidden="true" />
        Check again
      </button>
    );
  } else if (v === 'live' || v === 'one') {
    tile = (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`st-tg${on ? ' on' : ''}${warnTile ? ' warn' : ''}`}
        onClick={flip}
        {...tip(
          v === 'one'
            ? `Turns the key light that answers ${on ? 'off' : 'on'}. The other one is ${warnTile ? 'not answering' : 'not set up'}.`
            : on
              ? 'Turns both key lights off. The sliders in Fine tune keep their values.'
              : 'Turns both key lights on, at the brightness and warmth they last had.',
        )}
      >
        <i className={`st-sw${on ? ' on' : ''}`} style={{ ['--c' as string]: knob }} aria-hidden="true">
          <i />
        </i>
        <span>Key lights</span>
        {warnTile && <IconAlertTriangle size={20} aria-hidden="true" className="st-tg-warn" />}
      </button>
    );
    action = (
      <button
        type="button"
        className="st-chip"
        data-st-opener=""
        aria-expanded={drawer}
        onClick={() => useKeyLights.getState().setDrawer(!drawer)}
        {...tip('Opens the sliders for brightness and warmth, linked or one light at a time')}
      >
        <IconAdjustmentsHorizontal size={20} aria-hidden="true" />
        Fine tune
      </button>
    );
    if (singleLight(snap)) {
      action = (
        <>
          {action}
          <button type="button" className="st-chip" onClick={() => useToolsStore.getState().openDrawer('keylights')} {...tip("Opens Tools at Key lights, where each light's address is typed once")}>
            <IconSettings size={20} aria-hidden="true" />
            Open Tools
          </button>
        </>
      );
    }
  } else if (v === 'unset') {
    tile = (
      <span className="st-tg dis" aria-disabled="true" {...tip('The key lights need their addresses, typed once in Tools')}>
        <i className="st-sw dis" aria-hidden="true">
          <i />
        </i>
        <span>Key lights</span>
      </span>
    );
    action = (
      <button type="button" className="st-chip" onClick={() => useToolsStore.getState().openDrawer('keylights')} {...tip('Opens Tools at Key lights, where each light\'s address is typed once')}>
        <IconSettings size={20} aria-hidden="true" />
        Open Tools
      </button>
    );
  } else {
    tile = (
      <span className="st-tg dis" aria-disabled="true">
        <i className="st-sw dis" aria-hidden="true">
          <i />
        </i>
        <span>Key lights</span>
      </span>
    );
    action = null;
  }

  return (
    <div className="st-block" data-view={v} aria-label="Studio lights">
      <div className="st-hd">
        <IconBulb size={20} className="st-bulb" aria-hidden="true" />
        <span className="k st-title">Studio lights</span>
        <span className="st-office">Office only</span>
      </div>
      <div className="st-row">
        {tile}
        {action}
      </div>
      <div className={`st-line st-sum${sum.tone === 'amber' ? ' amber' : ''}`} role="status">
        {sum.text}
      </div>
      <div className="st-line st-quiet">Presets and room lights come with a later home app change.</div>
      {drawer && <StudioDrawer />}
    </div>
  );
}
