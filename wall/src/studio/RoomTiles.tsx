import { NameButton, TileSwitch } from './GroupTile';
import { awayWords, isFailedRead, tileState } from './homeModel';
import { canChange, useHome } from './homeStore';
import type { Group, HomeWord, Studio } from './home';

/** One room switch tile: the switch, and the name that opens the group's card. Its knob takes the home app's colour, else the default. */
export function RoomTile({ studio, g, canWrite }: { studio: Studio; g: Group; canWrite: boolean }) {
  const st = tileState(studio, g, canWrite);
  const on = g.on;
  const cls = `st-tg st-room${on ? ' on' : ''}${st.disabled ? ' dis' : ''}`;
  return (
    <div className={cls} data-group={g.id}>
      <TileSwitch label={g.label} on={on} dim={st.dim} disabled={st.disabled} knob={g.colour ?? undefined} tipText={st.tip} onClick={() => void useHome.getState().setGroup(g.id, !on)} />
      <NameButton id={g.id} label={g.label} />
    </div>
  );
}

/** A room tile while the home app is away: dashed and dim, no click, and the tip says why the read failed. */
export function AwayTile({ g, word }: { g: Group; word: HomeWord | null }) {
  return (
    <div className="st-tg st-room dis" data-group={g.id}>
      <TileSwitch label={g.label} on={g.on} dim disabled tipText={`${g.label}: ${awayWords(word).tip}`} />
      <NameButton id={g.id} label={g.label} />
    </div>
  );
}

/** The three room tiles, in the home app's order. While the home app is away they are dashed and dim. */
export function RoomTiles() {
  const studio = useHome((s) => s.studio);
  const readWord = useHome((s) => s.readWord);
  const readDone = useHome((s) => s.readDone);
  if (!studio) return null;
  const may = canChange({ studio, readWord, readDone });
  const away = isFailedRead(readWord);
  return (
    <>
      {studio.groups.map((g) =>
        away ? (
          <AwayTile key={g.id} g={g} word={readWord} />
        ) : (
          <RoomTile key={g.id} studio={studio} g={g} canWrite={may} />
        ),
      )}
    </>
  );
}
