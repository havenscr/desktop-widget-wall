import { IconAdjustmentsHorizontal, IconAlertTriangle, IconBulb, IconRefresh, IconSettings } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { tip } from '../ui/HoverTip';
import { useToolsStore } from '../tools/store';
import { StudioDrawer } from './StudioDrawer';
import { ABSENT_LINE, CHANGED_TIP, DOWN_LINE, homeLine, NOT_SET_UP_LINE, presetChipLabel, PRIVATE_LINE, STALE_TIP, summaryParts } from './homeModel';
import { canChange, homeView, useHome } from './homeStore';
import { PAGE_PRESETS, PresetRow } from './PresetRow';
import { GroupCard } from './GroupCard';
import { NameButton, TileLevel, TileSwitch } from './GroupTile';
import { RoomTiles } from './RoomTiles';
import { StudioOffer } from './StudioOffer';
import { useHomePolling } from './useHomePolling';
import { anyOn, kelvinColour, keyLevel, noneTitle, savedDown, singleLight, summaryLine, viewOf, working, type Snapshot } from './model';
import { useKeyLights } from './store';
import { useKeyLightPolling } from './useKeyLightPolling';

/** The Key lights switch: on when either light is on; a click turns every answering light on or off. */
export function turnTargets(s: Snapshot): 'left' | 'right' | 'both' | null {
  const w = working(s);
  if (w.length === 2) return 'both';
  return w[0]?.side ?? null;
}

/**
 * Studio lights on On Air. With the home app's studio answer: a preset row, one summary line and a row of four
 * switches (Key lights from the seam, Panels, Behind monitor, Overhead from the home app). Without it: the key
 * lights' switch and Fine tune as before, and one quiet line for the home part.
 */
