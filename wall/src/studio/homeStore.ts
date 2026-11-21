import { create } from 'zustand';
import { useOnAirStore } from '../onair/store';
import { useSignalStore } from '../signals/store';
import * as api from './home';
import { homeWordOf, type GroupId, type HomeWord, type Moods, type Studio, type TokenStatus } from './home';
import { currentInfo, noteHomeKeys } from './keyLights';
import { queueHomeWrite, resetHomeQueue, watchHomeWrites } from './homeQueue';
import { NOTE_MS, useKeyLights } from './store';

/** Reads while a place that shows the home part is visible. */
export const HOME_READ_EVERY_MS = 60_000;
/** An offer goes away by itself after this long. */
export const OFFER_MS = 60_000;

export const TEXT = {
  roomDark: 'One room light stays on, so the room is never dark around the monitor.',
  busy: 'The home app is busy with another light change. Try again in a moment.',
  notAnswering: 'A light did not answer the home app. This shows what it reports now.',
  unreachable: 'The home app did not answer in time. This is what it reports now.',
  failed: 'The home app did not take that change. This is what it reports now.',
  homeNotSetUp: 'The home app has no desk token yet. Set the same token there.',
  forbidden: 'The home app refused the desk token. Type it again in Tools.',
  /** The wall's own check refused the click: nothing was sent. */
  refused: 'That is not offered right now. This is what the home app reports.',
  /** The home app no longer knows that preset, group, look or mood. */
  unknown: 'The home app no longer lists that one. This is what it reports now.',
  notSetUp: "Office moods are view only here. To switch them, add the desk token in Tools.",
  /** A write the wall tried anyway with no desk token: the 5 second line, short enough for the lights block's summary line. */
  writeNotSetUp: "View only here. Add the home app's desk token in Tools.",
  needsPrivate: 'The desk token goes only to this PC or a tailnet address.',
  nothingToUndo: 'Nothing to go back from. This is what the home app reports now.',
  /** Off refused because the studio is on air (the home app's "Studio on air"). */
  onAir: 'The studio is on air. End it with As before on On Air first.',
  /** A nudge with no mood on (the mood ended since the last read). */
  noMood: 'No mood is on. This is what the home app reports now.',
  /** A nudge down refused at the floor. */
  atFloor: 'At the floor. Dimmer stops here so the room stays bright enough to work.',
  /** A nudge up refused at full. */
  atMax: 'Already at full brightness.',
} as const;

/** The office moods row's own key for the Off chip in `applying` and `moodFail`. A hyphen is never in a mood id, so a mood named Off cannot collide. */
export const OFFICE_OFF = 'office-off';
/** The sentinel family for the Office mood nudge in `applying` and `moodFail`: `office-nudge-up` and `office-nudge-down`. No card shows the apply spinner for it. */
export const OFFICE_NUDGE = 'office-nudge';
/** Id of the Office row's injected Normal card. The home app's ids are letters and digits only, so a mood called Normal can never collide with it. */
export const MOOD_BACK_ID = '_normal';
/** After an Off write the lights' own report trails the write: the read that follows waits this long. */
export const OFF_READ_DELAY_MS = 1500;

/** What the page can show of the home half: not read yet, not offered here, not answering, or ready. */
export type HomeView = 'checking' | 'absent' | 'down' | 'ready';

/** The words for a read that says "this home app does not do studio lights (yet)". */
const ABSENT_WORDS: readonly HomeWord[] = ['not-configured', 'absent', 'studio-not-set-up'];

export interface Offer {
  /** `start`: nothing is set and something began. `stop`: a preset is on and something ended. */
  kind: 'start' | 'stop';
  /** What began or ended. */
  what: 'timer' | 'recording';
  /** The active preset's name when the offer was raised (a stop offer). */
  label: string | null;
}

