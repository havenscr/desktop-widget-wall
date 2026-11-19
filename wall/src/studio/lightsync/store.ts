import { create } from 'zustand';
import { lightSyncStart, lightSyncStatus, lightSyncStop, lightSyncTune } from '../../bridge/lightsync';
import { loadLightSync, saveLightSync } from '../../settings/settings';
import { targetTint } from '../../music/coverTint';
import { useNowPlayingStore } from '../../music/store';
import { useHome } from '../homeStore';
import { swatchFor } from '../moodRow';
import { resolvePalette, type LightSyncSettings, type LightSyncStatus, type PaletteContext, type PaletteId } from './model';

const hex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** The cover now playing, as the three colours the dancing lines already read from it (`music/coverTint.ts`); null with no cover playing. */
export function coverNow(): string[] | null {
  if (!useNowPlayingStore.getState().art) return null;
  const t = targetTint();
  return [t.left, t.centre, t.right].map(hex);
}

/** How often the status is read while sync is on. */
export const SYNC_POLL_MS = 2000;

export interface LightSyncState {
  palette: PaletteId;
  settings: LightSyncSettings;
  status: LightSyncStatus | null;
  /** A start is out. */
  starting: boolean;
  /** A stop is out. */
  stopping: boolean;
  /** The fixed word of the last failed start or stop; cleared by the next start. */
  failure: string | null;
  /** The start stopped Hue Sync: the chip's tip says so once. */
  hueNote: boolean;
  /** The office mood that was on when sync started (read from the home store), for Lights back. */
  remembered: string | null;
  /** The palette strip is open. */
  stripOpen: boolean;
  /** What the live palettes follow. */
  context: PaletteContext;
  start: () => Promise<void>;
  /** Ends sync and leaves the lights as the stop does (the Plays are restored by the bridge, the panels by the stop). */
  stop: () => Promise<void>;
  /** Stop, then apply the remembered mood (with none, the stop alone). */
  lightsBack: () => Promise<void>;
  /** A mood chip (id) or Off (null) was clicked: stops sync if it is on or coming on (no Lights back), then applies it. A click during a start or stop is queued; the last one wins. */
  choose: (id: string | null) => Promise<void>;
  /** The chip's own click. */
  toggle: () => Promise<void>;
  setPalette: (id: PaletteId) => void;
  openStrip: (open: boolean) => void;
  /** The tip asks once: true the first time after a start that stopped Hue Sync. */
  takeHueNote: () => boolean;
  poll: () => Promise<void>;
  setContext: (c: PaletteContext) => void;
}

export const isOn = (s: Pick<LightSyncState, 'starting' | 'status'>): boolean => s.starting || s.status?.running === true || s.status?.starting === true;

const word = (e: unknown): string => (typeof e === 'string' ? e : e instanceof Error ? e.message : 'failed');

