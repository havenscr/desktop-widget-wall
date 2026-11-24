import type { AskError, AskModel, AskState, AskTurn, BriefHealth } from '../bridge/meetBrief';

/** The ask box's words and rules in one place, so a test can hold every word to the owner's three-word limit. */

export const MAX_Q = 300;
export const MAX_A = 1200;
export const MAX_TURNS = 3;
/** The health read while the field is enabled. */
export const HEALTH_EVERY_MS = 60_000;

export const PLACEHOLDER = 'Ask about this meeting';
export const PLACEHOLDER_FOLLOW = 'Ask a follow up';
export const SOURCE_LINE = 'Claude · brief only · can be wrong';

const STATES: AskState[] = ['off', 'ready', 'busy', 'failing'];
const MODELS: AskModel[] = ['Sonnet', 'Opus', 'Claude'];

export const REASONS = { brief: 'Brief not ready', onAir: 'Hidden on air', off: 'Ask off' } as const;

export const ERROR_WORDS: Record<AskError | 'unknown', string> = {
  'not-ready': 'Brief not ready',
  busy: 'Busy, try again',
  limit: 'Hourly limit',
  'day-limit': 'Day limit',
  'model-off': 'Claude unreachable',
  refused: 'Claude declined',
  'ask-off': 'Ask off',
  'limit-store': 'Limit check failed',
  forbidden: 'Ask failed',
  failed: 'Ask failed',
  'not-set-up': 'Ask failed',
  'not-configured': 'Ask failed',
  'invalid-config': 'Ask failed',
  gone: 'Ask failed',
  unknown: 'Ask failed',
};

export const errorWord = (e: unknown): string => (typeof e === 'string' && Object.prototype.hasOwnProperty.call(ERROR_WORDS, e) ? ERROR_WORDS[e as AskError] : ERROR_WORDS.unknown);

/** The health answer reduced to the two fixed word lists; anything else is null (nothing known). */
export function checkHealth(h: unknown): BriefHealth['ask'] | null {
  const ask = (h as { ask?: { state?: unknown; name?: unknown } } | null)?.ask;
  if (!ask || typeof ask.state !== 'string' || !(STATES as string[]).includes(ask.state)) return null;
  const name = typeof ask.name === 'string' && (MODELS as string[]).includes(ask.name) ? (ask.name as AskModel) : 'Claude';
  return { state: ask.state as AskState, name };
}

export interface AskGate {
  enabled: boolean;
  /** The short reason shown in the disabled field, or null when enabled. */
  reason: string | null;
}

/**
 * The field works only when the brief is ready, On Air is not live and the box says ask is on. A busy or failing box still lets
 * a question through (a failing box only recovers on a call that works), so the answer line names the trouble.
 */
export function askGate(o: { briefReady: boolean; onAir: boolean; health: BriefHealth['ask'] | null }): AskGate {
  if (o.onAir) return { enabled: false, reason: REASONS.onAir };
  if (!o.briefReady) return { enabled: false, reason: REASONS.brief };
  if (!o.health || o.health.state === 'off') return { enabled: false, reason: REASONS.off };
  return { enabled: true, reason: null };
}

/** The dim status word beside the field, or null before the first health read. */
export function statusWord(h: BriefHealth['ask'] | null): string | null {
  if (!h) return null;
  switch (h.state) {
    case 'ready':
      return `${h.name} ready`;
    case 'busy':
      return `${h.name} busy`;
    case 'failing':
      return 'Ask failing';
    default:
      return 'Ask off';
  }
}

export const askingLine = (seconds: number): string => `Asking · ${Math.max(0, Math.floor(seconds))} s`;

/** The question as typed: control characters dropped, trimmed, at most 300 characters; null when empty. */
export function cleanQuestion(raw: string): string | null {
  const t = Array.from(raw)
    .filter((c) => c >= ' ' && c !== '\u007f')
    .join('')
    .trim();
  return t ? Array.from(t).slice(0, MAX_Q).join('') : null;
}

/** The turns that go with the next question: the last three pairs. */
export const capTurns = (turns: AskTurn[]): AskTurn[] => turns.slice(-MAX_TURNS);

/** Every word the box can show, for the three-word test. */
export const allWords = (): string[] => [
  ...Object.values(REASONS),
  ...Object.values(ERROR_WORDS),
  ...MODELS.flatMap((name) => STATES.map((state) => statusWord({ state, name }) ?? '')),
  'Back',
  'Clear',
  'Cancel',
];
