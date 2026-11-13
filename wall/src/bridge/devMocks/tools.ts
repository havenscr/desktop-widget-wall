import { useToolsStore } from '../../tools/store';
import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the Tools drawer's knobs for review stills.
 *
 *   ?tools=1          open the drawer on load (`?tools=accounts` ringed at Accounts)
 *   ?keys=refused     `wall2_keys_summary` refuses the file with a long reason
 *   (`?source=default` is the existing knob for "no keys.json")
 *
 * With `?tools=` the build stamp is a fixed one, so the still reads like an installed build.
 * Registered after every other mock, so a knob wins. A no-op without knobs.
 */
export function registerToolsMocks(): void {
  if (!mocks.has('wall2_open_keys_file')) mocks.set('wall2_open_keys_file', () => undefined);
  if (knob('keys') === 'refused') {
    mocks.set('wall2_keys_summary', () => {
      throw 'app 3, key 7: chord is not in the allowed key list, so the whole file was refused and the built-in keys stay in use until it is fixed';
    });
  }
  const tools = knob('tools');
  if (!tools) return;
  mocks.set('wall2_build_info', () => ({ commit: '7c9f442', builtAt: '2026-11-13T16:17Z' }));
  // After the place the address names is open.
  setTimeout(() => useToolsStore.getState().openDrawer(tools === 'accounts' ? 'accounts' : null), 600);
}
