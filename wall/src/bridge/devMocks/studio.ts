import { mocks } from '../tauri';
import { knob } from './long';

/**
 * Dev only: the key light commands, for `npm run dev` in a plain browser and the gallery. Every
 * value is invented. The addresses a Tools form saves are checked loosely and then dropped: the
 * mock keeps only which sides are saved, as the native side's status does.
 *
 *   ?keys2=none|both|off|left-silent|right-silent|neither|other-model|mismatch|writefail|right-unset|right-unset-silent|unreadable
 *
 *   none          no address saved for either light (the day-one state, and the default)
 *   both          both saved, both on at 60 percent, 4400 K
 *   off           both saved, both off
 *   left-silent   the left light does not answer (right-silent: the right one)
 *   neither       both saved, neither answers
 *   other-model   both saved, both answer in a shape the wall does not know
 *   mismatch      left 60 percent at 4400 K, right 45 percent at 4700 K
 *   writefail     both answer reads, every write fails and the lights keep their values
 *   stuck         both answer, every write is accepted and the lights keep their values
 *   right-unset   only the left light has an address, and it works (right-unset-silent: it does not answer)
 *   unreadable    the saved addresses could not be read: nothing set, and Tools says so until an address is saved
 *
 * The home half (the home app's studio answer, its writes, the desk token, office moods):
 *
 *   ?studio=absent|notsetup|ready|onair|recording|changed|stale|nozone|threelooks|sixlooks|down|lost|slow
 *   ?studiowrite=ok|forbidden|homeunset|dark|busy|lights|unknown|unreachable|refused|private|notset|failed
 *   ?desktoken=unset|set|unreadable|insecure
 *   ?office=absent|empty|two|five|six|twelve|down
 *   ?officeoff=none|offered|on   ?officemood=<id>|none   ?officestale=1   ?officeslow=1
 *
 *   absent        the home app does not offer studio routes (the default: every older page is the day-one page)
 *   notsetup      the home app says the studio is not set up (the same quiet line as absent)
 *   ready         two presets, three room groups, two looks; nothing on
 *   onair         ready with the On air preset on, its look and key lights set
 *   recording     ready with the Recording preset on
 *   changed       On air is on and something was changed by hand
 *   stale         ready, but the home app could not read every light (Overhead not answering)
 *   nozone        ready, but Overhead needs a Hue zone
 *   threelooks    ready, with three panel looks (they fill one row of chips)
 *   sixlooks      ready, with six panel looks (the most the home app lists)
 *   down          the home app does not answer
 *   lost          reads are good until the sheet is opened (Fine tune); then the home app is gone
 *   slow          ready, but a preset answers after 3 seconds
 *   studiowrite   the answer of every write: ok (default), or the home app's refusal
 *   desktoken     unset (default): no token on this PC; set; unreadable; insecure: set, but the base may not carry it
 *   office        absent (default), empty, two, five, six or twelve moods (twelve with names near 40 characters and
 *                 lines near 120), or down
 *   officeoff     none (default: the answer has no `off`), offered (the Off chip), on (offered, and the lights are off)
 *   officemood    the id of the mood on at the start, or none (default)
 *   officestale   1: the moods answer says stale
 *   officeslow    1: a mood or Off write never answers (the in-flight look stays)
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

function start(kind: string | null): { left: Cell; right: Cell; failWrites: boolean; stuck: boolean; unreadable: boolean } {
  switch (kind) {
    case 'both':
      return { left: good(on()), right: good(on()), failWrites: false, stuck: false, unreadable: false };
    case 'off':
      return { left: good({ on: false, brightness: 40, kelvin: 3800 }), right: good({ on: false, brightness: 40, kelvin: 3800 }), failWrites: false, stuck: false, unreadable: false };
    case 'left-silent':
      return { left: silent(), right: good(on()), failWrites: false, stuck: false, unreadable: false };
    case 'right-silent':
      return { left: good(on()), right: silent(), failWrites: false, stuck: false, unreadable: false };
    case 'neither':
      return { left: silent(), right: silent('timeout'), failWrites: false, stuck: false, unreadable: false };
    case 'other-model':
      return { left: silent('other-model'), right: silent('other-model'), failWrites: false, stuck: false, unreadable: false };
    case 'mismatch':
      return { left: good(on(60, 4400)), right: good(on(45, 4700)), failWrites: false, stuck: false, unreadable: false };
    case 'stuck':
      return { left: good(on()), right: good(on()), failWrites: false, stuck: true, unreadable: false };
    case 'right-unset':
      return { left: good(on()), right: unset(), failWrites: false, stuck: false, unreadable: false };
    case 'right-unset-silent':
      return { left: silent(), right: unset(), failWrites: false, stuck: false, unreadable: false };
    case 'unreadable':
      return { left: unset(), right: unset(), failWrites: false, stuck: false, unreadable: true };
    case 'writefail':
      return { left: good(on()), right: good(on()), failWrites: true, stuck: false, unreadable: false };
    default:
      return { left: unset(), right: unset(), failWrites: false, stuck: false, unreadable: false };
  }
}

const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];

/** The page's view of one side: the light, or the fixed word. */
const reading = (c: Cell): Light | string => (!c.set ? 'not-set-up' : c.word ?? (c.light as Light));

