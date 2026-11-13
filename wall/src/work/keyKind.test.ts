// @ts-ignore node's own file calls; this test reads the Rust contract as text.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { ACTION_KIND, actionKind, GENERAL_SET, GROUP_KIND, KEY_KINDS, KIND_TOKEN, libIndex, libKeyKind, matchLibrary, normChord, pinKind, setKeyKind } from './keyKind';

const rust: string = readFileSync('../src-tauri/src/wall2_keylib.rs', 'utf8');

it('every library group maps to exactly one kind, and no kind is left over', () => {
  for (const g of LIBRARY_DATA) expect(KEY_KINDS, g.id).toContain(GROUP_KIND[g.id]);
  expect(Object.keys(GROUP_KIND).sort()).toEqual(LIBRARY_DATA.map((g) => g.id).sort());
  expect(Object.keys(KIND_TOKEN).sort()).toEqual([...KEY_KINDS].sort());
});

it('every wall action in the library and in the fixed list maps to one kind', () => {
  for (const g of LIBRARY_DATA)
    for (const k of g.keys) {
      if (k.action === null) continue;
      expect(actionKind(k.action), `${g.id}/${k.id} ${k.action}`).not.toBeNull();
    }
  for (const [a, kind] of Object.entries(ACTION_KIND)) expect(KEY_KINDS, a).toContain(kind);
  expect(actionKind('mood:evening')).toBe('system');
  expect(actionKind('nothing:here')).toBeNull();
});

it('Record 16:9 and the other capture keys are capture, whatever group they sit in', () => {
  expect(actionKind('layout:record169')).toBe('capture');
  expect(libKeyKind('windows', 'record-169', 'layout:record169')).toBe('capture');
  expect(libKeyKind('recording', 'rec-layout', 'layout:record169')).toBe('capture');
  expect(libKeyKind('anywhere', 'snip', null)).toBe('capture');
  expect(libKeyKind('powertoys', 'pt-ocr', null)).toBe('capture');
  expect(libKeyKind('windows', 'thirds', 'layout:thirds')).toBe('layout');
  expect(libKeyKind('anywhere', 'strip-dark', 'screens-off')).toBe('system');
  expect(libKeyKind('agents', 'open-waiting', 'agents:open-waiting')).toBe('agent');
  expect(libKeyKind('tasks', 'focus-25', 'focus:25')).toBe('focus');
  expect(libKeyKind('vscode', 'terminal', null)).toBe('app');
});

it('keys in sets: built-in sets by their group, the file own sets by their rule, actions by action', () => {
  expect(setKeyKind({ id: 'lib-vscode', general: false }, { action: null }, 0)).toBe('app');
  expect(setKeyKind({ id: 'lib-agents', general: false }, { action: null }, 0)).toBe('agent');
  expect(setKeyKind({ id: 'lib-recording', general: false }, { action: null }, 2)).toBe('capture');
  expect(setKeyKind({ id: 'lib-general', general: true }, { action: null }, 0)).toBe('capture');
  expect(setKeyKind({ id: 'lib-general', general: true }, { action: null }, 1)).toBe('system');
  // An unknown set from keys.json maps by its app set rule.
  expect(setKeyKind({ id: 'sales', general: false }, { action: null }, 0)).toBe('app');
  expect(setKeyKind({ id: 'general', general: true }, { action: null }, 0)).toBe('system');
  expect(setKeyKind({ id: 'general', general: true }, { action: 'focus:25' }, 4)).toBe('focus');
  expect(setKeyKind({ id: 'sales', general: false }, { action: 'layout:thirds' }, 0)).toBe('layout');
});

it('pins: a library key by its group, a keys.json pin by its action, else system', () => {
  expect(pinKind('lib:thirds', { group: 'windows', action: 'layout:thirds' }, { action: 'layout:thirds' })).toBe('layout');
  expect(pinKind('lib:record-169', { group: 'windows', action: 'layout:record169' }, { action: 'layout:record169' })).toBe('capture');
  expect(pinKind('file:0', null, { action: 'zen' })).toBe('focus');
  expect(pinKind('file:1', null, { action: null })).toBe('system');
  expect(pinKind('file:2', null, { action: null, label: 'snip' }, libIndex(LIBRARY_DATA))).toBe('capture');
});

it('the General set order equals Rust GENERAL_SET, and each key is in the group named', () => {
  const m = /const GENERAL_SET: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust);
  expect(m).not.toBeNull();
  const ids = [...m![1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]);
  expect(GENERAL_SET.map(([id]) => id)).toEqual(ids);
  for (const [id, group] of GENERAL_SET) expect(LIBRARY_DATA.find((g) => g.id === group)?.keys.some((k) => k.id === id), `${id} in ${group}`).toBe(true);
});

const lib = libIndex(LIBRARY_DATA);
const own = { id: 'mine', general: true };
const app = { id: 'sales', general: false };

it('a chord is compared in one spelling: modifier order and case do not matter, steps keep their order', () => {
  expect(normChord('Shift+Win+s')).toBe(normChord('Win+Shift+S'));
  expect(normChord('control+SHIFT+esc')).toBe(normChord('Ctrl+Shift+Esc'));
  expect(normChord('Alt+H, R')).toBe('alt+h,r');
  expect(normChord('Alt+H, R')).not.toBe(normChord('R, Alt+H'));
});

it('a keys.json key takes the kind of the library key with its chord first', () => {
  // Win+Shift+S is Snip in the library: capture, whatever the key is called.
  expect(matchLibrary({ label: 'My grab', chord: 'shift+win+S' }, lib)).toBe('capture');
  expect(setKeyKind(own, { action: null, label: 'My grab', chord: 'Shift+Win+S' }, 0, lib)).toBe('capture');
  // The chord wins over a label that names another library key.
  expect(setKeyKind(own, { action: null, label: 'Show desktop', chord: 'Win+Shift+S' }, 0, lib)).toBe('capture');
});

it('else the library key with its label, case-insensitive', () => {
  expect(setKeyKind(own, { action: null, label: 'snip' }, 0, lib)).toBe('capture');
  expect(setKeyKind(own, { action: null, label: 'SCREEN RECORDING' }, 1, lib)).toBe('capture');
  expect(setKeyKind(app, { action: null, label: 'Clipboard history' }, 0, lib)).toBe('system');
  // A chord that matches nothing falls through to the label.
  expect(setKeyKind(own, { action: null, label: 'Snip', chord: 'Ctrl+Alt+F9' }, 0, lib)).toBe('capture');
});

it('else the set rule, and a key that matches nothing keeps it; no library read means the set rule', () => {
  expect(setKeyKind(own, { action: null, label: 'Refresh the report', chord: 'Ctrl+Alt+F9' }, 0, lib)).toBe('system');
  expect(setKeyKind(app, { action: null, label: 'Refresh the report' }, 0, lib)).toBe('app');
  expect(setKeyKind(own, { action: null, label: 'Snip' }, 0, null)).toBe('system');
  expect(matchLibrary({ label: '' }, lib)).toBeNull();
});
