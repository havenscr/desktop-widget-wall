/**
 * The kind of a deck key, which sets its colour: a soft wash, an edge and the icon in the
 * kind's colour (the app's own variables, no new hue). The kind comes from data (the library
 * group a key belongs to, the wall action it runs, or the set it sits in), never from its label.
 */
export type KeyKind = 'layout' | 'capture' | 'focus' | 'app' | 'agent' | 'system';

export const KEY_KINDS: readonly KeyKind[] = ['layout', 'capture', 'focus', 'app', 'agent', 'system'];

/** Each kind's colour variable, for the README and tests; the CSS carries the same numbers. */
export const KIND_TOKEN: Record<KeyKind, string> = {
  layout: '--cyan',
  capture: '--mag',
  focus: '--violet',
  app: '--mint',
  agent: '--amber',
  system: '--dim',
};

/** Library group id to kind. A group the page does not know is an app group (every new one so far is). */
export const GROUP_KIND: Record<string, KeyKind> = {
  anywhere: 'system',
  sound: 'system',
  windows: 'layout',
  teams: 'app',
  zoom: 'app',
  agents: 'agent',
  vscode: 'app',
  tasks: 'focus',
  browser: 'app',
  firefox: 'app',
  mail: 'app',
  recording: 'capture',
  powerbi: 'app',
  excel: 'app',
  house: 'system',
  powertoys: 'system',
};

/** Library keys that capture the screen, coloured as capture whatever group they sit in. */
export const CAPTURE_KEYS: ReadonlySet<string> = new Set(['snip', 'screen-recording', 'record-169', 'rec-layout', 'pt-ocr']);

/** Every wall action a key can run, to its kind. Record 16:9 is a layout, but it is coloured as capture. */
export const ACTION_KIND: Record<string, KeyKind> = {
  'layout:thirds': 'layout',
  'layout:focus': 'layout',
  'layout:zones': 'layout',
  'layout:undo': 'layout',
  'layout:record169': 'capture',
  'focus:start': 'focus',
  'focus:25': 'focus',
  'focus:50': 'focus',
  'focus:stop': 'focus',
  'tasks:open': 'focus',
  'task:first': 'focus',
  zen: 'focus',
  'agents:open-waiting': 'agent',
  'omnigent:front': 'agent',
  'meet:join-next': 'app',
  'event:open-next': 'app',
  mixer: 'system',
  'sonos:pause-all': 'system',
  'sonos:play-suggested': 'system',
  lock: 'system',
  'displays:off': 'system',
  'screens-off': 'system',
  dream: 'system',
};

/** The kind of a wall action, or null when the page does not know it. Every `mood:` action is a house key. */
export function actionKind(action: string): KeyKind | null {
  if (action.startsWith('mood:')) return 'system';
  return ACTION_KIND[action] ?? null;
}

/** A key of the built-in library, by its group and id (and its action, if it runs one). */
export function libKeyKind(groupId: string, keyId: string, action: string | null): KeyKind {
  if (CAPTURE_KEYS.has(keyId)) return 'capture';
  const byAction = action ? actionKind(action) : null;
  return byAction ?? GROUP_KIND[groupId] ?? 'app';
}

/**
 * The library keys of the built-in General set, in its order (Rust's `GENERAL_SET` in
 * `wall2_keylib.rs`; a test holds the two equal) with their groups.
 */
export const GENERAL_SET: readonly (readonly [string, string])[] = [
  ['snip', 'anywhere'],
  ['clipboard-history', 'anywhere'],
  ['task-manager', 'anywhere'],
  ['lock', 'anywhere'],
  ['displays-off', 'anywhere'],
  ['mute', 'sound'],
  ['play-pause', 'sound'],
  ['show-desktop', 'anywhere'],
];

/**
 * The kind of a key in a set of the Now row: a wall action by its action; a key of a built-in
 * set (`lib-<group>`) by its library group (the General set's keys by their place in it); a key
 * of the file's own sets by the set's rule: the general set is a system set, any other an app's.
 */
export function setKeyKind(set: { id: string; general: boolean }, key: { action: string | null }, index: number): KeyKind {
  const byAction = key.action ? actionKind(key.action) : null;
  if (byAction) return byAction;
  if (set.id === 'lib-general') {
    const hit = GENERAL_SET[index];
    return hit ? libKeyKind(hit[1], hit[0], null) : 'system';
  }
  if (set.id.startsWith('lib-')) return GROUP_KIND[set.id.slice(4)] ?? 'app';
  return set.general ? 'system' : 'app';
}

/** A pin of the Always here row: a library key by its group, a keys.json pin by its action, else a system key. */
export function pinKind(ref: string, lib: { group: string; action: string | null } | null, action: string | null): KeyKind {
  if (ref.startsWith('lib:') && lib) return libKeyKind(lib.group, ref.slice(4), lib.action);
  return (action ? actionKind(action) : null) ?? 'system';
}
