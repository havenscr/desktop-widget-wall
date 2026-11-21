import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { tip } from '../ui/HoverTip';
import { useReducedMotion } from '../ui/useReducedMotion';
import { BODY_STEPS, CANDLE_LINE, CANDLE_LINE_MS, INTENTION_QUESTION } from './model';

const CAPTION_FADE_MS = 900;

/** One caption at a time; when the text changes the old line fades out as the new one fades in. Under reduced motion it just swaps. */
function Caption({ text, reduced }: { text: string; reduced: boolean }) {
  const [layers, setLayers] = useState<{ id: number; text: string }[]>([{ id: 0, text }]);
  const next = useRef(1);
  useEffect(() => {
    setLayers((l) => (l[l.length - 1].text === text ? l : reduced ? [{ id: next.current++, text }] : [...l, { id: next.current++, text }]));
  }, [text, reduced]);
  useEffect(() => {
    if (layers.length < 2) return;
    const id = window.setTimeout(() => setLayers((l) => l.slice(-1)), CAPTION_FADE_MS);
    return () => window.clearTimeout(id);
  }, [layers]);
  return (
    <div className="zen-scan-cap" role="status" aria-live="polite">
      {layers.map((l, i) => (
        <p key={l.id} className={i === layers.length - 1 ? 'cur' : 'out'} aria-hidden={i === layers.length - 1 ? undefined : true}>
          {l.text}
        </p>
      ))}
    </div>
  );
}

/** Body scan: an outline figure with a soft ring on the part being named, one caption under it and a thin progress line. */
export function BodyScan({ step, progress }: { step: number; progress: number }) {
  const reduced = useReducedMotion();
  const s = BODY_STEPS[Math.min(BODY_STEPS.length - 1, Math.max(0, step))];
  return (
    <div className="zen-mid zen-scan" data-step={step}>
      <svg className="zen-figure" width="240" height="300" viewBox="0 0 120 150" fill="none" stroke="#e9dcff" strokeWidth="2.2" strokeLinecap="round" opacity="0.9" aria-hidden="true">
        <circle cx="60" cy="22" r="14" />
        <path d="M60 36v54M34 52q26 -10 52 0M34 52l-12 34M86 52l12 34M60 90l-18 50M60 90l18 50" />
        <circle className="zen-figure-hl" cx={s.x} cy={s.y} r={s.r} stroke="#35e6ea" strokeWidth="1.4" opacity="0.6" style={reduced ? { transition: 'none' } : undefined} />
      </svg>
      <Caption text={s.caption} reduced={reduced} />
      <div className="zen-scan-bar" aria-hidden="true">
        <i style={{ width: `${(progress * 100).toFixed(2)}%` }} />
      </div>
    </div>
  );
}

/**
 * Candle: one SVG candle with a gentle flicker (transform and opacity only, kept under reduced motion) and a line that
 * shows for 10 seconds after the session starts, then fades. Before Start the line stays, as a preview.
 */
export function Candle({ running }: { running: boolean }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    setShown(true);
    if (!running) return;
    const id = window.setTimeout(() => setShown(false), CANDLE_LINE_MS);
    return () => window.clearTimeout(id);
  }, [running]);
  return (
    <div className="zen-mid zen-candle">
      <svg width="190" height="317" viewBox="0 0 90 150" aria-hidden="true">
        <defs>
          <radialGradient id="zen-cg">
            <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ff8a4c" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className="zen-candle-glow" cx="45" cy="52" r="44" fill="url(#zen-cg)" />
        <g className="zen-candle-flame">
          <path d="M45 20c10 16 14 26 8 38-3 6-13 6-16 0-6-12-2-22 8-38z" fill="#ffd47a" />
          <path d="M45 36c4 8 5 13 2 19-1 3-5 3-6 0-2-6-1-11 4-19z" fill="#fff6d6" />
        </g>
        <rect x="33" y="66" width="24" height="70" rx="3" fill="#e9dcff" opacity="0.85" />
      </svg>
      <p className={`zen-candle-line${shown ? '' : ' gone'}`} data-shown={shown ? 'true' : 'false'} aria-hidden={shown ? undefined : true}>
        {CANDLE_LINE}
      </p>
    </div>
  );
}

/** Intention before Start: the question and one text field. Enter begins the session; no key typed here reaches anything else on the wall. */
export function IntentionField({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter();
    }
  };
  return (
    <div className="zen-mid zen-intent-pick">
      <p className="zen-q">{INTENTION_QUESTION}</p>
      <input
        className="zen-field"
        type="text"
        value={value}
        maxLength={140}
        aria-label={INTENTION_QUESTION}
        placeholder="One line is enough"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={key}
        onKeyUp={(e) => e.stopPropagation()}
        {...tip('Type one line. Enter or Start begins; it stays faintly behind the session and is kept for today')}
      />
    </div>
  );
}

/** The intention line, faint and large behind a running session. */
export function IntentionLine({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="zen-mid zen-intent-line" aria-hidden="true">
      <p>{text}</p>
    </div>
  );
}
