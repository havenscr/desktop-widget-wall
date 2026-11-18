import { IconCheck, IconRefresh, IconSettings } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { tip } from '../ui/HoverTip';
import { useToolsStore } from '../tools/store';
import { activePreset, presetChipLabel, PRIVATE_TIP } from './homeModel';
import { canChange, useHome } from './homeStore';

/** At most this many preset chips sit on the page row (the sheet lists every one the home app offers). */
export const PAGE_PRESETS = 3;

/** Opens Tools at the new Home app section, ringed for 2 seconds as Key lights is. */
export const openHomeTools = () => useToolsStore.getState().openDrawer('desktoken');

/** The 40 px line of preset chips, As before (or the action that replaces it), and what the page puts at the right end. */
export function PresetRow({ trailing, action }: { trailing: ReactNode; action: 'checkAgain' | 'tryAgain' | 'openTools' | null }) {
  const studio = useHome((s) => s.studio);
  const readWord = useHome((s) => s.readWord);
  const readDone = useHome((s) => s.readDone);
  const applying = useHome((s) => s.applying);
  const may = canChange({ studio, readWord, readDone });
  if (!studio) return null;
  const presets = studio.presets.slice(0, PAGE_PRESETS);
  const refresh = () => void useHome.getState().readStudio();
  const blockedWhy = studio.writeBlock === 'not-set-up' ? "Add the home app's desk token in Tools to switch these from the wall" : studio.writeBlock === 'needs-private-address' ? PRIVATE_TIP : null;

  let normal: ReactNode;
  if (action === 'openTools') {
    normal = (
      <button type="button" className="st-chip" onClick={openHomeTools} {...tip('Opens Tools at Home app, where the desk token is typed once')}>
        <IconSettings size={20} aria-hidden="true" />
        Open Tools
      </button>
    );
  } else if (action === 'tryAgain' || action === 'checkAgain') {
    normal = (
      <button type="button" className="st-chip" onClick={refresh} {...tip(action === 'tryAgain' ? 'Reads the home app again now' : blockedWhy ?? 'Reads the home app again now')}>
        <IconRefresh size={20} aria-hidden="true" />
        {action === 'tryAgain' ? 'Try again' : 'Check again'}
      </button>
    );
  } else {
    const can = may && studio.canNormal;
    normal = (
      <button
        type="button"
        className={`st-preset st-normal${can ? '' : ' dis'}`}
        aria-disabled={can ? undefined : true}
        aria-busy={applying === 'normal' || undefined}
        onClick={can ? () => void useHome.getState().goNormal() : undefined}
        {...tip(!studio.canNormal ? 'Nothing to go back from' : !may ? blockedWhy ?? 'The home app is not answering' : studio.normalLine ?? 'Goes back to how the room was before')}
      >
        As before
      </button>
    );
  }

  return (
    <div className="st-presets" role="group" aria-label="Presets">
      {presets.map((p) => {
        const label = presetChipLabel(p, studio.changed);
        const dis = !may;
        return (
          <button
            key={p.id}
            type="button"
            className={`st-preset${p.active ? ' on' : ''}${dis ? ' dis' : ''}`}
            data-preset={p.id}
            aria-pressed={p.active}
            aria-disabled={dis ? true : undefined}
            aria-busy={applying === p.id || undefined}
            onClick={dis ? undefined : () => void useHome.getState().applyPreset(p.id)}
            {...tip(p.line ? `${p.label}: ${p.line}${p.active && studio.changed ? '. Something changed since it was set.' : ''}` : p.label)}
          >
            {p.active && (studio.changed ? <i className="st-dot" aria-hidden="true" /> : <IconCheck size={18} aria-hidden="true" />)}
            <span>{label}</span>
          </button>
        );
      })}
      {normal}
      <span className="st-spacer" />
      {trailing}
    </div>
  );
}

/** The active preset's name, for the chips. */
export function useActivePreset() {
  const studio = useHome((s) => s.studio);
  const readWord = useHome((s) => s.readWord);
  const readDone = useHome((s) => s.readDone);
  // Old data is never shown as live: a failed read means the chip says nothing about a preset.
  const usable = readDone && readWord === null && studio !== null;
  return usable ? { preset: activePreset(studio), changed: studio?.changed === true } : { preset: null, changed: false };
}
