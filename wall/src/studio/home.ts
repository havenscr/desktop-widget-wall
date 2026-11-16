import { invoke } from '../bridge/tauri';

/**
 * The home half of studio lights: the home app's presets, room light groups, panel looks and office
 * moods, through the native commands in `wall2_studio.rs`. The page never holds an address or the desk
 * token; every answer is checked again here, and every failure is one fixed word.
 */

/** The fixed words the native side answers with (see the table in `wall/README.md`). */
export const HOME_WORDS = [
  'not-configured',
  'absent',
  'not-set-up',
  'needs-private-address',
  'forbidden',
  'studio-not-set-up',
  'home-not-set-up',
  'not-answering',
  'room-dark',
  'nothing-to-undo',
  'on-air',
  'busy',
  'unknown',
  'refused',
  'unreachable',
  'failed',
  /** The desk token command's own word: the value broke the rule. */
  'invalid',
] as const;
export type HomeWord = (typeof HOME_WORDS)[number];

export type GroupId = 'panels' | 'behindMonitor' | 'overhead';
export const GROUP_IDS: readonly GroupId[] = ['panels', 'behindMonitor', 'overhead'];

export interface Preset {
  id: string;
  label: string;
  line: string | null;
  active: boolean;
  setsKeyLights: boolean;
}
export interface Group {
  id: GroupId;
  label: string;
  on: boolean;
  setTo: string | null;
  colour: string | null;
  canSwitch: boolean;
  canDim: boolean;
  level: number | null;
  floor: number | null;
  reachable: boolean;
}
export interface Look {
  id: string;
  label: string;
  active: boolean;
}
export interface Mood {
  id: string;
  label: string;
  line: string | null;
  active: boolean;
}
/** What the home app says its key lights are, for the seam's `home` back end. */
export interface HomeKeyLight {
  on: boolean;
  brightness: number;
  kelvin: number;
}
export type HomeKeySide = HomeKeyLight | 'no-answer' | 'other-model' | null;
export interface HomeKeys {
  canSet: boolean;
  left: HomeKeySide;
  right: HomeKeySide;
}
export type WriteBlock = 'not-set-up' | 'needs-private-address';
export interface Studio {
  stale: boolean;
  presets: Preset[];
  changed: boolean;
  groups: Group[];
  keys: HomeKeys | null;
  looks: Look[];
  canNormal: boolean;
  normalLine: string | null;
  canWrite: boolean;
  writeBlock: WriteBlock | null;
}
export interface Moods {
  stale: boolean;
  moods: Mood[];
  /** Present only when the home app offers Off (its `off.offered` is `true`); `active` is the office lights being off now. */
  off: { active: boolean } | null;
  canWrite: boolean;
  writeBlock: WriteBlock | null;
}
export interface TokenStatus {
  set: boolean;
  unreadable: boolean;
}

/** The word in an error from a command (Tauri rejects with the string itself). */
export function homeWordOf(e: unknown): HomeWord {
  const text = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
  return (HOME_WORDS as readonly string[]).includes(text) ? (text as HomeWord) : 'failed';
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const bool = (v: unknown): boolean => v === true;
const pct = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100 ? v : null);
const block = (v: unknown): WriteBlock | null => (v === 'not-set-up' || v === 'needs-private-address' ? v : null);

function keySide(v: unknown): HomeKeySide {
  if (v === 'no-answer' || v === 'other-model') return v;
  const o = obj(v);
  if (o && typeof o.on === 'boolean' && typeof o.brightness === 'number' && typeof o.kelvin === 'number' && Number.isFinite(o.brightness) && Number.isFinite(o.kelvin)) {
    return { on: o.on, brightness: Math.round(o.brightness), kelvin: Math.round(o.kelvin) };
  }
  return null;
}

/** The studio answer, checked again; null when it is not that shape at all. */
export function studioOf(raw: unknown): Studio | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.presets) || !Array.isArray(o.groups)) return null;
  const presets: Preset[] = [];
  for (const p of o.presets) {
    const r = obj(p);
    const id = str(r?.id);
    const label = str(r?.label);
    if (r && id && label) presets.push({ id, label, line: str(r.line), active: bool(r.active), setsKeyLights: bool(r.setsKeyLights) });
  }
  const groups: Group[] = [];
  for (const g of o.groups) {
    const r = obj(g);
    const id = r?.id;
    const label = str(r?.label);
    if (r && label && (GROUP_IDS as readonly unknown[]).includes(id)) {
      groups.push({
        id: id as GroupId,
        label,
        on: bool(r.on),
        setTo: str(r.setTo),
        colour: typeof r.colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.colour) ? r.colour : null,
        canSwitch: bool(r.canSwitch),
        canDim: bool(r.canDim),
        level: pct(r.level),
        floor: pct(r.floor),
        reachable: bool(r.reachable),
      });
    }
  }
  const looks: Look[] = [];
  if (Array.isArray(o.looks)) {
    for (const l of o.looks) {
      const r = obj(l);
      const id = str(r?.id);
      const label = str(r?.label);
      if (r && id && label) looks.push({ id, label, active: bool(r.active) });
    }
  }
  const k = obj(o.keys);
  return {
    stale: o.stale !== false,
    presets,
    changed: bool(o.changed),
    groups,
    keys: k ? { canSet: bool(k.canSet), left: keySide(k.left), right: keySide(k.right) } : null,
    looks,
    canNormal: bool(o.canNormal),
    normalLine: str(o.normalLine),
    canWrite: bool(o.canWrite),
    writeBlock: block(o.writeBlock),
  };
}

export function moodsOf(raw: unknown): Moods | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.moods)) return null;
  const moods: Mood[] = [];
  for (const m of o.moods) {
    const r = obj(m);
    const id = str(r?.id);
    const label = str(r?.label);
    if (r && id && label) moods.push({ id, label, line: str(r.line), active: bool(r.active) });
  }
  const off = obj(o.off);
  return { stale: o.stale !== false, moods, off: off ? { active: bool(off.active) } : null, canWrite: bool(o.canWrite), writeBlock: block(o.writeBlock) };
}

async function studio(command: string, args?: Record<string, unknown>): Promise<Studio> {
  const s = studioOf(await invoke(command, args));
  if (!s) throw 'failed';
  return s;
}

async function moods(command: string, args?: Record<string, unknown>): Promise<Moods> {
  const m = moodsOf(await invoke(command, args));
  if (!m) throw 'failed';
  return m;
}

export const readStudio = () => studio('wall2_studio');
export const applyPreset = (id: string) => studio('wall2_studio_preset', { id });
export const goNormal = () => studio('wall2_studio_normal');
export const setGroup = (id: GroupId, on: boolean, level?: number) => studio('wall2_studio_group', level === undefined ? { id, on } : { id, on, level: Math.round(level) });
export const applyLook = (id: string) => studio('wall2_studio_look', { id });
export const setHomeKeys = (which: 'left' | 'right' | 'both', patch: { on?: boolean; brightness?: number; kelvin?: number }) => studio('wall2_studio_keys', { which, ...patch });
export const readMoods = () => moods('wall2_office_moods');
export const applyMood = (id: string) => moods('wall2_office_mood', { id });
export const applyOff = () => moods('wall2_office_off');

export async function readTokenStatus(): Promise<TokenStatus> {
  const o = obj(await invoke('wall2_desk_token_status'));
  return { set: o?.set === true, unreadable: o?.unreadable === true };
}
export const saveToken = (token: string): Promise<void> => invoke('wall2_desk_token_set', { token });
export const forgetToken = (): Promise<void> => invoke('wall2_desk_token_forget');
