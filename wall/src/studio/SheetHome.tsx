import { IconAlertTriangle, IconBrightnessUp, IconCheck, IconRefresh, IconSettings } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';
import { useToolsStore } from '../tools/store';
import { DOWN_LINE, NEEDS_ZONE, needsZone, NOT_SET_UP_LINE, presetChipLabel, PRIVATE_LINE, PRIVATE_TIP, tileState, ZONE_TIP } from './homeModel';
import { canChange, homeView, useHome } from './homeStore';
import type { Group, Studio } from './home';
import { EffectRow } from './EffectPick';
import { Slider } from './Slider';

/** The home part is shown (read, or read before and now away). */
export function useSheetHome(): { studio: Studio | null; may: boolean; view: ReturnType<typeof homeView>; away: boolean } {
  const studio = useHome((s) => s.studio);
  const readWord = useHome((s) => s.readWord);
  const readDone = useHome((s) => s.readDone);
  const view = homeView({ studio, readWord, readDone });
  const show = studio !== null && (view === 'ready' || view === 'down');
  return { studio: show ? studio : null, may: canChange({ studio, readWord, readDone }), view, away: readWord !== null };
}

/** Why the controls are disabled, in a sentence, or null when they are not. */
function whyOff(studio: Studio, away: boolean): { text: string; tip: string; action: 'tools' | 'again' | null } | null {
  if (away) return { text: `${DOWN_LINE}.`, tip: 'The home app did not answer the last read. Nothing here can be changed until it does.', action: 'again' };
  if (studio.writeBlock === 'not-set-up') return { text: NOT_SET_UP_LINE, tip: 'Opens Tools at Home app, where the desk token is typed once', action: 'tools' };
  if (studio.writeBlock === 'needs-private-address') return { text: PRIVATE_LINE, tip: PRIVATE_TIP, action: 'again' };
  return null;
}

/**
 * Why the sheet's controls are off, as one amber button in the sheet's header (the sheet has no spare line):
 * type the desk token in Tools, check the address again, or try the home app again. Its tip says it in full.
 */
export function SheetWhy({ studio, away }: { studio: Studio; away: boolean }) {
  const why = whyOff(studio, away);
  if (!why) return null;
  const label = why.action === 'tools' ? 'Desk token' : away ? 'Try again' : 'Check again';
  return (
    <button
      type="button"
      className="st-lk st-why"
      aria-label={`${why.text} ${label}`}
      onClick={() => (why.action === 'tools' ? useToolsStore.getState().openDrawer('desktoken') : void useHome.getState().readStudio())}
      {...tip(`${why.text} ${why.tip}`)}
    >
      {why.action === 'tools' ? <IconSettings size={18} aria-hidden="true" /> : <IconRefresh size={18} aria-hidden="true" />}
      {label}
    </button>
  );
}

/** The preset tiles at the top of the sheet: each preset's name and its line, then Back to normal. */
export function SheetPresets({ studio, may }: { studio: Studio; may: boolean }) {
  const applying = useHome((s) => s.applying);
  const dis = !may;
  return (
    <>
      <div className="st-d-presets" role="group" aria-label="Presets">
        {studio.presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`st-pt${p.active ? ' on' : ''}${dis ? ' dis' : ''}`}
            data-preset={p.id}
            aria-pressed={p.active}
            aria-disabled={dis ? true : undefined}
            aria-busy={applying === p.id || undefined}
            onClick={dis ? undefined : () => void useHome.getState().applyPreset(p.id)}
            {...tip(p.line ? `${p.label}: ${p.line}${p.active && studio.changed ? '. Something changed since it was set.' : ''}` : p.label)}
          >
            <span className="st-pt-n">
              {p.active && !studio.changed && <IconCheck size={18} aria-hidden="true" />}
              {p.active && studio.changed && <i className="st-dot" aria-hidden="true" />}
              {presetChipLabel(p, studio.changed)}
            </span>
            <span className="st-pt-l">{p.line ?? ''}</span>
          </button>
        ))}
        <button
          type="button"
          className={`st-pt st-pt-normal${dis || !studio.canNormal ? ' dis' : ''}`}
          aria-disabled={dis || !studio.canNormal ? true : undefined}
          aria-busy={applying === 'normal' || undefined}
          onClick={dis || !studio.canNormal ? undefined : () => void useHome.getState().goNormal()}
          {...tip(!studio.canNormal ? 'Nothing to go back from' : (studio.normalLine ?? 'Goes back to how the room was before'))}
        >
          <span className="st-pt-n">Back to normal</span>
          <span className="st-pt-l">{studio.canNormal ? (studio.normalLine ?? '') : 'Nothing to go back from'}</span>
        </button>
      </div>
    </>
  );
}

/** A room slider sends at most one write this often while it is dragged, and the exact value on release. */
export const ROOM_WRITE_MS = 250;

