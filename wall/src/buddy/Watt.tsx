import { IconMusic } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioStore } from '../audio/store';
import { frameDelta, shouldDraw } from '../horizon/pacing';
import { usePlaceStore } from '../state/places';
import { reviewDate } from '../ui/reviewClock';
import { useReducedMotion } from '../ui/useReducedMotion';
import { NOTE_SIZES, WALKS, buddyFrame, driftAt, groundFor, initialPresence, spotFor, spriteSize, stepPresence, type Presence } from './model';
import { SPRITES, SPRITE_PX, pixelColor, type Pose } from './sprites';
import './watt.css';

const systemNow = () => new Date();

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
 * in a call) and Unwind. Mounted once, over the horizon and under the panels. A place change fades
 * it out and back in at the new place once the camera has settled.
 *
 * `inCall` hides it on Meet; nothing detects a call yet (the in-call pull request wires it).
 * `now` defaults to the review clock in a dev review still, the system clock otherwise.
 */
export function Watt({ now = reviewDate ?? systemNow, inCall = false }: { now?: () => Date; inCall?: boolean }) {
  // A review still (dev only) is one frozen frame: Watt stands still in the middle of its range.
  const reduced = useReducedMotion() || reviewDate !== undefined;
  const nowRef = useRef(now);
  nowRef.current = now;
  const inCallRef = useRef(inCall);
  inCallRef.current = inCall;
  const [look, setLook] = useState<{ pose: Pose; px: number }>({ pose: 'idle', px: SPRITE_PX });

  const actor = useRef<HTMLDivElement>(null);
  const sheep = useRef<HTMLDivElement>(null);
  const notes = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const zs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const lookRef = useRef(look);

  useEffect(() => {
    let T = 0;
    let last = 0;
    let raf = 0;
    let timer = 0;
    const want = () => {
      const ms = nowRef.current().getTime();
      return { ms, spot: spotFor(usePlaceStore.getState().active, ms, inCallRef.current) };
    };
    const first = want();
    let presence: Presence = initialPresence(first.spot);

    const paint = (dt: number) => {
      const w = want();
      presence = stepPresence(presence, w.spot, dt, w.ms, reduced);
      if (document.hidden) return;
      const el = actor.current;
      if (el) el.style.opacity = String(presence.opacity);
      const spot = presence.at;
      if (!spot) return;
      const walk = WALKS[spot.place];
      const f = buddyFrame(walk, new Date(w.ms), presence.since, useAudioStore.getState().playing, reduced);
      if (f.pose !== lookRef.current.pose || walk.px !== lookRef.current.px) {
        lookRef.current = { pose: f.pose, px: walk.px };
        setLook(lookRef.current);
      }
      const { w: width, h } = spriteSize(f.pose, walk.px);
      const y = groundFor(spot) - h;
      const s = sheep.current;
      if (s) s.style.transform = `translate(${f.x}px,${y}px) scaleX(${f.dir})`;
      notes.forEach((n, i) => {
        const e = n.current;
        if (!e) return;
        const k = (T * 0.55 + i * 0.5) % 1;
        const at = driftAt('note', walk, f.x, y, width, i, k);
        e.style.opacity = f.notes ? String(Math.sin(Math.PI * k) * 0.95) : '0';
        e.style.left = `${at.left}px`;
        e.style.top = `${at.top}px`;
      });
      zs.forEach((z, i) => {
        const e = z.current;
        if (!e) return;
        const k = (T * 0.3 + i * 0.5) % 1;
        const at = driftAt('z', walk, f.x, y, width, i, k);
        e.style.opacity = f.z ? String(Math.sin(Math.PI * k) * 0.9) : '0';
        e.style.left = `${at.left}px`;
        e.style.top = `${at.top}px`;
      });
    };

    paint(0);
    const onVisible = () => paint(0);
    let unsubscribe = () => {};
    if (reduced) {
      // One still pose; notice the hour changing (and the page returning) once a minute, and a
      // place change at once (Watt jumps there, as the horizon does).
      timer = window.setInterval(() => paint(0), 60_000);
      document.addEventListener('visibilitychange', onVisible);
      unsubscribe = usePlaceStore.subscribe(() => paint(0));
    } else {
      const frame = (ts: number) => {
        raf = requestAnimationFrame(frame);
        if (!shouldDraw(ts, last, document.hidden)) return;
        const dt = frameDelta(ts, last);
        T += dt;
        last = ts;
        paint(dt);
      };
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe();
    };
  }, [reduced]);

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
