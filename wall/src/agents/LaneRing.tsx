import { IconAlertTriangle, IconBolt, IconCheck } from '@tabler/icons-react';

/**
 * The card's ring (concept `.ring` at 68 px): progress by stage in the stage's colour
 * (`--c`, set by the card), amber while it waits, red when it failed; a bolt, a check, a
 * "?" or a warning sign. `num` is the card's number, which the ribbon's agent bars repeat.
 */
export function LaneRing({
  size,
  fraction,
  tone,
  glyph,
  num,
}: {
  size: number;
  fraction: number;
  tone: 'stage' | 'amber' | 'red' | 'cyan' | 'mint';
  glyph: 'bolt' | 'check' | 'ask' | 'failed';
  num?: number;
}) {
  const rad = size / 2 - 5;
  const c = 2 * Math.PI * rad;
  const m = size / 2;
  const icon = Math.round(size * 0.38);
  return (
    <span className={`lane-ring${tone === 'stage' ? '' : ` t-${tone}`}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg className="lane-ring-svg" viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
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
      {glyph === 'failed' && <IconAlertTriangle size={icon} stroke={1.9} />}
      {glyph === 'ask' && <b style={{ fontSize: Math.round(size * 0.36) }}>?</b>}
      {num !== undefined && <span className="lane-num">{num}</span>}
    </span>
  );
}
