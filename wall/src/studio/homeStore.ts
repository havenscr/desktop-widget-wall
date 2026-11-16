import { create } from 'zustand';
import { useOnAirStore } from '../onair/store';
import { useSignalStore } from '../signals/store';
import * as api from './home';
import { homeWordOf, type GroupId, type HomeWord, type Moods, type Studio, type TokenStatus } from './home';
import { noteHomeKeys } from './keyLights';
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
} as const;

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
  setGroup: (id: GroupId, on: boolean, level?: number) => Promise<void>;
  applyLook: (id: string) => Promise<void>;
  applyMood: (id: string) => Promise<void>;
  dismissOffer: () => void;
  refreshToken: () => Promise<void>;
  /** The token was saved or forgotten: the amber line goes and the studio is read again. */
  tokenChanged: () => Promise<void>;
}

let noteTimer: ReturnType<typeof setTimeout> | undefined;
let moodFailTimer: ReturnType<typeof setTimeout> | undefined;
let offerTimer: ReturnType<typeof setTimeout> | undefined;
let studioGen = 0;
let moodsGen = 0;

/** One write runs at a time; a write waiting for its turn is replaced by a newer one with the same key. */
const queue: { key: string; run: () => Promise<void>; done: () => void }[] = [];
let draining = false;

export const useHome = create<HomeState>((set, get) => {
  const raise = (text: string) => {
    clearTimeout(noteTimer);
    set({ note: text });
    noteTimer = setTimeout(() => set({ note: null }), NOTE_MS);
  };
  const applyStudio = (s: Studio) => {
    studioGen++;
    noteHomeKeys(s.keys?.canSet === true);
    set({ studio: s, readWord: null, readDone: true });
  };
  const applyMoods = (m: Moods) => {
    moodsGen++;
    set({ moods: m, moodsWord: null, moodsDone: true });
  };

  const enqueue = (key: string, run: () => Promise<void>): Promise<void> =>
    new Promise<void>((resolve) => {
      const job = async () => {
        try {
          await run();
        } finally {
          resolve();
        }
      };
      const waiting = queue.findIndex((q) => q.key === key);
      if (waiting >= 0) {
        // A newer click for the same control replaces the one that has not started; the older one is done.
        queue[waiting].done();
        queue[waiting] = { key, run: job, done: resolve };
        return;
      }
      queue.push({ key, run: job, done: resolve });
      set((s) => ({ writes: s.writes + 1 }));
      if (!draining) void drain();
    });
  const drain = async () => {
    draining = true;
    try {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) await next.run();
        set((s) => ({ writes: Math.max(0, s.writes - 1) }));
      }
    } finally {
      draining = false;
    }
  };

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
      default:
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
    setGroup(id, on, level) {
      return studioWrite(`group:${id}`, () => api.setGroup(id, on, level));
    },
    applyLook(id) {
      return studioWrite(`look:${id}`, () => api.applyLook(id));
    },
    applyMood(id) {
      return enqueue(`mood:${id}`, async () => {
        set({ applying: id });
        try {
          applyMoods(await api.applyMood(id));
          set({ sticky: null });
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
    },
  };
});

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
  if (by === 1) void useHome.getState().readStudio();
  if (before === 0 && pollUsers > 0) pollTimer = setInterval(() => void useHome.getState().readStudio(), HOME_READ_EVERY_MS);
  if (pollUsers === 0) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

let moodUsers = 0;
let moodTimer: ReturnType<typeof setInterval> | undefined;

/** Unwind joins while it is the shown place and awake: one read, then every 60 s. */
export function moodsPollChange(by: 1 | -1): void {
  const before = moodUsers;
  moodUsers = Math.max(0, moodUsers + by);
  if (by === 1) void useHome.getState().readMoods();
  if (before === 0 && moodUsers > 0) moodTimer = setInterval(() => void useHome.getState().readMoods(), HOME_READ_EVERY_MS);
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

let lastRunning = false;
let lastRecording = false;
let watching = false;

/** The page is hidden: nothing is read or offered. */
const hidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

async function onEdge(kind: 'start' | 'stop', what: 'timer' | 'recording') {
  if (hidden()) return;
  // One fresh read decides: the state may be old when nothing on screen has been polling.
  await useHome.getState().readStudio();
  raiseOffer(kind, what);
}

/** Starts watching the show timer and the recording signal (read only), once. */
export function watchOffers(): void {
  if (watching) return;
  watching = true;
  lastRunning = useOnAirStore.getState().saved.running;
  lastRecording = useSignalStore.getState().recording;
  useOnAirStore.subscribe((s) => {
    const r = s.saved.running;
    if (r === lastRunning) return;
    lastRunning = r;
    // A timer restored from storage at launch started long ago: that is not "just now".
    if (r && (s.saved.startedAt === null || Date.now() - s.saved.startedAt > JUST_NOW_MS)) return;
    void onEdge(r ? 'start' : 'stop', 'timer');
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
  clearInterval(pollTimer);
  clearInterval(moodTimer);
  pollTimer = moodTimer = undefined;
  pollUsers = moodUsers = 0;
  queue.length = 0;
  draining = false;
  studioGen = moodsGen = 0;
  lastRunning = useOnAirStore.getState().saved.running;
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
