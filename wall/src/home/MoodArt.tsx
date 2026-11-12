import { useId } from 'react';

/**
 * Painted art for a mood card, after the concept's mood cards (v3 `.mood`): a sky
 * gradient, its light (sun, striped sunset, moon, screen or a lamp glow), stars where it
 * is dark, and a ridge along the bottom. One SVG that covers the card at any size.
 */
export function MoodArt({ id }: { id: string }) {
  const u = useId().replace(/:/g, '');
  const kind = artKind(id);
  return (
    <svg className="mood-art" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${u}sky`} x1="0" y1="0" x2="0" y2="1">
          {SKY[kind].map(([off, c]) => (
            <stop key={off} offset={off} stopColor={c} />
          ))}
        </linearGradient>
        <radialGradient id={`${u}glow`}>
          <stop offset="0" stopColor={GLOW[kind]} stopOpacity="0.55" />
          <stop offset="1" stopColor={GLOW[kind]} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe27a" />
          <stop offset="0.55" stopColor="#ff8a4c" />
          <stop offset="1" stopColor="#ff2d87" />
        </linearGradient>
        <linearGradient id={`${u}scr`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#35e6ea" />
          <stop offset="0.6" stopColor="#9a7bff" />
          <stop offset="1" stopColor="#ff3d9a" />
        </linearGradient>
        <mask id={`${u}bands`}>
          <rect width="400" height="400" fill="#fff" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x="0" y={212 + i * 22} width="400" height={4 + i * 2.5} fill="#000" />
          ))}
        </mask>
      </defs>
      <rect width="400" height="400" fill={`url(#${u}sky)`} />
      {kind === 'day' && (
        <>
          <circle cx="292" cy="112" r="120" fill={`url(#${u}glow)`} />
          <circle cx="292" cy="112" r="46" fill="#fff3c4" />
          <ellipse cx="120" cy="170" rx="90" ry="12" fill="#fff" opacity="0.12" />
          <ellipse cx="300" cy="226" rx="70" ry="9" fill="#fff" opacity="0.1" />
        </>
      )}
      {kind === 'evening' && (
        <>
          <circle cx="200" cy="232" r="170" fill={`url(#${u}glow)`} />
          <circle cx="200" cy="232" r="104" fill={`url(#${u}sun)`} mask={`url(#${u}bands)`} />
        </>
      )}
      {(kind === 'night' || kind === 'goodnight' || kind === 'movie') && <Stars dim={kind === 'movie'} />}
      {kind === 'night' && (
        <>
          <circle cx="290" cy="104" r="96" fill={`url(#${u}glow)`} />
          <circle cx="290" cy="104" r="36" fill="#e8f1ff" />
        </>
      )}
      {kind === 'goodnight' && <path d="M300 92a34 34 0 1 0 26 56 28 28 0 1 1 -26 -56z" fill="#cfd6ff" opacity="0.8" />}
      {kind === 'movie' && (
        <>
          <ellipse cx="200" cy="150" rx="170" ry="110" fill={`url(#${u}glow)`} />
          <rect x="110" y="96" width="180" height="104" rx="8" fill={`url(#${u}scr)`} opacity="0.88" />
        </>
      )}
      {kind === 'lamp' && (
        <>
          <circle cx="200" cy="150" r="150" fill={`url(#${u}glow)`} />
          <circle cx="200" cy="150" r="34" fill="#ffe9b8" opacity="0.9" />
        </>
      )}
      <path d={FAR} fill={RIDGE[kind][0]} />
      <path d={NEAR} fill={RIDGE[kind][1]} />
    </svg>
  );
}

type Kind = 'day' | 'evening' | 'night' | 'movie' | 'goodnight' | 'lamp';

/** The art for a mood id; any mood the concept did not draw gets a warm lamp glow. */
export function artKind(id: string): Kind {
  const key = id.toLowerCase();
  if (key === 'day' || key === 'morning') return 'day';
  if (key === 'evening' || key === 'sunset') return 'evening';
  if (key === 'latenight' || key === 'night') return 'night';
  if (key === 'movie' || key === 'tv') return 'movie';
  if (key === 'goodnight' || key === 'sleep' || key === 'off') return 'goodnight';
  return 'lamp';
}

const SKY: Record<Kind, [string, string][]> = {
  day: [
    ['0', '#0b2458'],
    ['0.68', '#1a6c90'],
    ['1', '#3cc0c8'],
  ],
  evening: [
    ['0', '#2a0c52'],
    ['0.6', '#a8246e'],
    ['1', '#ff8a4c'],
  ],
  night: [
    ['0', '#05041a'],
    ['0.72', '#14104a'],
    ['1', '#2a1a66'],
  ],
  movie: [
    ['0', '#050410'],
    ['1', '#0b0920'],
  ],
  goodnight: [
    ['0', '#030208'],
    ['1', '#07051a'],
  ],
  lamp: [
    ['0', '#1a0f3a'],
    ['1', '#4a2a5a'],
  ],
};

const GLOW: Record<Kind, string> = {
  day: '#ffe9a8',
  evening: '#ff8a4c',
  night: '#9fb6ff',
  movie: '#9a7bff',
  goodnight: '#9fb6ff',
  lamp: '#ffc24d',
};

const RIDGE: Record<Kind, [string, string]> = {
  day: ['#145a82', '#0c3a5e'],
  evening: ['#4a1252', '#22082e'],
  night: ['#1a1450', '#0b0828'],
  movie: ['#0d0b24', '#060512'],
  goodnight: ['#0a0818', '#040309'],
  lamp: ['#2a1640', '#140a22'],
};

const FAR = 'M0 300 L40 282 L78 292 L120 262 L160 284 L204 270 L250 290 L292 258 L336 280 L370 268 L400 278 L400 400 L0 400 Z';
const NEAR = 'M0 330 L52 316 L96 326 L150 304 L206 322 L258 312 L310 330 L356 314 L400 322 L400 400 L0 400 Z';

const STARS: [number, number, number][] = [
  [34, 40, 1.6], [92, 74, 1.2], [150, 30, 1.4], [196, 96, 1], [244, 52, 1.5], [62, 150, 1.1],
  [120, 124, 1.5], [350, 40, 1.2], [372, 150, 1.4], [230, 170, 1], [30, 210, 1.2], [176, 214, 1],
  [330, 206, 1.1], [270, 128, 0.9], [14, 104, 1],
];

function Stars({ dim }: { dim: boolean }) {
  return (
    <g fill="#fff" opacity={dim ? 0.35 : 0.8}>
      {STARS.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} opacity={0.5 + (i % 3) * 0.25} />
      ))}
    </g>
  );
}
