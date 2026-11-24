import { useCallback, useEffect, useRef, useState } from 'react';
import { askBrief, briefHealth, type AskModel, type AskTurn, type BriefHealth } from '../bridge/meetBrief';
import { useAwake } from '../onair/useNow';
import { usePlaceStore } from '../state/places';
import { askGate, capTurns, checkHealth, cleanQuestion, errorWord, HEALTH_EVERY_MS, MAX_A, type AskGate } from './askModel';

export type AskView = { q: string; phase: 'asking'; seconds: number } | { q: string; phase: 'done'; a: string; model: AskModel } | { q: string; phase: 'error'; word: string };

export interface BriefAsk {
  gate: AskGate;
  health: BriefHealth['ask'] | null;
  /** The panel's content, or null while the feed shows. */
  view: AskView | null;
  hasTurns: boolean;
  send: (raw: string) => boolean;
  /** Leave the panel; a question still on its way is dropped. The earlier turns stay for a follow up. */
  back: () => void;
  /** Leave the panel and forget every earlier turn. */
  clear: () => void;
}

type Slot = { q: string; phase: 'asking'; at: number } | { q: string; phase: 'done'; a: string; model: AskModel } | { q: string; phase: 'error'; word: string };

/**
 * One question at a time for the hero meeting's brief. Nothing is sent until `send` (Enter). The question, the answer and the
 * last three turns live in component memory only: they clear when the meeting key changes, when Meet hides or when On Air
 * goes live. Health is read when Meet shows and every 60 s while the brief is ready, never while hidden.
 */
export function useBriefAsk(key: string | null, briefReady: boolean, onAir: boolean): BriefAsk {
  const awake = useAwake();
  const onMeet = usePlaceStore((s) => s.active === 'meet');
  const live = awake && onMeet;
  const [health, setHealth] = useState<BriefHealth['ask'] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const run = useRef(0);

  const reset = useCallback(() => {
    run.current += 1;
    setSlot(null);
    setTurns([]);
  }, []);

  // A new meeting, Meet hiding or On Air going live forgets the question, the answer and the turns.
  useEffect(() => {
    reset();
  }, [key, reset]);
  useEffect(() => {
    if (!live || onAir) reset();
  }, [live, onAir, reset]);

  const reading = live && !!key && briefReady && !onAir;
  useEffect(() => {
    if (!reading) {
      setHealth(null);
      return;
    }
    let dead = false;
    const read = () =>
      briefHealth().then(
        (h) => !dead && setHealth(checkHealth(h)),
        () => !dead && setHealth(null),
      );
    read();
    const t = setInterval(read, HEALTH_EVERY_MS);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [reading]);

  const asking = slot?.phase === 'asking';
  useEffect(() => {
    if (!asking) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [asking]);

  const gate = askGate({ briefReady, onAir, health });

  const send = useCallback(
    (raw: string): boolean => {
      const q = cleanQuestion(raw);
      if (!q || !key || !gate.enabled || !live || slot?.phase === 'asking') return false;
      const mine = ++run.current;
      setSlot({ q, phase: 'asking', at: Date.now() });
      setNow(Date.now());
      askBrief(key, q, capTurns(turns)).then(
        (out) => {
          if (run.current !== mine) return;
          const a = typeof out?.a === 'string' ? out.a.slice(0, MAX_A) : '';
          if (!a) {
            setSlot({ q, phase: 'error', word: errorWord('failed') });
            return;
          }
          const model: AskModel = out.model === 'Sonnet' || out.model === 'Opus' ? out.model : 'Claude';
          setSlot({ q, phase: 'done', a, model });
          setTurns((t) => capTurns([...t, { q, a }]));
          briefHealth().then((h) => run.current === mine && setHealth(checkHealth(h)), () => {});
        },
        (e) => {
          if (run.current !== mine) return;
          setSlot({ q, phase: 'error', word: errorWord(e) });
        },
      );
      return true;
    },
    [key, gate.enabled, live, slot?.phase, turns],
  );

  const back = useCallback(() => {
    run.current += 1;
    setSlot(null);
  }, []);

  const view: AskView | null = !slot ? null : slot.phase === 'asking' ? { q: slot.q, phase: 'asking', seconds: (now - slot.at) / 1000 } : slot;
  return { gate, health, view, hasTurns: turns.length > 0, send, back, clear: reset };
}
