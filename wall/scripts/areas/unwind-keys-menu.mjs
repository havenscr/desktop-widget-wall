// The Always here keys on Unwind take the Work key menu and a rename: the menu, the picker and the rename popover sit
// fully on screen (inside the stage), no label in them wraps or is cut, and every text is 16 px or more. The menu and the
// rename popover open upward from the row; the picker fills the right wing (x 2000 to 2540, y 20 to 650).
const BASE = '?hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&agents=3&watch=mock&wlist=three&wlook=drivein&wplay=0&meet=heavy&keys=three&hold=three&pins=long';
const OPEN = 'rest:.u-foot >> ctx:.u-keys .u-key:not(.empty)';
const GALLERY_Q = 'hz=unwind&at=2026-11-11T13%3A12%3A00-08%3A00&long=1&agents=ask&net=calm&audio=demo&desktoken=set&office=six&officeoff=offered&officemood=relax&watch=mock&wlist=three&wplay=0';
const GALLERY_OPEN = 'hover:.u-foot >> ctx:.u-keys .u-key:not(.empty)';
const MENU = 'Unwind keys, menu open';
const PICKER = 'Unwind keys, picker open';
const RENAME = 'Unwind keys, rename open, too long a name';
const FITS = 'Unwind keys, rename open, a name that fits';
const WORK = 'Work keys, long names on the Always here row';

function measureKeyPopovers() {
  const out = { found: [], layerShown: !!document.querySelector('.u-keys[data-shown]') };
  for (const box of document.querySelectorAll('.u-keys .key-menu, .u-keys .key-rename, .u-keys .pk')) {
    const r = box.getBoundingClientRect();
    const bad = [];
    for (const el of box.querySelectorAll('*')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const size = parseFloat(cs.fontSize);
      const cut = el.scrollWidth > el.clientWidth + 0.5 || (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth);
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = new Set([...range.getClientRects()].map((q) => Math.round(q.top / (size * 0.6))));
      const wraps = lines.size > 1;
      if (size < 16 || cut || wraps) bad.push(`${(el.textContent || '').trim().slice(0, 24)} (${size}px${cut ? ', cut' : ''}${wraps ? ', wraps' : ''})`);
    }
    out.found.push({ cls: box.className.split(' ')[0], l: r.left, t: r.top, r: r.right, b: r.bottom, bad });
  }
  const save = document.querySelector('.key-rename-save');
  out.saveDisabled = save ? save.disabled : null;
  out.fitText = document.querySelector('.key-rename-fit')?.textContent ?? '';
  return out;
}

// The Work row with names: every pinned label on one line, whole (no ellipsis, no cut), 15 px or more.
function measureWorkNames() {
  const labels = [];
  for (const l of document.querySelectorAll('.pinned .pin-tile .deck-lbl')) {
    const cs = getComputedStyle(l);
    const range = document.createRange();
    range.selectNodeContents(l);
    const lines = new Set([...range.getClientRects()].map((q) => Math.round(q.top)));
    labels.push({ text: l.textContent || '', cut: l.scrollWidth > l.clientWidth + 0.5 || l.scrollHeight > l.clientHeight + 0.5, ellipsis: cs.textOverflow === 'ellipsis' && l.scrollWidth > l.clientWidth, lines: lines.size });
  }
  return { labels };
}

const variant = (name, click, checks = ['.u-keys-tiles']) => ({ name, q: BASE, click, checks, viewportOnly: true });
export default {
  name: 'unwind-keys-menu',
  fit: {
    variants: [
      variant(MENU, OPEN),
      variant(PICKER, `${OPEN} >> .key-menu button:nth-child(5)`),
      variant(RENAME, `${OPEN} >> .key-menu button:nth-child(6) >> type:.key-rename input=This is far too long a name for a key`),
      variant(FITS, `${OPEN} >> .key-menu button:nth-child(6) >> type:.key-rename input=Deep work`),
      { name: WORK, q: '?hz=work&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&keys=library&hold=lib-vscode&pinnames=long', checks: ['.pinned'], viewportOnly: true },
    ],
    measurements: { keyPopovers: measureKeyPopovers, workNames: measureWorkNames },
    rules: {
      keyPopovers: (variant, results, emit) => {
        if (![MENU, PICKER, RENAME, FITS].includes(variant.name)) return false;
        const r = results.keyPopovers;
        const want = variant.name === MENU ? 'key-menu' : variant.name === PICKER ? 'pk' : 'key-rename';
        const fitsOk = variant.name !== FITS || (r.saveDisabled === false && r.fitText === 'Fits the key');
        const box = r.found.find((f) => f.cls === want);
        const onScreen = box && box.l >= 0 && box.t >= 0 && box.r <= 2560 && box.b <= 720;
        const wing = variant.name !== PICKER || (box && Math.round(box.l) >= 1999 && Math.round(box.r) <= 2541 && Math.round(box.t) >= 19 && Math.round(box.b) <= 651);
        const saveOk = (variant.name !== RENAME || r.saveDisabled === true) && fitsOk;
        if (box && r.layerShown && onScreen && wing && saveOk && box.bad.length === 0) {
          emit(`  ok   unwind keys ${want}: fully on screen, every text 16 px or more, none wrapped or cut${variant.name === RENAME ? ', Save off for a name too long' : ''}${variant.name === FITS ? ', Fits the key and Save on' : ''}`);
          return false;
        }
        emit(`  FAIL unwind keys ${want}: found ${!!box}, layer shown ${r.layerShown}, on screen ${!!onScreen}, in the wing ${!!wing}, save off ${saveOk}; bad [${box ? box.bad.join(', ') : ''}]`);
        return true;
      },
      workNames: (variant, results, emit) => {
        if (variant.name !== WORK) return false;
        const labels = results.workNames.labels;
        const bad = labels.filter((l) => l.cut || l.ellipsis || l.lines !== 1).map((l) => l.text);
        if (labels.length === 5 && bad.length === 0 && labels.some((l) => l.text === 'Deep work')) {
          emit(`  ok   work row names: ${labels.map((l) => l.text).join(', ')} each on one line, whole, no ellipsis`);
          return false;
        }
        emit(`  FAIL work row names: ${labels.length} labels; cut, ellipsised or wrapped [${bad.join(', ')}]`);
        return true;
      },
    },
    breaks: {
      'work-names-clip': {
        css: '.pinned .pin-tile .deck-lbl { padding: 0 60px !important; }',
        expect: /^ *FAIL work row names:/m,
        appliesTo: (variant) => variant.name === WORK,
      },
      'unwind-keys-menu-off': {
        css: '.u-keys .key-menu, .u-keys .key-rename { bottom: auto !important; top: 650px !important; }',
        expect: /^ *FAIL unwind keys key-(menu|rename):/m,
        appliesTo: (variant) => variant.name === MENU || variant.name === RENAME,
      },
    },
  },
  gallery: {
    states: [
      { screen: 'unwind', name: 'unwind keys: menu open', query: GALLERY_Q, custom: true, actions: GALLERY_OPEN, expect: 'Remove from Always here' },
      { screen: 'unwind', name: 'unwind keys: picker open', query: GALLERY_Q, custom: true, actions: `${GALLERY_OPEN} >> .key-menu button:nth-child(5)`, expect: 'Reset to defaults' },
      { screen: 'unwind', name: 'unwind keys: rename open', query: GALLERY_Q, custom: true, actions: `${GALLERY_OPEN} >> .key-menu button:nth-child(6) >> type:.key-rename input=Deep work`, expect: 'Fits the key' },
    ],
  },
};
