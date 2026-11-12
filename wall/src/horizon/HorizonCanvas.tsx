import { useEffect, useRef } from 'react';
import { STAGE_HEIGHT, STAGE_WIDTH, fitScale } from '../stage/fitScale';
import { HORIZON_Y, drawHorizon } from './index';

/** Canvas filling the stage. Backing store = stage scale x devicePixelRatio. */
export function HorizonCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => {
      const scale = fitScale(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1);
      const width = Math.round(STAGE_WIDTH * scale);
      const height = Math.round(STAGE_HEIGHT * scale);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawHorizon(ctx, { width, height, horizonY: HORIZON_Y, scale });
    };
    paint();
    window.addEventListener('resize', paint);
    return () => window.removeEventListener('resize', paint);
  }, []);

  return <canvas ref={ref} className="horizon-canvas" aria-hidden="true" />;
}
