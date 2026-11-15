// @ts-ignore node's own file calls; the stylesheets and sources are read as text.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A `var(--name)` with no fallback and no definition anywhere is dropped by the browser along with
// the whole declaration (the position bar's fill used `--pink`, which never existed, and drew
// nothing). Every such use must name a token defined in some stylesheet or set from code.

const walk = (dir: string): string[] =>
  (readdirSync(dir) as string[]).flatMap((n) => {
    const p = `${dir}/${n}`;
    return (statSync(p).isDirectory() ? walk(p) : [p]) as string[];
  });
const read = (p: string) => readFileSync(p, 'utf8') as string;
/** The text with every comment blanked and its line breaks kept, so line numbers stay true. */
const blank = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

// Every stylesheet under src, not only the shared ones: Watt's own sheet sits beside its component.
const sheets = walk('src').filter((p) => p.endsWith('.css'));
const sources = walk('src').filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p));

/** Tokens a stylesheet declares (`--x: ...`). Outside `var()`, so a use is never read as a definition. */
const declared = new Set<string>();
for (const p of sheets) for (const m of blank(read(p)).matchAll(/(^|[\s;{])(--[\w-]+)\s*:/g)) declared.add(m[2]);
/** Tokens the code sets: a quoted `'--x'` (style objects, `setProperty`, `style.setProperty`). */
for (const p of sources) for (const m of read(p).matchAll(/['"`](--[a-zA-Z][\w-]*)['"`]/g)) declared.add(m[1]);

/** Known gaps found when this test was written, none in a file of the position bar's block. Each is listed so the test is green; fix at the source, then delete the line. */
const ALLOWED: Record<string, string> = {};

describe('stylesheet tokens', () => {
  it('every var(--name) without a fallback names a token that is defined or set from code', () => {
    const missing: string[] = [];
    for (const p of sheets) {
      const lines = blank(read(p)).split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
          if (m[2] === ',') continue;
          if (declared.has(m[1]) || ALLOWED[m[1]]) continue;
          missing.push(`${p}:${i + 1} uses ${m[1]}, which nothing defines`);
        }
      });
    }
    expect(missing).toEqual([]);
  });

  it('reads every stylesheet under src, Watt\'s own included', () => {
    expect(sheets.some((p) => p.endsWith('buddy/watt.css'))).toBe(true);
    expect(sheets.some((p) => p.endsWith('styles/home.css'))).toBe(true);
  });

  it('knows the tokens the play block uses: the pink is --mag, there is no --pink', () => {
    expect(declared.has('--mag')).toBe(true);
    expect(declared.has('--cyan')).toBe(true);
    expect(declared.has('--pink')).toBe(false);
  });
});
