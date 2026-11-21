import { reviewNow } from '../../ui/reviewClock';
import type { Capture } from '../../shelf/captures';
import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the Shelf Captures card's answers, with invented names and placeholder art.
 *
 *   (no knob)           eight captures, newest first: a picture, a GIF, a picture, a video, then older pictures
 *   ?captures=empty     the history file has no captures
 *   ?captures=nohistory ShareX has no history file on this PC
 *   ?captures=gone      the third capture's file was moved or deleted (a dimmed row)
 *   ?captures=gonebig   the newest capture's file was moved or deleted
 *   ?captures=video     the newest capture is a recording
 *   ?captures=long      the newest capture has a very long title and app name
 *   ?captures=big       the newest capture is over the 6 MB thumbnail limit
 *
 * Registered after the other mocks, so a knob wins. Opening, copying and showing a file do nothing.
 */

const clock = reviewNow ?? (() => Date.now());
const MIN = 60_000;

interface Seed {
  title: string;
  app: string;
  kind: Capture['kind'];
  agoMin: number;
  size: number;
  hue: [string, string];
}

const SEEDS: Seed[] = [
  { title: 'Sales overview, region slicer', app: 'Power BI Desktop', kind: 'image', agoMin: 22, size: 412_000, hue: ['#3a2a08', '#f2c811'] },
  { title: 'Release flow, draft three', app: 'Microsoft Edge', kind: 'gif', agoMin: 37, size: 2_400_000, hue: ['#08283a', '#35e6ea'] },
  { title: 'Inbox, flagged for today', app: 'Outlook', kind: 'image', agoMin: 53, size: 188_000, hue: ['#0a1e3a', '#4aa8ff'] },
  { title: 'Agent review walkthrough', app: 'OmniGent', kind: 'video', agoMin: 86, size: 18_700_000, hue: ['#1a1040', '#9a7bff'] },
  { title: 'wall2_captures.rs', app: 'Visual Studio Code', kind: 'image', agoMin: 104, size: 301_000, hue: ['#0a2a22', '#5df2b6'] },
  { title: 'Sprint standup', app: 'Teams', kind: 'image', agoMin: 1500, size: 256_000, hue: ['#2a0a22', '#ff3d9a'] },
  { title: 'Invoice 0042', app: 'Chrome', kind: 'image', agoMin: 2900, size: 97_000, hue: ['#2a1a08', '#ffc24d'] },
  { title: 'Settings, display', app: 'Settings', kind: 'image', agoMin: 4400, size: 143_000, hue: ['#0a2030', '#4fc3f7'] },
];

const EXT: Record<Capture['kind'], string> = { image: 'png', gif: 'gif', video: 'mp4', other: 'bin' };

function build(mode: string | null): Capture[] {
  const base = clock();
  const out: Capture[] = SEEDS.map((s, i) => ({
    id: `cap${i}`,
    fileName: `capture-${String(i + 1).padStart(2, '0')}.${EXT[s.kind]}`,
    title: s.title,
    app: s.app,
    kind: s.kind,
    time: base - s.agoMin * MIN,
    size: s.size,
    exists: true,
  }));
  if (mode === 'gone') out[2] = { ...out[2], exists: false };
  if (mode === 'gonebig') out[0] = { ...out[0], exists: false };
  if (mode === 'video') out[0] = { ...out[0], kind: 'video', fileName: 'capture-01.mp4', size: 22_300_000 };
  if (mode === 'long') out[0] = { ...out[0], title: 'Quarterly sales overview by region and product line with every slicer and filter open at once', app: 'Power BI Desktop (Preview) - Extended Edition' };
  return out;
}

/** A placeholder picture: a dark gradient with bars in the capture's colour. */
function art(i: number): string {
  const [a, b] = SEEDS[i % SEEDS.length].hue;
  const bars = [0, 1, 2, 3, 4, 5]
    .map((k) => {
      const h = 18 + ((i * 7 + k * 13) % 40);
      return `<rect x="${18 + k * 26}" y="${92 - h}" width="16" height="${h}" rx="3" fill="${b}" opacity="${0.5 + k * 0.08}"/>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 104" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="#07051a"/></linearGradient></defs><rect width="200" height="104" fill="url(#g)"/>${bars}<rect x="10" y="8" width="70" height="8" rx="4" fill="#fff" opacity="0.5"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function registerCapturesMocks(): void {
  const mode = knob('captures');
  mocks.set('wall2_captures_list', () => {
    if (mode === 'nohistory') throw 'not-found';
    if (mode === 'empty') return [];
    return build(mode);
  });
  mocks.set('wall2_captures_thumb', (args) => {
    const id = Number(String((args as { id?: string } | undefined)?.id ?? '').replace('cap', ''));
    const c = build(mode)[id];
    if (!c || !c.exists) throw 'missing';
    if (c.kind === 'video') throw 'not-image';
    if (mode === 'big' && id === 0) throw 'too-big';
    return art(id);
  });
  mocks.set('wall2_captures_act', () => undefined);
}