/** One room group's brightness slider (Panels stops at 1 percent: the home app takes nothing lower). Used by the sheet and the card. */
export function RoomSliderRow({ g, studio, may }: { g: Group; studio: Studio; may: boolean }) {
  const writes = useHome((s) => s.writes);
  const floor = g.floor ?? 0;
  const st = tileState(studio, g, may);
  const level = g.level ?? 0;
  // Moving the slider turns an off group on, at that level (as the key lights do), unless that would be refused.
  const send = (v: number) => void useHome.getState().setGroup(g.id, true, v);
  // A group that does not answer is dimmed like one without a desk token: nothing to drag.
  const down = !may || needsZone(g) || !g.reachable;
  return (
    <Slider
      label={`${g.label} brightness`}
      icon={<IconBrightnessUp size={20} />}
      value={g.on ? level : floor}
      min={g.id === 'panels' ? 1 : 0}
      max={100}
      floor={floor > 0 ? floor : undefined}
      step={1}
      format={(v) => (g.on ? `${Math.round(v)}%` : 'Off')}
      down={down}
      busyCount={writes}
      throttleMs={ROOM_WRITE_MS}
      onInput={send}
      tipText={`${g.label}: brightness from ${floor} to 100 percent${floor > 0 ? `. The ${floor} percent floor keeps the room comfortable on camera` : ''}. Moving it turns the lights on. ${st.tip}`}
    />
  );
}

/** The full words for a room's tip: the home app's own state words and the floor. */
function stateWords(g: Group): string {
  if (needsZone(g)) return g.setTo ?? 'Needs a Hue zone';
  const base = g.setTo ?? (g.on ? 'On' : 'Off');
  return g.floor ? `${base}. Floor ${g.floor}%` : base;
}

/**
 * The short form on the room's name line (the level already shows at the slider's right): the floor, or
 * the home app's words without their number. The full sentence is the hover tip.
 */
export function shortWords(g: Group): string {
  if (needsZone(g)) return g.setTo ?? 'Needs a Hue zone';
  if (g.floor) return `Floor ${g.floor}%`;
  const bare = (g.setTo ?? '').replace(/\s*\d+%/g, '').trim();
  return bare || (g.on ? 'On' : 'Off');
}

/** One room light group: its switch and name, the home app's words, and a slider with the floor marked. */
function RoomRow({ g, studio, may }: { g: Group; studio: Studio; may: boolean }) {
  const st = tileState(studio, g, may);
  return (
    <div className={`st-rm${st.disabled ? ' off' : ''}`} data-group={g.id}>
      <div className="st-rm-hd">
        <button
          type="button"
          role="switch"
          aria-checked={g.on}
          aria-disabled={st.disabled ? true : undefined}
          className="st-swbtn"
          onClick={st.disabled ? undefined : () => void useHome.getState().setGroup(g.id, !g.on)}
          {...tip(st.tip)}
        >
          <i className={`st-sw${g.on ? ' on' : ''}${st.disabled && !g.on ? ' dis' : ''}`} style={g.colour ? { ['--c' as string]: g.colour } : undefined} aria-hidden="true">
            <i />
          </i>
        </button>
        <span className="st-h st-rm-n">{g.label}</span>
        {!g.reachable && <IconAlertTriangle size={18} aria-hidden="true" className="st-tg-warn" />}
        {!needsZone(g) && (
          <span className="st-line st-rm-r" {...tip(stateWords(g))}>
            {shortWords(g)}
          </span>
        )}
      </div>
      {needsZone(g) && <ZoneLine g={g} />}
      {!needsZone(g) && g.canDim && <RoomSliderRow g={g} studio={studio} may={may} />}
    </div>
  );
}

/** The full words a group that needs a Hue zone shows, on a line of its own so they are never cut. */
function ZoneLine({ g }: { g: Group }) {
  return (
    <div className="st-line st-zone amber" {...tip(ZONE_TIP)}>
      {g.setTo ?? NEEDS_ZONE}
    </div>
  );
}

/** The rooms column: Panels with its brightness and its effect, then Behind monitor and Overhead. */
export function SheetRooms({ studio, may }: { studio: Studio; may: boolean }) {
  const panels = studio.groups.find((g) => g.id === 'panels');
  const rooms = studio.groups.filter((g) => g.id !== 'panels');
  const pst = panels ? tileState(studio, panels, may) : null;
  return (
    <div className="st-d-rooms" aria-label="Room lights">
      {panels && pst && (
        <div className={`st-rm st-rm-panels${pst.disabled ? ' off' : ''}`} data-group="panels">
          <div className="st-rm-hd">
            <button
              type="button"
              role="switch"
              aria-checked={panels.on}
              aria-disabled={pst.disabled ? true : undefined}
              className="st-swbtn"
              onClick={pst.disabled ? undefined : () => void useHome.getState().setGroup('panels', !panels.on)}
              {...tip(pst.tip)}
            >
              <i className={`st-sw${panels.on ? ' on' : ''}${pst.disabled && !panels.on ? ' dis' : ''}`} style={panels.colour ? { ['--c' as string]: panels.colour } : undefined} aria-hidden="true">
                <i />
              </i>
            </button>
            <span className="st-h st-rm-n">{panels.label}</span>
          </div>
          {needsZone(panels) && <ZoneLine g={panels} />}
          {!needsZone(panels) && panels.canDim && <RoomSliderRow g={panels} studio={studio} may={may} />}
          {!needsZone(panels) && <EffectRow studio={studio} panels={panels} may={may} where="below" />}
        </div>
      )}
      {rooms.map((g) => (
        <RoomRow key={g.id} g={g} studio={studio} may={may} />
      ))}
    </div>
  );
}
