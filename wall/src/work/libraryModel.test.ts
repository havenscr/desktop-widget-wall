// @ts-ignore node's own file calls; these tests read the Rust contract as text.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { KEY_ICONS } from './keyIcons';
import { FALLBACK_PINS, MAX_PINS, parsePins, PINS_KEY, resolvePin, searchLibrary, swapPin } from './libraryModel';

const rust: string = readFileSync('../src-tauri/src/wall2_keylib.rs', 'utf8');
const filePins = [{ label: 'Mine', icon: 'window', action: 'zen' }];
const lib = LIBRARY_DATA;

describe('the library the page and the mocks hold equals the Rust one', () => {
  const entries = [...rust.matchAll(/LibEntry \{ id: "([a-z0-9-]+)", label: "([^"]*)", icon: "([a-z0-9-]+)", group: "([a-z0-9-]+)", kind: LibKind::(\w+), how: "([^"]*)", spec: "([^"]*)" \}/g)];
  const flat = lib.flatMap((g) => g.keys.map((k) => ({ ...k, group: g.id })));

  it('has 102 keys with unique ids in the same order, groups, labels, icons and kinds', () => {
    expect(entries.length).toBe(102);
    expect(flat.length).toBe(102);
    expect(new Set(flat.map((k) => k.id)).size).toBe(102);
    expect(flat.map((k) => [k.id, k.label, k.icon, k.group, k.kind, k.how])).toEqual(entries.map((m) => [m[1], m[2], m[3], m[4], m[5].toLowerCase() === 'wall' ? 'wall' : m[5].toLowerCase(), m[6]]));
  });

  it('every icon is one the page draws', () => {
    for (const k of flat) expect(KEY_ICONS[k.icon], `${k.id}: ${k.icon}`).toBeTruthy();
  });

  it('a key that can run is listed as runnable; coming keys are not; no chord is in the page copy', () => {
    for (const m of entries) {
      const k = flat.find((f) => f.id === m[1])!;
      expect(k.runnable, m[1]).toBe(m[5] !== 'Soon' && m[7] !== '');
    }
    expect(JSON.stringify(lib)).not.toContain('"spec"');
    expect(flat.filter((k) => k.kind === 'soon').map((k) => k.id)).toEqual(['new-chat', 'task-add', 'tv-off', 'alarms-seen']);
  });

  it('every action name is in the fixed list Rust parses', () => {
    const names = new Set([...rust.matchAll(/^\s+"([a-z0-9:-]+)" => WallAction::\w+,/gm)].map((m) => m[1]));
    expect(names.size).toBe(22);
    for (const k of flat) if (k.action) expect(names.has(k.action) || /^mood:[a-z0-9-]+$/.test(k.action), `${k.id}: ${k.action}`).toBe(true);
  });

  it('the fallback pins equal the Rust defaults', () => {
    const m = /DEFAULT_PINS: \[&str; 5\] = \[([^\]]*)\]/.exec(rust);
    const ids = [...(m?.[1] ?? '').matchAll(/"([a-z0-9-]+)"/g)].map((x) => `lib:${x[1]}`);
    expect(ids).toEqual([...FALLBACK_PINS]);
    expect(FALLBACK_PINS.length).toBe(MAX_PINS);
  });
});

describe('pins on this display', () => {
  it('resolves a library key and a keys.json key, and nothing that cannot run', () => {
    expect(resolvePin('lib:thirds', lib, [])).toMatchObject({ label: 'Thirds', action: 'layout:thirds', group: null });
    expect(resolvePin('lib:teams-mute', lib, [])).toMatchObject({ label: 'Mute', group: 'Calls: Teams', action: null });
    expect(resolvePin('lib:rec-toggle', lib, [])).toMatchObject({ kind: 'check' });
    expect(resolvePin('file:0', lib, filePins)).toMatchObject({ label: 'Mine', action: 'zen', kind: 'file' });
    for (const bad of ['', 'lib:', 'lib:nope', 'lib:new-chat', 'lib:pbi-refresh', 'file:1', 'file:x', 'x:thirds', 'lib:Thirds', 'lib:../x', 'file:0 ']) {
      expect(resolvePin(bad, lib, filePins), bad).toBeNull();
    }
  });

  it('reads a saved list only when every entry is valid, at most five, without repeats', () => {
    expect(PINS_KEY).toBe('wall2-keys-pins');
    const ok = ['lib:snip', 'lib:thirds', 'file:0'];
    expect(parsePins(JSON.stringify(ok), lib, filePins)).toEqual(ok);
    for (const bad of [null, '', 'nope', '{}', '[]', '"lib:snip"', JSON.stringify([1]), JSON.stringify(['lib:nope']), JSON.stringify(['lib:snip', 'lib:snip']), JSON.stringify(['lib:snip', 'lib:focus', 'lib:thirds', 'lib:mute', 'lib:mixer', 'lib:zen']), JSON.stringify(['file:3'])]) {
      expect(parsePins(bad, lib, filePins), String(bad)).toBeNull();
    }
    // A key.json pin that is gone from the file drops the whole saved list: the defaults apply.
    expect(parsePins(JSON.stringify(['file:0']), lib, [])).toBeNull();
  });

  it('swaps a key into a slot; a key already pinned elsewhere trades places', () => {
    expect(swapPin(['lib:a', 'lib:b', 'lib:c'], 1, 'lib:x')).toEqual(['lib:a', 'lib:x', 'lib:c']);
    expect(swapPin(['lib:a', 'lib:b', 'lib:c'], 0, 'lib:c')).toEqual(['lib:c', 'lib:b', 'lib:a']);
    expect(swapPin(['lib:a', 'lib:b'], 1, 'lib:b')).toEqual(['lib:a', 'lib:b']);
    expect(swapPin(['lib:a'], 3, 'lib:x')).toEqual(['lib:a', 'lib:x']);
    expect(swapPin(['lib:a', 'lib:b', 'lib:c', 'lib:d', 'lib:e'], 9, 'lib:x')).toHaveLength(5);
  });

  it('searches label, group and what a key does; empty groups drop out', () => {
    expect(searchLibrary(lib, '')).toHaveLength(13);
    expect(searchLibrary(lib, 'volume').flatMap((g) => g.keys.map((k) => k.id))).toEqual(expect.arrayContaining(['volume-up', 'volume-down', 'mixer']));
    expect(searchLibrary(lib, 'ZOOM').map((g) => g.id)).toEqual(['zoom']);
    expect(searchLibrary(lib, 'zzzzzz')).toEqual([]);
    expect(searchLibrary(lib, '  task manager ')[0].keys.map((k) => k.id)).toEqual(['task-manager']);
  });
});