/** The private ranges the native side accepts (10/8, 172.16/12, 192.168/16), loosely: enough to tell a good value from a bad one in a plain browser. */
const PRIVATE = /^(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}|192\.168\.\d{1,3})\.\d{1,3}$/;

// Section: the home half (invented values only)

type MockGroup = { id: string; label: string; on: boolean; setTo: string; colour: string | null; canSwitch: boolean; canDim: boolean; level: number; floor: number | null; reachable: boolean };

const PRESETS = [
  { id: 'onAir', label: 'On air', line: 'Key lights on, panels glow, monitor and overhead white', setsKeyLights: true },
  { id: 'recording', label: 'Recording', line: 'Room 80%, panels calm, key lights on, overhead white', setsKeyLights: true },
];
const LOOKS = [
  { id: 'glow', label: 'Glow' },
  { id: 'calm', label: 'Calm' },
];
const SIX_LOOKS = [
  { id: 'glow', label: 'Glow' },
  { id: 'calm', label: 'Calm' },
  { id: 'sunrise', label: 'Sunrise' },
  { id: 'ocean', label: 'Ocean waves' },
  { id: 'ember', label: 'Ember' },
  { id: 'aurora', label: 'Aurora' },
];
const MOODS = [
  { id: 'brightDesk', label: 'Bright desk', line: 'Room 70%, neon 20%' },
  { id: 'reading', label: 'Reading', line: 'Room 60%, desk lamp on' },
  { id: 'relax', label: 'Relax', line: 'Room 35%, neon 30%' },
  { id: 'gaming', label: 'Gaming', line: 'Room 25%, panels 10%' },
  { id: 'meeting', label: 'Meeting', line: 'Room 80%, desk lamp on' },
  { id: 'night', label: 'Night', line: 'Room 10%' },
];