export interface HomeState {
  studio: Studio | null;
  /** The word of the newest read that failed, or null while the newest read is good. */
  readWord: HomeWord | null;
  /** A first answer (good or not) has come. */
  readDone: boolean;
  note: string | null;
  /** An amber line kept until a write succeeds or the token changes. */
  sticky: 'home-not-set-up' | 'forbidden' | null;
  /** Home writes running or waiting (one runs at a time). */
  writes: number;
  /** The id of the preset or mood being applied, for its tile's waiting look. */
  applying: string | null;
  moods: Moods | null;
  moodsWord: HomeWord | null;
  moodsDone: boolean;
  /** A mood whose last apply failed: the word, for its chip's tip. */
  moodFail: { id: string; word: HomeWord } | null;
  offer: Offer | null;
  token: TokenStatus | null;
  readStudio: () => Promise<void>;
  readMoods: () => Promise<void>;
  applyPreset: (id: string) => Promise<void>;
  goNormal: () => Promise<void>;
  /** The As before chip of the Office moods row: the same call as `goNormal`, then the moods are read again. A 409 (no mood on) is a quiet no-op. */
  goBackFromMood: () => Promise<void>;
  setGroup: (id: GroupId, on: boolean, level?: number) => Promise<void>;
  applyLook: (id: string) => Promise<void>;
  applyMood: (id: string) => Promise<void>;
  /** Turns the office lights off (only when the last moods read offered Off). */
  applyOff: () => Promise<void>;
  /** One brightness step for the mood that is on: only the live level changes, the mood stays. */
  nudgeMood: (dir: 'up' | 'down') => Promise<void>;
  dismissOffer: () => void;
  refreshToken: () => Promise<void>;
  /** The token was saved or forgotten: the amber line goes and the studio is read again. */
  tokenChanged: () => Promise<void>;
}

let noteTimer: ReturnType<typeof setTimeout> | undefined;
let moodFailTimer: ReturnType<typeof setTimeout> | undefined;
let offerTimer: ReturnType<typeof setTimeout> | undefined;
let offReadTimer: ReturnType<typeof setTimeout> | undefined;
/** Until this time (ms) a poll, a join or a token change reads no moods: the lights' own report still trails an Off. */
let offHoldUntil = 0;
let studioGen = 0;
let moodsGen = 0;
let moodUsers = 0;
let moodTimer: ReturnType<typeof setInterval> | undefined;

