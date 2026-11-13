import { useId } from 'react';

/**
 * Painted art for a mood card, after the concept's mood cards (v3 `.mood`): a sky
 * gradient, its light, and three smooth ridges with soft haze between them. Day has a
 * sun and a few rounded cumulus clouds lit along their top edge; Evening a striped sun
 * with clean, even slats sinking behind the ridges; Late Night a calm starfield and a
 * moon in a soft glow. Movie, Goodnight and any other mood keep their simpler lights.
 * One SVG that covers the card at any size.
 */
export function MoodArt({ id }: { id: string }) {
  const u = useId().replace(/:/g, '');
  const kind = artKind(id);
  const [far, mid, near] = RIDGE[kind];
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
          <stop offset="0.45" stopColor={GLOW[kind]} stopOpacity="0.2" />
          <stop offset="1" stopColor={GLOW[kind]} stopOpacity="0" />
        </radialGradient>
        {/* Haze that rises from the foot of each ridge, so the layers part softly. */}
        <linearGradient id={`${u}haze`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={HAZE[kind]} stopOpacity="0" />
          <stop offset="1" stopColor={HAZE[kind]} stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id={`${u}sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe27a" />
          <stop offset="0.55" stopColor="#ff8a4c" />
          <stop offset="1" stopColor="#ff2d87" />
        </linearGradient>
        <radialGradient id={`${u}moon`} cx="0.42" cy="0.38" r="0.7">
          <stop offset="0" stopColor="#f7faff" />
          <stop offset="1" stopColor="#c9d4f2" />
        </radialGradient>
        <linearGradient id={`${u}scr`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#35e6ea" />
          <stop offset="0.6" stopColor="#9a7bff" />
          <stop offset="1" stopColor="#ff3d9a" />
        </linearGradient>
        <mask id={`${u}slats`}>
          <rect width="400" height="400" fill="#fff" />
          {SLATS.map(([y, h]) => (
            <rect key={y} x="0" y={y} width="400" height={h} fill="#000" />
          ))}
        </mask>
      </defs>
      <rect width="400" height="400" fill={`url(#${u}sky)`} />
      {kind === 'day' && (
        <>
          <circle cx="292" cy="112" r="132" fill={`url(#${u}glow)`} />
          <circle cx="292" cy="112" r="42" fill="#fff3c4" />
          <Cloud u={`${u}c1`} x={84} y={158} s={1.2} />
          <Cloud u={`${u}c2`} x={232} y={182} s={0.82} />
          <Cloud u={`${u}c3`} x={150} y={96} s={0.55} faint />
        </>
      )}
      {kind === 'evening' && (
        <>
          <circle cx="200" cy="214" r="176" fill={`url(#${u}glow)`} />
          <circle cx="200" cy="214" r="100" fill={`url(#${u}sun)`} mask={`url(#${u}slats)`} />
        </>
      )}
      {(kind === 'night' || kind === 'goodnight' || kind === 'movie') && <Stars dim={kind === 'movie'} />}
      {kind === 'night' && (
        <>
          <circle cx="290" cy="104" r="150" fill={`url(#${u}glow)`} opacity="0.55" />
          <circle cx="290" cy="104" r="70" fill={`url(#${u}glow)`} />
          <circle cx="290" cy="104" r="34" fill={`url(#${u}moon)`} />
          <g fill="#b4bfe6" opacity="0.2">
            <circle cx="280" cy="96" r="7" />
            <circle cx="298" cy="114" r="5" />
            <circle cx="296" cy="92" r="3" />
          </g>
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
      <path d={FAR} fill={far} />
      <rect x="0" y="230" width="400" height="58" fill={`url(#${u}haze)`} />
      <path d={MID} fill={mid} />
      <rect x="0" y="270" width="400" height="46" fill={`url(#${u}haze)`} opacity="0.75" />
      <path d={NEAR} fill={near} />
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

/** Far, middle and near ridge, lighter to darker, in each card's palette. */
const RIDGE: Record<Kind, [string, string, string]> = {
  day: ['#25668c', '#164f74', '#0b3354'],
  evening: ['#7a2668', '#4a1252', '#22082e'],
  night: ['#28226a', '#1a1450', '#0b0828'],
  movie: ['#15122e', '#0d0b24', '#060512'],
  goodnight: ['#100d24', '#0a0818', '#040309'],
  lamp: ['#3a2050', '#2a1640', '#140a22'],
};

/** The haze between the ridges: the sky's light near the horizon. */
const HAZE: Record<Kind, string> = {
  day: '#8fdce6',
  evening: '#ff8f6e',
  night: '#5c5cc4',
  movie: '#3a2a70',
  goodnight: '#2a2a60',
  lamp: '#a06a5a',
};

/**
 * A smooth ridge through `pts`: quadratic curves through the midpoints, so every peak and
 * saddle is rounded, closed along the bottom of the art.
 */
export function ridgePath(pts: readonly (readonly [number, number])[]): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += ` Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L${f(lx)} ${f(ly)} L410 410 L-10 410 Z`;
}

const FAR = ridgePath([
  [-10, 250],
  [26, 236],
  [64, 214],
  [96, 232],
  [128, 244],
  [170, 222],
  [206, 200],
  [240, 226],
  [276, 248],
  [318, 228],
  [352, 208],
  [384, 226],
  [410, 238],
]);
const MID = ridgePath([
  [-10, 286],
  [40, 268],
  [84, 252],
  [128, 274],
  [176, 288],
  [226, 270],
  [272, 256],
  [318, 276],
  [366, 266],
  [410, 280],
]);
const NEAR = ridgePath([
  [-10, 318],
  [58, 306],
  [130, 316],
  [196, 300],
  [262, 314],
  [330, 304],
  [410, 314],
]);

/** The evening sun's slats: even gaps that thicken as they sink (y, height). */
const SLATS: readonly (readonly [number, number])[] = [
  [184, 3],
  [198, 4.5],
  [212, 6],
  [226, 7.5],
  [240, 9],
];

/**
 * A rounded cumulus at (x, y) scaled by s: a flat base with domes on top. The whole shape
 * is drawn lit (near white), then its body again in a cooler shade, shifted down and to
 * the left and clipped to the shape, so a bright rim stays along the top edge facing the
 * sun. A soft shadow sits under its base.
 */
function Cloud({ u, x, y, s, faint = false }: { u: string; x: number; y: number; s: number; faint?: boolean }) {
  const shape = (
    <>
      <rect x="-30" y="-2" width="132" height="24" rx="12" />
      <circle cx="4" cy="2" r="18" />
      <circle cx="30" cy="-12" r="26" />
      <circle cx="60" cy="-4" r="21" />
      <circle cx="84" cy="6" r="14" />
    </>
  );
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={faint ? 0.55 : 0.92}>
      <defs>
        <clipPath id={`${u}clip`}>{shape}</clipPath>
        <linearGradient id={`${u}body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e6f4fa" />
          <stop offset="1" stopColor="#9cc7da" />
        </linearGradient>
      </defs>
      <ellipse cx="36" cy="26" rx="64" ry="6" fill="#06203f" opacity="0.18" />
      <g fill="#fffdf4">{shape}</g>
      <g clipPath={`url(#${u}clip)`}>
        <g transform="translate(-4 5)" fill={`url(#${u}body)`}>
          {shape}
        </g>
      </g>
    </g>
  );
}

/**
 * A calm, fixed starfield: one star in each cell of an 8 by 6 grid over the sky above the
 * ridges (y under 190), placed at random inside its cell, so the stars spread evenly and
 * never bunch at the ridge. Mixed sizes and brightness; a few have a soft halo.
 */
const STARS: readonly (readonly [number, number, number, number])[] = (() => {
  const out: [number, number, number, number][] = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const COLS = 8;
  const ROWS = 6;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = Math.round(((col + 0.15 + rnd() * 0.7) * 400) / COLS);
      const y = Math.round(((row + 0.15 + rnd() * 0.7) * 190) / ROWS);
      const r = Math.round((0.5 + rnd() * 0.9) * 10) / 10;
      const o = Math.round((0.35 + rnd() * 0.55) * 100) / 100;
      out.push([x, y, r, o]);
    }
  }
  return out;
})();

function Stars({ dim }: { dim: boolean }) {
  return (
    <g fill="#fff" opacity={dim ? 0.35 : 0.9}>
      {STARS.map(([x, y, r, o], i) => (
        <g key={i}>
          {i % 12 === 0 && <circle cx={x} cy={y} r={r * 3.2} opacity={0.12} />}
          <circle cx={x} cy={y} r={r} opacity={o} />
        </g>
      ))}
    </g>
  );
}
