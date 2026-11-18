import { IconArrowBackUp } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';
import { KeyTile, Trailing } from '../meet/MeetLights';
import { GroupCard } from '../studio/GroupCard';
import { NameButton, TileSwitch } from '../studio/GroupTile';
import { RoomTile } from '../studio/RoomTiles';
import { StudioDrawer } from '../studio/StudioDrawer';
import { PRIVATE_TIP } from '../studio/homeModel';
import { canChange, useHome } from '../studio/homeStore';
import { BACK_WORD, moodFailText, rowModel, type ChipModel, type RowModel } from '../studio/moodRow';
import type { Snapshot } from '../studio/model';
import { useKeyLights } from '../studio/store';
import { useHomePolling } from '../studio/useHomePolling';
import { useKeyLightPolling } from '../studio/useKeyLightPolling';
import { useMoodsPolling } from '../studio/useMoodsPolling';
import { BackTip, Chip } from '../studio/OfficeMoods';

/** The two mood buttons, in order: the name drawn and the office mood (by its name in the home app) it applies. */
export const HOME_MOODS: { key: string; label: string; match: RegExp }[] = [
  { key: 'gaming', label: 'Gaming', match: /gaming/i },
  { key: 'recording', label: 'Office Recording', match: /record/i },
];

/** At most this many panel looks sit on the page; the rest are in Fine tune. */
export const HOME_LOOKS = 3;

/** Why a part cannot be used now, in the words the rest of the wall uses; null when it can. */
function whyNot(): string | null {
  const s = useHome.getState();
  if (s.readWord !== null) return 'The home app is not answering';
  if (s.studio && s.studio.writeBlock === 'not-set-up') return "Add the home app's desk token in Tools to switch these from the wall";
  if (s.studio && s.studio.writeBlock === 'needs-private-address') return PRIVATE_TIP;
  return null;
}

/** Panels as a switch. Without the home app's studio answer it is the wall's dead switch (dashed, dim) with a plain tip. */
function PanelsTile() {
  const studio = useHome((s) => s.studio);
  const readWord = useHome((s) => s.readWord);
  const readDone = useHome((s) => s.readDone);
  const g = studio?.groups.find((x) => x.id === 'panels');
  if (studio && g && readWord === null) return <RoomTile studio={studio} g={g} canWrite={canChange({ studio, readWord, readDone })} />;
  return (
    <div className="st-tg st-room dis" data-group="panels" aria-disabled="true" {...tip(readWord !== null ? 'Panels: the home app is not answering' : 'Panels need the home app, which has not answered yet')}>
      <TileSwitch label="Panels" on={false} plain />
      <NameButton id="panels" label="Panels" />
    </div>
  );
}

