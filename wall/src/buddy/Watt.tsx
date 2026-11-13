import { IconMusic } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { agentsStale, useAgentStatusLine, useAgentsStore, useAgentsWaiting } from '../agents/useAgents';
import { audioBeats, useAudioStore } from '../audio/store';
import { invoke } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { frameDelta, shouldDraw } from '../horizon/pacing';
import { cameraSignal, subscribeCamera } from '../horizon/signal';
import { useNowPlayingStore } from '../music/store';
import { usePlaceStore } from '../state/places';
import { reviewNow } from '../ui/reviewClock';
import { useIdle } from '../ui/useIdle';
import { useReducedMotion } from '../ui/useReducedMotion';
import { useWeather } from '../weather/useWeather';
import { useNextMeeting } from '../work/useNextMeeting';
import { BUBBLE_MS, CHECK_MS, createChat, lineFrom, markSpoken, nextBubble, quietNow, type Chatty, type Quiet, type Talk } from './chatter';
import type { Topic } from './lines';
import {
  NOTE_SIZES,
  WALKS,
  cameraOf,
  cameraReady,
  createClock,
  createDrift,
  createPresence,
  driftAt,
  isIdle,
  readClock,
  spriteHeight,
  spriteWidth,
  stepPresence,
  wattPlaceFor,
  wanderAt,
  createWander,
} from './model';
import { PetCard } from './PetCard';
import {
  HEARTS_S,
  MARK_HIT,
  REACT_S,
  bubbleSize,
  cloverBox,
  createBox,
  createBubblePlace,
  createMind,
  createPetFrame,
  holdsStill,
  markBox,
  petFrame,
  placeBubble,
  wrapLine,
  type Mind,
  type ReactKind,
} from './petFrame';
import { PixelSvg, PropSvg, SheepSvg } from './Pixels';
import { bump, dayKey, loadPet, moodOf, rollDay, savePet, type Cosmetic, type PetData } from './pet';
import { CLOVER_WAIT_MS, cloverTimes, dayTopic, finishedBetween, midday, moonUp, senseWeather, weatherTopics, workingIds } from './senses';
import { CLOVER, HEART, MARK, SMALL_PX, SPRITE_PX, type Pose, type Prop } from './sprites';
import './watt.css';

export { SheepSvg } from './Pixels';

/** Shortest time between two beat bobs, milliseconds: well under the calm limit of three moves a second. */
export const BOB_GAP_MS = 1200;
/** A second pet within this long does nothing more, milliseconds. */
export const PET_HOLD_MS = 3000;
/** A meeting this close (milliseconds) makes her look at the clock and say so. */
export const MEETING_SOON_MS = 5 * 60_000;
/** Music playing this long without a long break is a listening streak, milliseconds. */
export const STREAK_MS = 45 * 60_000;
/** The mind check runs this often, milliseconds; the bubble scheduler every `CHECK_MS`. */
export const MIND_MS = 5000;

interface Look {
  pose: Pose;
  px: number;
  prop: Prop | null;
  scarf: boolean;
  cosmetic: Prop | null;
  hearts: boolean;
  mark: boolean;
}

interface Bubble {
  id: number;
  lines: string[];
  width: number;
  height: number;
}

interface Clover {
  stop: number;
  since: number;
}

/** Dev builds only: a handle for review stills (say a line, start a reaction, grow a clover). */
interface WattDebug {
  say(text: string): void;
  react(kind: ReactKind): void;
  clover(): void;
  set(m: Partial<Mind>): void;
}

