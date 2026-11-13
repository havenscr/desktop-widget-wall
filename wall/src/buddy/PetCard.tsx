import { CHATTY_LEVELS, type Chatty } from './chatter';
import { COSMETICS, MOOD_WORD, UNLOCK_DAYS, todayLines, unlocked, type Cosmetic, type Mood, type PetData } from './pet';

const CHATTY_WORD: Readonly<Record<Chatty, string>> = { off: 'Off', sometimes: 'Sometimes', chatty: 'Chatty' };
const CHATTY_HINT: Readonly<Record<Chatty, string>> = {
  off: 'No speech bubbles at all',
  sometimes: 'A short line at most every six minutes',
  chatty: 'A short line at most every three minutes',
};
const COSMETIC_WORD: Readonly<Record<Cosmetic, string>> = { none: 'None', bow: 'Bow', star: 'Star', cape: 'Cape' };

/** Every button in the card is at least this tall, design pixels (a mouse target, not a touch one). */
export const BUTTON_H = 32;
const BTN = { minHeight: BUTTON_H } as const;

export type Trick = 'hop' | 'spin' | 'nap' | 'come';

/** What the card's trick row needs to know, and how it answers. */
export interface TrickPanel {
  /** Why tricks are off right now ("In a call", ...), or null. They are refused quietly: disabled, with this as the tooltip. */
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

/**
 * Watt's card, opened by a right-click on him: his name and mood, two honest lines about today, the
 * days together, how chatty he is, the cosmetics he has unlocked, his tricks and a way to read with
 * him. A strip placed by `placeCard` (beside him in the band over the horizon, or under Unwind's
 * transport row); it stays open until Escape, a click outside it, a right-click on him, a place
 * change or he goes away. Every button is 32 px tall and has a tooltip.
 */
export function PetCard({
  left,
  top,
  mood,
  pet,
  tricks,
  onBlur,
  onChatty,
  onCosmetic,
}: {
  left: number;
  top: number;
  mood: Mood;
  pet: PetData;
  tricks: TrickPanel;
  onBlur: (e: React.FocusEvent<HTMLElement>) => void;
  onChatty: (c: Chatty) => void;
  onCosmetic: (c: Cosmetic) => void;
}) {
  const days = pet.days;
  const off = tricks.refused;
  const why = (what: string) => off ?? what;
  return (
    <div className="watt-card" role="dialog" aria-label="Watt" tabIndex={-1} style={{ left, top }} onBlur={onBlur}>
      <div className="wc-head">
        <div className="wc-title">
          <span className="wc-name">Watt</span>
          <span className={`wc-mood m-${mood}`}>{MOOD_WORD[mood]}</span>
        </div>
        <ul className="wc-today">
          {todayLines(pet.today).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <span className="wc-days">{days === 1 ? 'First day together' : `${days} days together`}</span>
      </div>
      <div className="wc-rows">
        <div className="wc-line">
          <div className="wc-row" role="radiogroup" aria-label="How chatty">
            <span className="wc-label">Chatty</span>
            {CHATTY_LEVELS.map((c) => (
              <button
                style={BTN}
                key={c}
                type="button"
                role="radio"
                aria-checked={pet.chatty === c}
                className={pet.chatty === c ? 'on' : ''}
                title={CHATTY_HINT[c]}
                onClick={() => onChatty(c)}
              >
                {CHATTY_WORD[c]}
              </button>
            ))}
          </div>
          <div className="wc-row" role="radiogroup" aria-label="What he wears">
            <span className="wc-label">Wear</span>
            {COSMETICS.map((c) => {
              const open = unlocked(c, days);
              const left = UNLOCK_DAYS[c] - days;
              return (
                <button
                style={BTN}
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={pet.cosmetic === c}
                  className={pet.cosmetic === c ? 'on' : ''}
                  disabled={!open}
                  title={open ? COSMETIC_WORD[c] : `Unlocks in ${left} day${left === 1 ? '' : 's'}`}
                  onClick={() => onCosmetic(c)}
                >
                  {COSMETIC_WORD[c]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="wc-line">
          <div className="wc-row" role="group" aria-label="Tricks">
            <span className="wc-label">Tricks</span>
            <button style={BTN} type="button" disabled={off !== null} title={why('Watt hops once')} onClick={() => tricks.onTrick('hop')}>
              Hop
            </button>
            <button style={BTN} type="button" disabled={off !== null} title={why('Watt turns on the spot')} onClick={() => tricks.onTrick('spin')}>
              Spin
            </button>
            <button style={BTN} type="button" disabled={off !== null} className={tricks.napping ? 'on' : ''} title={why('Watt lies down and sleeps for a minute, or until he is petted')} onClick={() => tricks.onTrick('nap')}>
              Nap
            </button>
            <button style={BTN} type="button" disabled={off !== null || tricks.stay} title={why(tricks.stay ? 'Switch Stay off first' : 'Watt trots to the middle of this place')} onClick={() => tricks.onTrick('come')}>
              Come here
            </button>
            <button
                style={BTN}
              type="button"
              role="switch"
              aria-checked={tricks.stay}
              disabled={off !== null && !tricks.stay}
              className={tricks.stay ? 'on' : ''}
              title={tricks.stay ? 'Watt is staying where he was set down. Click to let him wander again.' : why('Watt stays where he was set down, sitting, until you switch this off, change place or the day ends')}
              onClick={() => tricks.onStay(!tricks.stay)}
            >
              Stay
            </button>
          </div>
          <div className="wc-row">
            <button
                style={BTN}
              type="button"
              className="wc-read"
              disabled={tricks.focusBusy}
              title={tricks.focusBusy ? 'A focus session is already running' : `Start a ${tricks.focusMinutes} minute focus session. Watt reads along.`}
              onClick={tricks.onRead}
            >
              Read with me, {tricks.focusMinutes} min
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
