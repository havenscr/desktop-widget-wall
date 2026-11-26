import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the studio keys commands, for `npm run dev` and the gallery.
 *
 *   ?swin=picked|none|several|minimized       (default `picked`)   the studio window pick
 */
const NAMES = ['solo', 'two', 'share', 'golive', 'end'];

export function registerStudioKeysMocks(): void {
  const state = () => knob('swin') ?? 'picked';
  mocks.set('wall2_studio_pick_start', () => ({ state: 'waiting' }));
  mocks.set('wall2_studio_pick_status', () => ({ state: state(), browser: state() === 'none' || state() === 'several' ? null : 'firefox', studio: true }));
  mocks.set('wall2_studio_key', (args) => {
    const key = String(args?.key);
    if (!NAMES.includes(key)) throw 'not set up';
    if ((key === 'golive' || key === 'end') && args?.confirm !== true) throw 'needs confirm';
    if (state() === 'none' || state() === 'several') throw 'no studio window';
    if (state() === 'gone') throw 'gone';
    return { sent: key, at: Date.now() };
  });
}