/**
 * Watt the electric sheep, on the horizon band of every place that has one: Work, Home, Meet (not
 * in a call) and Unwind. Mounted once, over the horizon. It is up only while the horizon's camera is
 * settled on its place (`horizon/signal.ts`), so a place change or a turn fades it out and back in
 * where it belongs.
 *
 * She is a small pet: she says a short line now and then (`chatter.ts`, at most one every six
 * minutes by default, never in a call, the first minute of focus or while the display is idle),
 * hops when focus or an agent finishes, shows an amber mark when something waits (click it to open
 * it), looks at the clock before a meeting, bobs to the beat, reads during focus, wears what the
 * weather asks, naps when the display is idle, eats the odd clover, and likes being petted. Click
 * her to pet her; hover for her card. Everything she knows comes from the wall's own hooks.
 *
 * `inCall` hides it on Meet; nothing detects a call yet (the in-call pull request wires it). A
 * meeting in progress also keeps her quiet. `now` (epoch milliseconds) defaults to the review clock
 * in a dev review still, the system clock otherwise.
 */
export function Watt({ now = reviewNow ?? Date.now, inCall = false }: { now?: () => number; inCall?: boolean }) {
  // A review still (dev only) is one frozen frame: Watt stands still in the middle of its range.
  const reduced = useReducedMotion() || reviewNow !== undefined;
  const nowRef = useRef(now);
  nowRef.current = now;
  const inCallRef = useRef(inCall);
  inCallRef.current = inCall;
  const [look, setLook] = useState<Look>({ pose: 'idle', px: SPRITE_PX, prop: null, scarf: false, cosmetic: null, hearts: false, mark: false });
  const lookRef = useRef(look);

  // Kept across a reduced motion toggle, so Watt does not start over.
  const presence = useRef(createPresence());
  const mind = useRef(createMind());
  const wake = useRef<() => void>(() => {});
  const startReact = useRef<(kind: ReactKind, dir?: 1 | -1) => void>(() => {});

  const actor = useRef<HTMLDivElement>(null);
  const sheep = useRef<HTMLDivElement>(null);
  const hit = useRef<HTMLButtonElement>(null);
  const bubbleEl = useRef<HTMLDivElement>(null);
  const markEl = useRef<HTMLButtonElement>(null);
  const cloverEl = useRef<HTMLButtonElement>(null);
  const notes = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const zs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const hearts = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];

  // Her life, stored on this PC.
  const [pet, setPet] = useState<PetData>(() => rollDay(loadPet(now()), now()));
  const petRef = useRef(pet);
  petRef.current = pet;
  useEffect(() => savePet(pet), [pet]);
  const update = useCallback((fn: (d: PetData) => PetData) => setPet((d) => fn(d)), []);

  // What the wall knows.
  const statusLine = useAgentStatusLine();
  const waiting = useAgentsWaiting();
  const summary = useAgentsStore((s) => s.summary);
  const agentsOld = useAgentsStore(agentsStale);
  const weather = useWeather();
  const stableNow = useCallback(() => nowRef.current(), []);
  const next = useNextMeeting(stableNow);
  const focus = useFocusStore((s) => s.state);
  const idle = useIdle();
  const playing = useAudioStore((s) => s.playing);
  const track = useNowPlayingStore((s) => s.info?.title ?? null);
  const [minute, setMinute] = useState(() => Math.floor(now() / 60_000));

  const nowMs = minute * 60_000;
  const hour = new Date(nowMs).getHours();
  const ws = senseWeather(weather.reading, nowMs);
  const meetingStart = next.meeting && !next.stale ? Date.parse(next.meeting.start) : NaN;
  const meetingEnd = next.meeting && !next.stale ? Date.parse(next.meeting.end) : NaN;
  const inMeeting = meetingStart <= now() && now() < meetingEnd;
  const meetingSoon = meetingStart - now() > 0 && meetingStart - now() <= MEETING_SOON_MS;
  const [clover, setClover] = useState<Clover | null>(null);
  const cloverRef = useRef(clover);
  cloverRef.current = clover;
  const mood = moodOf({
    hour,
    minute: new Date(nowMs).getMinutes(),
    today: pet.today,
    playing,
    goodWeather: ws.clear,
    novelty: waiting || meetingSoon || clover !== null,
  });

  // The mind the frame loop reads, refreshed on every render (no allocation in the loop).
  const m = mind.current;
  m.focus = focus.status === 'running';
  m.rain = ws.rain;
  m.cold = ws.cold || ws.snow;
  m.sunny = ws.clear && midday(hour);
  m.evening = moonUp(hour);
  m.sleepy = mood === 'sleepy';
  m.nap = idle;
  m.waiting = waiting;
  m.cosmetic = pet.cosmetic;
  // Dev review stills only (`window.__watt.set`): kept over the hooks' values on every render.
  const debugMind = useRef<Partial<Mind>>({});
  Object.assign(m, debugMind.current);

  // The bubble.
  const chat = useRef(createChat());
  const talk = useRef<Talk>({ events: {}, context: [], thoughts: ['sheep'] });
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const bubbleRef = useRef(bubble);
  bubbleRef.current = bubble;
  const bubbleTimer = useRef(0);
  const quiet = useRef<Quiet>({ chatty: 'sometimes', inCall: false, idle: false, away: true, focusSince: null });
  const q = quiet.current;
  q.chatty = pet.chatty;
  q.inCall = inCall || inMeeting;
  q.idle = idle;
  q.focusSince = focus.status === 'running' ? focus.endAt - focus.minutes * 60_000 : null;

  const show = useCallback((line: string) => {
    const walk = presence.current.place ? WALKS[presence.current.place] : WALKS.work;
    const lines = wrapLine(line, walk.bubbleW);
    const size = bubbleSize(lines);
    window.clearTimeout(bubbleTimer.current);
    setBubble((b) => ({ id: (b?.id ?? 0) + 1, lines, ...size }));
    bubbleTimer.current = window.setTimeout(() => setBubble(null), BUBBLE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(bubbleTimer.current), []);
  // A call, the display going idle or chatter turned off takes the bubble down at once.
  useEffect(() => {
    if (q.chatty === 'off' || q.inCall || q.idle) setBubble(null);
  }, [q.chatty, q.inCall, q.idle]);

  const note = useCallback((topic: Topic, at: number) => {
    talk.current.events[topic] = at;
  }, []);

  /** One scheduler check: what is true now, then maybe a bubble. */
  const check = useCallback(() => {
    const t = nowRef.current();
    const p = presence.current;
    q.away = p.place === null || p.night || document.hidden;
    const context: Topic[] = [];
    if (statusRef.current && !statusRef.current.startsWith('No agents')) context.push('agentsWorking');
    if (useAudioStore.getState().playing) context.push(streak.current.since !== null && t - streak.current.since >= STREAK_MS ? 'musicStreak' : 'musicPlaying');
    context.push(...weatherTopics(wsRef.current));
    context.push(dayTopic(new Date(t).getHours()));
    talk.current.context = context;
    const md = moodRef.current;
    talk.current.thoughts = md === 'content' ? ['sheep'] : ['sheep', md];
    const said = nextBubble(chat.current, q, talk.current, t);
    if (said) show(said.line);
  }, [q, show]);
  const statusRef = useRef(statusLine);
  statusRef.current = statusLine;
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const streak = useRef<{ since: number | null; lastSound: number }>({ since: null, lastSound: -Infinity });

  // Focus: a quiet line after its first minute, one half way, a hop and a line when it is done.
  const prevFocus = useRef(focus);
  const halfSaid = useRef(false);
  useEffect(() => {
    const prev = prevFocus.current;
    prevFocus.current = focus;
    const t = nowRef.current();
    if (focus.status === 'running' && prev.status !== 'running') {
      const start = focus.endAt - focus.minutes * 60_000;
      if (prev.status !== 'paused') {
        halfSaid.current = false;
        note('focusStart', start + 60_000);
      }
    }
    if (focus.status === 'finished' && prev.status === 'running') {
      note('focusDone', t);
      startReact.current('hop');
      update((d) => bump(d, 'focus', t));
      check();
    }
  }, [focus, note, update, check]);

  // Agents: a hop when one finishes; turning to the cards and the amber mark while something waits.
  const prevWorking = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!summary || agentsOld) return;
    const t = nowRef.current();
    const before = prevWorking.current;
    prevWorking.current = workingIds(summary.lanes);
    if (!before) return;
    const n = finishedBetween(before, summary.lanes);
    if (n > 0) {
      note('agentFinished', t);
      startReact.current('hop');
      update((d) => {
        let r = d;
        for (let i = 0; i < n; i++) r = bump(r, 'agents', t);
        return r;
      });
      check();
    }
  }, [summary, agentsOld, note, update, check]);
  const prevWaiting = useRef(waiting);
  useEffect(() => {
    if (waiting && !prevWaiting.current) {
      note('agentWaiting', nowRef.current());
      // The agent cards sit above her, right of her on Work: she turns up toward them.
      startReact.current('look', 1);
      check();
    }
    prevWaiting.current = waiting;
    wake.current();
  }, [waiting, note, check]);

  // Meetings: she looks at the clock (top left) five minutes before; a line once it has ended.
  const lookedAt = useRef<string | null>(null);
  const prevMeeting = useRef<{ key: string; end: number } | null>(null);
  useEffect(() => {
    const mtg = next.meeting;
    const prev = prevMeeting.current;
    const t = nowRef.current();
    if (prev && (!mtg || mtg.key !== prev.key) && prev.end <= t && t - prev.end < 5 * 60_000) note('meetingEnded', t);
    prevMeeting.current = mtg && !next.stale ? { key: mtg.key, end: Date.parse(mtg.end) } : prev && prev.end > t ? prev : null;
    if (mtg && meetingSoon && lookedAt.current !== mtg.key) {
      lookedAt.current = mtg.key;
      note('meetingSoon', t);
      startReact.current('look', -1);
      check();
    }
  }, [next.meeting, next.stale, meetingSoon, note, check]);

  // Music: songs counted by track changes while playing; a line when it stops after a while.
  const prevTrack = useRef(track);
  useEffect(() => {
    if (track && track !== prevTrack.current && useAudioStore.getState().playing) update((d) => bump(d, 'songs', nowRef.current()));
    prevTrack.current = track;
  }, [track, update]);
  useEffect(() => {
    const t = nowRef.current();
    const s = streak.current;
    if (playing) {
      if (s.since === null || t - s.lastSound > 10 * 60_000) s.since = t;
      // Back within the pause's grace: no "music stopped" line.
      const paused = talk.current.events.musicPaused;
      if (paused !== undefined && paused > t) delete talk.current.events.musicPaused;
    } else if (s.since !== null && t - s.since > 2 * 60_000) {
      note('musicPaused', t + 20_000);
    }
    s.lastSound = t;
    wake.current();
  }, [playing, note]);

  // The display going idle by day: a nap.
  const prevIdle = useRef(idle);
  useEffect(() => {
    if (idle && !prevIdle.current && !presence.current.night && presence.current.place) update((d) => bump(d, 'naps', nowRef.current()));
    prevIdle.current = idle;
    wake.current();
  }, [idle, update]);

  // The minute clock, focus half way, the clover times, and the bubble scheduler.
  useEffect(() => {
    let n = 0;
    const id = window.setInterval(() => {
      const t = nowRef.current();
      setMinute(Math.floor(t / 60_000));
      setPet((d) => (d.today.date === dayKey(t) && d.lastDay === dayKey(t) ? d : rollDay(d, t)));
      const f = useFocusStore.getState().state;
      if (f.status === 'running' && !halfSaid.current && f.endAt - t <= (f.minutes * 60_000) / 2) {
        halfSaid.current = true;
        note('focusHalf', t);
      }
      const d = petRef.current;
      const times = cloverTimes(d.today.date);
      const mins = new Date(t).getHours() * 60 + new Date(t).getMinutes();
      const due = d.today.clovers < 2 && mins >= times[d.today.clovers];
      if (due && !cloverRef.current && presence.current.place && !presence.current.night) {
        const w = presence.current.place ? wanderAt(WALKS[presence.current.place], wanderT.current, createWander()) : null;
        setClover({ stop: ((w?.stop ?? 0) + 1) % 8, since: t });
      }
      if (cloverRef.current && (reducedRef.current || !presence.current.place) && t - cloverRef.current.since >= CLOVER_WAIT_MS) eatClover();
      n += 1;
      if (n % Math.round(CHECK_MS / MIND_MS) === 0) check();
    }, MIND_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check, note]);
  // A fresh event gets its line without waiting for the next check.
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const wanderT = useRef(0);

  const eatClover = useCallback(() => {
    if (!cloverRef.current) return;
    const t = nowRef.current();
    cloverRef.current = null;
    setClover(null);
    startReact.current('eat');
    note('clover', t);
    update((d) => bump(d, 'clovers', t));
    check();
  }, [note, update, check]);
  const eatRef = useRef(eatClover);
  eatRef.current = eatClover;

  // Pet her: hearts, a wiggle, a pleased line. A second click within a few seconds adds nothing.
  const lastPet = useRef(-Infinity);
  const petHer = useCallback(() => {
    const t = nowRef.current();
    if (t - lastPet.current < PET_HOLD_MS) return;
    lastPet.current = t;
    startReact.current('pet');
    update((d) => bump(d, 'pets', t));
    if (!quietNow({ ...q, away: false }, t)) {
      const line = lineFrom('pet', chat.current.lastLine, Math.random);
      markSpoken(chat.current, line, t);
      show(line);
    }
  }, [q, show, update]);

  // The amber mark: open what waits when the helper gives a link, else go to Work where it shows.
  const firstId = summary?.linksAvailable ? (summary.yourMove.first?.sessionId ?? null) : null;
  const openWaiting = useCallback(() => {
    if (firstId) invoke('wall2_open_session', { id: firstId }).catch(() => undefined);
    else usePlaceStore.getState().setActive('work');
  }, [firstId]);

  // Hover card.
  const [card, setCard] = useState<{ left: number; top: number } | null>(null);
  const cardTimer = useRef(0);
  const frameRef = useRef({ x: 0, y: 0, w: 0 });
  const openCard = useCallback(() => {
    window.clearTimeout(cardTimer.current);
    const p = presence.current;
    if (!p.place) return;
    const walk = WALKS[p.place];
    const f = frameRef.current;
    setCard({ left: Math.max(130, Math.min(2560 - 20 - 300, f.x + f.w / 2 - 150)), top: walk.ceiling - 8 });
  }, []);
  const closeCard = useCallback(() => {
    window.clearTimeout(cardTimer.current);
    cardTimer.current = window.setTimeout(() => setCard(null), 300);
  }, []);
  useEffect(() => () => window.clearTimeout(cardTimer.current), []);

  useEffect(() => {
    let T = 0;
    let last = 0;
    let raf = 0;
    let timer = 0;
    let reactTimer = 0;
    let prevNight: boolean | null = null;
    let lastBeats = audioBeats().count;
    let lastBobAt = -Infinity;
    const p = presence.current;
    const clock = createClock();
    const f = createPetFrame();
    const drift = createDrift();
    const bp = createBubblePlace();
    const mb = createBox();
    const cb = createBox();
    const wp = createWander();
    let reactAt = -Infinity;
    const tNow = () => (reduced ? performance.now() / 1000 : T);

    /** Advance the presence; returns true when the loop can stop (see `isIdle`). */
    const step = (dt: number) => {
      readClock(clock, nowRef.current());
      const place = wattPlaceFor(usePlaceStore.getState().active, inCallRef.current);
      const camera = place ? cameraOf(place, clock) : null;
      const ready = cameraReady(place, camera, cameraSignal());
      stepPresence(p, place, camera, clock.night, ready, dt, reduced);
      if (p.since === 0) wanderT.current = 0;
      else if (!holdsStill(mind.current)) wanderT.current += dt;
      // Waking at 6:30: a yawn and a stretch.
      if (p.place && prevNight === true && !p.night) {
        startReact.current('wake');
        talk.current.events.wake = nowRef.current();
      }
      if (p.place) prevNight = p.night;
      return isIdle(p, place, ready);
    };

    const paint = () => {
      if (document.hidden) return;
      const el = actor.current;
      if (el) el.style.opacity = String(p.opacity);
      const live = p.place !== null && p.opacity > 0.5;
      if (hit.current) hit.current.style.pointerEvents = live ? 'auto' : 'none';
      if (!p.place || !p.camera) return;
      const walk = WALKS[p.place];
      const mi = mind.current;
      mi.reactT = tNow() - reactAt;
      // The beat: a soft squash at most once every `BOB_GAP_MS`.
      const beats = audioBeats().count;
      const music = useAudioStore.getState().playing;
      if (beats !== lastBeats) {
        lastBeats = beats;
        const ms = tNow() * 1000;
        if (music && ms - lastBobAt >= BOB_GAP_MS) {
          lastBobAt = ms;
          mi.bob = 1;
        }
      }
      petFrame(walk, p.place, p.camera.hy, p.night, wanderT.current, music, reduced, mi, f);
      mi.bob = Math.max(0, mi.bob - 0.12);
      // A new look object only when something visible changed (not every frame).
      const cur = lookRef.current;
      if (cur.pose !== f.pose || cur.px !== walk.px || cur.prop !== f.prop || cur.scarf !== f.scarf || cur.cosmetic !== f.cosmetic || cur.hearts !== f.hearts || cur.mark !== f.mark) {
        lookRef.current = { pose: f.pose, px: walk.px, prop: f.prop, scarf: f.scarf, cosmetic: f.cosmetic, hearts: f.hearts, mark: f.mark };
        setLook(lookRef.current);
      }
      const width = spriteWidth(f.pose, walk.px);
      const y = p.camera.hy - spriteHeight(f.pose, walk.px);
      frameRef.current.x = f.x;
      frameRef.current.y = y;
      frameRef.current.w = width;
      const s = sheep.current;
      if (s) s.style.transform = `translate(${f.x}px,${y - f.lift}px) scaleX(${f.dir}) scaleY(${f.squash})`;
      const h = hit.current;
      if (h) {
        h.style.left = `${f.x}px`;
        h.style.top = `${y}px`;
        h.style.width = `${width}px`;
        h.style.height = `${spriteHeight(f.pose, walk.px)}px`;
      }
      for (let i = 0; i < 2; i++) {
        const e = notes[i].current;
        if (!e) continue;
        const k = (T * 0.55 + i * 0.5) % 1;
        driftAt('note', walk, f.x, y, width, i, k, drift);
        e.style.opacity = f.notes && !f.hearts ? String(Math.sin(Math.PI * k) * 0.95) : '0';
        e.style.left = `${drift.left}px`;
        e.style.top = `${drift.top}px`;
      }
      for (let i = 0; i < 2; i++) {
        const e = hearts[i].current;
        if (!e) continue;
        const k = reduced ? 0.3 + i * 0.3 : Math.min(1, (mi.reactT / HEARTS_S) * 0.9 + i * 0.15);
        driftAt('note', walk, f.x, y, width, i, k, drift);
        e.style.opacity = f.hearts ? String(reduced ? 0.9 : Math.sin(Math.PI * k) * 0.95) : '0';
        e.style.left = `${drift.left}px`;
        e.style.top = `${drift.top}px`;
      }
      for (let i = 0; i < 2; i++) {
        const e = zs[i].current;
        if (!e) continue;
        const k = (T * 0.3 + i * 0.5) % 1;
        driftAt('z', walk, f.x, y, width, i, k, drift);
        e.style.opacity = f.z ? String(Math.sin(Math.PI * k) * 0.9) : '0';
        e.style.left = `${drift.left}px`;
        e.style.top = `${drift.top}px`;
      }
      const b = bubbleEl.current;
      const bub = bubbleRef.current;
      if (b && bub) {
        placeBubble(walk, p.camera.hy, f.x, y, width, bub.width, bub.height, bp);
        b.style.left = `${bp.left}px`;
        b.style.top = `${bp.top}px`;
        b.dataset.side = bp.leftSide ? 'left' : 'right';
      }
      const mk = markEl.current;
      if (mk) {
        markBox(walk, f.x, y, width, mb);
        mk.style.left = `${mb.left + mb.width / 2 - MARK_HIT / 2}px`;
        mk.style.top = `${mb.top + mb.height / 2 - MARK_HIT / 2}px`;
        mk.style.pointerEvents = live && f.mark ? 'auto' : 'none';
      }
      const cl = cloverEl.current;
      const clv = cloverRef.current;
      if (cl && clv) {
        if (reduced) {
          cb.left = f.x + width + walk.px;
          cb.top = p.camera.hy - CLOVER.length * SMALL_PX;
        } else cloverBox(walk, p.camera.hy, clv.stop, cb);
        cl.style.left = `${cb.left}px`;
        cl.style.top = `${cb.top}px`;
        cl.style.pointerEvents = live ? 'auto' : 'none';
        // She reaches the clover's stop and stands there: she eats it.
        if (!reduced && !p.night && !mi.nap && !holdsStill(mi)) {
          wanderAt(walk, wanderT.current, wp);
          if (!wp.moving && wp.stop === clv.stop) window.setTimeout(() => eatRef.current(), 0);
        }
      }
    };

    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      if (!shouldDraw(ts, last, document.hidden)) return;
      const dt = frameDelta(ts, last);
      T += dt;
      last = ts;
      const idle = step(dt);
      paint();
      // Away with nowhere to go (Zen, Meet in a call) or waiting for the camera: stop until a
      // place, call or camera change wakes it.
      if (idle) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const onVisible = () => paint();
    wake.current = () => {
      if (reduced) {
        step(0);
        paint();
      } else if (!raf && !step(0)) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    startReact.current = (kind, dir = 1) => {
      reactAt = tNow();
      mind.current.react = kind;
      mind.current.reactDir = dir;
      mind.current.reactT = 0;
      wake.current();
      if (reduced) {
        // A still pose for the reaction, then back.
        window.clearTimeout(reactTimer);
        reactTimer = window.setTimeout(() => wake.current(), Math.max(REACT_S[kind], kind === 'pet' ? HEARTS_S : 0) * 1000 + 50);
      }
    };

    const idle = step(0);
    paint();
    if (reduced) {
      // One still pose; notice the hour changing (and the page returning) once a minute. A place,
      // camera or call change repaints at once (Watt jumps there, as the horizon does).
      timer = window.setInterval(() => wake.current(), 60_000);
      document.addEventListener('visibilitychange', onVisible);
    } else if (!idle) {
      raf = requestAnimationFrame(frame);
    }
    const offPlace = usePlaceStore.subscribe(() => wake.current());
    const offCamera = subscribeCamera(() => wake.current());
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      window.clearTimeout(reactTimer);
      document.removeEventListener('visibilitychange', onVisible);
      offPlace();
      offCamera();
      wake.current = () => {};
      startReact.current = () => {};
    };
  }, [reduced]);

  // A call starting or ending, a bubble, a clover or her look changing wakes the loop (or repaints the still pose).
  useEffect(() => {
    wake.current();
  }, [inCall, bubble, clover, pet.cosmetic, focus.status, ws.rain, ws.cold, minute]);

  // Dev review stills: a handle on the window to say a line, react or grow a clover.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __watt?: WattDebug };
    w.__watt = {
      say: (text) => show(text),
      react: (kind) => startReact.current(kind),
      clover: () => setClover({ stop: 0, since: nowRef.current() }),
      set: (patch) => {
        Object.assign(debugMind.current, patch);
        Object.assign(mind.current, patch);
        wake.current();
      },
    };
    return () => {
      delete w.__watt;
    };
  }, [show]);

  const chooseChatty = useCallback((c: Chatty) => update((d) => ({ ...d, chatty: c })), [update]);
  const chooseCosmetic = useCallback((c: Cosmetic) => update((d) => ({ ...d, cosmetic: c })), [update]);

  return (
    <div className="watt" ref={actor}>
      <div className="watt-sheep" ref={sheep} aria-hidden="true">
        <SheepSvg pose={look.pose} px={look.px} />
        {look.cosmetic === 'cape' && <PropSvg prop="cape" pose={look.pose} px={look.px} />}
        {look.scarf && <PropSvg prop="scarf" pose={look.pose} px={look.px} />}
        {look.prop && <PropSvg prop={look.prop} pose={look.pose} px={look.px} />}
        {look.cosmetic && look.cosmetic !== 'cape' && <PropSvg prop={look.cosmetic} pose={look.pose} px={look.px} />}
      </div>
      <button
        type="button"
        className="watt-hit"
        ref={hit}
        aria-label="Watt, the sheep. Click to pet her."
        onClick={petHer}
        onMouseEnter={openCard}
        onMouseLeave={closeCard}
        onFocus={openCard}
        onBlur={closeCard}
      />
      <span className="watt-note" ref={notes[0]} aria-hidden="true">
        <IconMusic size={NOTE_SIZES[0]} stroke={2} />
      </span>
      <span className="watt-note cy" ref={notes[1]} aria-hidden="true">
        <IconMusic size={NOTE_SIZES[1]} stroke={2} />
      </span>
      <span className="watt-heart" ref={hearts[0]} aria-hidden="true">
        <PixelSvg map={HEART} px={SMALL_PX} />
      </span>
      <span className="watt-heart" ref={hearts[1]} aria-hidden="true">
        <PixelSvg map={HEART} px={SMALL_PX} />
      </span>
      <span className="watt-z" ref={zs[0]} aria-hidden="true">
        z
      </span>
      <span className="watt-z sm" ref={zs[1]} aria-hidden="true">
        z
      </span>
      <button
        type="button"
        className="watt-mark"
        ref={markEl}
        hidden={!look.mark}
        aria-label={firstId ? 'Something waits for you. Open it.' : 'Something waits for you. Go to Work.'}
        title={firstId ? 'Something waits for you. Click to open it.' : 'Something waits for you on Work. Click to go there.'}
        onClick={openWaiting}
      >
        <PixelSvg map={MARK} px={SMALL_PX} />
      </button>
      {clover && (
        <button type="button" className="watt-clover" ref={cloverEl} aria-label="A clover. Give it to Watt." title="A clover. Click to give it to her." onClick={eatClover}>
          <PixelSvg map={CLOVER} px={SMALL_PX} />
        </button>
      )}
      {bubble && (
        <div key={bubble.id} className={`watt-bubble${reduced ? ' still' : ''}`} ref={bubbleEl} role="status" style={{ width: bubble.width, height: bubble.height }}>
          {bubble.lines.join('\n')}
        </div>
      )}
      {card && (
        <PetCard
          left={card.left}
          top={card.top}
          mood={mood}
          pet={pet}
          onEnter={openCard}
          onLeave={closeCard}
          onChatty={chooseChatty}
          onCosmetic={chooseCosmetic}
        />
      )}
    </div>
  );
}