let timer: ReturnType<typeof setInterval> | undefined;
/** How many mounted chips read the status; the timer runs only while one is mounted. */
let pollOwners = 0;
function pollWhile(on: boolean): void {
  if (on && pollOwners > 0 && timer === undefined) timer = setInterval(() => void useLightSync.getState().poll(), SYNC_POLL_MS);
  if (!on && timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

/** A chip mounts: it may poll. Returns the cleanup; the last owner to leave stops the timer. Safe across remounts. */
export function attachPoll(): () => void {
  pollOwners += 1;
  let released = false;
  if (isOn(useLightSync.getState())) pollWhile(true);
  return () => {
    if (released) return;
    released = true;
    pollOwners = Math.max(0, pollOwners - 1);
    if (pollOwners === 0) pollWhile(false);
  };
}

/** The user's last click on a mood or Off while sync was starting or stopping; it is applied once sync is down. The last click wins. */
let pendingChoice: { id: string | null } | undefined;
function drainChoice(): Promise<void> {
  const c = pendingChoice;
  pendingChoice = undefined;
  if (!c) return Promise.resolve();
  const st = useHome.getState();
  return c.id === null ? st.applyOff() : st.applyMood(c.id);
}

const fresh = () => {
  const saved = loadLightSync();
  return { palette: saved.palette, settings: saved.settings };
};

export const useLightSync = create<LightSyncState>((set, get) => ({
  ...fresh(),
  status: null,
  starting: false,
  stopping: false,
  failure: null,
  hueNote: false,
  remembered: null,
  stripOpen: false,
  context: {},
  async start() {
    const s = get();
    if (s.starting || s.stopping || isOn(s)) return;
    const lit = useHome.getState().moods?.moods.find((m) => m.active) ?? null;
    set({ starting: true, failure: null, hueNote: false, stripOpen: false, remembered: lit ? lit.id : null });
    try {
      const ctx: PaletteContext = { ...get().context, cover: coverNow(), mood: lit ? swatchFor(lit.id) : null };
      await lightSyncStart(resolvePalette(get().palette, ctx), get().settings);
      let status: LightSyncStatus | null = null;
      try {
        status = await lightSyncStatus();
      } catch {
        /* the next poll reads it */
      }
      set({ starting: false, status, hueNote: status?.stoppedHueSync === true, failure: status?.lastError ?? null });
      pollWhile(true);
      // A mood or Off was clicked while the start was out: it wins. Sync stops without Lights back, then it applies.
      if (pendingChoice) {
        await get().stop();
        if (get().failure === null) await drainChoice();
        else pendingChoice = undefined;
      }
    } catch (e) {
      set({ starting: false, failure: word(e), status: null, remembered: null });
      pollWhile(false);
      await drainChoice();
    }
  },
  async choose(id) {
    pendingChoice = { id };
    const s = get();
    // The start or stop in flight drains it when it ends.
    if (s.starting || s.stopping) return;
    if (isOn(s)) {
      await get().stop();
      if (get().failure !== null) {
        pendingChoice = undefined;
        return;
      }
    }
    await drainChoice();
  },
  async stop() {
    if (get().stopping) return;
    set({ stopping: true, stripOpen: false });
    pollWhile(false);
    try {
      await lightSyncStop(true);
      set({ status: null, failure: null, hueNote: false });
    } catch (e) {
      set({ failure: word(e) });
      // The stop failed: sync is still running, so the status keeps being read.
      pollWhile(isOn(get()));
    } finally {
      set({ stopping: false });
    }
  },
  async lightsBack() {
    const back = get().remembered;
    await get().stop();
    if (get().failure !== null) {
      pendingChoice = undefined;
      return;
    }
    set({ remembered: null });
    // A mood or Off clicked during the stop is the user's last action; it replaces Lights back.
    if (pendingChoice) {
      await drainChoice();
      return;
    }
    if (back !== null) await useHome.getState().applyMood(back);
  },
  async toggle() {
    const s = get();
    if (s.starting || s.stopping) return;
    if (isOn(s)) await s.lightsBack();
    else await s.start();
  },
  setPalette(id) {
    if (id === 'custom') return;
    set({ palette: id, stripOpen: false });
    saveLightSync({ palette: id, settings: get().settings });
    const s = get();
    if (isOn(s) && !s.starting) {
      const mood = s.remembered === null ? null : swatchFor(s.remembered);
      void lightSyncTune(resolvePalette(id, { ...s.context, cover: coverNow(), mood }), s.settings).catch(() => undefined);
    }
  },
  openStrip(open) {
    set({ stripOpen: open });
  },
  takeHueNote() {
    if (!get().hueNote) return false;
    set({ hueNote: false });
    return true;
  },
  async poll() {
    if (get().stopping) return;
    try {
      const status = await lightSyncStatus();
      if (get().starting || get().stopping || pollOwners === 0) return;
      const wasOn = get().status?.running === true;
      // Sync ended by itself (a lock, silence, a lost link): the chip goes dark, a lost link says why.
      if (wasOn && !status.running && !status.starting) {
        set({ status: null, failure: status.lastError, remembered: null });
        pollWhile(false);
        return;
      }
      set({ status });
      // Sync already running when the page opened (or started by a key): keep reading it.
      pollWhile(status.running || status.starting);
    } catch {
      /* the next poll tries again */
    }
  },
  setContext(c) {
    set({ context: c });
  },
}));

export function resetLightSync(): void {
  pollWhile(false);
  pendingChoice = undefined;
  useLightSync.setState({ ...fresh(), status: null, starting: false, stopping: false, failure: null, hueNote: false, remembered: null, stripOpen: false, context: {} });
}

// Album art: a new cover is read by the lines' own follower; a moment later the lights follow it.
let lastArt: string | null | undefined;
useNowPlayingStore.subscribe((n) => {
  if (n.art === lastArt) return;
  lastArt = n.art ?? null;
  setTimeout(() => {
    const s = useLightSync.getState();
    if (s.palette !== 'album' || !isOn(s) || s.starting) return;
    void lightSyncTune(resolvePalette('album', { cover: coverNow() }), s.settings).catch(() => undefined);
  }, 1500);
});
