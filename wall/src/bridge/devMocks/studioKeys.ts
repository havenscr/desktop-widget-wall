import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the studio keys commands, for `npm run dev` and the gallery.
 *
 *   ?skeys=set|unset     (default `set`)   whether keys.json has chords for the studio keys
 *   ?swin=picked|none|minimized|gone       (default `picked`)   the studio window pick
 */
const NAMES = ['solo', 'two', 'share', 'golive', 'end'];

export function registerStudioKeysMocks(): void {
  const state = () => knob('swin') ?? 'picked';
  const keys = () => (knob('skeys') === 'unset' ? [] : ['solo', 'two', 'golive', 'end']);
  mocks.set('wall2_studio_pick_start', () => ({ state: 'waiting' }));
  mocks.set('wall2_studio_pick_status', () => ({ state: state(), browser: state() === 'none' ? null : 'firefox', keys: keys() }));
  mocks.set('wall2_studio_key', (args) => {
    const key = String(args?.key);
    if (!NAMES.includes(key) || !keys().includes(key)) throw 'not set up';
    if ((key === 'golive' || key === 'end') && args?.confirm !== true) throw 'needs confirm';
    if (state() === 'none') throw 'no studio window';
    if (state() === 'gone') throw 'gone';
    return { sent: key, at: Date.now() };
  });
}
