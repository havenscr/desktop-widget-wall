import type { Icon } from '@tabler/icons-react';
import { RECORDING_KEYS, recordingKeyTip } from '../signals/recordingKeys';
import { allKeys, type LibGroup } from '../work/libraryModel';

/** A key as On Air draws it, everything taken from the key library (and, for the recorder's keys, the recording mode's shared definitions). */
export interface ResolvedKey {
  id: string;
  label: string;
  /** The library group, for the colour (keyKind.ts). */
  group: string;
  /** The wall action the key runs, or null for a key Rust sends. */
  action: string | null;
  /** The library's icon name, drawn as the deck draws it; a recording key brings its own. */
  icon: string;
  recordingIcon: Icon | null;
  where: { name: string; general: boolean };
  tip: string;
}

/** The key with this id from the library, or null when the library has none (or one that cannot run). */
export function resolveKey(id: string, lib: readonly LibGroup[]): ResolvedKey | null {
  const hit = allKeys(lib).get(id);
  if (!hit || !hit.key.runnable || hit.key.kind === 'soon') return null;
  const { key, group } = hit;
  const rk = RECORDING_KEYS.find((r) => r.id === id);
  // The recorder's own keys say where they go the way recording mode says it; any other key goes
  // to the program of its group, or the app in front when its group is for any program.
  const where = rk ? { name: rk.to, general: rk.to === 'the app in front' } : { name: group.exes.length > 0 ? group.title : 'the app in front', general: group.exes.length === 0 };
  const text = rk ? recordingKeyTip(rk, key.how) : `${key.label}${group.exes.length > 0 ? ` (${group.title})` : ''}${key.kind === 'check' ? ', a shortcut to check on your PC' : ''}. ${key.how}.`;
  return { id, label: key.label, group: group.id, action: key.action, icon: key.icon, recordingIcon: rk?.icon ?? null, where, tip: text };
}
