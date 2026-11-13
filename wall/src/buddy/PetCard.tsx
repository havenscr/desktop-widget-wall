import { CHATTY_LEVELS, type Chatty } from './chatter';
import { COSMETICS, MOOD_WORD, UNLOCK_DAYS, todayLines, unlocked, type Cosmetic, type Mood, type PetData } from './pet';

const CHATTY_WORD: Readonly<Record<Chatty, string>> = { off: 'Off', sometimes: 'Sometimes', chatty: 'Chatty' };
const CHATTY_HINT: Readonly<Record<Chatty, string>> = {
  off: 'No speech bubbles at all',
  sometimes: 'A short line at most every six minutes',
  chatty: 'A short line at most every three minutes',
};
const COSMETIC_WORD: Readonly<Record<Cosmetic, string>> = { none: 'None', bow: 'Bow', star: 'Star', cape: 'Cape' };

/**
 * Watt's card, opened by a right-click on him: his name and mood, two honest lines about today, the
 * days together, how chatty he is, and the cosmetics he has unlocked. A strip placed by `placeCard`
 * (beside him in the band over the horizon, or under Unwind's transport row); it stays open until
 * Escape, a click outside it, a right-click on him, a place change or he goes away.
 */
export function PetCard({
  left,
  top,
  mood,
  pet,
  onBlur,
  onChatty,
  onCosmetic,
}: {
  left: number;
  top: number;
  mood: Mood;
  pet: PetData;
  onBlur: (e: React.FocusEvent<HTMLElement>) => void;
  onChatty: (c: Chatty) => void;
  onCosmetic: (c: Cosmetic) => void;
}) {
  const days = pet.days;
  return (
    <div className="watt-card" role="dialog" aria-label="Watt" tabIndex={-1} style={{ left, top }} onBlur={onBlur}>
      <div className="wc-head">
        <span className="wc-name">Watt</span>
        <span className={`wc-mood m-${mood}`}>{MOOD_WORD[mood]}</span>
        <ul className="wc-today">
          {todayLines(pet.today).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <span className="wc-days">{days === 1 ? 'First day together' : `${days} days together`}</span>
      </div>
      <div className="wc-rows">
        <div className="wc-row" role="radiogroup" aria-label="How chatty">
          <span className="wc-label">Chatty</span>
          {CHATTY_LEVELS.map((c) => (
            <button
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
    </div>
  );
}
