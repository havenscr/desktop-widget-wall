import type { ReactNode } from 'react';
import { tip } from '../ui/HoverTip';
import { toggleCard, useCard, type CardId } from './cardStore';

/**
 * The name half of a switch tile: a button that opens that group's card. The switch half turns the group on or off
 * as before. Under the pointer the name is cyan and underlined; at rest nothing moves.
 */
export function NameButton({ id, label, warn = false }: { id: CardId; label: string; warn?: boolean }) {
  const open = useCard((s) => s.open === id);
  return (
    <button
      type="button"
      className={`st-name${open ? ' open' : ''}${warn ? ' warn' : ''}`}
      data-card-for={id}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(e) => toggleCard(id, e.detail === 0)}
      {...tip(`Opens the settings for ${label}`)}
    >
      {label}
    </button>
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
