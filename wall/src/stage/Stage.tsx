import { useEffect, useState, type ReactNode } from 'react';
import { fitScale } from './fitScale';

function currentScale(): number {
  return fitScale(window.innerWidth, window.innerHeight);
}

/** Fixed 2560 x 720 surface, scaled uniformly to the window and centred on black. */
export function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(currentScale);

  useEffect(() => {
    const onResize = () => setScale(currentScale());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="stage-host">
      <div
        className="stage"
        data-scale={scale}
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

export { currentScale };
