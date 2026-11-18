// Unwind's player: the video icon on the album art shows only when the track has a video, as a 36 px dark round chip
// with a white icon in the bottom right of the art, named "Watch the video".

const AT = encodeURIComponent('2026-11-11T22:30:00-08:00');
const base = (knobs) => `hz=unwind&at=${AT}&clock=review&weather=ok&watch=mock&wlist=three&wtab=listen&${knobs}`;
const V = (n) => `Video icon, ${n}`;
// [name, knobs, icon expected, text on the card]
const STATES = [
  ['saved video in a browser', 'media=ytvideo', true, ['Night drive mix']],
  ['wall plays the Watch item', 'wplay=0&media=watchown', true, ['Playing in Watch']],
  ['idle card, stopped Watch item', 'wplay=0&media=watchstopped', true, ['Last played in Watch']],
  ['plain audio, videos saved', 'media=on', false, ['Tokyo Burnout']],
  ['song sharing a saved video name', 'media=spotifysame', false, ['Night drive mix']],
];

// Runs in the page: the icon's count, size, glyph, accessible name and contrast of its glyph against the chip over the art.
function measureIcon() {
  const chips = [...document.querySelectorAll('.u-art .u-video')];
  const el = chips[0];
  if (!el) return { count: 0 };
  const r = el.getBoundingClientRect();
  const art = el.parentElement.getBoundingClientRect();
  const lum = (rgb) => {
    const c = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const cs = getComputedStyle(el);
  const parse = (v) => (v.match(/[\d.]+/g) || []).map(Number);
  const [br, bg, bb, ba = 1] = parse(cs.backgroundColor);
  // Worst case: the cover under the chip is white.
  const mixed = [br, bg, bb].map((v) => v * ba + 255 * (1 - ba));
  const fg = parse(cs.color).slice(0, 3);
  const [l1, l2] = [lum(fg), lum(mixed)].sort((a, b) => b - a);
  return {
    count: chips.length,
    w: Math.round(r.width),
    h: Math.round(r.height),
    right: Math.round(art.right - r.right),
    bottom: Math.round(art.bottom - r.bottom),
    glyph: !!el.querySelector('svg'),
    name: el.getAttribute('aria-label') || '',
    title: el.getAttribute('title') || '',
    text: (el.textContent || '').trim(),
    contrast: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100,
    round: cs.borderRadius,
    // The chip is never dimmed with the idle card's cover: neither it nor the art it sits in carries an opacity.
    opacity: Number(cs.opacity) * Number(getComputedStyle(el.parentElement).opacity),
  };
}

export default {
  name: 'video-icon',
  gallery: { states: STATES.map(([n, k, , expect]) => ({ screen: 'unwind', name: `listen: ${V(n)}`, query: base(k), custom: true, expect })) },
  fit: {
    variants: STATES.map(([n, k]) => ({ name: V(n), q: `?${base(k)}`, checks: ['.u-player'] })),
    measurements: { videoIcon: measureIcon },
    rules: {
      videoIcon: (variant, results, emit) => {
        const state = STATES.find(([n]) => V(n) === variant.name);
        if (!state) return false;
        const m = results.videoIcon;
        if (!state[2]) {
          if (m.count === 0) { emit('  ok   video icon: none for this track'); return false; }
          emit('  FAIL video icon: shown for a track with no known video');
          return true;
        }
        let bad = false;
        const check = (ok, good, fail) => { if (ok) emit(`  ok   video icon: ${good}`); else { emit(`  FAIL video icon: ${fail}`); bad = true; } };
        check(m.count === 1, 'exactly one on the art', `${m.count} on the art`);
        if (m.count !== 1) return true;
        check(m.w === 36 && m.h === 36, '36 px round chip', `chip is ${m.w} x ${m.h} px`);
        check(m.right >= 0 && m.right <= 12 && m.bottom >= 0 && m.bottom <= 12, 'bottom right of the art', `chip sits ${m.right}/${m.bottom} px from the art corner`);
        check(m.glyph && m.text === '', 'a glyph and no text', 'it holds text or no glyph');
        check(m.name === 'Watch the video' && m.title === 'Watch the video', 'named "Watch the video"', `name "${m.name}", title "${m.title}"`);
        check(m.opacity === 1, 'full strength (not dimmed with the art)', `chip drawn at ${m.opacity} of full strength`);
        check(m.contrast >= 3, `icon contrast ${m.contrast} to 1 (3 needed)`, `icon contrast ${m.contrast} to 1, under 3`);
        return bad;
      },
    },
    breaks: {
      'video-icon-small': {
        css: '.u-art .u-video { width: 24px !important; height: 24px !important; }',
        expect: /^ *FAIL video icon: chip is \d+ x \d+ px/m,
        appliesTo: (variant) => variant.name === V('saved video in a browser'),
      },
      'video-icon-dimmed': {
        css: '.u-art .u-video { opacity: 0.7 !important; }',
        expect: /^ *FAIL video icon: chip drawn at/m,
        appliesTo: (variant) => variant.name === V('saved video in a browser'),
      },
      'video-icon-pale': {
        css: '.u-art .u-video { background: rgba(255, 255, 255, 0.9) !important; }',
        expect: /^ *FAIL video icon: icon contrast/m,
        appliesTo: (variant) => variant.name === V('saved video in a browser'),
      },
    },
  },
};
