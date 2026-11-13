// @ts-ignore node's own file calls; the test reads the Rust contract as text.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { KEY_ICONS } from './keyIcons';

/** Vitest runs from the `wall` folder, so the Rust file is one folder up. The allowed names live in the Rust contract (`ICON_NAMES`); the page must draw exactly those. */
it('draws exactly the icon names the Rust config accepts', () => {
  const src: string = readFileSync('../src-tauri/src/wall2_keys.rs', 'utf8');
  const block = /pub\(crate\) const ICON_NAMES: \[&str; \d+\] = \[([^\]]*)\]/.exec(src);
  expect(block).not.toBeNull();
  const names = [...(block?.[1] ?? '').matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
  expect(names.length).toBeGreaterThan(0);
  expect(Object.keys(KEY_ICONS).sort()).toEqual([...names].sort());
});
