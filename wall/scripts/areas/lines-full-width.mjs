// Music lines: a newer line type (Bars, Ribbon, Sparks, Skyline) plays the full width in every video look.
// A development-only probe in the horizon (`lineProbe.ts`, `?lineprobe=front|behind`) reads, on the page,
// which layer the type is drawn on and whether that layer is above or below the picture. The rule reads
// which layer is above which: it cannot see a mask or a blend (the feathered edges, the hologram's pane).
const NIGHT = '2026-11-11T22:30:00-08:00';
const view = (name, look, type, mode, checks) => ({
  name,
  q: `?hz=unwind&at=${NIGHT}&long=1&agents=3&watch=mock&wlist=three&wlook=${look}&wplay=0&audio=demo&lines=${type}&lineprobe=${mode}`,
  checks,
});
// A picture in front of the land (Feathered, Drive-in, Hologram) hides the part that passes behind it; a picture behind
// the land (The sun, Whole sky) has the lines in front of its lower part.
const VIEWS = [
  view('Lines, bars under the drive-in', 'drivein', 'bars', 'front', ['.w-screen']),
  view('Lines, skyline under the drive-in', 'drivein', 'skyline', 'front', ['.w-screen']),
  view('Lines, ribbon under the hologram', 'holo', 'ribbon', 'front', ['.w-screen']),
  view('Lines, bars under the feathered picture', 'feather', 'bars', 'front', ['.w-screen']),
  view('Lines, skyline under the feathered picture', 'feather', 'skyline', 'front', ['.w-screen']),
  view('Lines, skyline under the sun', 'sun', 'skyline', 'behind', ['.w-layer']),
  view('Lines, bars under the whole sky', 'sky', 'bars', 'behind', ['.w-layer']),
  view('Lines, sparks under the whole sky', 'sky', 'sparks', 'behind', ['.w-layer']),
];
const NAMES = new Set(VIEWS.map((v) => v.name));

// Gallery: each of the four newer types under The sun and Whole sky (the drive-in states are built in).
const at = encodeURIComponent(NIGHT);
const states = [];
for (const type of ['bars', 'ribbon', 'sparks', 'skyline']) {
  for (const [look, label] of [['sun', 'the sun'], ['sky', 'the whole sky']]) {
    states.push({
      screen: 'unwind',
      name: `lines: ${type} under ${label}`,
      query: `hz=unwind&at=${at}&clock=review&weather=ok&watch=mock&wlist=three&wlook=${look}&wplay=0&audio=demo&lines=${type}`,
      custom: true,
      expectNote: 'the lines are canvas pixels; the fit check reads them',
    });
  }
}

/** The probe's published numbers, read where the page draws them. Runs in the page: references nothing outside its body. */
function measureLinesProbe() {
  const mode = new URLSearchParams(location.search).get('lineprobe');
  if (!mode) return null;
  return { mode, probe: document.querySelector('canvas.horizon-canvas:not(.horizon-front)')?.dataset.lineProbe ?? '' };
}

function ruleLinesProbe(variant, results, emit) {
  if (!NAMES.has(variant.name)) return false;
  const { mode, probe } = results.linesProbe ?? { mode: '', probe: '' };
  // drawn,most,boxes,onTop,under,cols,above,nopic,measured
  const [, drawn, boxes, onTop, under, cols, above, , measured] = (probe || '0,0,0,0,0,0,0,0,0').split(',').map(Number);
  let fail = '';
  if (!probe) fail = 'lines: the probe reported nothing (no new type was drawn)';
  else if (!boxes) fail = 'lines: no picture box was claimed';
  else if (!drawn) fail = 'lines: the new type drew nothing';
  else if (!measured) fail = 'lines: the stacking could not be measured, no sampled point found the drawn canvas in the page: ' + probe;
  else if (mode === 'front' && onTop > 0) fail = 'lines: a new type is painted above the picture at ' + onTop + ' sampled points (a picture in front of the land hides all of it)';
  else if (mode === 'front' && under < 1) fail = 'lines: a new type never passes behind the picture (nothing to hide, the check proved nothing): ' + probe;
  else if (mode === 'behind' && (under > 0 || onTop < 1 || cols < 24)) fail = 'lines: a new type does not play in front of the picture: ' + onTop + ' sampled points in front, ' + under + ' behind, ' + cols + ' of 32 columns across the picture (none behind, and 24 columns at least)';
  else if (above > 0) fail = 'lines: a new type rises above its Height setting: ' + above + ' pixels higher than the setting and 48 px allow';
  if (fail) {
    emit(`  FAIL ${fail}`);
    return true;
  }
  emit(mode === 'front' ? '  ok   lines: the new type passes behind the picture, never above it, and stays under its Height setting' : '  ok   lines: the new type plays in front of the picture across its width, and stays under its Height setting');
  return false;
}

export default {
  name: 'lines-full-width',
  gallery: { states },
  fit: {
    variants: VIEWS,
    measurements: { linesProbe: measureLinesProbe },
    rules: { linesProbe: ruleLinesProbe },
    breaks: {
      // The drawn canvas lifted above the page: a picture in front of the land would be painted over.
      'lines-over': {
        query: '&lover=1',
        expect: /^ *FAIL lines: a new type is painted above the picture/m,
        appliesTo: (variant) => variant.name === 'Lines, bars under the drive-in',
      },
      // The type drawn on the main canvas under a picture that stands behind the land.
      'lines-hole': {
        query: '&ltarget=main',
        expect: /^ *FAIL lines: a new type does not play in front of the picture/m,
        appliesTo: (variant) => variant.name === 'Lines, bars under the whole sky',
      },
    },
  },
};
