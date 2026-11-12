import type { KeyboardEvent } from 'react';
import {
  IconBriefcase,
  IconHeadphones,
  IconHome,
  IconMoon,
  IconBroadcast,
  IconTools,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { PLACES, usePlaceStore, type PlaceId } from '../state/places';

const PLACE_ICONS: Record<PlaceId, Icon> = {
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

export function Rail() {
  const active = usePlaceStore((s) => s.active);
  const setActive = usePlaceStore((s) => s.setActive);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const next = buttons[(index + step + buttons.length) % buttons.length];
    next.focus();
    next.click();
  };

  return (
    <nav className="rail" aria-label="Places" onKeyDown={onKeyDown}>
      {PLACES.map(({ id, label }) => {
        const Glyph = PLACE_ICONS[id];
        return (
          <button
            key={id}
            type="button"
            className="rb"
            aria-label={label}
            aria-current={active === id ? 'page' : undefined}
            onClick={() => setActive(id)}
          >
            <Glyph size={30} stroke={1.8} aria-hidden="true" />
            {label}
          </button>
        );
      })}
      <div className="rsep" role="separator" />
      <Disabled label="Meet" Glyph={IconUsers} />
      <Disabled label="On air" Glyph={IconBroadcast} />
      <div className="rail-spacer" />
      <Disabled label="Zen" Glyph={IconMoon} />
      <Disabled label="Tools" Glyph={IconTools} />
    </nav>
  );
}
