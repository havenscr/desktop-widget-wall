import { useMemo } from 'react';
import { tip } from '../ui/HoverTip';
import { CHATTY_LEVELS, type Chatty } from './chatter';
import { COSMETICS, MOOD_WORD, UNLOCK_DAYS, todayLines, unlocked, type Cosmetic, type Mood, type PetData } from './pet';

/** Every item in the menu is at least this tall, design pixels (a mouse target, not a touch one). */
export const ITEM_H = 38;
/** The footer's segmented choices. */
export const SEG_H = 34;

const CHATTY_WORD: Readonly<Record<Chatty, string>> = { off: 'Off', sometimes: 'Some', chatty: 'Chatty' };
const CHATTY_HINT: Readonly<Record<Chatty, string>> = {
  off: 'No speech bubbles at all',
  sometimes: 'A short line at most every six minutes',
  chatty: 'A short line at most every three minutes',
};
const COSMETIC_WORD: Readonly<Record<Cosmetic, string>> = { none: 'None', bow: 'Bow', star: 'Star', cape: 'Cape' };

const ITEM_STYLE = { minHeight: ITEM_H } as const;
const SEG_STYLE = { minHeight: SEG_H } as const;

export type Trick = 'hop' | 'spin' | 'nap' | 'come';

/** What the menu needs to know about his tricks, and how it answers. */
export interface TrickPanel {
  /** Why tricks are off right now ("Not during a call or meeting", ...), or null. Refused quietly: the items stay, marked off, with this as their tooltip. */
  refused: string | null;
  napping: boolean;
  stay: boolean;
  /** A focus session is running or paused: "Read with me" waits. */
  focusBusy: boolean;
  focusMinutes: number;
  onTrick: (t: Trick) => void;
  onStay: (on: boolean) => void;
  onRead: () => void;
}

/** Pixel icons, 7 by 7, one colour (the text's). */
const ICONS = {
  hop: ['...x...', '..xxx..', '.x.x.x.', '...x...', '...x...', '.......', '.xxxxx.'],
  spin: ['..xxx..', '.x...x.', 'x.....x', 'x...xxx', 'x....x.', '.x.....', '..xxx..'],
  nap: ['xxxx...', '..x....', '.x.....', 'xxxx...', '....xxx', '.....x.', '....xxx'],
  come: ['...x...', '...xx..', 'xxxxxx.', '...xx..', '...x...', '.......', '.......'],
  stay: ['..xxx..', '.xxxxx.', '.xxxxx.', '..xxx..', '...x...', '...x...', '...x...'],
  read: ['.......', 'xxx.xxx', 'x.x.x.x', 'x.x.x.x', 'xxx.xxx', '...x...', '.......'],
} as const;
type IconName = keyof typeof ICONS;

export function MenuIcon({ name }: { name: IconName }) {
  const rects = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    ICONS[name].forEach((row, y) => [...row].forEach((c, x) => c === 'x' && out.push({ x, y })));
    return out;
  }, [name]);
  return (
    <svg className="wm-ico" viewBox="0 0 7 7" width={21} height={21} fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={1} height={1} />
      ))}
    </svg>
  );
}

/** Up, Down, Home and End move between the menu's items (roving focus, as a menu does). */
function onMenuKey(e: React.KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-item]')];
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const n = items.length;
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
  items[next].focus();
}

/**
 * Watt's menu, opened by a right-click on him: a speech bubble of his own above him, its tail
 * pointing at him. His name, mood and days together, a line about today, then three short groups
 * (Tricks: Hop, Spin, Nap; Where: Come here, Stay here; Together: Read with me) and a quiet footer
 * for how chatty he is and what he wears. Choosing something he does closes it, and he answers
 * after he has done it; the footer's choices keep it open. It closes on Escape, a click outside, a
 * right-click on him, a place change or when he goes away (`Watt.tsx`). Every item is 38 px tall;
 * explanations and refusals are the wall's own tooltip. `Watt.tsx` places it (`placeMenu`).
 */
