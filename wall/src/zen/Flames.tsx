import { useEffect, useState } from 'react';
import flame192 from '../assets/flames/flame-192.webp';
import flame470 from '../assets/flames/flame-470.webp';
import flame522 from '../assets/flames/flame-522.webp';
import { useReducedMotion } from '../ui/useReducedMotion';
import { DREAM_DIM, FLAME_FADE_MS, FLAME_ROTATE_MS, flamePair } from './model';

export const FLAMES = [flame192, flame470, flame522] as const;

function Pair({ step }: { step: number }) {
  const { base, top } = flamePair(step * FLAME_ROTATE_MS, FLAMES.length);
  return (
    <div className="fl-pair" data-step={step}>
      <i className="fl" style={{ backgroundImage: `url(${FLAMES[base]})` }} />
      <i className="fl b" style={{ backgroundImage: `url(${FLAMES[top]})` }} />
    </div>
  );
}

/**
 * Two stacked, slowly drifting flame layers filling the stage (the lower one plain, the upper one
 * screen-blended). Every few minutes the pair changes to the next flames with a long cross-fade.
 * Under reduced motion the layers are still and the pair changes without a fade.
 */
export function Flames({ dim = false }: { dim?: boolean }) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStep((s) => {
        setLeaving(s);
        return s + 1;
      });
    }, FLAME_ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (leaving === null) return;
    const id = window.setTimeout(() => setLeaving(null), reduced ? 0 : FLAME_FADE_MS);
    return () => window.clearTimeout(id);
  }, [leaving, reduced]);

  return (
    <div
      className={`flames${reduced ? ' still' : ''}`}
      data-dim={dim ? 'true' : 'false'}
      style={{ opacity: dim ? DREAM_DIM : 1, ['--fade' as string]: `${FLAME_FADE_MS}ms` }}
      aria-hidden="true"
    >
      {leaving !== null && !reduced && <Pair key={leaving} step={leaving} />}
      <Pair key={step} step={step} />
    </div>
  );
}
