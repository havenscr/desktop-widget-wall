import { IconBolt, IconCheck } from '@tabler/icons-react';
import type { Tone } from './model';

/** The lane's ring (concept `.ring` at 68 px): progress by stage, a bolt, a check or a "?". */
export function LaneRing({ size, fraction, tone, glyph }: { size: number; fraction: number; tone: Tone; glyph: 'bolt' | 'check' | 'ask' }) {
  const rad = size / 2 - 5;
  const c = 2 * Math.PI * rad;
  const m = size / 2;
  const icon = Math.round(size * 0.38);
  return (
    <span className={`lane-ring t-${tone}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={m} cy={m} r={rad} fill="none" stroke="rgba(255,255,255,.13)" strokeWidth={5} />
        <circle
          cx={m}
          cy={m}
          r={rad}
          fill="none"
          className="lane-arc"
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c.toFixed(1)}
          strokeDashoffset={(c * (1 - fraction)).toFixed(1)}
          transform={`rotate(-90 ${m} ${m})`}
        />
      </svg>
      {glyph === 'bolt' && <IconBolt size={icon} stroke={1.9} />}
      {glyph === 'check' && <IconCheck size={icon} stroke={2.2} />}
      {glyph === 'ask' && <b style={{ fontSize: Math.round(size * 0.36) }}>?</b>}
    </span>
  );
}
