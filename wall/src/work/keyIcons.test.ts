import rust from '../../../src-tauri/src/wall2_keys.rs?raw';
import { expect, it } from 'vitest';
import { KEY_ICONS } from './keyIcons';

/** The allowed names live in the Rust contract (`ICON_NAMES`); the page must draw exactly those. */
it('draws exactly the icon names the Rust config accepts', () => {
  const src: string = rust;
  const block = /pub\(crate\) const ICON_NAMES: \[&str; \d+\] = \[([^\]]*)\]/.exec(src);
  expect(block).not.toBeNull();
  const names = [...(block?.[1] ?? '').matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
  expect(names.length).toBeGreaterThan(0);
  expect(Object.keys(KEY_ICONS).sort()).toEqual([...names].sort());
});