export const useHome = create<HomeState>((set, get) => {
  const raise = (text: string) => {
    clearTimeout(noteTimer);
    set({ note: text });
    noteTimer = setTimeout(() => set({ note: null }), NOTE_MS);
  };
  const applyStudio = (s: Studio) => {
    studioGen++;
    const could = currentInfo().homeCanSet;
    noteHomeKeys(s.keys?.canSet === true);
    set({ studio: s, readWord: null, readDone: true });
    // The home app can now (or no longer) set the key lights: the key lights are read through the seam again.
    if (could !== (s.keys?.canSet === true)) void useKeyLights.getState().read();
  };
  const applyMoods = (m: Moods) => {
    moodsGen++;
    set({ moods: m, moodsWord: null, moodsDone: true });
  };

  const enqueue = (key: string, run: () => Promise<void>): Promise<void> =>
    queueHomeWrite(key, async () => {
      try {
        await run();
      } catch {
        // Every write handles its own words; nothing more to say here.
      }
    }, undefined);

  /** What to show and do after a write the home app did not take. */
  const afterStudioWord = async (w: HomeWord) => {
    switch (w) {
      case 'room-dark':
        raise(TEXT.roomDark);
        return;
      case 'home-not-set-up':
      case 'forbidden':
        set({ sticky: w });
        return;
      case 'busy':
        raise(TEXT.busy);
        break;
      case 'not-answering':
        raise(TEXT.notAnswering);
        break;
      case 'unreachable':
        raise(TEXT.unreachable);
        break;
      case 'failed':
        raise(TEXT.failed);
        break;
      case 'refused':
        raise(TEXT.refused);
        break;
      case 'unknown':
        raise(TEXT.unknown);
        break;
      case 'not-set-up':
        raise(TEXT.writeNotSetUp);
        break;
      case 'needs-private-address':
        raise(TEXT.needsPrivate);
        break;
      case 'nothing-to-undo':
        raise(TEXT.nothingToUndo);
        break;
      default:
        // Absent, not configured, not set up at the home app: the read that follows shows its own line.
        break;
    }
    await get().readStudio();
  };

  const studioWrite = (key: string, call: () => Promise<Studio>, opts: { keys?: boolean; applying?: string } = {}) =>
    enqueue(key, async () => {
      if (opts.applying) set({ applying: opts.applying });
      try {
        applyStudio(await call());
        set({ sticky: null });
        // The home app set the key lights too: the sliders show what the lights report now.
        if (opts.keys) void useKeyLights.getState().read();
      } catch (e) {
        await afterStudioWord(homeWordOf(e));
      } finally {
        if (opts.applying) set({ applying: null });
      }
    });

  /** One office mood write (a mood or Off). Ignored while a write of the page is running: a click queued behind a slow write would land long after it. */
  const moodWrite = (key: string, id: string, call: () => Promise<Moods>, delayRead = false): Promise<void> => {
    if (get().applying !== null) return Promise.resolve();
    return enqueue(key, async () => {
      set({ applying: id });
      try {
        applyMoods(await call());
        set({ sticky: null });
        // The answer is trusted; the lights' own report trails an Off, so the read that follows waits a moment.
        if (delayRead) {
          offHoldUntil = Date.now() + OFF_READ_DELAY_MS;
          clearTimeout(offReadTimer);
          offReadTimer = setTimeout(() => {
            if (moodUsers > 0) void get().readMoods();
          }, OFF_READ_DELAY_MS);
        }
      } catch (e) {
        const w = homeWordOf(e);
        if (w === 'home-not-set-up' || w === 'forbidden') set({ sticky: w });
        clearTimeout(moodFailTimer);
        set({ moodFail: { id, word: w } });
        moodFailTimer = setTimeout(() => set({ moodFail: null }), NOTE_MS);
        // The chip keeps what the home app reports now, not what was clicked.
        await get().readMoods();
      } finally {
        set({ applying: null });
      }
    });
  };

  return {
    studio: null,
    readWord: null,
    readDone: false,
    note: null,
    sticky: null,
    writes: 0,
    applying: null,
    moods: null,
    moodsWord: null,
    moodsDone: false,
    moodFail: null,
    offer: null,
    token: null,
    async readStudio() {
      const gen = ++studioGen;
      try {
        const s = await api.readStudio();
        if (gen !== studioGen) return;
        applyStudio(s);
      } catch (e) {
        if (gen !== studioGen) return;
        set({ readWord: homeWordOf(e), readDone: true });
      }
    },
    async readMoods() {
      const gen = ++moodsGen;
      try {
        const m = await api.readMoods();
        if (gen !== moodsGen) return;
        applyMoods(m);
      } catch (e) {
        if (gen !== moodsGen) return;
        set({ moodsWord: homeWordOf(e), moodsDone: true });
      }
    },
    applyPreset(id) {
      const setsKeys = get().studio?.presets.find((p) => p.id === id)?.setsKeyLights === true;
      return studioWrite(`preset:${id}`, () => api.applyPreset(id), { keys: setsKeys, applying: id });
    },
    goNormal() {
      return studioWrite('normal', () => api.goNormal(), { keys: true, applying: 'normal' });
    },
    goBackFromMood() {
      if (get().applying !== null) return Promise.resolve();
      return enqueue('normal', async () => {
        set({ applying: MOOD_BACK_ID });
        try {
          applyStudio(await api.goNormal());
          set({ sticky: null });
          void useKeyLights.getState().read();
        } catch (e) {
          const w = homeWordOf(e);
          // Nothing was on: nothing to go back from, and nothing to say about it.
          if (w !== 'nothing-to-undo') await afterStudioWord(w);
        } finally {
          set({ applying: null });
        }
        await get().readMoods();
      });
    },
    setGroup(id, on, level) {
      return studioWrite(`group:${id}`, () => api.setGroup(id, on, level));
    },
    applyLook(id) {
      return studioWrite(`look:${id}`, () => api.applyLook(id));
    },
    applyMood(id) {
      return moodWrite(`mood:${id}`, id, () => api.applyMood(id));
    },
    applyOff() {
      return moodWrite('office:off', OFFICE_OFF, () => api.applyOff(), true);
    },
    nudgeMood(dir) {
      return moodWrite(`office:nudge:${dir}`, `${OFFICE_NUDGE}-${dir}`, () => api.nudgeMood(dir));
    },
    dismissOffer() {
      clearTimeout(offerTimer);
      set({ offer: null });
    },
    async refreshToken() {
      try {
        set({ token: await api.readTokenStatus() });
      } catch {
        set({ token: { set: false, unreadable: true } });
      }
    },
    async tokenChanged() {
      set({ sticky: null });
      await get().refreshToken();
      await get().readStudio();
      if (moodUsers > 0) await readMoodsPolled();
    },
  };
});

