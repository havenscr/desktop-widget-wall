import { tip } from '../ui/HoverTip';
import { tileState } from './homeModel';
import { canChange, useHome } from './homeStore';
import type { Group, Studio } from './home';

/** One room switch tile: the switch, its name. Its knob takes the home app's colour, else the default. */
export function RoomTile({ studio, g, canWrite }: { studio: Studio; g: Group; canWrite: boolean }) {
  const st = tileState(studio, g, canWrite);
  const on = g.on;
  const cls = `st-tg st-room${on ? ' on' : ''}${st.disabled ? ' dis' : ''}${st.dim ? ' dim' : ''}`;
  const inner = (
    <>
      <i className={`st-sw${on ? ' on' : ''}${st.disabled && !on ? ' dis' : ''}`} style={g.colour ? { ['--c' as string]: g.colour } : undefined} aria-hidden="true">
        <i />
      </i>
      <span>{g.label}</span>
    </>
  );
  if (st.disabled) {
    return (
      <span className={cls} data-group={g.id} role="switch" aria-checked={on} aria-disabled="true" {...tip(st.tip)}>
        {inner}
      </span>
    );
  }
  return (
    <button type="button" role="switch" aria-checked={on} className={cls} data-group={g.id} onClick={() => void useHome.getState().setGroup(g.id, !on)} {...tip(st.tip)}>
      {inner}
    </button>
  );
}

/** The three room tiles, in the home app's order. While the home app is away they are dashed and dim. */
export function RoomTiles() {
  const studio = useHome((s) => s.studio);
  const readWord = useHome((s) => s.readWord);
  const readDone = useHome((s) => s.readDone);
  if (!studio) return null;
  const may = canChange({ studio, readWord, readDone });
  const away = readWord !== null;
  return (
    <>
      {studio.groups.map((g) =>
        away ? (
          <span key={g.id} className="st-tg st-room dis" data-group={g.id} role="switch" aria-checked={g.on} aria-disabled="true" {...tip(`${g.label}: the home app is not answering`)}>
            <i className="st-sw dis" aria-hidden="true">
              <i />
            </i>
            <span>{g.label}</span>
          </span>
        ) : (
          <RoomTile key={g.id} studio={studio} g={g} canWrite={may} />
        ),
      )}
    </>
  );
}
