import { IconSunrise, IconSunset } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';
import { CURVE_BASE, CURVE_H, CURVE_W, labelSpots, type DayCurve } from './dayCurve';

/**
 * The day as a low curve under the headline, midnight to midnight: the sun's place on it by
 * day, a ring on the dip at night, the two crossings labelled. Still (no animation); the
 * parent redraws it once a minute at most.
 */
export function SunCurve({ curve: c }: { curve: DayCurve }) {
  const up = c.phase === 'day';
  const spots = labelSpots(c.xRise, c.xSet, c.riseText, c.setText);
  const labelStyle = (s: typeof spots.rise) => ({ top: CURVE_BASE - 30, [s.side]: s.px });
  return (
    <div className="lw-curve" style={{ height: CURVE_H }} role="img" aria-label={c.alt} {...tip(c.tip)}>
      <svg width={CURVE_W} height={CURVE_H} viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} aria-hidden="true">
        <defs>
          <linearGradient id="lw-day" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#ffc24d" />
            <stop offset="1" stopColor="#ff5fa8" />
          </linearGradient>
          <linearGradient id="lw-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffc24d" stopOpacity=".2" />
            <stop offset="1" stopColor="#ff5fa8" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="lw-glow">
            <stop offset="0" stopColor="#ffd27a" stopOpacity=".55" />
            <stop offset="1" stopColor="#ffd27a" stopOpacity="0" />
          </radialGradient>
          <clipPath id="lw-travelled">
            <rect x="0" y="-10" width={c.travelled.toFixed(1)} height={CURVE_H + 20} />
          </clipPath>
        </defs>
        <path d={c.fill} fill="url(#lw-fill)" opacity={up ? 1 : 0.45} />
        <line x1="0" x2={CURVE_W} y1={CURVE_BASE} y2={CURVE_BASE} stroke="rgba(255,255,255,.2)" strokeWidth="1" />
        <path d={c.nightBefore} fill="none" stroke="rgba(154,123,255,.5)" strokeWidth="1.6" strokeLinecap="round" />
        <path d={c.nightAfter} fill="none" stroke="rgba(154,123,255,.5)" strokeWidth="1.6" strokeLinecap="round" />
        <path d={c.day} fill="none" stroke="url(#lw-day)" strokeWidth="2.4" strokeLinecap="round" opacity=".38" />
        {up && <path d={c.day} fill="none" stroke="url(#lw-day)" strokeWidth="2.6" strokeLinecap="round" clipPath="url(#lw-travelled)" />}
        <line x1={c.xRise} x2={c.xRise} y1={CURVE_BASE - 5} y2={CURVE_BASE + 5} stroke="rgba(255,255,255,.45)" strokeWidth="1.5" />
        <line x1={c.xSet} x2={c.xSet} y1={CURVE_BASE - 5} y2={CURVE_BASE + 5} stroke="rgba(255,255,255,.45)" strokeWidth="1.5" />
        {up ? (
          <>
            <circle cx={c.xSun} cy={c.ySun} r="22" fill="url(#lw-glow)" />
            <circle className="lw-sun" cx={c.xSun} cy={c.ySun} r="8.5" fill="#ffd98a" stroke="#fff3d6" strokeWidth="1.5" />
          </>
        ) : (
          <circle className="lw-moon" cx={c.xSun} cy={c.ySun} r="7" fill="#120d2e" stroke="#b9a8ff" strokeWidth="2" />
        )}
      </svg>
      <span className="lw-label rise" style={labelStyle(spots.rise)}>
        {!spots.rise.compact && <IconSunrise size={20} stroke={1.7} color="#ffc24d" aria-hidden="true" />}
        {c.riseText}
      </span>
      <span className="lw-label set" style={labelStyle(spots.set)}>
        {!spots.set.compact && <IconSunset size={20} stroke={1.7} color="#ff8fc0" aria-hidden="true" />}
        {c.setText}
      </span>
    </div>
  );
}
