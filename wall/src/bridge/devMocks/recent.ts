import { reviewNow } from '../../ui/reviewClock';
import type { RecentFile } from '../../shelf/recent';
import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the Shelf Recent files card's answers, with invented file names.
 *
 *   (no knob)        five files, newest first: three today, then Yesterday and a weekday
 *   ?recent=empty    no recent files
 *   ?recent=down     the read fails
 *   ?recent=long     the newest file has a very long name
 *
 * Registered after the other mocks, so a knob wins. Opening a file and showing it in Explorer do nothing.
 */

const clock = reviewNow ?? (() => Date.now());
const MIN = 60_000;

const SEEDS: { name: string; kind: string; agoMin: number }[] = [
  { name: 'Quarterly review.pptx', kind: 'slides', agoMin: 44 },
  { name: 'Budget 2027.xlsx', kind: 'sheet', agoMin: 128 },
  { name: 'Meeting notes.docx', kind: 'document', agoMin: 215 },
  { name: 'Site photo.png', kind: 'image', agoMin: 1700 },
  { name: 'Project plan.pdf', kind: 'document', agoMin: 3600 },
];

export function registerRecentMocks(): void {
  const mode = knob('recent');
  mocks.set('wall2_recent_files', () => {
    if (mode === 'down') throw 'failed';
    if (mode === 'empty') return [];
    const base = clock();
    const out: RecentFile[] = SEEDS.map((s, i) => ({ id: `rf${i}`, name: s.name, kind: s.kind, modified: base - s.agoMin * MIN }));
    if (mode === 'long') out[0] = { ...out[0], name: 'Quarterly business review with every region and product line, final version three.pptx' };
    return out;
  });
  mocks.set('wall2_recent_open', () => undefined);
  mocks.set('wall2_recent_folder', () => undefined);
}
