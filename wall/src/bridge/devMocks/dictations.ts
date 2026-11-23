import type { Dictation } from '../dictations';
import { reviewNow } from '../../ui/reviewClock';
import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the Shelf Dictations list's answers, with invented sentences.
 *
 *   (no knob)              eight dictations, newest first, one with a long text and one with no app, the last with no raw text
 *   ?dict=not-installed    Wispr Flow is not installed
 *   ?dict=no-history       Wispr Flow has no history
 *   ?dict=changed          Wispr Flow changed its history format
 *   ?dict=busy             the history file is locked
 *   ?dict=failed           the read fails
 *   ?dict=empty            no dictations yet
 *   ?shelfmode=dictations  opens the Shelf card on Dictations (also `files`); the choice is kept in this browser
 *
 * Copy does nothing. Registered after the other mocks, so a knob wins.
 */

const clock = reviewNow ?? (() => Date.now());
const MIN = 60_000;
const WORDS = 'the review notes and the follow up for the next planning session with the whole team';
const LONG = Array.from({ length: 9 }, () => `Here is a longer dictation about ${WORDS}.`).join(' ');

const SEEDS: { agoMin: number; app: string; clean: string; raw: string }[] = [
  { agoMin: 3, app: 'Outlook', clean: 'Thanks for the notes. I can move the review to Thursday at two if that works for the team.', raw: 'um thanks for the notes uh I can move the review to thursday at two if that works for the team' },
  { agoMin: 26, app: 'Teams', clean: 'Quick update: the refresh finished and the numbers match the finance export now.', raw: 'quick update the refresh finished and the numbers match the finance export now' },
  { agoMin: 49, app: 'Code', clean: 'Add a test that the sort keeps the playing row marked after the list reorders.', raw: 'add a test that the sort keeps the playing row marked after the list reorders' },
  { agoMin: 190, app: 'Notes', clean: LONG, raw: LONG.toLowerCase().replace(/[.,:]/g, '') },
  { agoMin: 255, app: '', clean: 'Ideas for the workshop opener: start with the before and after, then the three steps.', raw: 'ideas for the workshop opener start with the before and after then the three steps' },
  { agoMin: 1700, app: 'Chrome', clean: 'Search for a standing desk mat that fits under a sixty inch desk.', raw: 'search for a standing desk mat that fits under a sixty inch desk' },
  { agoMin: 1750, app: 'Outlook', clean: 'Hi, following up on the invoice from last week. Let me know if anything is missing.', raw: 'hi following up on the invoice from last week let me know if anything is missing' },
  { agoMin: 4000, app: 'Notes', clean: 'Pick up the printer paper and the spare cables on the way in.', raw: '' },
];

export function registerDictationMocks(): void {
  const mode = knob('dict');
  const shelf = knob('shelfmode');
  if (shelf === 'dictations' || shelf === 'files') {
    try {
      localStorage.setItem('wall.shelf.recent', shelf);
    } catch {
      /* the mode just is not set */
    }
  }
  mocks.set('wall2_dictations', () => {
    if (mode === 'not-installed' || mode === 'no-history' || mode === 'changed' || mode === 'busy' || mode === 'failed') throw mode;
    if (mode === 'empty') return [];
    const base = clock();
    return SEEDS.map((s, i): Dictation => ({
      id: `d-${i + 1}`,
      at: new Date(base - s.agoMin * MIN).toISOString(),
      app: s.app,
      clean: s.clean,
      raw: s.raw,
      hasRaw: s.raw !== '',
      words: s.clean.split(/\s+/).length,
    }));
  });
  mocks.set('wall2_dictation_copy', () => undefined);
}