/** Twelve moods with names near the native cap of 40 characters and lines near the cap of 120. */
const TWELVE = [
  ['brightDesk', 'Bright desk for the long afternoon sessions', 'Room 70%, neon 20%, desk lamp on, panels off, the window side kept low so the screen has no glare on it at all'],
  ['readLamp', 'Late evening reading with the lamp low', 'Room 35%, desk lamp on, neon off, panels warm and dim, the key lights stay off for the whole evening session'],
  ['windDown', 'Wind down before bed, slow and warm', 'Room 20%, neon 10%, panels amber, everything else off, and the room stays this way until it is switched'],
  ['gaming', 'Gaming with the panels turned up high', 'Room 25%, panels 60%, neon 40%, the desk lamp off so the glare stays off the monitor during long matches'],
  ['meeting', 'Camera ready for a long video call', 'Room 80%, desk lamp on, key lights on and matched, panels soft white so faces look even on the camera'],
  ['nightRun', 'Night run with only the neon showing', 'Room 5%, neon 30%, nothing else on, a quiet low glow that never lights the walls or the ceiling at all'],
  ['partyMusic', 'Music on, colours moving with the beat', 'Room 40%, panels cycle through the colour looks slowly, neon 50%, desk lamp off, no key lights at all'],
  ['softScreen', 'Easy on the eyes for a long screen day', 'Room 55%, panels pale and warm, desk lamp on low, the neon off, a steady light that never changes'],
  ['workDay', 'Plain bright working light, nothing fancy', 'Room 90%, desk lamp on, neon off, panels white, the whole office evenly lit for a normal working day'],
  ['calmMorning', 'Calm morning with the blinds still shut', 'Room 45%, panels warm, neon 15%, desk lamp on low, a soft start that never feels sharp or too bright'],
  ['stream', 'Live on stream, key lights and a clean wall', 'Room 60%, key lights on, panels in the stream look, neon 30%, the desk lamp off so the shot stays clean'],
  ['tidyUp', 'Tidy up with every light up and bright', 'Room 100%, every light on and bright so nothing is missed, switched back to a mood once the room is tidy'],
] as const;

const group = (id: string, label: string, on: boolean, level: number, over: Partial<MockGroup> = {}): MockGroup => ({
  id,
  label,
  on,
  setTo: on ? (id === 'panels' ? `Glow ${level}%` : `White ${level}%`) : 'Off',
  colour: id === 'panels' || !on ? null : '#fff1dd',
  canSwitch: true,
  canDim: true,
  level: on ? level : 0,
  floor: id === 'panels' ? null : 45,
  reachable: true,
  ...over,
});

function homeStart(kind: string | null) {
  const home = {
    kind: kind ?? 'absent',
    active: null as string | null,
    changed: false,
    look: 'glow',
    groups: [group('panels', 'Panels', false, 70), group('behindMonitor', 'Behind monitor', true, 80), group('overhead', 'Overhead', true, 90)] as MockGroup[],
    stale: false,
  };
  if (kind === 'onair' || kind === 'changed') {
    home.active = 'onAir';
    home.groups[0] = group('panels', 'Panels', true, 70);
    if (kind === 'changed') {
      home.changed = true;
      home.look = 'calm';
    }
  }
  if (kind === 'recording') {
    home.active = 'recording';
    home.groups[0] = group('panels', 'Panels', true, 50);
    home.look = 'calm';
  }
  if (kind === 'stale') {
    home.stale = true;
    home.groups[2] = group('overhead', 'Overhead', true, 90, { reachable: false });
  }
  if (kind === 'nozone') home.groups[2] = group('overhead', 'Overhead', false, 0, { canSwitch: false, canDim: false, setTo: 'Needs a Hue zone', floor: null });
  return home;
}

const validTokenText = (c: string): boolean => c.length >= 1 && c.length <= 256 && [...c].every((ch) => ch.charCodeAt(0) > 32 && ch.charCodeAt(0) < 127);