export function StudioBlock() {
  const left = useKeyLights((s) => s.left);
  const right = useKeyLights((s) => s.right);
  const status = useKeyLights((s) => s.status);
  const note = useKeyLights((s) => s.note);
  const drawer = useKeyLights((s) => s.drawer);
  const snap: Snapshot = { status, left, right };
  useKeyLightPolling();
  useHomePolling();
  const studio = useHome((h) => h.studio);
  const readWord = useHome((h) => h.readWord);
  const readDone = useHome((h) => h.readDone);
  const sticky = useHome((h) => h.sticky);
  const homeNote = useHome((h) => h.note);
  const offer = useHome((h) => h.offer);
  const hv = homeView({ studio, readWord, readDone });
  const may = canChange({ studio, readWord, readDone });
  const full = studio !== null && (hv === 'ready' || hv === 'down');

  const v = viewOf(snap);
  const keySum = summaryLine(snap);
  const sum = note ? { text: note, tone: 'amber' as const } : keySum;
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
      <div className="st-tg warn" data-group="keys" aria-disabled="true" {...tip('Neither key light answered the last read. Check that both are plugged in and on the same network, then Check again.')}>
        <IconAlertTriangle size={20} aria-hidden="true" />
        <NameButton id="keys" label={noneTitle(snap)} />
      </div>
    );
    action = (
      <button type="button" className="st-chip" onClick={checkAgain} {...tip('Reads both key lights again now')}>
        <IconRefresh size={20} aria-hidden="true" />
        Check again
      </button>
    );
  } else if (v === 'live' || v === 'one') {
    tile = (
      <div className={`st-tg${on ? ' on' : ''}${warnTile ? ' warn' : ''}`} data-group="keys">
        <NameButton id="keys" label="Key lights" />
        <TileSwitch
          label="Key lights"
          on={on}
          knob={knob}
          onClick={flip}
          tipText={
            v === 'one'
              ? `Turns the key light that answers ${on ? 'off' : 'on'}. The other one is ${warnTile ? 'not answering' : 'not set up'}.`
              : on
                ? 'Turns both key lights off. The sliders in Fine tune keep their values.'
                : 'Turns both key lights on, at the brightness and warmth they last had.'
          }
        />
        {on && <TileLevel level={keyLevel(snap)} colour={knob} />}
        {warnTile && <IconAlertTriangle size={20} aria-hidden="true" className="st-tg-warn" />}
      </div>
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
      <div className="st-tg dis" data-group="keys" aria-disabled="true" {...tip('The key lights need their addresses, typed once in Tools')}>
        <NameButton id="keys" label="Key lights" />
        <TileSwitch label="Key lights" on={false} plain />
      </div>
    );
    action = (
      <button type="button" className="st-chip" onClick={() => useToolsStore.getState().openDrawer('keylights')} {...tip('Opens Tools at Key lights, where each light\'s address is typed once')}>
        <IconSettings size={20} aria-hidden="true" />
        Open Tools
      </button>
    );
  } else {
    tile = (
      <div className="st-tg dis" data-group="keys" aria-disabled="true">
        <NameButton id="keys" label="Key lights" />
        <TileSwitch label="Key lights" on={false} plain />
      </div>
    );
    action = null;
  }

  const refreshHome = () => void useHome.getState().readStudio();

  // The summary slot, most urgent first: a failed key light write, a home note or kept line, the home app
  // away, a write the wall cannot make, a key light that needs a look, then what is on.
  const hl = homeLine({ studio, readWord, readDone, sticky, note: homeNote });
  let line: { lead?: string; text: string; tone: 'plain' | 'amber'; tip?: ReactNode; action: 'checkAgain' | 'tryAgain' | 'openTools' | null } | null = null;
  if (note) line = { text: note, tone: 'amber', action: null };
  else if (hl) line = { text: hl.text, tone: hl.tone, action: hl.action };
  else if (full && hv === 'down') line = { text: DOWN_LINE + '.', tone: 'amber', action: 'tryAgain', tip: 'The home app did not answer the last read. The switches show what it said before.' };
  else if (full && studio.writeBlock === 'not-set-up') line = { text: NOT_SET_UP_LINE, tone: 'plain', action: 'openTools' };
  else if (full && studio.writeBlock === 'needs-private-address') line = { text: PRIVATE_LINE, tone: 'plain', action: 'checkAgain' };
  else if (full && sum.tone === 'amber') line = { text: sum.text, tone: 'amber', action: null };

  if (!full) {
    // The home part is not there (not read yet, not offered, or never answered): the key lights as before.
    const absent = hv === 'absent';
    const checking = hv === 'checking';
    return (
      <div className="st-block" data-view={v} data-home={hv} aria-label="Studio lights">
        <Header />
        <div className="st-row">
          {tile}
          {action}
        </div>
        <div className={`st-line st-sum${sum.tone === 'amber' ? ' amber' : ''}`} role="status">
          {sum.text}
        </div>
        <div className="st-homeline">
          {hv === 'down' ? (
            <>
              <span className="st-line amber st-hl-t">{DOWN_LINE}.</span>
              <button type="button" className="st-chip" onClick={refreshHome} {...tip('Reads the home app again now')}>
                <IconRefresh size={20} aria-hidden="true" />
                Try again
              </button>
            </>
          ) : absent ? (
            <>
              <span className="st-line st-hl-t">{ABSENT_LINE}</span>
              <button type="button" className="st-chip" onClick={refreshHome} {...tip('Asks the home app again whether it offers presets and room lights')}>
                <IconRefresh size={20} aria-hidden="true" />
                Check again
              </button>
            </>
          ) : (
            checking && <span className="st-line st-hl-t">Asking the home app</span>
          )}
        </div>
        {drawer && <StudioDrawer />}
        <GroupCard />
      </div>
    );
  }

  // Full layout. Fine tune goes to the right end of the preset row (icon only when three presets show).
  // Icon only when three presets show, or when the chips' words are long enough to crowd the row (as "On air, changed" does).
  const pageChips = studio.presets.slice(0, PAGE_PRESETS);
  const threePresets = pageChips.length >= PAGE_PRESETS || pageChips.reduce((n, p) => n + presetChipLabel(p, studio.changed).length, 0) > 20;
  const trailing =
    v === 'live' || v === 'one' ? (
      <button
        type="button"
        className={`st-chip${threePresets ? ' st-icon' : ''}`}
        data-st-opener=""
        aria-expanded={drawer}
        aria-label="Fine tune"
        onClick={() => useKeyLights.getState().setDrawer(!drawer)}
        {...tip('Opens the sliders for brightness and warmth, the presets, panel looks and room lights')}
      >
        <IconAdjustmentsHorizontal size={20} aria-hidden="true" />
        {!threePresets && 'Fine tune'}
      </button>
    ) : v === 'none' ? (
      <button type="button" className={`st-chip${threePresets ? ' st-icon' : ''}`} aria-label="Check again" onClick={checkAgain} {...tip('Reads both key lights again now')}>
        <IconRefresh size={20} aria-hidden="true" />
        {!threePresets && 'Check again'}
      </button>
    ) : v === 'unset' ? (
      <button type="button" className="st-chip st-icon" aria-label="Open Tools" onClick={() => useToolsStore.getState().openDrawer('keylights')} {...tip("Opens Tools at Key lights, where each light's address is typed once")}>
        <IconSettings size={20} aria-hidden="true" />
      </button>
    ) : null;
  const summary = studio ? summaryParts(studio, keySum.tone === 'plain' && v !== 'unset' && v !== 'checking' ? keySum.text : '') : null;
  const changedTip = studio.changed ? CHANGED_TIP : null;
  return (
    <div className="st-block" data-view={v} data-home={hv} data-offer={offer ? offer.kind : undefined} aria-label="Studio lights">
      <Header />
      {offer && may ? (
        <StudioOffer />
      ) : (
        <>
          <PresetRow trailing={trailing} action={line?.action ?? null} />
          <div className={`st-line st-sum${line?.tone === 'amber' ? ' amber' : ''}`} role="status" {...(line?.tip ? tip(line.tip) : line ? tip(line.text) : tip(<>{changedTip ?? summary?.full}{studio.stale ? `. ${STALE_TIP}.` : ''}</>))}>
            {line ? (
              line.text
            ) : (
              <>
                <b className="st-lead">{summary?.lead}</b>
                {summary?.rest}
                {studio.stale && <span className="st-stale"> (not fresh)</span>}
              </>
            )}
          </div>
        </>
      )}
      <div className="st-switches">
        {tile}
        <RoomTiles />
      </div>
      {drawer && <StudioDrawer />}
      <GroupCard />
    </div>
  );
}

function Header() {
  return (
    <div className="st-hd">
      <IconBulb size={20} className="st-bulb" aria-hidden="true" />
      <span className="k st-title">Studio lights</span>
      <span className="st-office">Office only</span>
    </div>
  );
}
