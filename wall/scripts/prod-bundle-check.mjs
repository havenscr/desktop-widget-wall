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
  console.log(bad ? `prod-check: ${bad} marker(s) found in the production bundle` : 'prod-check: no mock or gallery code in the production bundle');
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(out, { recursive: true, force: true });
}
