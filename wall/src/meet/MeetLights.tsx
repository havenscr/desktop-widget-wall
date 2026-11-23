import { IconAdjustmentsHorizontal, IconBulb, IconRefresh, IconSettings } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { tip } from '../ui/HoverTip';
import { useToolsStore } from '../tools/store';
import { GroupCard } from '../studio/GroupCard';
import { NameButton, TileSwitch } from '../studio/GroupTile';
import { PresetRow } from '../studio/PresetRow';
import { AwayTile, RoomTile } from '../studio/RoomTiles';
import { StudioDrawer } from '../studio/StudioDrawer';
import { canChange, useHome } from '../studio/homeStore';
import { moodFailText, rowModel, type RowModel } from '../studio/moodRow';
import { anyOn, kelvinColour, savedDown, viewOf, working, type Snapshot } from '../studio/model';
import { useKeyLights } from '../studio/store';
import { useHomePolling } from '../studio/useHomePolling';
import { useKeyLightPolling } from '../studio/useKeyLightPolling';
import { useMoodsPolling } from '../studio/useMoodsPolling';

/**
 * The words a failed or refused light write leaves: a key light note, the home app's note, then a mood that did not
 * take. Null when there is nothing to say. The hero shows it on its 16 px notice line under the section.
 */
export function useLightsNotice(): string | null {
  const keyNote = useKeyLights((s) => s.note);
  const homeNote = useHome((s) => s.note);
  const moodFail = useHome((s) => s.moodFail);
  return keyNote ?? homeNote ?? (moodFail ? moodFailText(moodFail.word) : null);
}

/** The office chip's words: the mood now on, else a plain name. */
export function officeChipLabel(row: RowModel | null): string {
  const lit = row?.chips.find((c) => c.lit && c.id !== null);
  return lit ? `Office: ${lit.label}` : 'Office lights';
}

function keyTarget(s: Snapshot): 'left' | 'right' | 'both' | null {
  const w = working(s);
  if (w.length === 2) return 'both';
  return w[0]?.side ?? null;
}

