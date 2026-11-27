/**
 * Light sync sandbox: every song through the real beat detector, the page's energy and drop
 * detector, and the native light engine (ported, see engine.ts), for each intensity. Pure
 * simulation in node: no device, no network, no Tauri.
 *
 * Run from wall/:
 *   npx vitest run -c scripts/lightsim/vitest.config.ts
 * Output (filmstrip PNGs, metrics.md, true beat times) goes to $LIGHTSIM_OUT, default
 * scripts/lightsim/out (ignored by git). LIGHTSIM_SONGS=house120,dnb174 runs a subset and
 * LIGHTSIM_LAYOUT=path/to/layout.json swaps the panel layout.
 */
import { test } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SONG_MAKERS } from './songs';
import { capture, run, type Layout } from './sim';
import { markdown, measure, type Metrics } from './metrics';
import { filmstrip } from './render';
import { INTENSITY_IDS } from '../../src/studio/lightsync/model';
import { createBeatDetector } from '../../src/audio/beat';
import type { Song } from './songs';
import type { Captured } from './sim';

/** Hit rate and false beats a minute of the beat detector alone at other onset thresholds (a tuning probe, not the product). */
function sweep(song: Song, cap: Captured): string {
  const cells = [9, 7, 6, 5].map((onsetDb) => {
    const det = createBeatDetector({ onsetDb });
    const hits = new Set<number>();
    let falses = 0;
    cap.frames.forEach((f, i) => {
      const unit = Array.from({ length: 12 }, (_, j) => (j < f.bands.length ? f.bands[j] / 255 : 0));
      if (!det.push(unit, cap.at[i], cap.at[i])) return;
      const k = song.kicks.findIndex((kt) => det.lastBeatAt - kt * 1000 >= -60 && det.lastBeatAt - kt * 1000 <= 150);
      if (k < 0) falses++;
      else hits.add(k);
    });
    return `${Math.round((hits.size / Math.max(1, song.kicks.length)) * 100)}% / ${((falses * 60) / song.seconds).toFixed(1)}`;
  });
  return `| ${song.id} | ${cells.join(' | ')} |`;
}

const here = dirname(fileURLToPath(import.meta.url));

test('light sync sandbox', () => {
  const out = resolve(process.env.LIGHTSIM_OUT ?? join(here, 'out'));
  mkdirSync(out, { recursive: true });
  const layoutPath = process.env.LIGHTSIM_LAYOUT ?? join(here, 'layouts', 'row5.json');
  const layout = JSON.parse(readFileSync(layoutPath, 'utf8')) as Layout;
  const pick = process.env.LIGHTSIM_SONGS?.split(',');
  const rows: Metrics[] = [];
  const truth: Record<string, unknown> = {};
  const sweeps: string[] = [];
  for (const [id, make] of Object.entries(SONG_MAKERS)) {
    if (pick && !pick.includes(id)) continue;
    const song = make();
    truth[id] = { name: song.name, bpm: song.bpm, seconds: song.seconds, kicks: song.kicks, grid: song.grid, drops: song.drops, sections: song.sections };
    const cap = capture(song);
    sweeps.push(sweep(song, cap));
    for (const preset of INTENSITY_IDS) {
      const r = run(song, cap, preset, layout);
      const m = measure(r);
      rows.push(m);
      writeFileSync(join(out, `${id}-${preset}.png`), filmstrip(r, m, layout.name.toUpperCase()));
    }
  }
  writeFileSync(join(out, 'true-beats.json'), JSON.stringify(truth, null, 1));
  const md = `# Light sync sandbox metrics\n\nLayout: ${layout.name}. Palette: Synthwave. Follow: highs, bass, bass, highs, panels both. Ripple on.\n\n` +
    'hit: share of true kicks a detected onset landed on (60 ms before to 150 ms after). onset/react: median ms from the true kick to the detected onset and to the tick the lights react. ' +
    'grid: share of quarter notes with a detected beat. pulses/min: luminance peaks of 0.04 or more (FL L R FR Plays, Pc centre panel, Pe edge panel). inner/outer b: brightness scalar range of Left and Far Left while music plays. ' +
    'min lum: lowest luminance a Play showed. at peak: share of music time Left sits at its cap. colour/min: palette colour changes on Left. edge/centre lift: beat swing of the edge panel against the centre panel. ' +
    'corr, lag: correlation of the beat motion of Left and the centre panel, and the lag that fits best (positive: panel after Play). guard holds: frames the flash guard changed. silence lum: brightest Left frame in the silence.\n\n' +
    markdown(rows) +
    '\n\n## Beat detector onset threshold probe\n\nHit rate / false beats a minute of the detector alone at each onset threshold (dB over the running median; 9 is the product).\n\n| song | 9 dB | 7 dB | 6 dB | 5 dB |\n|-|-|-|-|-|\n' +
    sweeps.join('\n') + '\n';
  writeFileSync(join(out, 'metrics.md'), md);
  console.log(md);
}, 600_000);
