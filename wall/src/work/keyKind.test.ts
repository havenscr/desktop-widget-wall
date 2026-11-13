// @ts-ignore node's own file calls; this test reads the Rust contract as text.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { LIBRARY_DATA } from '../bridge/devMocks/libraryData';
import { ACTION_KIND, actionKind, GENERAL_SET, GROUP_KIND, KEY_KINDS, KIND_TOKEN, libKeyKind, pinKind, setKeyKind } from './keyKind';

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
  expect(pinKind('lib:thirds', { group: 'windows', action: 'layout:thirds' }, 'layout:thirds')).toBe('layout');
  expect(pinKind('lib:record-169', { group: 'windows', action: 'layout:record169' }, 'layout:record169')).toBe('capture');
  expect(pinKind('file:0', null, 'zen')).toBe('focus');
  expect(pinKind('file:1', null, null)).toBe('system');
});

it('the General set order equals Rust GENERAL_SET, and each key is in the group named', () => {
  const m = /const GENERAL_SET: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust);
  expect(m).not.toBeNull();
  const ids = [...m![1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]);
  expect(GENERAL_SET.map(([id]) => id)).toEqual(ids);
  for (const [id, group] of GENERAL_SET) expect(LIBRARY_DATA.find((g) => g.id === group)?.keys.some((k) => k.id === id), `${id} in ${group}`).toBe(true);
});