/** The first three panel looks as chips (the rest are in Fine tune). Dashed while the home app cannot be changed from here. */
function Looks() {
  const studio = useHome((s) => s.studio);
  const readWord = useHome((s) => s.readWord);
  const readDone = useHome((s) => s.readDone);
  const applying = useHome((s) => s.applying);
  if (!studio) {
    return (
      <div className="hs-row" data-row="looks" role="group" aria-label="Panel looks">
        <span className="st-preset dis" aria-disabled="true" {...tip('Panel looks need the home app, which has not answered yet')}>
          <span>Panel looks</span>
        </span>
      </div>
    );
  }
  const looks = studio.looks.slice(0, HOME_LOOKS);
  if (looks.length === 0) return null;
  const may = canChange({ studio, readWord, readDone });
  return (
    <div className="hs-row" data-row="looks" role="group" aria-label="Panel looks">
      {looks.map((l) => (
        <button
          key={l.id}
          type="button"
          className={`st-preset${l.active ? ' on' : ''}${may ? '' : ' dis'}`}
          data-look={l.id}
          aria-pressed={l.active}
          aria-disabled={may ? undefined : true}
          aria-busy={applying === `look:${l.id}` || undefined}
          onClick={may && !l.active ? () => void useHome.getState().applyLook(l.id) : undefined}
          {...tip(may ? `${l.label}: the panels' look` : (whyNot() ?? 'The home app cannot be changed from here'))}
        >
          <span>{l.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A mood button the home app does not list, or cannot be reached for: the wall's dashed, dim chip with its reason. */
function DeadChip({ label, why }: { label: string; why: string }) {
  return (
    <button type="button" className="u-mood blocked" data-mood-dead={label} aria-disabled="true" {...tip(why)}>
      <span className="u-mood-name">{label}</span>
    </button>
  );
}

/** Gaming, Office Recording and As before: the Unwind Office moods row's chips (same look, states and tips), three in a row. */
function MoodButtons() {
  const moods = useHome((s) => s.moods);
  const moodsWord = useHome((s) => s.moodsWord);
  const applying = useHome((s) => s.applying);
  const moodFail = useHome((s) => s.moodFail);
  const sticky = useHome((s) => s.sticky);
  const row: RowModel | null = rowModel({ moods, moodsWord, applying, moodFail, sticky });
  const why = moodsWord !== null ? moodFailText(moodsWord) : 'Asking the home app';
  if (!row) {
    return (
      <div className="hs-row hs-moods" data-row="moods" role="group" aria-label="Office moods">
        {HOME_MOODS.map((d) => (
          <DeadChip key={d.key} label={d.label} why={why} />
        ))}
        <button type="button" className="u-mood u-mood-back dis blocked" data-mood="back" aria-disabled="true" {...tip(why)}>
          <IconArrowBackUp size={18} stroke={2} aria-hidden="true" />
          <span className="u-mood-name">{BACK_WORD}</span>
        </button>
      </div>
    );
  }
  const click = (c: ChipModel) => {
    if (row.blocked || row.waiting || c.id === null) return;
    void useHome.getState().applyMood(c.id);
  };
  const goBack = () => {
    if (row.blocked || row.waiting || !row.canBack) return;
    void useHome.getState().goBackFromMood();
  };
  return (
    <div className="hs-row hs-moods" data-row="moods" role="group" aria-label="Office moods">
      {HOME_MOODS.map((d) => {
        const c = row.chips.find((x) => x.id !== null && d.match.test(x.label));
        if (!c) return <DeadChip key={d.key} label={d.label} why={`The home app has no ${d.label} mood`} />;
        return <Chip key={d.key} chip={{ ...c, label: d.label }} row={row} cap={null} iconOnly={false} onClick={() => click(c)} />;
      })}
      <button
        type="button"
        className={`u-mood u-mood-back${row.canBack ? '' : ' dis'}${row.blocked ? ' blocked' : ''}`}
        data-mood="back"
        aria-disabled={row.canBack && !row.blocked ? undefined : 'true'}
        onClick={goBack}
        {...tip(() => <BackTip iconOnly={false} />)}
      >
        <IconArrowBackUp size={18} stroke={2} aria-hidden="true" />
        <span className="u-mood-name">{BACK_WORD}</span>
      </button>
    </div>
  );
}

/**
 * The studio lights under Now playing on the Home tab: a Key lights switch, a Panels switch and Fine tune on one row, the
 * first three panel looks, and three buttons (Gaming, Office Recording, As before). Same calls as On Air and Unwind;
 * a part the home app cannot serve yet shows the wall's dashed, dim state with the reason on hover.
 */
export function HomeStudio() {
  useKeyLightPolling();
  useHomePolling();
  useMoodsPolling();
  const drawer = useKeyLights((s) => s.drawer);
  const status = useKeyLights((s) => s.status);
  const left = useKeyLights((s) => s.left);
  const right = useKeyLights((s) => s.right);
  const snap: Snapshot = { status, left, right };
  return (
    <div className="hs-block" role="group" aria-label="Studio lights">
      <span className="k hs-title">Studio lights</span>
      <div className="hs-row st-switches" data-row="switches">
        <KeyTile snap={snap} />
        <PanelsTile />
        <span className="st-spacer" />
        <Trailing snap={snap} />
      </div>
      <Looks />
      <MoodButtons />
      {drawer && <StudioDrawer />}
      <GroupCard />
    </div>
  );
}