export function registerStudioMocks(): void {
  const state = start(knob('keys2'));
  const cell = (side: unknown): Cell => state[side as Side];
  const oneSide = (side: unknown): Side => {
    if (side !== 'left' && side !== 'right') throw 'refused';
    return side;
  };

  mocks.set('wall2_keylights_status', () => ({ left: { set: state.left.set }, right: { set: state.right.set }, unreadable: state.unreadable }));
  mocks.set('wall2_keylights_read', () => ({ left: reading(state.left), right: reading(state.right) }));
  mocks.set('wall2_keylights_set_address', (args) => {
    const side = oneSide(args?.side);
    if (typeof args?.address !== 'string' || !PRIVATE.test(args.address)) throw 'bad-address';
    state[side] = good(on());
    state.unreadable = false;
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
      if (state.stuck) {
        out[side] = { ...(c.light as Light) };
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
  registerHomeHalf(state);
}

type LightMock = { left: Cell; right: Cell };

function registerHomeHalf(keys: LightMock): void {
  const home = homeStart(knob('studio'));
  const looks = knob('studio') === 'sixlooks' ? SIX_LOOKS : knob('studio') === 'threelooks' ? SIX_LOOKS.slice(0, 3) : LOOKS;
  const writeKind = knob('studiowrite') ?? 'ok';
  const tokenKind = knob('desktoken') ?? 'unset';
  const token = { set: tokenKind === 'set' || tokenKind === 'insecure', unreadable: tokenKind === 'unreadable', insecure: tokenKind === 'insecure' };
  const officeKind = knob('office') ?? 'absent';
  const offKind = knob('officeoff') ?? 'none';
  const initialMood = knob('officemood');
  let activeMood: string | null = initialMood && initialMood !== 'none' ? initialMood : null;
  let offActive = offKind === 'on';
  const slowWrites = knob('officeslow') === '1';
  const moodSet = (): readonly { id: string; label: string; line: string }[] =>
    officeKind === 'empty'
      ? []
      : officeKind === 'two'
        ? MOODS.slice(0, 2)
        : officeKind === 'five'
          ? MOODS.slice(0, 5)
          : officeKind === 'twelve'
            ? TWELVE.map(([id, label, line]) => ({ id, label, line }))
            : MOODS;

  const block = (): 'not-set-up' | 'needs-private-address' | null => (!token.set ? 'not-set-up' : token.insecure ? 'needs-private-address' : null);
  const studio = () => ({
    ok: true,
    stale: home.stale,
    presets: PRESETS.map((p) => ({ ...p, active: home.active === p.id })),
    changed: home.changed,
    groups: home.groups.map((g) => ({ ...g })),
    keys: { canSet: false, left: null, right: null },
    looks: looks.map((l) => ({ ...l, active: home.active !== null && home.look === l.id })),
    canNormal: home.active !== null,
    normalLine: home.active !== null ? 'Goes back to how the room was before' : null,
    canWrite: block() === null,
    writeBlock: block(),
  });
  const moods = () => ({
    ok: true,
    stale: knob('officestale') === '1',
    moods: moodSet().map((m) => ({ ...m, active: activeMood === m.id })),
    ...(offKind === 'none' ? {} : { off: { offered: true, active: offActive && activeMood === null } }),
    canWrite: block() === null,
    writeBlock: block(),
  });
  const wordsFor: Record<string, string> = { forbidden: 'forbidden', homeunset: 'home-not-set-up', dark: 'room-dark', busy: 'busy', lights: 'not-answering', unknown: 'unknown', unreachable: 'unreachable', refused: 'refused', private: 'needs-private-address', notset: 'not-set-up', failed: 'failed', onair: 'on-air' };
  /** A write: refused without a token or on an unsafe base (nothing sent), else the review knob's answer. */
  const gate = (): void => {
    const b = block();
    if (b) throw b;
    if (writeKind !== 'ok' && wordsFor[writeKind]) throw wordsFor[writeKind];
  };
  const touchKeys = (on: boolean) => {
    for (const c of [keys.left, keys.right]) if (c.set && !c.word && c.light) c.light.on = on;
  };
  const read = (): Record<string, unknown> => {
    // `lost`: the home app is there until the sheet is opened, then it is not (the sheet's read finds it gone).
    if (home.kind === 'lost' && typeof document !== 'undefined' && document.querySelector('.st-drawer')) throw 'unreachable';
    if (home.kind === 'absent') throw 'absent';
    if (home.kind === 'notsetup') throw 'studio-not-set-up';
    if (home.kind === 'down') throw 'unreachable';
    return studio();
  };
  const markChanged = () => {
    if (home.active === 'onAir') home.changed = true;
  };

  mocks.set('wall2_studio', () => read());
  mocks.set('wall2_studio_preset', async (args) => {
    read();
    gate();
    if (home.kind === 'slow') await new Promise((r) => setTimeout(r, 3000));
    const id = String(args?.id);
    if (!PRESETS.some((p) => p.id === id)) throw 'refused';
    home.active = id;
    home.changed = false;
    home.look = id === 'onAir' ? 'glow' : 'calm';
    home.groups[0] = group('panels', 'Panels', true, id === 'onAir' ? 70 : 50);
    home.groups[1] = group('behindMonitor', 'Behind monitor', true, id === 'onAir' ? 80 : 80);
    touchKeys(true);
    return studio();
  });
  mocks.set('wall2_studio_normal', () => {
    read();
    gate();
    if (home.active === null) throw 'nothing-to-undo';
    home.active = null;
    home.changed = false;
    home.groups[0] = group('panels', 'Panels', false, 70);
    touchKeys(false);
    return studio();
  });
  mocks.set('wall2_studio_group', (args) => {
    read();
    gate();
    const g = home.groups.find((x) => x.id === args?.id);
    if (!g || !g.canSwitch) throw 'refused';
    const on = args?.on === true;
    if (!on && (g.id === 'behindMonitor' || g.id === 'overhead')) {
      const other = home.groups.find((x) => x.id !== g.id && x.id !== 'panels');
      if (!other || !other.on) throw 'room-dark';
    }
    const level = typeof args?.level === 'number' ? Math.round(args.level) : g.level || 70;
    const i = home.groups.indexOf(g);
    home.groups[i] = group(g.id, g.label, on, on ? Math.max(g.floor ?? 1, level) : 0);
    markChanged();
    return studio();
  });
  mocks.set('wall2_studio_look', (args) => {
    read();
    gate();
    const id = String(args?.id);
    if (!looks.some((l) => l.id === id)) throw 'refused';
    home.look = id;
    home.groups[0] = group('panels', 'Panels', true, home.groups[0].level || 70);
    if (home.active === null) home.active = null;
    markChanged();
    return studio();
  });
  mocks.set('wall2_studio_keys', () => {
    read();
    gate();
    throw 'refused';
  });
  mocks.set('wall2_office_moods', () => {
    if (officeKind === 'absent') throw 'absent';
    if (officeKind === 'down') throw 'unreachable';
    return moods();
  });
  mocks.set('wall2_office_mood', async (args) => {
    if (officeKind === 'absent') throw 'absent';
    if (officeKind === 'down') throw 'unreachable';
    gate();
    const id = String(args?.id);
    if (!moodSet().some((m) => m.id === id)) throw 'refused';
    if (slowWrites) await new Promise<never>(() => undefined);
    activeMood = id;
    offActive = false;
    return moods();
  });
  mocks.set('wall2_office_off', async () => {
    if (officeKind === 'absent') throw 'absent';
    if (officeKind === 'down') throw 'unreachable';
    gate();
    // Off is refused unless the home app offered it, as the native side does.
    if (offKind === 'none') throw 'refused';
    if (slowWrites) await new Promise<never>(() => undefined);
    activeMood = null;
    offActive = true;
    return moods();
  });

  mocks.set('wall2_desk_token_status', () => ({ set: token.set, unreadable: token.unreadable }));
  mocks.set('wall2_desk_token_set', (args) => {
    const t = typeof args?.token === 'string' ? args.token.trim() : '';
    if (!validTokenText(t)) throw 'invalid';
    // The value is dropped here: the mock keeps only that one is set, as the native status does.
    token.set = true;
    token.unreadable = false;
  });
  mocks.set('wall2_desk_token_forget', () => {
    token.set = false;
    token.unreadable = false;
    token.insecure = false;
  });
}