// The page shows how many home writes are running or waiting (the queue is shared with the key light fallback).
watchHomeWrites((n) => useHome.setState({ writes: n }));

// Section: views

export function homeView(s: Pick<HomeState, 'studio' | 'readWord' | 'readDone'>): HomeView {
  if (!s.readDone) return 'checking';
  if (s.readWord && ABSENT_WORDS.includes(s.readWord)) return 'absent';
  if (s.readWord) return 'down';
  return s.studio ? 'ready' : 'down';
}

/** The home controls take clicks: a good read, and a token this PC may use. */
export function canChange(s: Pick<HomeState, 'studio' | 'readWord' | 'readDone'>): boolean {
  return homeView(s) === 'ready' && s.studio?.canWrite === true;
}

// Section: polling (one shared poll, a user count as `pollUserChange` in store.ts)

let pollUsers = 0;
let pollTimer: ReturnType<typeof setInterval> | undefined;

/** A screen that shows the home part joins (+1) or leaves (-1). A join reads at once; the poll runs while anyone is in. */
export function homePollChange(by: 1 | -1): void {
  const before = pollUsers;
  pollUsers = Math.max(0, pollUsers + by);
  // A screen that joins reads at once; an offer waiting for a surface is decided on that read.
  if (by === 1) void useHome.getState().readStudio().then(() => settleEdges());
  if (before === 0 && pollUsers > 0) pollTimer = setInterval(() => void useHome.getState().readStudio(), HOME_READ_EVERY_MS);
  if (pollUsers === 0) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

/** A moods read that waits out the hold after an Off write; the one read scheduled after the Off covers it. */
async function readMoodsPolled(): Promise<void> {
  if (Date.now() < offHoldUntil) return;
  await useHome.getState().readMoods();
}

/** Unwind joins while it is the shown place and awake: one read, then every 60 s. */
export function moodsPollChange(by: 1 | -1): void {
  const before = moodUsers;
  moodUsers = Math.max(0, moodUsers + by);
  if (by === 1) void readMoodsPolled();
  if (before === 0 && moodUsers > 0) moodTimer = setInterval(() => void readMoodsPolled(), HOME_READ_EVERY_MS);
  if (moodUsers === 0) {
    clearInterval(moodTimer);
    moodTimer = undefined;
  }
}

// Section: the offer

const ONAIR = 'onAir';
/** A timer start older than this is not offered on. */
const JUST_NOW_MS = 15_000;

/**
 * Raises the offer for a start or stop, when it makes sense: a good read, a token that may write,
 * a preset with id `onAir`, and (start) no preset on or (stop) a preset on. Never applies anything.
 */
export function raiseOffer(kind: 'start' | 'stop', what: 'timer' | 'recording'): void {
  const s = useHome.getState();
  if (!canChange(s) || !s.studio || !s.studio.presets.some((p) => p.id === ONAIR)) return;
  const active = s.studio.presets.find((p) => p.active) ?? null;
  if (kind === 'start' && active) return;
  if (kind === 'stop' && !active) return;
  clearTimeout(offerTimer);
  useHome.setState({ offer: { kind, what, label: active?.label ?? null } });
  offerTimer = setTimeout(() => useHome.setState({ offer: null }), OFFER_MS);
}

/** What began or ended, noted when it happens and decided when a studio surface has read the home app. */
interface Edge {
  kind: 'start' | 'stop';
  what: 'timer' | 'recording';
  at: number;
}

/** An edge nobody showed within this long is forgotten: it is no longer "just now". */
const EDGE_FRESH_MS = 15_000;
const pending: Partial<Record<Edge['what'], Edge>> = {};

let prevSaved = useOnAirStore.getState().saved;
let lastRecording = false;
let watching = false;

/** The page is hidden: nothing is read or offered. */
const hidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** Whether the world still matches an edge: a start that has since ended is no start. */
function stillTrue(e: Edge): boolean {
  if (e.what === 'recording') return useSignalStore.getState().recording === (e.kind === 'start');
  const running = useOnAirStore.getState().saved.running;
  return e.kind === 'start' ? running : !running;
}

/**
 * Raises the offer for edges that are still true and fresh, after a read. Called when a studio surface has
 * read the home app, never from a read nobody asked for.
 */
export function settleEdges(): void {
  for (const what of ['timer', 'recording'] as const) {
    const e = pending[what];
    if (!e) continue;
    if (Date.now() - e.at > EDGE_FRESH_MS || !stillTrue(e)) {
      delete pending[what];
      continue;
    }
    delete pending[what];
    raiseOffer(e.kind, e.what);
  }
}

async function onEdge(kind: Edge['kind'], what: Edge['what']) {
  if (hidden()) return;
  // The opposite edge makes the offer for this one obsolete, and an older edge of the same kind of thing.
  const shown = useHome.getState().offer;
  if (shown && shown.what === what && shown.kind !== kind) useHome.getState().dismissOffer();
  const edge: Edge = { kind, what, at: Date.now() };
  pending[what] = edge;
  // Only a shown studio surface reads: with none, the edge waits for one to show (a chip a moment later).
  if (pollUsers === 0) return;
  await useHome.getState().readStudio();
  if (pending[what] === edge) settleEdges();
}

/** Starts watching the show timer and the recording signal (read only), once. */
export function watchOffers(): void {
  if (watching) return;
  watching = true;
  prevSaved = useOnAirStore.getState().saved;
  lastRecording = useSignalStore.getState().recording;
  useOnAirStore.subscribe((s) => {
    const p = prevSaved;
    const n = s.saved;
    prevSaved = n;
    // Start, also carrying on after a Stop, that is only just now (not a timer restored from storage at launch).
    if (!p.running && n.running && n.startedAt !== null && Date.now() - n.startedAt <= JUST_NOW_MS) void onEdge('start', 'timer');
    // Stop (the button, or the timer stopping itself at 24 hours). Reset afterwards raises nothing: the stop was offered once.
    else if (p.running && !n.running) void onEdge('stop', 'timer');
  });
  useSignalStore.subscribe((s, prev) => {
    const r = s.recording;
    if (r === lastRecording) return;
    lastRecording = r;
    // The first answer after launch only says what was already so.
    if (!prev.known) return;
    void onEdge(r ? 'start' : 'stop', 'recording');
  });
}

watchOffers();

/** Tests only: back to nothing known. */
export function resetHome(): void {
  clearTimeout(noteTimer);
  clearTimeout(moodFailTimer);
  clearTimeout(offerTimer);
  clearTimeout(offReadTimer);
  offHoldUntil = 0;
  clearInterval(pollTimer);
  clearInterval(moodTimer);
  pollTimer = moodTimer = undefined;
  pollUsers = moodUsers = 0;
  resetHomeQueue();
  studioGen = moodsGen = 0;
  prevSaved = useOnAirStore.getState().saved;
  delete pending.timer;
  delete pending.recording;
  lastRecording = useSignalStore.getState().recording;
  useHome.setState({
    studio: null,
    readWord: null,
    readDone: false,
    note: null,
    sticky: null,
    writes: 0,
    applying: null,
    moods: null,
    moodsWord: null,
    moodsDone: false,
    moodFail: null,
    offer: null,
    token: null,
  });
}
