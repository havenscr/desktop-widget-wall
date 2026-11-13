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
import {
  FALL,
  RETURN,
  callCarry,
  endStay,
  landingX,
  startStay,
  CARRY_LINE_GAP_MS,
  CLOVER_FEED_PX,
  DIZZY_LINE_GAP_MS,
  GRAB_PX,
  HELD,
  NONE,
  PET_MAX_MS,
  SETTLE_S,
  airborne,
  beginCarry,
  cancelCarry,
  carryFrame,
  createCarry,
  moveCarry,
  placeCarriedBubble,
  releaseCarry,
  stepCarry,
} from './carry';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/fitScale';
import { BUBBLE_MS, CHECK_MS, FOCUS_QUIET_MS, createChat, lineFrom, markSpoken, nextBubble, quietNow, type Chatty, type Quiet, type Talk } from './chatter';
import type { Topic } from './lines';
import {
  NOTE_SIZES,
  WALKS,
  middle,
  isNight,
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
import { PetCard, type Trick } from './PetCard';
import {
  BUBBLE,
  HEARTS_S,
  NOTICE_S,
  REACT_S,
  atClover,
  cloverHitBox,
  hitParts,
  markHitBox,
  placeCard,
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
import { bump, dayKey, loadPet, moodOf, rollDay, savePet, type Cosmetic, type PetData, type StayPlace } from './pet';
import { sunTimes } from '../ribbon/sun';
import { CLOVER_WAIT_MS, cloverDue, dayTopic, finishedBetween, midday, moonUp, senseWeather, weatherTopics, workingIds } from './senses';
import { CLOVER, FIREFLY, HEART, MARK, PROP_SPRITES, SMALL_PX, SPRITE_PX, type Pose, type Prop } from './sprites';
import './watt.css';

export { SheepSvg } from './Pixels';

/** Shortest time between two beat bobs, milliseconds: well under the calm limit of three moves a second. */
export const BOB_GAP_MS = 1200;
/** A second pet within this long does nothing more, milliseconds. */
export const PET_HOLD_MS = 3000;
/** A pet gets a spoken reply only this long after any bubble, and at most one pet line this often. */
export const PET_REPLY_GAP_MS = 20_000;
export const PET_LINE_EVERY_MS = 60_000;
/** Three clicks within this long (milliseconds) give one happy hop, at most this often. */
export const HAPPY_WITHIN_MS = 4000;
export const HAPPY_EVERY_MS = 20_000;
/** Ten pets in a day are a milestone. */
export const MILESTONE_PETS = 10;
/** A nap lasts this long unless he is petted, milliseconds. */
export const NAP_MS = 60_000;
/** Watt's tooltip: the three things the pointer can do on him. */
export const WATT_TIP = 'Click to pet. Drag to carry. Right-click for his card.';
/** A meeting this close (milliseconds) makes him look at the clock and say so. */
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

/** Take an element of hers out of the tab order and out of sight while she is away (no allocation). */
function switchOff(el: HTMLElement | null, tab: number, vis: string): void {
  if (!el) return;
  if (el.tabIndex !== tab) el.tabIndex = tab;
  if (el.style.visibility !== vis) el.style.visibility = vis;
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
  // Being carried: one record, reused (`carry.ts`); the loop's clock for handlers outside it.
  const carry = useRef(createCarry());
  const tNowRef = useRef<() => number>(() => performance.now() / 1000);

  const actor = useRef<HTMLDivElement>(null);
  const sheep = useRef<HTMLDivElement>(null);
  const hit = useRef<HTMLButtonElement>(null);
  const hitParts_ = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const bubbleEl = useRef<HTMLDivElement>(null);
  const markEl = useRef<HTMLElement | null>(null);
  const setMark = useCallback((e: HTMLElement | null) => {
    markEl.current = e;
  }, []);
  const cloverEl = useRef<HTMLButtonElement>(null);
  const notes = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const zs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const hearts = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const ffEl = useRef<HTMLSpanElement>(null);
  const sparks = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];

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
  // Dusk: after sunset and before his bedtime a firefly drifts near him (not under reduced motion, not in a call).
  const sunset = sunTimes(nowMs).set;
  const dusk = sunset !== null && nowMs >= sunset && !isNight(new Date(nowMs));
  const meetingStart = next.meeting && !next.stale ? Date.parse(next.meeting.start) : NaN;
  const meetingEnd = next.meeting && !next.stale ? Date.parse(next.meeting.end) : NaN;
  // A stale or missing feed keeps the last known meeting's quiet time until its end.
  const lastMeeting = useRef<{ start: number; end: number } | null>(null);
  if (Number.isFinite(meetingStart) && Number.isFinite(meetingEnd)) lastMeeting.current = { start: meetingStart, end: meetingEnd };
  // A fresh feed without it (cancelled or finished) ends the quiet time at once.
  else if (!next.stale) lastMeeting.current = null;
  const win = lastMeeting.current;
  const inMeeting = win !== null && win.start <= now() && now() < win.end;
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
  m.clover = clover !== null;
  m.firefly = dusk && !reduced && !inCall && !inMeeting;
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
  /**
   * The one quiet state: any quiet condition (Off, a call or meeting, the first minute of focus,
   * the display idle, the page hidden, asleep or away) takes a showing bubble down at once.
   */
  const quietCheck = useCallback(() => {
    const p = presence.current;
    q.away = p.place === null || p.night || document.hidden;
    if (bubbleRef.current && quietNow(q, nowRef.current())) setBubble(null);
  }, [q]);
  const quietRef = useRef(quietCheck);
  quietRef.current = quietCheck;
  useEffect(() => {
    quietCheck();
  }, [quietCheck, q.chatty, q.inCall, q.idle, q.focusSince]);
  useEffect(() => {
    const onVis = () => quietRef.current();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

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
      // A session restored past half way says nothing about half way.
      halfSaid.current = prev.status === 'paused' ? halfSaid.current : focus.endAt - t <= (focus.minutes * 60_000) / 2;
      // Only a session that has just started gets its line (not one restored at start up).
      if (prev.status !== 'paused' && t - start < 2 * 60_000) note('focusStart', start + 60_000);
    }
    // Only a session seen running that ends now: one that ended while the app was closed says nothing.
    if (focus.status === 'finished' && prev.status === 'running' && t - prev.endAt < 60_000) {
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
    const n = finishedBetween(before, summary.lanes, summary.day);
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
      const mins = new Date(t).getHours() * 60 + new Date(t).getMinutes();
      const grown = cloverDue(d.today.date, mins, d.today.grown);
      if (grown !== null && !cloverRef.current && presence.current.place && !presence.current.night) {
        const w = wanderAt(WALKS[presence.current.place], wanderT.current, createWander());
        setClover({ stop: (w.stop + 1) % 8, since: t });
        update((x) => ({ ...rollDay(x, t), today: { ...rollDay(x, t).today, grown } }));
      }
      quietRef.current();
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
  const lastPetLine = useRef(-Infinity);
  // Three clicks within 4 s (the second and third add nothing to the count) give a happy hop.
  const clicks = useRef(new Float64Array(3).fill(-Infinity));
  const clickAt = useRef(0);
  const lastHappy = useRef(-Infinity);
  const napUntil = useRef(0);
  const petHer = useCallback(() => {
    const t = nowRef.current();
    clicks.current[clickAt.current % 3] = t;
    clickAt.current += 1;
    // He wakes when petted.
    if (napUntil.current > 0) {
      napUntil.current = 0;
      wake.current();
    }
    if (clickAt.current >= 3 && t - clicks.current[clickAt.current % 3] <= HAPPY_WITHIN_MS && t - lastHappy.current >= HAPPY_EVERY_MS) {
      lastHappy.current = t;
      startReact.current('happy');
    }
    if (t - lastPet.current < PET_HOLD_MS) return;
    lastPet.current = t;
    // Hearts and the wiggle every time he is petted.
    startReact.current('pet');
    const before = petRef.current.today.date === dayKey(t) ? petRef.current.today.pets : 0;
    const milestone = before + 1 === MILESTONE_PETS;
    if (milestone) startReact.current('sparkle');
    update((d) => bump(d, 'pets', t));
    // A spoken reply only outside every quiet time, 20 s after any bubble, and once a minute.
    const p = presence.current;
    q.away = p.place === null || p.night || document.hidden;
    if (!quietNow(q, t) && t - chat.current.lastAt >= PET_REPLY_GAP_MS && t - lastPetLine.current >= PET_LINE_EVERY_MS) {
      const line = lineFrom(milestone ? 'milestone' : 'pet', chat.current.lastLine, Math.random);
      lastPetLine.current = t;
      markSpoken(chat.current, line, t);
      show(line);
    }
  }, [q, show, update]);

  // The amber mark: open what waits when the helper gives a link, else go to Work where it shows.
  const firstId = summary?.linksAvailable ? (summary.yourMove.first?.sessionId ?? null) : null;
  const activePlace = usePlaceStore((st) => st.active);
  const markStatic = !firstId && activePlace === 'work';
  const markStaticRef = useRef(markStatic);
  markStaticRef.current = markStatic;
  const openWaiting = useCallback(() => {
    if (firstId) invoke('wall2_open_session', { id: firstId }).catch(() => undefined);
    else usePlaceStore.getState().setActive('work');
  }, [firstId]);

  // His card: opens on a right-click on him (or the ContextMenu key, Shift+F10 or M), closes on
  // Escape, a click or right-click outside it, a right-click on him again, a place change and when
  // he goes away. He stands still while it is open. Hovering opens nothing.
  const [card, setCard] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef(card);
  cardRef.current = card;
  const frameRef = useRef<{ x: number; y: number; w: number; dir: 1 | -1 }>({ x: 0, y: 0, w: 0, dir: 1 });
  const cardBox = useRef(createBox());
  const focusCard = useRef(false);
  const kbMenuAt = useRef(-Infinity);
  const openCard = useCallback((fromKeyboard = false) => {
    const p = presence.current;
    if (!p.place || p.opacity < 0.5 || carry.current.mode === HELD) return;
    const f = frameRef.current;
    const b = placeCard(p.place, WALKS[p.place], f.x, f.w, cardBox.current);
    focusCard.current = fromKeyboard;
    setCard({ left: b.left, top: b.top });
  }, []);
  const closeCard = useCallback(() => setCard(null), []);
  const closeRef = useRef(closeCard);
  closeRef.current = closeCard;
  const onHitKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const menu = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey) || ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey);
      if (!menu) return;
      e.preventDefault();
      kbMenuAt.current = performance.now();
      openCard(true);
    },
    [openCard],
  );
  // The native menu is suppressed on him, and only on him; the card toggles. A contextmenu that
  // follows a keyboard menu key within a moment is the same gesture and changes nothing.
  useEffect(() => {
    const el = hit.current;
    if (!el) return;
    const onMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (performance.now() - kbMenuAt.current < 600) return;
      if (cardRef.current) closeRef.current();
      else openCard();
    };
    el.addEventListener('contextmenu', onMenu);
    return () => el.removeEventListener('contextmenu', onMenu);
  }, [openCard]);
  useEffect(() => {
    mind.current.held = card !== null;
    if (!card) return;
    if (focusCard.current) {
      focusCard.current = false;
      actor.current?.querySelector<HTMLElement>('.watt-card button:not(:disabled)')?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const a = document.activeElement;
      const inside = !!a && (a === hit.current || !!a.closest?.('.watt-card'));
      closeRef.current();
      if (inside) hit.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.watt-card')) return;
      // A right-click on him is his own contextmenu, which toggles the card.
      if (e.button === 2 && t?.closest?.('.watt-hit')) return;
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    const offPlace = usePlaceStore.subscribe((st, prev) => {
      if (st.active !== prev.active) closeRef.current();
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      offPlace();
    };
  }, [card]);
  const onCardBlur = useCallback((e: React.FocusEvent<HTMLElement>) => {
    // Keyboard focus moving on past the card closes it; focus going nowhere (the window) does not.
    const to = e.relatedTarget as Node | null;
    if (to && !e.currentTarget.contains(to) && to !== hit.current) closeRef.current();
  }, []);

  // Pick him up and set him down. A press that moves 6 px or more becomes a carry (pointer capture,
  // so nothing under him sees the pointer); one that does not is a pet on release.
  const press = useRef({ active: false, id: -1, x: 0, y: 0, t: 0 });
  const pt = useRef({ x: 0, y: 0 });
  const cloverAt = useRef({ x: 0, y: 0, on: false });
  // The pointer, for the "he notices it" look: raw client position and the loop time it last moved.
  const ptrRaw = useRef({ x: 0, y: 0, t: -Infinity });
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const r = ptrRaw.current;
      r.x = e.clientX;
      r.y = e.clientY;
      r.t = tNowRef.current();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  const lastCarryLine = useRef(-Infinity);
  const lastDizzyLine = useRef(-Infinity);
  const heldBubble = useRef(0);
  const sitTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(sitTimer.current), []);
  /** The pointer in stage pixels (the stage is scaled to the window). */
  const toStage = useCallback((cx: number, cy: number) => {
    const r = actor.current?.getBoundingClientRect();
    const o = pt.current;
    if (r && r.width > 0 && r.height > 0) {
      o.x = ((cx - r.left) * STAGE_WIDTH) / r.width;
      o.y = ((cy - r.top) * STAGE_HEIGHT) / r.height;
    } else {
      o.x = cx;
      o.y = cy;
    }
    return o;
  }, []);
  const dropCapture = useCallback((id: number) => {
    try {
      const el = hit.current;
      if (el && id >= 0 && el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
    } catch {
      /* not captured */
    }
  }, []);
  /** Something other than the pointer ended the carry: down he goes from where he is. */
  const interruptCarry = useCallback(() => {
    const pr = press.current;
    pr.active = false;
    const c = carry.current;
    if (c.mode !== HELD) return;
    dropCapture(c.pointerId);
    const p = presence.current;
    if (!p.place || !p.camera) {
      cancelCarry(c);
      return;
    }
    const walk = WALKS[p.place];
    releaseCarry(c, tNowRef.current(), walk, p.camera.hy, walk.px, reducedRef.current || document.hidden, true);
    wake.current();
  }, [dropCapture]);
  const interruptRef = useRef(interruptCarry);
  interruptRef.current = interruptCarry;
  /** A new place, or the camera moving off: he is just gone from where he was, nothing to set down. */
  const dropCarry = useCallback(() => {
    press.current.active = false;
    napUntil.current = 0;
    if (petRef.current.stay) {
      // A place change ends Stay.
      petRef.current = { ...petRef.current, stay: null };
      update((d) => (d.stay ? { ...d, stay: null } : d));
    }
    const c = carry.current;
    if (c.mode === NONE) {
      c.stay = false;
      return;
    }
    dropCapture(c.pointerId);
    cancelCarry(c);
    mind.current.carry = false;
  }, [dropCapture, update]);
  const dropRef = useRef(dropCarry);
  dropRef.current = dropCarry;

  const onHitPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const c = carry.current;
    if (press.current.active || c.mode === HELD || c.mode === FALL) return;
    const p = presence.current;
    if (!p.place || !p.camera || p.opacity < 0.5) return;
    press.current = { active: true, id: e.pointerId, x: e.clientX, y: e.clientY, t: nowRef.current() };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
  }, []);
  const startCarry = useCallback(
    (cx: number, cy: number) => {
      const p = presence.current;
      if (!p.place || !p.camera) return;
      const walk = WALKS[p.place];
      const at = toStage(cx, cy);
      const f = frameRef.current;
      const t = nowRef.current();
      q.away = p.night || document.hidden;
      beginCarry(carry.current, press.current.id, at.x, at.y, f.x, p.camera.hy, f.dir, walk.px, tNowRef.current(), t - lastCarryLine.current >= CARRY_LINE_GAP_MS);
      mind.current.carry = true;
      closeRef.current();
      wake.current();
    },
    [q, toStage],
  );
  const onHitPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const pr = press.current;
      if (!pr.active || e.pointerId !== pr.id) return;
      const c = carry.current;
      if (c.mode === HELD) {
        const at = toStage(e.clientX, e.clientY);
        moveCarry(c, at.x, at.y);
        if (reducedRef.current) wake.current();
        return;
      }
      if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) >= GRAB_PX) startCarry(e.clientX, e.clientY);
    },
    [startCarry, toStage],
  );
  const onHitPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const pr = press.current;
      if (!pr.active || e.pointerId !== pr.id) return;
      pr.active = false;
      dropCapture(pr.id);
      const c = carry.current;
      const p = presence.current;
      if (c.mode === HELD) {
        if (!p.place || !p.camera) {
          cancelCarry(c);
          return;
        }
        const walk = WALKS[p.place];
        const at = toStage(e.clientX, e.clientY);
        moveCarry(c, at.x, at.y);
        // Letting go on a clover feeds it to him.
        const cl = cloverAt.current;
        const feed = cloverRef.current !== null && cl.on && Math.hypot(at.x - cl.x, at.y - cl.y) <= CLOVER_FEED_PX;
        const instant = reducedRef.current || document.hidden;
        releaseCarry(c, tNowRef.current(), walk, p.camera.hy, walk.px, instant, false);
        if (feed) {
          c.fed = true;
          c.sayLanded = false;
          eatRef.current();
        }
        if (reducedRef.current) {
          window.clearTimeout(sitTimer.current);
          sitTimer.current = window.setTimeout(() => wake.current(), SETTLE_S * 1000 + 100);
        }
        wake.current();
        return;
      }
      if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < GRAB_PX && nowRef.current() - pr.t < PET_MAX_MS) petHer();
    },
    [dropCapture, petHer, toStage],
  );
  const onHitPointerCancel = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (press.current.active && e.pointerId === press.current.id) interruptRef.current();
  }, []);
  const onHitLostCapture = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (press.current.active && e.pointerId === press.current.id) interruptRef.current();
  }, []);
  // The keyboard's Enter and Space arrive as a click with no pointer (detail 0): a pet.
  const onHitClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.detail === 0) petHer();
    },
    [petHer],
  );
  // Anything else that should put him down: the window losing focus, the page hiding, a place
  // change, a call starting, the display going idle.
  useEffect(() => {
    const onBlur = () => interruptRef.current();
    const onHide = () => {
      if (document.hidden) interruptRef.current();
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHide);
    const offPlace = usePlaceStore.subscribe((st, prev) => {
      if (st.active !== prev.active) dropRef.current();
    });
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHide);
      offPlace();
    };
  }, []);
  useEffect(() => {
    if (inCall || idle) interruptRef.current();
  }, [inCall, idle]);

  /** A line while he is carried, set down or dizzy: outside every quiet time, and calm. */
  const sayCarry = useCallback(
    (topic: 'held' | 'landed' | 'dizzy' | 'tricks' | 'stay') => {
      const t = nowRef.current();
      const p = presence.current;
      q.away = p.place === null || p.night || document.hidden;
      if (quietNow(q, t)) return;
      let which = topic;
      if (which === 'dizzy' && t - lastDizzyLine.current < DIZZY_LINE_GAP_MS) which = 'landed';
      if (which === 'tricks' || which === 'stay') {
        if (t - lastCarryLine.current < CARRY_LINE_GAP_MS) return;
      } else if (which !== 'dizzy' && !carry.current.mayTalk) return;
      // Another bubble is showing: wait for it, except his own held line, which the landing replaces.
      const showing = bubbleRef.current;
      if (showing && showing.id !== heldBubble.current) return;
      const line = lineFrom(which, chat.current.lastLine, Math.random);
      markSpoken(chat.current, line, t);
      lastCarryLine.current = t;
      if (which === 'dizzy') lastDizzyLine.current = t;
      heldBubble.current = which === 'held' ? (showing?.id ?? 0) + 1 : 0;
      show(line);
    },
    [q, show],
  );
  const sayCarryRef = useRef(sayCarry);
  sayCarryRef.current = sayCarry;

  // The tricks in his card. Each is refused quietly (the buttons are off, with the reason as their
  // tooltip) in a call, in the first minute of focus, while he is asleep and while he is away.
  const refusal = (): string | null => {
    const p = presence.current;
    if (!p.place || p.opacity < 0.5) return 'Watt is away';
    if (q.inCall) return 'Not during a call or meeting';
    if (q.focusSince !== null && nowRef.current() - q.focusSince < FOCUS_QUIET_MS) return 'Not in the first minute of focus';
    if (p.night) return 'Watt is asleep';
    return null;
  };
  const refusalRef = useRef(refusal);
  refusalRef.current = refusal;
  const setStay = useCallback(
    (on: boolean) => {
      const p = presence.current;
      const c = carry.current;
      const t = tNowRef.current();
      if (!on) {
        endStay(c, t);
        petRef.current = { ...petRef.current, stay: null };
        update((d) => (d.stay ? { ...d, stay: null } : d));
        wake.current();
        return;
      }
      if (!p.place || !p.camera || refusalRef.current()) return;
      const walk = WALKS[p.place];
      // Where he was last set down (he is sitting there now), else where he stands.
      const x = landingX(walk, c.mode === NONE ? frameRef.current.x : c.x);
      const dir = frameRef.current.dir;
      startStay(c, t, x, dir);
      const stay = { place: p.place as StayPlace, x, date: dayKey(nowRef.current()) };
      petRef.current = { ...petRef.current, stay };
      update((d) => ({ ...d, stay }));
      wake.current();
      sayCarryRef.current('stay');
    },
    [update],
  );
  const doTrick = useCallback(
    (kind: Trick) => {
      if (refusalRef.current()) return;
      const p = presence.current;
      if (!p.place || !p.camera || carry.current.mode === HELD) return;
      if (kind === 'hop') startReact.current('hop');
      else if (kind === 'spin') startReact.current('spin');
      else if (kind === 'nap') {
        napUntil.current = nowRef.current() + NAP_MS;
        window.clearTimeout(napTimer.current);
        napTimer.current = window.setTimeout(() => wake.current(), NAP_MS + 100);
        wake.current();
      } else if (kind === 'come' && !carry.current.stay) {
        const walk = WALKS[p.place];
        const mid = middle(walk);
        const f = frameRef.current;
        if (Math.abs(f.x - mid) < 1) wanderT.current = 0;
        else callCarry(carry.current, tNowRef.current(), f.x, mid >= f.x ? 1 : -1, mid);
        wake.current();
      }
      sayCarryRef.current('tricks');
    },
    [],
  );
  const napTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(napTimer.current), []);
  const readWithMe = useCallback(() => {
    const st = useFocusStore.getState();
    if (st.state.status === 'running' || st.state.status === 'paused') return;
    st.start();
  }, []);

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
    const hb = createBox();
    const body = createBox();
    const head = createBox();
    const wp = createWander();
    const wc = createWander();
    let originAir = false;
    let wasLive = false;
    /** One-shot: set when she reaches the clover, cleared when a new clover grows. */
    let cloverTaken = false;
    let cloverSeen: Clover | null = null;
    let reactAt = -Infinity;
    const tNow = () => (reduced ? performance.now() / 1000 : T);

    /** Advance the presence; returns true when the loop can stop (see `isIdle`). */
    const step = (dt: number) => {
      readClock(clock, nowRef.current());
      const place = wattPlaceFor(usePlaceStore.getState().active, inCallRef.current);
      const camera = place ? cameraOf(place, clock) : null;
      const ready = cameraReady(place, camera, cameraSignal());
      stepPresence(p, place, camera, clock.night, ready, dt, reduced);
      const c = carry.current;
      if (c.mode !== NONE) {
        // Gone from the place he was carried on (or the camera moving off): nothing to set down.
        if (!ready || !p.place || p.place !== place || !p.camera) dropRef.current();
        else {
          const walk = WALKS[p.place];
          const home = c.mode === RETURN ? wanderAt(walk, wanderT.current, wc).x : 0;
          stepCarry(c, dt, tNow(), p.camera.hy, walk.px, home, reduced, f);
        }
      }
      // Stay: kept in the stored record; applied once he stands on its place, ended when it is gone.
      const st = petRef.current.stay;
      if (p.place && p.camera && p.opacity > 0.5) {
        if (st && !c.stay && c.mode === NONE && p.place === st.place) startStay(c, tNow(), landingX(WALKS[p.place], st.x), 1);
        else if (!st && c.stay) endStay(c, tNow());
      }
      if (c.arrived) {
        // Called to the middle: the wander picks up from there.
        c.arrived = false;
        if (c.target === c.target) {
          c.target = Number.NaN;
          if (c.mode === NONE) wanderT.current = 0;
        }
      }
      mind.current.carry = c.mode !== NONE;
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
      const cr = carry.current;
      const air = airborne(cr);
      if (el) {
        el.style.opacity = String(p.opacity);
        // Carried, he is drawn above the cards.
        const z = air ? '40' : '';
        if (el.style.zIndex !== z) el.style.zIndex = z;
      }
      const live = p.place !== null && p.camera !== null && p.opacity > 0.5;
      // Away, waiting for the camera or fading: nothing of hers takes the pointer or the keyboard.
      const pe = live ? 'auto' : 'none';
      const vis = live ? '' : 'hidden';
      // The amber mark and the clover are hidden while he is off the ground.
      const visA = live && !air ? '' : 'hidden';
      const tab = live ? 0 : -1;
      for (let i = 0; i < 2; i++) {
        const e = hitParts_[i].current;
        if (e && e.style.pointerEvents !== pe) e.style.pointerEvents = pe;
      }
      switchOff(hit.current, tab, vis);
      switchOff(markEl.current, markStaticRef.current ? -1 : tab, visA);
      switchOff(cloverEl.current, tab, visA);
      if (!live || air) {
        if (markEl.current) markEl.current.style.pointerEvents = 'none';
        if (cloverEl.current) cloverEl.current.style.pointerEvents = 'none';
      }
      if (live !== wasLive) {
        wasLive = live;
        if (!live) {
          if (cardRef.current) closeRef.current();
          quietRef.current();
        }
      }
      if (!p.place || !p.camera) return;
      const walk = WALKS[p.place];
      const mi = mind.current;
      mi.reactT = tNow() - reactAt;
      // He notices a pointer that moved lately (never under reduced motion, which stands still).
      const pr = ptrRaw.current;
      mi.pointerOn = !reduced && tNow() - pr.t < NOTICE_S;
      if (mi.pointerOn) {
        const at = toStage(pr.x, pr.y);
        mi.pointerX = at.x;
        mi.pointerY = at.y;
      }
      const ff = ffEl.current;
      if (ff) {
        if (mi.firefly) {
          // One slow loop round his head, kept in the band; blinking, never brighter than his wool.
          const cx = f.x + spriteWidth('idle', walk.px) / 2;
          const tt = tNow();
          mi.fireflyX = Math.min(walk.right - 12, Math.max(walk.min - 30, cx + 95 * Math.sin(tt * 0.5) + 35 * Math.sin(tt * 1.3)));
          mi.fireflyY = Math.min(p.camera.hy - 14, Math.max(walk.ceiling + 4, p.camera.hy - spriteHeight('idle', walk.px) - 14 + 24 * Math.sin(tt * 0.8 + 1)));
          ff.style.left = `${mi.fireflyX}px`;
          ff.style.top = `${mi.fireflyY}px`;
          ff.style.opacity = String(0.5 + 0.4 * (0.5 + 0.5 * Math.sin(tt * 2.1)));
        } else if (ff.style.opacity !== '0') ff.style.opacity = '0';
      }
      mi.lie = napUntil.current > 0 && nowRef.current() < napUntil.current && !p.night;
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
      if (cr.mode !== NONE) carryFrame(cr, tNow(), p.camera.hy, walk.px, reduced, mi, f);
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
      frameRef.current.dir = f.dir;
      const s = sheep.current;
      if (s) {
        // Carried, he tilts about his back (the pendulum); otherwise about his feet.
        if (air !== originAir) {
          originAir = air;
          s.style.transformOrigin = air ? '50% 14%' : '';
        }
        const tilt = f.tilt !== 0 ? ` rotate(${f.tilt}deg)` : '';
        s.style.transform = `translate(${f.x}px,${y - f.lift}px) scaleX(${f.dir}) scaleY(${f.squash})${tilt}`;
      }
      const h = hit.current;
      if (h) {
        const held = cr.mode === HELD;
        const want = held ? 'auto' : '';
        if (h.style.pointerEvents !== want) h.style.pointerEvents = want;
        if (h.classList.contains('carrying') !== held) h.classList.toggle('carrying', held);
        h.style.left = `${f.x}px`;
        h.style.top = `${y - f.lift}px`;
        h.style.width = `${width}px`;
        h.style.height = `${spriteHeight(f.pose, walk.px)}px`;
        // Her visible shape: the body and the head, not the empty corners.
        hitParts(f.pose, f.dir, body, head);
        const bEl = hitParts_[0].current;
        const hEl = hitParts_[1].current;
        if (bEl) {
          bEl.style.left = `${body.left * walk.px}px`;
          bEl.style.top = `${body.top * walk.px}px`;
          bEl.style.width = `${body.width * walk.px}px`;
          bEl.style.height = `${body.height * walk.px}px`;
        }
        if (hEl) {
          hEl.style.left = `${head.left * walk.px}px`;
          hEl.style.top = `${head.top * walk.px}px`;
          hEl.style.width = `${head.width * walk.px}px`;
          hEl.style.height = `${head.height * walk.px}px`;
        }
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
        const e = sparks[i].current;
        if (!e) continue;
        const k = reduced ? 0.4 + i * 0.3 : Math.min(1, (mi.reactT / REACT_S.sparkle) * 0.9 + i * 0.1);
        driftAt('note', walk, f.x, y, width, i, k, drift);
        e.style.opacity = f.sparkle ? String(reduced ? 0.9 : Math.sin(Math.PI * k) * 0.95) : '0';
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
        // Her card takes the band while it is open.
        b.style.visibility = cardRef.current ? 'hidden' : '';
        if (air) {
          placeCarriedBubble(f.x, y - f.lift, width, bub.width, bub.height, BUBBLE.tail, bp);
          bp.leftSide = bp.left < f.x;
        } else placeBubble(walk, p.camera.hy, f.x, y, width, bub.width, bub.height, bp);
        b.style.left = `${bp.left}px`;
        b.style.top = `${bp.top}px`;
        b.dataset.side = bp.leftSide ? 'left' : 'right';
      }
      const mk = markEl.current;
      if (mk) {
        markBox(walk, f.x, y, width, mb);
        markHitBox(walk, p.camera.hy, mb, hb);
        mk.style.left = `${hb.left}px`;
        mk.style.top = `${hb.top}px`;
        mk.style.pointerEvents = live && !air && f.mark && !markStaticRef.current ? 'auto' : 'none';
      }
      const cl = cloverEl.current;
      const clv = cloverRef.current;
      if (cl && clv) {
        if (reduced) {
          cb.left = f.x + width + walk.px;
          cb.top = p.camera.hy - CLOVER.length * SMALL_PX;
        } else cloverBox(walk, p.camera.hy, clv.stop, cb);
        cb.width = CLOVER[0].length * SMALL_PX;
        cb.height = CLOVER.length * SMALL_PX;
        cloverHitBox(walk, p.camera.hy, cb, hb);
        cl.style.left = `${hb.left}px`;
        cl.style.top = `${hb.top}px`;
        cl.style.pointerEvents = live && !air ? 'auto' : 'none';
        cloverAt.current.x = hb.left + hb.width / 2;
        cloverAt.current.y = hb.top + hb.height / 2;
        cloverAt.current.on = true;
      } else cloverAt.current.on = false;
    };

    /** Outside the paint: she reaches the clover's stop and stands there, so she eats it (once). */
    const reachClover = () => {
      const clv = cloverRef.current;
      if (clv !== cloverSeen) {
        cloverSeen = clv;
        cloverTaken = false;
      }
      if (!clv || cloverTaken || reduced || !p.place || p.night || mind.current.nap || holdsStill(mind.current)) return;
      if (atClover(WALKS[p.place], wanderT.current, clv.stop, wp)) {
        cloverTaken = true;
        eatRef.current();
      }
    };

    /** Outside the paint: the lines a carry asks for (held, landed, dizzy). */
    const carryTalk = () => {
      const c = carry.current;
      if (c.sayHeld) {
        c.sayHeld = false;
        sayCarryRef.current('held');
      }
      if (c.sayLanded) {
        c.sayLanded = false;
        if (!c.fed) sayCarryRef.current(c.shaken ? 'dizzy' : 'landed');
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
      reachClover();
      carryTalk();
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
        carryTalk();
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

    tNowRef.current = tNow;
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
      tNowRef.current = () => performance.now() / 1000;
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
        aria-label="Watt, the sheep. Press Enter to pet him, or the letter M for his card."
        title={WATT_TIP}
        onClick={onHitClick}
        onKeyDown={onHitKeyDown}
        onPointerDown={onHitPointerDown}
        onPointerMove={onHitPointerMove}
        onPointerUp={onHitPointerUp}
        onPointerCancel={onHitPointerCancel}
        onLostPointerCapture={onHitLostCapture}
      >
        <span className="watt-hit-part" ref={hitParts_[0]} />
        <span className="watt-hit-part" ref={hitParts_[1]} />
      </button>
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
      <span className="watt-firefly" ref={ffEl} aria-hidden="true">
        <PixelSvg map={FIREFLY} px={SMALL_PX} />
      </span>
      <span className="watt-spark" ref={sparks[0]} aria-hidden="true">
        <PixelSvg map={PROP_SPRITES.star.map} px={SMALL_PX} />
      </span>
      <span className="watt-spark" ref={sparks[1]} aria-hidden="true">
        <PixelSvg map={PROP_SPRITES.star.map} px={SMALL_PX} />
      </span>
      <span className="watt-z" ref={zs[0]} aria-hidden="true">
        z
      </span>
      <span className="watt-z sm" ref={zs[1]} aria-hidden="true">
        z
      </span>
      {markStatic ? (
        // On Work with no link the agent cards above already show what waits: the mark only tells.
        <span className="watt-mark static" ref={setMark} hidden={!look.mark} role="img" aria-label="Something waits for you in the agent cards above." title="Something waits for you in the agent cards above.">
          <PixelSvg map={MARK} px={SMALL_PX} />
        </span>
      ) : (
        <button
          type="button"
          className="watt-mark"
          ref={setMark}
          hidden={!look.mark}
          aria-label={firstId ? 'Something waits for you. Open it.' : 'Something waits for you. Go to Work.'}
          title={firstId ? 'Something waits for you. Click to open it.' : 'Something waits for you on Work. Click to go there.'}
          onClick={openWaiting}
        >
          <PixelSvg map={MARK} px={SMALL_PX} />
        </button>
      )}
      {clover && (
        <button type="button" className="watt-clover" ref={cloverEl} aria-label="A clover. Give it to Watt." title="A clover. Click to give it to him, or carry Watt here." onClick={eatClover}>
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
          tricks={{
            refused: refusal(),
            napping: napUntil.current > 0 && now() < napUntil.current,
            stay: pet.stay !== null,
            focusBusy: focus.status === 'running' || focus.status === 'paused',
            focusMinutes: focus.minutes,
            onTrick: doTrick,
            onStay: setStay,
            onRead: readWithMe,
          }}
          onBlur={onCardBlur}
          onChatty={chooseChatty}
          onCosmetic={chooseCosmetic}
        />
      )}
    </div>
  );
}