export function WattMenu({
  tail,
  mood,
  pet,
  tricks,
  onBlur,
  onChatty,
  onCosmetic,
}: {
  tail: number;
  mood: Mood;
  pet: PetData;
  tricks: TrickPanel;
  onBlur: (e: React.FocusEvent<HTMLElement>) => void;
  onChatty: (c: Chatty) => void;
  onCosmetic: (c: Cosmetic) => void;
}) {
  const days = pet.days;
  const off = tricks.refused;
  // A refused item stays focusable and says why in its tooltip; a click on it does nothing.
  const offProps = (why: string | null, hint: string) => ({
    'aria-disabled': why !== null ? true : undefined,
    'aria-description': why ?? hint,
    style: ITEM_STYLE,
    ...tip(
      <>
        <span className="tip-t">{why ?? hint}</span>
      </>,
    ),
  });
  const run = (why: string | null, fn: () => void) => () => {
    if (why === null) fn();
  };
  // What he wears: those unlocked, and the next one still to come (off, with its wait).
  const wear = COSMETICS.filter((c) => unlocked(c, days));
  const next = COSMETICS.find((c) => !unlocked(c, days)) ?? null;
  const stayWhy = off !== null && !tricks.stay ? off : null;
  const comeWhy = off ?? (tricks.stay ? 'Switch Stay off first' : null);
  return (
    <div
      className="watt-menu"
      role="menu"
      aria-label="Watt"
      tabIndex={-1}
      style={{ ['--tail' as string]: `${tail}px` }}
      onBlur={onBlur}
      onKeyDown={onMenuKey}
    >
      <div className="wm-hd">
        <span className="wm-name">Watt</span>
        <span className={`wm-mood m-${mood}`}>{MOOD_WORD[mood]}</span>
        <span className="wm-days">{days <= 1 ? 'First day together' : `${days} days together`}</span>
      </div>
      <p className="wm-today">{todayLines(pet.today).join(' ')}</p>
      {off !== null ? <p className="wm-why">{off}.</p> : null}
      <div className="wm-gp" id="wm-tricks">
        Tricks
      </div>
      <div className="wm-row" role="group" aria-labelledby="wm-tricks">
        <button type="button" role="menuitem" data-item className="wm-it" {...offProps(off, 'He hops once')} onClick={run(off, () => tricks.onTrick('hop'))}>
          <MenuIcon name="hop" />
          Hop
        </button>
        <button type="button" role="menuitem" data-item className="wm-it" {...offProps(off, 'He turns once on the spot')} onClick={run(off, () => tricks.onTrick('spin'))}>
          <MenuIcon name="spin" />
          Spin
        </button>
        <button
          type="button"
          role="menuitem"
          data-item
          className={`wm-it${tricks.napping ? ' on' : ''}`}
          {...offProps(off, 'He lies down and sleeps for a minute, or until he is petted')}
          onClick={run(off, () => tricks.onTrick('nap'))}
        >
          <MenuIcon name="nap" />
          Nap
        </button>
      </div>
      <div className="wm-gp" id="wm-where">
        Where
      </div>
      <div className="wm-row" role="group" aria-labelledby="wm-where">
        <button type="button" role="menuitem" data-item className="wm-it" {...offProps(comeWhy, 'He trots back to the middle of this place')} onClick={run(comeWhy, () => tricks.onTrick('come'))}>
          <MenuIcon name="come" />
          Come here
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={tricks.stay}
          data-item
          className={`wm-it${tricks.stay ? ' on' : ''}`}
          {...offProps(stayWhy, tricks.stay ? 'He is staying put. Click to let him wander again.' : 'He sits where he is until you switch this off, change place or the day ends')}
          onClick={run(stayWhy, () => tricks.onStay(!tricks.stay))}
        >
          <MenuIcon name="stay" />
          {tricks.stay ? 'Staying' : 'Stay here'}
        </button>
      </div>
      <div className="wm-gp" id="wm-together">
        Together
      </div>
      <div className="wm-row" role="group" aria-labelledby="wm-together">
        <button
          type="button"
          role="menuitem"
          data-item
          className="wm-it"
          {...offProps(tricks.focusBusy ? 'A focus session is already running' : null, `Starts a ${tricks.focusMinutes} minute focus session. He reads along.`)}
          onClick={run(tricks.focusBusy ? '' : null, tricks.onRead)}
        >
          <MenuIcon name="read" />
          Read with me, {tricks.focusMinutes} min
        </button>
      </div>
      <div className="wm-ft">
        <span className="wm-fl" id="wm-talks">
          Talks
        </span>
        <span className="wm-seg" role="group" aria-labelledby="wm-talks">
          {CHATTY_LEVELS.map((c) => (
            <button key={c} type="button" role="menuitemradio" data-item aria-checked={pet.chatty === c} className="wm-sb" style={SEG_STYLE} aria-description={CHATTY_HINT[c]} {...tip(<span className="tip-t">{CHATTY_HINT[c]}</span>)} onClick={() => onChatty(c)}>
              {CHATTY_WORD[c]}
            </button>
          ))}
        </span>
      </div>
      <div className="wm-ft">
        <span className="wm-fl" id="wm-wears">
          Wears
        </span>
        <span className="wm-seg" role="group" aria-labelledby="wm-wears">
          {wear.map((c) => (
            <button key={c} type="button" role="menuitemradio" data-item aria-checked={pet.cosmetic === c} className="wm-sb" style={SEG_STYLE} onClick={() => onCosmetic(c)}>
              {COSMETIC_WORD[c]}
            </button>
          ))}
          {next ? (
            <button
              type="button"
              role="menuitemradio"
              data-item
              aria-checked={false}
              aria-disabled
              aria-description={`Unlocks after ${UNLOCK_DAYS[next]} days together`}
              style={SEG_STYLE}
              className="wm-sb wm-locked"
              {...tip(<span className="tip-t">Unlocks after {UNLOCK_DAYS[next]} days together</span>)}
            >
              {COSMETIC_WORD[next]} in {UNLOCK_DAYS[next] - days} day{UNLOCK_DAYS[next] - days === 1 ? '' : 's'}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
