// @ts-ignore node's own file calls; these tests read the Rust contract as text.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { KEY_ICONS } from './keyIcons';
import { FALLBACK_PINS, MAX_PINS, parsePins, PINS_KEY, removePin, resolvePin, searchLibrary, serializePins, swapPin, type LibGroup, type LibKey } from './libraryModel';

const rust: string = readFileSync('../src-tauri/src/wall2_keylib.rs', 'utf8');
const filePins = [{ label: 'Mine', icon: 'window', action: 'zen' }];
const lib = LIBRARY_DATA;

/** The library as `library_info` returns it, worked out from the Rust text: every field. */
function rustLibrary(): LibGroup[] {
  const names = new Set([...rust.matchAll(/^\s+"([a-z0-9:-]+)" => WallAction::\w+,/gm)].map((m) => m[1]));
  const groups: LibGroup[] = [...rust.matchAll(/LibGroup \{ id: "([a-z0-9-]+)", title: "([^"]*)", exes: &\[([^\]]*)\] \}/g)].map((m) => ({
    id: m[1],
    title: m[2],
    exes: [...m[3].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
    keys: [],
  }));
  for (const m of rust.matchAll(/LibEntry \{ id: "([a-z0-9-]+)", label: "([^"]*)", icon: "([a-z0-9-]+)", group: "([a-z0-9-]+)", kind: LibKind::(\w+), how: "([^"]*)", spec: "([^"]*)" \}/g)) {
    const kind = m[5].toLowerCase() as LibKey['kind'];
    const spec = m[7];
    const action = names.has(spec) || /^mood:[a-z0-9-]+$/.test(spec) || /^sharex:[a-z-]+$/.test(spec) ? spec : null;
    groups.find((g) => g.id === m[4])!.keys.push({ id: m[1], label: m[2], icon: m[3], kind, how: m[6], action, runnable: kind !== 'soon' && spec !== '' });
  }
  return groups;
}

