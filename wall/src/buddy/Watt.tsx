import { IconMusic } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioStore } from '../audio/store';
import { CAMERAS } from '../horizon/cameras';
import { frameDelta, shouldDraw } from '../horizon/pacing';
import { usePlaceStore } from '../state/places';
import { useReducedMotion } from '../ui/useReducedMotion';
import { buddyFrame } from './model';
import { SPRITES, SPRITE_PX, pixelColor, type Pose } from './sprites';

const systemNow = () => new Date();

export function SheepSvg({ pose }: { pose: Pose }) {
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
    <svg width={map[0].length * SPRITE_PX} height={map.length * SPRITE_PX} shapeRendering="crispEdges">
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x * SPRITE_PX} y={r.y * SPRITE_PX} width={SPRITE_PX} height={SPRITE_PX} fill={r.c} />
      ))}
    </svg>
  );
}

/** Watt the electric sheep, on the Unwind tab only. */
export function Watt({ now = systemNow }: { now?: () => Date }) {
  const place = usePlaceStore((s) => s.active);
  return place === 'unwind' ? <Scene now={now} /> : null;
}

function Scene({ now }: { now: () => Date }) {
  const reduced = useReducedMotion();
  const playing = useAudioStore((s) => s.playing);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const nowRef = useRef(now);
  nowRef.current = now;
  const [pose, setPose] = useState<Pose>(() => buddyFrame(now(), 0, false, reduced).pose);

  const actor = useRef<HTMLDivElement>(null);
  const sheep = useRef<HTMLDivElement>(null);
  const notes = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const zs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const poseRef = useRef(pose);

  useEffect(() => {
    let T = 0;
    let last = 0;
    let raf = 0;
    let timer = 0;
    const hy = CAMERAS.unwind.hy;

    const paint = () => {
      if (document.hidden) return;
      const f = buddyFrame(nowRef.current(), T, playingRef.current, reduced);
      if (f.pose !== poseRef.current) {
        poseRef.current = f.pose;
        setPose(f.pose);
      }
      const map = SPRITES[f.pose];
      const w = map[0].length * SPRITE_PX;
      const h = map.length * SPRITE_PX;
      const y = hy - h;
      const el = sheep.current;
      if (el) el.style.transform = `translate(${f.x}px,${y}px) scaleX(${f.dir})`;
      notes.forEach((n, i) => {
        const e = n.current;
        if (!e) return;
        const k = (T * 0.55 + i * 0.5) % 1;
        e.style.opacity = f.notes ? String(Math.sin(Math.PI * k) * 0.95) : '0';
        e.style.left = `${f.x + w + 4 + k * 30 + i * 10}px`;
        e.style.top = `${y - 6 - k * 44}px`;
      });
      zs.forEach((z, i) => {
        const e = z.current;
        if (!e) return;
        const k = (T * 0.3 + i * 0.5) % 1;
        e.style.opacity = f.z ? String(Math.sin(Math.PI * k) * 0.9) : '0';
        e.style.left = `${f.x + w - 4 + k * 26}px`;
        e.style.top = `${y - 14 - k * 46}px`;
      });
    };

    paint();
    const onVisible = () => paint();
    if (reduced) {
      // One still pose; notice the hour changing (and the page returning) once a minute.
      timer = window.setInterval(paint, 60_000);
      document.addEventListener('visibilitychange', onVisible);
    } else {
      const frame = (ts: number) => {
        raf = requestAnimationFrame(frame);
        if (!shouldDraw(ts, last, document.hidden)) return;
        T += frameDelta(ts, last);
        last = ts;
        paint();
      };
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reduced]);

  return (
    <div className="watt" ref={actor} aria-hidden="true">
      <div className="watt-sheep" ref={sheep}>
        <SheepSvg pose={pose} />
      </div>
      <span className="watt-note" ref={notes[0]}>
        <IconMusic size={20} stroke={2} />
      </span>
      <span className="watt-note cy" ref={notes[1]}>
        <IconMusic size={15} stroke={2} />
      </span>
      <span className="watt-z" ref={zs[0]}>z</span>
      <span className="watt-z sm" ref={zs[1]}>z</span>
    </div>
  );
}
