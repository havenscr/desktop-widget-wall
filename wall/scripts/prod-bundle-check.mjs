// Proves a production build carries no development mock or gallery code: builds for
// production and fails if any marker string (mock data, knob parsing, the gallery module)
// is found in the output. Run by hand or in CI:  npm --prefix wall run prod-check

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'wall-prod-check-'));
const MARKERS = [
  /registerGalleryMocks|registerDevMocks|seedReviewFocus/,
  /Away For The Weekend|Company offsite|Draft the workshop outline|Quarterly planning and roadmap/,
  /Tokyo Burnout|A Very Long Artist Name|Friday social card|Admin pill polish/,
  /registerWatchMocks|data-mock-poster|Night drive mix|PLmockPlaylist0001|get\(["']wlist["']\)/,
  /\blineprobe\b|\bltarget\b|["']lover["']|\.lineProbe\b|\*\{pointer-events:auto !important\}/,
  // The lines knobs (devMocks/lines.ts) and the horizon's cost probe, as quoted strings (the bundler writes a plain string in backticks): the words alone ("lines") are real code.
  /["'`](lheight|lcol|lrest|lrefl|ltab|linecost|wday)["'`]/,
  /signedout|get\(["']agents["']\)|has\(["']long["']\)|get\(["']clock["']\)|get\(["']screen["']\)|get\(["']audio["']\)|get\(["']hz["']\)/,
];
const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
try {
  process.env.NODE_ENV = 'production';
  const { build } = await import('vite');
  await build({ root, configFile: join(root, 'vite.config.ts'), mode: 'production', logLevel: 'warn', build: { outDir: join(out, 'dist'), emptyOutDir: true } });
  let bad = 0;
  for (const f of files(join(out, 'dist')).filter((f) => /\.(js|css|html)$/.test(f))) {
    const text = readFileSync(f, 'utf8');
    for (const m of MARKERS) {
      const hit = m.exec(text);
      if (hit) {
        bad++;
        console.log(`FAIL ${f.slice(out.length + 1)}: found "${hit[0]}"`);
      }
    }
  }
  // The Tabler icon data (tags' glyphs) must be its own lazily loaded chunk: found in exactly the
  // files that index.html does not load or preload, never in the first load.
  {
    const html = readFileSync(join(out, 'dist', 'index.html'), 'utf8');
    const firstLoad = new Set([...html.matchAll(/(?:src|href)="\.?\/?([^"]+\.js)"/g)].map((m) => m[1]));
    const ICON_DATA = /["']shopping-cart["']\s*:\s*[`"']M4 19a2 2 0 1 0 4 0/;
    const holders = files(join(out, 'dist')).filter((f) => f.endsWith('.js') && ICON_DATA.test(readFileSync(f, 'utf8')));
    const rel = (f) => f.slice(join(out, 'dist').length + 1).replaceAll('\\', '/');
    if (holders.length !== 1) {
      bad++;
      console.log(`FAIL icon data: expected it in exactly one chunk, found it in ${holders.length}`);
    } else if (firstLoad.has(rel(holders[0]))) {
      bad++;
      console.log(`FAIL icon data: ${rel(holders[0])} is part of the first load`);
    } else if (
      // A static import (`from"./chunk.js"` or `import"./chunk.js"`) would pull it into whichever chunk names it;
      // a dynamic `import("./chunk.js")` is what keeps it lazy.
      files(join(out, 'dist'))
        .filter((f) => f.endsWith('.js') && f !== holders[0])
        .some((f) => new RegExp(`(?:from|import)\\s*["'\`]\\./${rel(holders[0]).split('/').pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`]`).test(readFileSync(f, 'utf8')))
    ) {
      bad++;
      console.log(`FAIL icon data: ${rel(holders[0])} is imported statically by another chunk`);
    } else {
      const bytes = readFileSync(holders[0]).length;
      console.log(`prod-check: icon data is its own chunk (${rel(holders[0])}, ${bytes} bytes), not in the first load (${[...firstLoad].join(', ')})`);
    }
  }
  console.log(bad ? `prod-check: ${bad} marker(s) found in the production bundle` : 'prod-check: no mock or gallery code in the production bundle');
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(out, { recursive: true, force: true });
}
