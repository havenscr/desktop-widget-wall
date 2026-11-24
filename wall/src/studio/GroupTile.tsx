import type { ReactNode } from 'react';
import { tip } from '../ui/HoverTip';
import { toggleCard, useCard, type CardId } from './cardStore';

/**
 * The name half of a switch tile: a button that opens that group's card. The switch half turns the group on or off
 * as before. A page with its own menu for the name (Home's Panels effects) passes `menu`. Under the pointer the name is cyan and underlined; at rest nothing moves.
 */
export function NameButton({ id, label, warn = false, menu }: { id: CardId; label: string; warn?: boolean; menu?: { open: boolean; toggle: () => void; tipText: string } }) {
  const cardOpen = useCard((s) => s.open === id);
  const open = menu ? menu.open : cardOpen;
  return (
    <button
      type="button"
      className={`st-name${open ? ' open' : ''}${warn ? ' warn' : ''}`}
      data-card-for={id}
      aria-haspopup={menu ? 'true' : 'dialog'}
      aria-expanded={open}
      onClick={menu ? menu.toggle : (e) => toggleCard(id, e.detail === 0)}
      {...tip(menu ? menu.tipText : `Opens the settings for ${label}`)}
    >
      {label}
    </button>
  );
}

/**
 * The level bar along a tile's foot: a faint track (always drawn, so an off tile keeps its line), and over it a fill to the light's level in its own colour.
 * With no level known only the track is drawn. Hidden from assistive tech; the switch and name say the rest.
 */
export function TileLevel({ level, colour, on = true }: { level: number | null; colour: string; on?: boolean }) {
  const pct = level === null || !Number.isFinite(level) ? null : Math.max(0, Math.min(100, level));
  return (
    <>
      <i className="st-track" aria-hidden="true" />
      {on && pct !== null && <i className="st-bar" aria-hidden="true" style={{ width: `calc((100% - 24px) * ${pct / 100})`, background: colour }} />}
    </>
  );
}

/** The switch half: a button when it can be switched, a dead switch (still drawn, still said) when it cannot. */
export function TileSwitch({ label, on, dim = false, disabled = false, plain = false, onClick, knob, tipText, children }: { label: string; on: boolean; dim?: boolean; disabled?: boolean; plain?: boolean; onClick?: () => void; knob?: string; tipText?: ReactNode; children?: ReactNode }) {
  const sw = (
    <i className={`st-sw${on ? ' on' : ''}${disabled && !on ? ' dis' : ''}`} style={knob ? { ['--c' as string]: knob } : undefined} aria-hidden="true">
      <i />
    </i>
  );
  const cls = `st-tg-sw${dim ? ' dim' : ''}`;
  if (plain) {
    // Not a switch at all (no key light to switch): the drawn switch only.
    return (
      <span className={cls} aria-hidden="true">
        {sw}
      </span>
    );
  }
  if (disabled) {
    return (
      <span className={cls} role="switch" aria-checked={on} aria-disabled="true" aria-label={label} {...(tipText ? tip(tipText) : {})}>
        {sw}
        {children}
      </span>
    );
  }
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={cls} onClick={onClick} {...(tipText ? tip(tipText) : {})}>
      {sw}
      {children}
    </button>
  );
}
