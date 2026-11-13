import type { KeyboardEvent } from 'react';
import {
  IconBriefcase,
  IconHeadphones,
  IconHome,
  IconMaximize,
  IconMinimize,
  IconMoon,
  IconBroadcast,
  IconTools,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { isTauri } from '../bridge/tauri';
import { toggleFullscreen, useFullscreen } from '../ui/fullscreen';
import { PLACES, usePlaceStore } from '../state/places';
import { alarmChipText, useOpenAlarms } from '../home/useSecurity';
import { tip } from '../ui/HoverTip';

const PLACE_ICONS: Record<'work' | 'home' | 'unwind', Icon> = {
  work: IconBriefcase,
  home: IconHome,
  unwind: IconHeadphones,
};

function Disabled({ label, Glyph }: { label: string; Glyph: Icon }) {
  return (
    <button type="button" className="rb" disabled aria-label={label}>
      <Glyph size={30} stroke={1.8} aria-hidden="true" />
      {label}
    </button>
  );
}

function FullscreenButton() {
  const full = useFullscreen();
  const label = full ? 'Exit fullscreen' : 'Enter fullscreen';
  const Glyph = full ? IconMinimize : IconMaximize;
  return (
    <button
      type="button"
      className="rb rb-fs"
      aria-label={label}
      onClick={() => {
        toggleFullscreen().catch((e) => console.warn('[Wall2] fullscreen change failed', e));
      }}
    >
      <Glyph size={30} stroke={1.8} aria-hidden="true" />
      {full ? 'Exit' : 'Full'}
    </button>
  );
}

export function Rail() {
  const active = usePlaceStore((s) => s.active);
  const setActive = usePlaceStore((s) => s.setActive);
  const alarms = useOpenAlarms();

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('button.rb:not(:disabled):not(.rb-fs)'),
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const next = buttons[(index + step + buttons.length) % buttons.length];
    next.focus();
    next.click();
  };

  return (
    <nav className="rail" aria-label="Places" onKeyDown={onKeyDown}>
      {PLACES.map(({ id, label }) => {
        const Glyph = PLACE_ICONS[id as keyof typeof PLACE_ICONS];
        // An open network alarm puts a small amber dot on Home's icon, on every place.
        const alarm = id === 'home' && alarms > 0;
        return (
          <button
            key={id}
            type="button"
            className="rb"
            aria-label={label}
            aria-description={alarm ? alarmChipText(alarms) : undefined}
            aria-current={active === id ? 'page' : undefined}
            onClick={() => setActive(id)}
            {...(alarm ? tip(`${alarmChipText(alarms)} open. Home lists them.`) : {})}
          >
            <span className="rb-ico">
              <Glyph size={30} stroke={1.8} aria-hidden="true" />
              {alarm && <i className="rb-alarm" aria-hidden="true" />}
            </span>
            {label}
          </button>
        );
      })}
      <div className="rsep" role="separator" />
      <button
        type="button"
        className="rb"
        aria-label="Meet"
        aria-current={active === 'meet' ? 'page' : undefined}
        onClick={() => setActive('meet')}
      >
        <IconUsers size={30} stroke={1.8} aria-hidden="true" />
        Meet
      </button>
      <Disabled label="On air" Glyph={IconBroadcast} />
      <div className="rail-spacer" />
      <button
        type="button"
        className="rb"
        aria-label="Zen"
        aria-current={active === 'zen' ? 'page' : undefined}
        onClick={() => setActive('zen')}
      >
        <IconMoon size={30} stroke={1.8} aria-hidden="true" />
        Zen
      </button>
      {isTauri() && <FullscreenButton />}
      <Disabled label="Tools" Glyph={IconTools} />
    </nav>
  );
}
