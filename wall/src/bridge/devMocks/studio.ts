import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the key light commands, for `npm run dev` in a plain browser and the gallery. Every
 * value is invented. The addresses a Tools form saves are checked loosely and then dropped: the
 * mock keeps only which sides are saved, as the native side's status does.
 *
 *   ?keys2=none|both|off|left-silent|right-silent|neither|other-model|mismatch|writefail
 *
 *   none          no address saved for either light (the day-one state, and the default)
 *   both          both saved, both on at 60 percent, 4400 K
 *   off           both saved, both off
 *   left-silent   the left light does not answer (right-silent: the right one)
 *   neither       both saved, neither answers
 *   other-model   both saved, both answer in a shape the wall does not know
 *   mismatch      left 60 percent at 4400 K, right 45 percent at 4700 K
 *   writefail     both answer reads, every write fails and the lights keep their values
 */

interface Light {
  on: boolean;
  brightness: number;
  kelvin: number;
}
type Cell = { set: boolean; light: Light | null; word: string | null };

const on = (brightness = 60, kelvin = 4400): Light => ({ on: true, brightness, kelvin });
const good = (light: Light): Cell => ({ set: true, light, word: null });
const silent = (word = 'no-answer'): Cell => ({ set: true, light: on(), word });
const unset = (): Cell => ({ set: false, light: null, word: null });

function start(kind: string | null): { left: Cell; right: Cell; failWrites: boolean } {
  switch (kind) {
    case 'both':
      return { left: good(on()), right: good(on()), failWrites: false };
    case 'off':
      return { left: good({ on: false, brightness: 40, kelvin: 3800 }), right: good({ on: false, brightness: 40, kelvin: 3800 }), failWrites: false };
    case 'left-silent':
      return { left: silent(), right: good(on()), failWrites: false };
    case 'right-silent':
      return { left: good(on()), right: silent(), failWrites: false };
    case 'neither':
      return { left: silent(), right: silent('timeout'), failWrites: false };
    case 'other-model':
      return { left: silent('other-model'), right: silent('other-model'), failWrites: false };
    case 'mismatch':
      return { left: good(on(60, 4400)), right: good(on(45, 4700)), failWrites: false };
    case 'writefail':
      return { left: good(on()), right: good(on()), failWrites: true };
    default:
      return { left: unset(), right: unset(), failWrites: false };
  }
}

const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];

/** The page's view of one side: the light, or the fixed word. */
const reading = (c: Cell): Light | string => (!c.set ? 'not-set-up' : c.word ?? (c.light as Light));

/** The private ranges the native side accepts (10/8, 172.16/12, 192.168/16), loosely: enough to tell a good value from a bad one in a plain browser. */
const PRIVATE = /^(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}|192\.168\.\d{1,3})\.\d{1,3}$/;

export function registerStudioMocks(): void {
  const state = start(knob('keys2'));
  const cell = (side: unknown): Cell => state[side as Side];
  const oneSide = (side: unknown): Side => {
    if (side !== 'left' && side !== 'right') throw 'refused';
    return side;
  };

  mocks.set('wall2_keylights_status', () => ({ left: { set: state.left.set }, right: { set: state.right.set } }));
  mocks.set('wall2_keylights_read', () => ({ left: reading(state.left), right: reading(state.right) }));
  mocks.set('wall2_keylights_set_address', (args) => {
    const side = oneSide(args?.side);
    if (typeof args?.address !== 'string' || !PRIVATE.test(args.address)) throw 'bad-address';
    state[side] = good(on());
  });
  mocks.set('wall2_keylights_forget', (args) => {
    state[oneSide(args?.side)] = unset();
  });
  mocks.set('wall2_keylights_test', (args) => {
    const c = cell(oneSide(args?.side));
    if (!c.set) throw 'not-set-up';
    if (c.word) throw c.word;
    return c.light;
  });
  mocks.set('wall2_keylights_set', (args) => {
    const target = args?.side;
    const sides: Side[] = target === 'both' ? ['left', 'right'] : [oneSide(target)];
    const out: Record<Side, Light | string | null> = { left: null, right: null };
    for (const side of sides) {
      const c = state[side];
      if (!c.set) {
        out[side] = 'not-set-up';
        continue;
      }
      if (c.word) {
        out[side] = c.word;
        continue;
      }
      if (state.failWrites) {
        out[side] = 'failed';
        continue;
      }
      const l = c.light as Light;
      if (typeof args?.on === 'boolean') l.on = args.on;
      if (typeof args?.brightness === 'number') l.brightness = Math.min(100, Math.max(3, Math.round(args.brightness)));
      if (typeof args?.kelvin === 'number') l.kelvin = Math.min(7000, Math.max(2900, Math.round(args.kelvin / 50) * 50));
      out[side] = { ...l };
    }
    return out;
  });
}