describe('the library the page and the mocks hold equals the Rust one', () => {
  const flat = lib.flatMap((g) => g.keys.map((k) => ({ ...k, group: g.id })));

  it('has 124 keys in 17 groups, equal field by field to what library_info returns: ids, labels, icons, kinds, how, action, runnable and each group exes', () => {
    const fromRust = rustLibrary();
    expect(fromRust.flatMap((g) => g.keys).length).toBe(124);
    expect(fromRust.length).toBe(17);
    expect(new Set(flat.map((k) => k.id)).size).toBe(124);
    expect(LIBRARY_DATA).toEqual(fromRust);
  });

  it('PowerToys: the not-installed state is the mock (title, all keys check); the found state is plain keys under "PowerToys"', () => {
    const pt = lib.find((g) => g.id === 'powertoys')!;
    expect(pt.title).toBe('PowerToys (not installed on this PC)');
    expect(pt.keys.length).toBe(5);
    expect(pt.keys.every((k) => k.kind === 'check')).toBe(true);
    // Rust's found state, as text: the plain title and the check-to-key swap for this group only.
    expect(rust).toContain('if g.id == "powertoys" && powertoys { "PowerToys".to_string() }');
    expect(rust).toContain('if powertoys && e.group == "powertoys" && e.kind == LibKind::Check { LibKind::Key.word() }');
    const found = { ...pt, title: 'PowerToys', keys: pt.keys.map((k) => ({ ...k, kind: 'key' as const })) };
    expect(found.keys.every((k) => k.kind === 'key') && found.title === 'PowerToys').toBe(true);
    expect(found.keys.map((k) => k.id)).toEqual(pt.keys.map((k) => k.id));
  });

  it('the comparison bites: one changed action, one changed exe, one changed runnable each make it unequal', () => {
    const fromRust = rustLibrary();
    const swapped = structuredClone(LIBRARY_DATA);
    const thirds = swapped.flatMap((g) => g.keys).find((k) => k.id === 'thirds')!;
    thirds.action = 'layout:focus';
    expect(swapped).not.toEqual(fromRust);
    const exes = structuredClone(LIBRARY_DATA);
    exes.find((g) => g.id === 'excel')!.exes.push('pbidesktop.exe');
    expect(exes).not.toEqual(fromRust);
    const runnable = structuredClone(LIBRARY_DATA);
    runnable.flatMap((g) => g.keys).find((k) => k.id === 'new-chat')!.runnable = true;
    expect(runnable).not.toEqual(fromRust);
  });

  it('every icon is one the page draws', () => {
    for (const k of flat) expect(KEY_ICONS[k.icon], `${k.id}: ${k.icon}`).toBeTruthy();
  });

  it('coming keys are not runnable; no chord is in the page copy', () => {
    expect(JSON.stringify(lib)).not.toContain('"spec"');
    expect(flat.filter((k) => k.kind === 'soon').map((k) => k.id)).toEqual(['new-chat', 'task-add', 'tv-off', 'alarms-seen']);
  });

  it('every action name is in the fixed list Rust parses', () => {
    const names = new Set([...rust.matchAll(/^\s+"([a-z0-9:-]+)" => WallAction::\w+,/gm)].map((m) => m[1]));
    expect(names.size).toBe(27);
    for (const k of flat) if (k.action) expect(names.has(k.action) || /^mood:[a-z0-9-]+$/.test(k.action) || /^sharex:[a-z-]+$/.test(k.action), `${k.id}: ${k.action}`).toBe(true);
  });

  it('the ShareX group is exactly the 16 tasks of the Rust table, all runnable wall keys, and never an upload or an active-window task', () => {
    const sharex: string = readFileSync('../src-tauri/src/wall2_sharex.rs', 'utf8');
    const table = [...sharex.matchAll(/Row \{ spec: "([a-z-]+)", arg: "(-[A-Za-z]+)" \}/g)].map((m) => ({ spec: m[1], arg: m[2] }));
    expect(table.length).toBe(16);
    const group = lib.find((g) => g.id === 'sharex')!;
    expect(group.title).toBe('ShareX');
    expect(group.exes).toEqual([]);
    expect(group.keys.map((k) => k.action)).toEqual(table.map((t) => `sharex:${t.spec}`));
    for (const k of group.keys) {
      expect(k.kind, k.id).toBe('wall');
      expect(k.runnable, k.id).toBe(true);
    }
    const args = table.map((t) => t.arg);
    for (const bad of ['-ClipboardUpload', '-FileUpload', '-ActiveWindow', '-ActiveMonitor', '-workflow', '-task', '-silent']) expect(args).not.toContain(bad);
    expect(flat.filter((k) => k.action?.startsWith('sharex:') && k.group !== 'sharex')).toEqual([]);
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
    const stored = JSON.stringify(['lib:snip', 'lib:thirds', { ref: 'file:0', label: 'Mine', action: 'zen' }]);
    expect(parsePins(stored, lib, filePins)).toEqual(ok);
    expect(serializePins(ok, filePins)).toBe(stored);
    expect(parsePins('[]', lib, filePins)).toEqual([]);
    for (const bad of [null, '', 'nope', '{}', '"lib:snip"', JSON.stringify([1]), JSON.stringify(['lib:snip', 'lib:snip']), JSON.stringify(['Lib:Snip']), JSON.stringify([null]), JSON.stringify(['lib:snip', 'lib:focus', 'lib:thirds', 'lib:mute', 'lib:mixer', 'lib:zen']), JSON.stringify([{ ref: 'file:3', label: 'x', action: null }, 'lib:../x'])]) {
      expect(parsePins(bad, lib, filePins), String(bad)).toBeNull();
    }
    // A pin on a keys.json key is an index: it is dropped when the file no longer has that same key there.
    const mine = { ref: 'file:0', label: 'Mine', action: 'zen' };
    expect(parsePins(JSON.stringify(['lib:snip', mine]), lib, filePins)).toEqual(['lib:snip', 'file:0']);
    expect(parsePins(JSON.stringify(['lib:snip', mine]), lib, [{ label: 'Other', icon: 'window', action: 'zen' }])).toEqual(['lib:snip']);
    expect(parsePins(JSON.stringify(['lib:snip', mine]), lib, [{ label: 'Mine', icon: 'window', action: 'dream' }])).toEqual(['lib:snip']);
    expect(parsePins(JSON.stringify(['lib:snip', mine]), lib, [])).toEqual(['lib:snip']);
    expect(parsePins(JSON.stringify([mine]), lib, [])).toEqual([]);
    expect(parsePins(JSON.stringify(['file:0']), lib, filePins)).toEqual([]);
  });

  it('keeps what still resolves when a well formed reference stops resolving, and never falls back to the defaults for it', () => {
    // One stale reference among two: the one that resolves stays.
    expect(parsePins(JSON.stringify(['lib:snip', 'lib:nope']), lib, filePins)).toEqual(['lib:snip']);
    expect(parsePins(JSON.stringify(['lib:nope', { ref: 'file:0', label: 'Mine', action: 'zen' }]), lib, filePins)).toEqual(['file:0']);
    // A lone stale reference (a library id that is gone, a key that cannot run, a keys.json index) is an empty row, not null.
    expect(parsePins(JSON.stringify(['lib:nope']), lib, filePins)).toEqual([]);
    expect(parsePins(JSON.stringify(['lib:new-chat']), lib, filePins)).toEqual([]);
    expect(parsePins(JSON.stringify(['file:0']), lib, [])).toEqual([]);
    // A malformed value is still null; a list stored before this change (bare library ids) still loads.
    expect(parsePins('nope', lib, filePins)).toBeNull();
    expect(parsePins(JSON.stringify([7]), lib, filePins)).toBeNull();
    expect(parsePins(JSON.stringify(['lib:snip', 'lib:thirds']), lib, filePins)).toEqual(['lib:snip', 'lib:thirds']);
  });

  it('swaps a key into a slot; a key already pinned elsewhere trades places', () => {
    expect(swapPin(['lib:a', 'lib:b', 'lib:c'], 1, 'lib:x')).toEqual(['lib:a', 'lib:x', 'lib:c']);
    expect(swapPin(['lib:a', 'lib:b', 'lib:c'], 0, 'lib:c')).toEqual(['lib:c', 'lib:b', 'lib:a']);
    expect(swapPin(['lib:a', 'lib:b'], 1, 'lib:b')).toEqual(['lib:a', 'lib:b']);
    expect(swapPin(['lib:a'], 3, 'lib:x')).toEqual(['lib:a', 'lib:x']);
    expect(swapPin(['lib:a', 'lib:b', 'lib:c', 'lib:d', 'lib:e'], 9, 'lib:x')).toHaveLength(5);
  });

  it('keeps an intentionally empty pin row and removes any slot', () => {
    expect(parsePins('[]', lib, [])).toEqual([]);
    expect(removePin(['lib:a', 'lib:b', 'lib:c'], 1)).toEqual(['lib:a', 'lib:c']);
    expect(removePin(['lib:a'], 0)).toEqual([]);
  });

  it('searches label, group and what a key does; empty groups drop out', () => {
    expect(searchLibrary(lib, '')).toHaveLength(17);
    expect(searchLibrary(lib, 'volume').flatMap((g) => g.keys.map((k) => k.id))).toEqual(expect.arrayContaining(['volume-up', 'volume-down', 'mixer']));
    expect(searchLibrary(lib, 'ZOOM').map((g) => g.id)).toEqual(['zoom']);
    expect(searchLibrary(lib, 'zzzzzz')).toEqual([]);
    expect(searchLibrary(lib, '  task manager ')[0].keys.map((k) => k.id)).toEqual(['task-manager']);
  });
});
