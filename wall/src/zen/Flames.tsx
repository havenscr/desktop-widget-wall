import { useEffect, useRef, useState } from 'react';
import flame192 from '../assets/flames/flame-192.webp';
import flame470 from '../assets/flames/flame-470.webp';
import flame522 from '../assets/flames/flame-522.webp';
import flameLoop from '../assets/flames/flame-loop.webm';
import { useDisplayDark } from '../ui/useDisplayDark';
import { useReducedMotion } from '../ui/useReducedMotion';
import { DREAM_DIM, FLAME_FADE_MS, FLAME_ROTATE_MS, flamePair } from './model';

export const FLAMES = [flame192, flame470, flame522] as const;
export { flameLoop };

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
 * The fallback when the video cannot play: two stacked, slowly drifting flame layers (the lower one plain,
 * the upper one screen-blended). Every few minutes the pair changes to the next flames with a long cross-fade.
 */
function Layers() {
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
    const id = window.setTimeout(() => setLeaving(null), FLAME_FADE_MS);
    return () => window.clearTimeout(id);
  }, [leaving]);

  return (
    <>
      {leaving !== null && <Pair key={leaving} step={leaving} />}
      <Pair key={step} step={step} />
    </>
  );
}

/** True while the page is hidden. */
function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

/**
 * The flame behind Zen: a seamless 150 second loop (`flame-loop.webm`, rendered by `scripts/flame-loop.mjs`), muted and
 * covering the stage. It is paused while the page is hidden or the display is off, and plays again after. Under reduced
 * motion there is no video, only the still flame. If the video errors, the drifting still layers take over.
 */
export function Flames({ dim = false }: { dim?: boolean }) {
  const reduced = useReducedMotion();
  const dark = useDisplayDark();
  const hidden = usePageHidden();
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const paused = hidden || dark;
  const useVideo = !reduced && !failed;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (paused) v.pause();
    else void Promise.resolve(v.play()).catch(() => {});
  }, [paused, useVideo]);

  return (
    <div
      className={`flames${reduced ? ' still' : ''}`}
      data-dim={dim ? 'true' : 'false'}
      style={{ opacity: dim ? DREAM_DIM : 1, ['--fade' as string]: `${FLAME_FADE_MS}ms` }}
      aria-hidden="true"
    >
      {reduced ? (
        <i className="fl-still" style={{ backgroundImage: `url(${flame192})` }} />
      ) : failed ? (
        <Layers />
      ) : (
        <video
          ref={video}
          className="flame-video"
          src={flameLoop}
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