/** The office lights as one mood chip: it says the mood now on, and a click lists the home app's office moods. */
function OfficeChip() {
  const moods = useHome((s) => s.moods);
  const moodsWord = useHome((s) => s.moodsWord);
  const applying = useHome((s) => s.applying);
  const moodFail = useHome((s) => s.moodFail);
  const sticky = useHome((s) => s.sticky);
  const writes = useHome((s) => s.writes);
  const row = rowModel({ moods, moodsWord, applying, moodFail, sticky });
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  if (!row) return null;
  // Locked while this PC may not write, or while any home write runs or waits (a panel switch too).
  const locked = row.blocked || row.waiting || writes > 0;
  const pick = (id: string | null) => {
    if (locked) return;
    const st = useHome.getState();
    // The picker stays open: a failure shows on the chip and on the notice line, not by a silent close.
    void (id === null ? st.applyOff() : st.applyMood(id));
  };
  return (
    <div className="meet-office" ref={box}>
      <button type="button" className="st-chip" data-office-chip="" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} {...tip('The office lights. Click to pick an office mood.')}>
        <IconBulb size={20} aria-hidden="true" />
        {officeChipLabel(row)}
      </button>
      {open && (
        <div className="meet-office-list" role="group" aria-label="Office moods">
          {row.chips.map((c) => (
            <button
              key={c.id ?? 'office-off'}
              type="button"
              className={`st-preset${c.lit ? ' on' : ''}${locked ? ' dis' : ''}${c.failed ? ' failed' : ''}`}
              data-mood={c.id ?? 'off'}
              aria-pressed={c.lit}
              aria-disabled={locked ? true : undefined}
              onClick={() => pick(c.id)}
              {...tip(c.line ? `${c.label}: ${c.line}` : c.label)}
            >
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The key lights switch, as On Air draws it. Without a working light it is a dead switch with a plain tip. */
export function KeyTile({ snap }: { snap: Snapshot }) {
  const v = viewOf(snap);
  const on = anyOn(snap);
  const target = keyTarget(snap);
  const knob = kelvinColour(working(snap)[0]?.light.kelvin ?? 4400);
  const warn = v === 'one' && savedDown(snap).length > 0;
  if (v === 'live' || v === 'one') {
    return (
      <div className={`st-tg${on ? ' on' : ''}${warn ? ' warn' : ''}`} data-group="keys">
        <TileSwitch
          label="Key lights"
          on={on}
          knob={knob}
          onClick={() => target && void useKeyLights.getState().set(target, { on: !on })}
          tipText={on ? 'Turns the key lights off. The sliders in Fine tune keep their values.' : 'Turns the key lights on, at the brightness and warmth they last had.'}
        />
        <NameButton id="keys" label="Key lights" />
      </div>
    );
  }
  return (
    <div className="st-tg dis" data-group="keys" aria-disabled="true" {...tip(v === 'unset' ? 'The key lights need their addresses, typed once in Tools' : 'The key lights did not answer the last read')}>
      <TileSwitch label="Key lights" on={false} plain />
      <NameButton id="keys" label="Key lights" />
    </div>
  );
}

/** Fine tune at the right end of the moods row; when the key lights cannot be tuned, the action that fixes it. */
export function Trailing({ snap }: { snap: Snapshot }) {
  const drawer = useKeyLights((s) => s.drawer);
  const v = viewOf(snap);
  if (v === 'live' || v === 'one') {
    return (
      <button
        type="button"
        className="st-chip st-icon"
        data-st-opener=""
        aria-expanded={drawer}
        aria-label="Fine tune"
        onClick={() => useKeyLights.getState().setDrawer(!drawer)}
        {...tip('Opens the sliders for brightness and warmth, the presets, panel looks and room lights')}
      >
        <IconAdjustmentsHorizontal size={20} aria-hidden="true" />
      </button>
    );
  }
  if (v === 'unset') {
    return (
      <button type="button" className="st-chip st-icon" aria-label="Open Tools" onClick={() => useToolsStore.getState().openDrawer('keylights')} {...tip("Opens Tools at Key lights, where each light's address is typed once")}>
        <IconSettings size={20} aria-hidden="true" />
      </button>
    );
  }
  return (
    <button type="button" className="st-chip st-icon" aria-label="Check again" onClick={() => void useKeyLights.getState().refresh()} {...tip('Reads both key lights again now')}>
      <IconRefresh size={20} aria-hidden="true" />
    </button>
  );
}

/**
 * The studio lights a meeting needs, under the people: one row of moods (the presets the home app lists, at most
 * three), As before and Fine tune; one row with the Key lights switch, the Panels switch and the office
 * lights as a mood chip. Same calls as the On Air block; it replaces the old Lights key and chip.
 */
export function MeetLights() {
  useKeyLightPolling();
  useHomePolling();
  useMoodsPolling();
  const drawer = useKeyLights((s) => s.drawer);
  const status = useKeyLights((s) => s.status);
  const left = useKeyLights((s) => s.left);
  const right = useKeyLights((s) => s.right);
  const studio = useHome((s) => s.studio);
  const readWord = useHome((s) => s.readWord);
  const readDone = useHome((s) => s.readDone);
  const snap: Snapshot = { status, left, right };
  const may = canChange({ studio, readWord, readDone });
  const panels = studio?.groups.find((g) => g.id === 'panels');
  return (
    <div className="meet-lights" aria-label="Studio lights" role="group">
      <div className="meet-lights-row" data-row="moods">
        {studio ? (
          <PresetRow trailing={<Trailing snap={snap} />} action={null} />
        ) : (
          <div className="st-presets">
            <span className="st-spacer" />
            <Trailing snap={snap} />
          </div>
        )}
      </div>
      <div className="meet-lights-row st-switches" data-row="switches">
        <KeyTile snap={snap} />
        {studio && panels && (readWord !== null ? <AwayTile g={panels} word={readWord} /> : <RoomTile studio={studio} g={panels} canWrite={may} />)}
        <OfficeChip />
      </div>
      {drawer && <StudioDrawer />}
      <GroupCard />
    </div>
  );
}
