import { IconMusic } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioStore } from '../audio/store';
import { frameDelta, shouldDraw } from '../horizon/pacing';
import { cameraSignal, subscribeCamera } from '../horizon/signal';
import { usePlaceStore } from '../state/places';
import { reviewNow } from '../ui/reviewClock';
import { useReducedMotion } from '../ui/useReducedMotion';
import {
  NOTE_SIZES,
  WALKS,
  buddyFrame,
  cameraOf,
  cameraReady,
  createClock,
  createDrift,
  createFrame,
  createPresence,
  driftAt,
  isIdle,
  readClock,
  spriteHeight,
  spriteWidth,
  stepPresence,
  wattPlaceFor,
} from './model';
import { SPRITES, SPRITE_PX, pixelColor, type Pose } from './sprites';
import './watt.css';

export function SheepSvg({ pose, px = SPRITE_PX }: { pose: Pose; px?: number }) {
  const map = SPRITES[pose];
  const rects = useMemo(() => {
    const out: { x: number; y: number; c: string }[] = [];
    map.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = pixelColor(map, x, y);
        if (c) out.push({ x, y, c });
      }
    });
    return out;
  }, [map]);
  return (
    <svg width={map[0].length * px} height={map.length * px} shapeRendering="crispEdges">
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x * px} y={r.y * px} width={px} height={px} fill={r.c} />
      ))}
    </svg>
  );
}

/**
 * Watt the electric sheep, on the horizon band of every place that has one: Work, Home, Meet (not
 * in a call) and Unwind. Mounted once, over the horizon and under the panels. It is up only while
 * the horizon's camera is settled on its place (`horizon/signal.ts`), so a place change or a turn
 * fades it out and back in where it belongs.
 *
 * `inCall` hides it on Meet; nothing detects a call yet (the in-call pull request wires it).
 * `now` (epoch milliseconds) defaults to the review clock in a dev review still, the system clock otherwise.
 */
export function Watt({ now = reviewNow ?? Date.now, inCall = false }: { now?: () => number; inCall?: boolean }) {
  // A review still (dev only) is one frozen frame: Watt stands still in the middle of its range.
  const reduced = useReducedMotion() || reviewNow !== undefined;
  const nowRef = useRef(now);
  nowRef.current = now;
  const inCallRef = useRef(inCall);
  inCallRef.current = inCall;
  const [look, setLook] = useState<{ pose: Pose; px: number }>({ pose: 'idle', px: SPRITE_PX });
  const lookRef = useRef(look);

  // Kept across a reduced motion toggle, so Watt does not start over.
  const presence = useRef(createPresence());
  const wake = useRef<() => void>(() => {});

  const actor = useRef<HTMLDivElement>(null);
  const sheep = useRef<HTMLDivElement>(null);
  const notes = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const zs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];

  useEffect(() => {
    let T = 0;
    let last = 0;
    let raf = 0;
    let timer = 0;
    const p = presence.current;
    const clock = createClock();
    const f = createFrame();
    const drift = createDrift();

    /** Advance the presence; returns true when the loop can stop (see `isIdle`). */
    const step = (dt: number) => {
      readClock(clock, nowRef.current());
      const place = wattPlaceFor(usePlaceStore.getState().active, inCallRef.current);
      const camera = place ? cameraOf(place, clock) : null;
      const ready = cameraReady(place, camera, cameraSignal());
      stepPresence(p, place, camera, clock.night, ready, dt, reduced);
      return isIdle(p, place, ready);
    };

    const paint = () => {
      if (document.hidden) return;
      const el = actor.current;
      if (el) el.style.opacity = String(p.opacity);
      if (!p.place || !p.camera) return;
      const walk = WALKS[p.place];
      buddyFrame(walk, p.night, p.since, useAudioStore.getState().playing, reduced, f);
      if (f.pose !== lookRef.current.pose || walk.px !== lookRef.current.px) {
        lookRef.current = { pose: f.pose, px: walk.px };
        setLook(lookRef.current);
      }
      const width = spriteWidth(f.pose, walk.px);
      const y = p.camera.hy - spriteHeight(f.pose, walk.px);
      const s = sheep.current;
      if (s) s.style.transform = `translate(${f.x}px,${y}px) scaleX(${f.dir})`;
      for (let i = 0; i < 2; i++) {
        const e = notes[i].current;
        if (!e) continue;
        const k = (T * 0.55 + i * 0.5) % 1;
        driftAt('note', walk, f.x, y, width, i, k, drift);
        e.style.opacity = f.notes ? String(Math.sin(Math.PI * k) * 0.95) : '0';
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
      document.removeEventListener('visibilitychange', onVisible);
      offPlace();
      offCamera();
      wake.current = () => {};
    };
  }, [reduced]);

  // A call starting or ending wakes the loop (or repaints the still pose) at once.
  useEffect(() => {
    wake.current();
  }, [inCall]);

  return (
    <div className="watt" ref={actor} aria-hidden="true">
      <div className="watt-sheep" ref={sheep}>
        <SheepSvg pose={look.pose} px={look.px} />
      </div>
      <span className="watt-note" ref={notes[0]}>
        <IconMusic size={NOTE_SIZES[0]} stroke={2} />
      </span>
      <span className="watt-note cy" ref={notes[1]}>
        <IconMusic size={NOTE_SIZES[1]} stroke={2} />
      </span>
      <span className="watt-z" ref={zs[0]}>
        z
      </span>
      <span className="watt-z sm" ref={zs[1]}>
        z
      </span>
    </div>
  );
}
