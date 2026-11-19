import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

/** One place of a library row: its id, its words and its Tabler icon. */
export interface Place<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
}

/**
 * The library row of a music card: the word "Library", then the places as underlined tabs with an icon each. Shared by the
 * Spotify card and (later) the YouTube Music card. A tab list: Left and Right move along it.
 */
export function LibraryRow<T extends string>({ label, places, value, onPick }: { label: string; places: readonly Place<T>[]; value: T; onPick: (id: T) => void }) {
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const to = buttons[(at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    to.focus();
    to.click();
  };
  return (
    <div className="mu-lib">
      <span className="mu-lib-word" aria-hidden="true">
        Library
      </span>
      <div className="mu-places" role="tablist" aria-label={label} onKeyDown={key}>
        {places.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={value === p.id} tabIndex={value === p.id ? 0 : -1} className={value === p.id ? 'on' : ''} onClick={() => onPick(p.id)}>
            {p.icon}
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
