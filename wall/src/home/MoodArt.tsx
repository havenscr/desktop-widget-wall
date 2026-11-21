import { useId } from 'react';
import { MOOD_BACK_ID } from '../studio/homeStore';

/**
 * Painted art for a mood card, after the concept's mood cards (v3 `.mood`): a sky
 * gradient, its light, and three smooth ridges with soft haze between them. Day has a
 * sun and a few rounded cumulus clouds lit along their top edge; Evening a striped sun
 * with clean, even slats sinking behind the ridges; Late Night a calm starfield and a
 * moon in a soft glow; Still Working a lit bulb rising from the far ridge on a bright blue night.
 * Normal (the Office's back-to-before card) is a plain daylight sky with a soft white sun. Four moods are small scenes in the hills: Gaming a striped synthwave sun over a neon grid
 * floor (in place of the near ridge), Recording a lit ON AIR sign over a sound meter, Romantic
 * a pink moon with hearts, Fireplace a campfire with sparks. Movie keeps its screen, drawn low
 * enough to show whole on a 150 px card. Goodnight and any other mood keep their simpler lights.
 * One SVG that covers the card at any size.
 */
export function MoodArt({ id }: { id: string }) {
  const u = useId().replace(/:/g, '');
  const kind = artKind(id);
  const [far, mid, near] = RIDGE[kind];
  const slats = kind === 'gaming' ? GAMING_SLATS : SLATS;
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
          {slats.map(([y, h]) => (
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
      {(kind === 'night' || kind === 'goodnight' || kind === 'movie' || kind === 'bulb') && <Stars dim={kind === 'movie'} />}
      {kind === 'gaming' && (
        <>
          <Sprinkle spec={SPRINKLE.gaming} />
          <circle cx="200" cy="200" r="130" fill={`url(#${u}glow)`} />
          <circle cx="200" cy="200" r="40" fill={`url(#${u}sun)`} mask={`url(#${u}slats)`} />
        </>
      )}
      {kind === 'recording' && (
        <>
          <Sprinkle spec={SPRINKLE.recording} />
          <circle cx="200" cy="178" r="120" fill={`url(#${u}glow)`} />
          <rect x="156" y="164" width="88" height="32" rx="7" fill="#2a0612" stroke="#ff4a5c" strokeWidth="3" />
          <text x="200" y="186" textAnchor="middle" style={{ fontFamily: "var(--disp, 'Oxanium', sans-serif)" }} fontWeight="700" fontSize="17" letterSpacing="2" fill="#ff6a78">
            ON AIR
          </text>
          <g fill="#ff6a78" opacity="0.75">
            {METER.map((h, i) => (
              <rect key={i} x={118 + i * 16} y={226 - h} width="8" height={h} rx="3" />
            ))}
          </g>
        </>
      )}
      {kind === 'romantic' && (
        <>
          <Sprinkle spec={SPRINKLE.romantic} />
          <circle cx="200" cy="176" r="120" fill={`url(#${u}glow)`} />
          <circle cx="200" cy="176" r="30" fill="#ffd6e6" />
          <circle cx="200" cy="176" r="30" fill={`url(#${u}glow)`} opacity="0.6" />
          <Heart x={128} y={190} s={0.5} fill="#ff8ab8" opacity={0.7} />
          <Heart x={272} y={170} s={0.4} fill="#ff8ab8" opacity={0.55} />
          <Heart x={300} y={204} s={0.3} fill="#ffc2da" opacity={0.5} />
        </>
      )}
      {kind === 'normal' && (
        <>
          <circle cx="200" cy="196" r="150" fill={`url(#${u}glow)`} />
          <circle cx="200" cy="196" r="34" fill="#fffaf0" />
          <circle cx="200" cy="196" r="46" fill="none" stroke="#fffaf0" strokeWidth="2" opacity="0.35" />
        </>
      )}
      {kind === 'fireplace' && (
        <>
          <circle cx="200" cy="214" r="140" fill={`url(#${u}glow)`} />
          {SPARKS.map(([x, y, r, o], i) => (
            <circle key={i} cx={x} cy={y} r={r} fill="#ffc26a" opacity={o} />
          ))}
          <Flame x={200} y={206} s={1} outer="#ff7a2a" inner="#ffd45e" />
          <Flame x={184} y={214} s={0.6} outer="#ff5a1a" inner="#ffb040" />
          <Flame x={218} y={214} s={0.65} outer="#ff5a1a" inner="#ffb040" />
          <g stroke="#3a1a0a" strokeWidth="8" strokeLinecap="round">
            <line x1="170" y1="232" x2="230" y2="220" />
            <line x1="170" y1="220" x2="230" y2="232" />
          </g>
        </>
      )}
      {kind === 'bulb' && (
        <>
          <circle cx="300" cy="128" r="170" fill={`url(#${u}glow)`} />
          <circle cx="300" cy="128" r="84" fill={`url(#${u}glow)`} />
          <g stroke="#f3dc9a" strokeWidth="6" strokeLinecap="round" opacity="0.9">
            {BULB_RAYS.map((a) => (
              <line key={a} x1={300 + 64 * Math.cos(a)} y1={128 + 64 * Math.sin(a)} x2={300 + 92 * Math.cos(a)} y2={128 + 92 * Math.sin(a)} />
            ))}
          </g>
          <circle cx="300" cy="128" r="52" fill="#ffd45e" />
          <circle cx="300" cy="128" r="42" fill="#fff0b0" opacity="0.9" />
          <path d="M282 150l6 -22l12 14l12 -14l6 22" fill="none" stroke="#d98a1f" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="280" y="180" width="40" height="8" rx="4" fill="#a9b2dc" />
          <rect x="284" y="191" width="32" height="8" rx="4" fill="#8f99c8" />
          <rect x="289" y="202" width="22" height="8" rx="4" fill="#7a84b4" />
        </>
      )}
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
          <ellipse cx="200" cy="190" rx="170" ry="100" fill={`url(#${u}glow)`} />
          <rect x="146" y="160" width="108" height="62" rx="6" fill={`url(#${u}scr)`} opacity="0.88" />
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
      {kind === 'gaming' ? <GridFloor /> : <path d={NEAR} fill={near} />}
    </svg>
  );
}

/** The bulb's four rays, in radians: two above, one each side. */
const BULB_RAYS = [-2.1, -1.05, 3.4, -0.25];

type Kind = 'day' | 'evening' | 'night' | 'movie' | 'goodnight' | 'lamp' | 'bulb' | 'normal' | 'gaming' | 'recording' | 'romantic' | 'fireplace';

/** The art for a mood id; any mood the concept did not draw gets a warm lamp glow. */
export function artKind(id: string): Kind {
  const key = id.toLowerCase();
  if (key === 'day' || key === 'morning') return 'day';
  if (key === 'evening' || key === 'sunset') return 'evening';
  if (key === 'latenight' || key === 'night') return 'night';
  if (key === 'movie' || key === 'tv' || key === 'movie_mode') return 'movie';
  if (id === MOOD_BACK_ID) return 'normal';
  if (key === 'gaming') return 'gaming';
  if (key === 'recording' || key === 'office_recording') return 'recording';
  if (key === 'romantic' || key === 'romantic_mode') return 'romantic';
  if (key === 'fireplace' || key === 'fireplace_cozy') return 'fireplace';
  if (key === 'stillworking') return 'bulb';
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
  // A brighter blue than Late Night on purpose: the card reads awake, not sleepy.
  bulb: [
    ['0', '#0a2a6e'],
    ['0.62', '#1d62b4'],
    ['1', '#4aa8e0'],
  ],
  gaming: [
    ['0', '#12062e'],
    ['0.6', '#3a0f6e'],
    ['1', '#7a1fa0'],
  ],
  recording: [
    ['0', '#14051c'],
    ['0.65', '#4a0c36'],
    ['1', '#9a1c3e'],
  ],
  romantic: [
    ['0', '#1c0626'],
    ['0.6', '#5a1450'],
    ['1', '#c23c78'],
  ],
  normal: [
    ['0', '#0c2a4e'],
    ['0.65', '#2a6a8e'],
    ['1', '#8fc8d8'],
  ],
  fireplace: [
    ['0', '#140806'],
    ['0.6', '#3e1608'],
    ['1', '#8a3a10'],
  ],
};

const GLOW: Record<Kind, string> = {
  day: '#ffe9a8',
  evening: '#ff8a4c',
  night: '#9fb6ff',
  movie: '#9a7bff',
  goodnight: '#9fb6ff',
  lamp: '#ffc24d',
  bulb: '#ffe9a8',
  gaming: '#35e6ea',
  recording: '#ff4a5c',
  romantic: '#ff8ab8',
  normal: '#fff3d6',
  fireplace: '#ffa040',
};

/** Far, middle and near ridge, lighter to darker, in each card's palette. */
const RIDGE: Record<Kind, [string, string, string]> = {
  day: ['#25668c', '#164f74', '#0b3354'],
  evening: ['#7a2668', '#4a1252', '#22082e'],
  night: ['#28226a', '#1a1450', '#0b0828'],
  movie: ['#15122e', '#0d0b24', '#060512'],
  goodnight: ['#100d24', '#0a0818', '#040309'],
  lamp: ['#3a2050', '#2a1640', '#140a22'],
  bulb: ['#2a63a4', '#1a4a86', '#0d2f5c'],
  gaming: ['#3a1670', '#24104e', '#10072a'],
  recording: ['#4a1238', '#2e0a26', '#160512'],
  romantic: ['#5a1a52', '#3a103c', '#1c0820'],
  normal: ['#2f6a86', '#1f5170', '#0f3452'],
  fireplace: ['#4a2010', '#30140a', '#160804'],
};

/** The haze between the ridges: the sky's light near the horizon. */
const HAZE: Record<Kind, string> = {
  day: '#8fdce6',
  evening: '#ff8f6e',
  night: '#5c5cc4',
  movie: '#3a2a70',
  goodnight: '#2a2a60',
  lamp: '#a06a5a',
  bulb: '#9ad4f0',
  gaming: '#ff3d9a',
  recording: '#ff6a6a',
  romantic: '#ff9ac0',
  normal: '#cfeaf0',
  fireplace: '#ff9a4a',
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

/** The gaming sun's slats: thin, evenly stepped gaps (y, height). */
const GAMING_SLATS: readonly (readonly [number, number])[] = [
  [196, 3],
  [204, 4],
  [212, 5],
];

/** The recording card's sound meter: bar heights, left to right. */
const METER = [6, 12, 20, 30, 18, 26, 10, 16, 24, 8, 14];

/** A small seeded random run, so each scene's stars and sparks are fixed. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** Small stars over the sky band (y 110 to 220): x, y, radius, opacity. */
function sprinkleStars(seed: number, count: number, op: number): readonly (readonly [number, number, number, number])[] {
  const r = seeded(seed);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < count; i++) out.push([Math.round(r() * 4000) / 10, Math.round((110 + r() * 110) * 10) / 10, Math.round((0.8 + r() * 1.4) * 10) / 10, Math.round((0.3 + r() * op) * 100) / 100]);
  return out;
}

const SPRINKLE = {
  gaming: { color: '#cfe9ff', dots: sprinkleStars(7, 22, 0.7) },
  recording: { color: '#ffd6dc', dots: sprinkleStars(3, 16, 0.4) },
  romantic: { color: '#ffe0ee', dots: sprinkleStars(11, 18, 0.5) },
} as const;

function Sprinkle({ spec }: { spec: { color: string; dots: readonly (readonly [number, number, number, number])[] } }) {
  return (
    <g fill={spec.color}>
      {spec.dots.map(([x, y, r, o], i) => (
        <circle key={i} cx={x} cy={y} r={r} opacity={o} />
      ))}
    </g>
  );
}

/** Sparks rising from the campfire: x, y, radius, opacity. */
const SPARKS: readonly (readonly [number, number, number, number])[] = (() => {
  const r = seeded(5);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < 16; i++) out.push([Math.round((170 + r() * 60) * 10) / 10, Math.round((140 + r() * 60) * 10) / 10, Math.round((1 + r() * 1.8) * 10) / 10, Math.round((0.4 + r() * 0.6) * 100) / 100]);
  return out;
})();

function Heart({ x, y, s, fill, opacity }: { x: number; y: number; s: number; fill: string; opacity: number }) {
  return <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 6 C-2 -2 -14 -2 -14 8 C-14 16 -4 22 0 28 C4 22 14 16 14 8 C14 -2 2 -2 0 6Z" fill={fill} opacity={opacity} />;
}

function Flame({ x, y, s, outer, inner }: { x: number; y: number; s: number; outer: string; inner: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 -40 C10 -24 22 -16 20 4 C18 20 8 28 0 28 C-8 28 -20 20 -20 4 C-20 -10 -8 -14 -6 -26 C-2 -18 0 -14 0 -40Z" fill={outer} />
      <path d="M0 -14 C6 -4 11 2 10 12 C9 21 4 24 0 24 C-4 24 -10 20 -10 12 C-10 4 -4 2 0 -14Z" fill={inner} />
    </g>
  );
}

/** Gaming's neon grid floor from y 218, drawn instead of the near ridge. */
function GridFloor() {
  return (
    <g>
      <rect x="-10" y="218" width="420" height="180" fill="#160830" />
      {Array.from({ length: 21 }, (_, k) => k - 10).map((i) => (
        <line key={i} x1={200 + i * 12} y1="218" x2={200 + i * 60} y2="410" stroke="#35e6ea" strokeWidth="1.4" opacity="0.6" />
      ))}
      {[222, 228, 236, 248, 266, 292, 330].map((y) => (
        <line key={y} x1="-10" y1={y} x2="410" y2={y} stroke="#ff3d9a" strokeWidth="1.4" opacity="0.6" />
      ))}
      <line x1="-10" y1="218" x2="410" y2="218" stroke="#ff8ad0" strokeWidth="2" opacity="0.8" />
    </g>
  );
}

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
