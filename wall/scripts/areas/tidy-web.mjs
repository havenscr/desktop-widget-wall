// Review entries for the front end tidy-up: the size of the labels on Home's Sound card, and what a key tile may hold.
// Everything this area needs lives here; the two big review scripts are not edited for it.

const SOUND = 'Home, tidy: the Sound card labels';
const KEYS = 'Deck, tidy: a key tile holds only its icon and its label';
const soundQuery = '?hz=home&at=2026-11-11T10:24:00-08:00&clock=review&weather=ok&long=1&moods=five&where=none&tidycheck=sound';
const keysQuery = '?hz=work&at=2026-11-11T16:10:00-08:00&long=1&agents=3&keys=typical&tidycheck=keys';

// The "Where" label has room for the 16 px floor. The "Suggested" mark is an 18 px icon; it is held to being whole and clear of the key's icon.

/**
 * Runs in the page (it references nothing outside its own body). Reports only when the URL asks (`tidycheck`).
 * sound: the "Suggested" mark whole and clear of the icon beside it; the "Where" label at 16 px or more.
 * keys: each key tile's element children are its icon and its `.deck-lbl` and nothing else, and nothing inside draws generated content.
 */
function measureTidyWeb() {
  const kind = new URLSearchParams(location.search).get('tidycheck');
  const out = [];
  if (kind === 'sound') {
    const tag = document.querySelector('.home .sound-chip .sound-tag.sug');
    const label = document.querySelector('.home .sound-lbl');
    if (!tag) out.push('tidy sound: the "Suggested" mark is not on the page');
    else {
      if (tag.scrollWidth > tag.clientWidth + 0.5) out.push('tidy sound: the "Suggested" mark is cut (' + tag.scrollWidth + ' px of text in ' + tag.clientWidth + ')');
      const art = tag.closest('.sound-chip')?.querySelector('.sound-art');
      if (art) {
        const gap = Math.round((tag.getBoundingClientRect().left - art.getBoundingClientRect().right) * 10) / 10;
        if (gap < 2) out.push('tidy sound: the "Suggested" mark is ' + gap + " px from the chip's icon (2 or more clear)");
      }
    }
    if (!label) out.push('tidy sound: the "Where" label is not on the page');
    else {
      const px = parseFloat(getComputedStyle(label).fontSize);
      if (px < 16 - 0.01) out.push('tidy sound: the "Where" label is ' + px + ' px (16 or more)');
    }
  } else if (kind === 'keys') {
    const tiles = [...document.querySelectorAll('.work .right-wing .deck .key-tile')];
    if (tiles.length === 0) out.push('tidy keys: no key tile on the page');
    const generated = (el, pe) => { const c = getComputedStyle(el, pe).content; return c !== 'none' && c !== 'normal'; };
    for (const tile of tiles) {
      const name = tile.getAttribute('aria-label') || tile.textContent || 'a key';
      const extra = [...tile.children].filter((c) => !c.matches('svg, .deck-lbl'));
      if (extra.length) out.push('tidy keys: key "' + name + '" holds an extra part (' + extra.map((c) => c.tagName.toLowerCase() + (c.className ? '.' + String(c.className.baseVal ?? c.className).split(' ')[0] : '')).join(', ') + ')');
      if ([...tile.querySelectorAll('*')].some((d) => generated(d, '::before') || generated(d, '::after'))) out.push('tidy keys: key "' + name + '" has generated content inside it');
    }
  }
  return out;
}

export default {
  name: 'tidy-web',
  fit: {
    variants: [
      { name: SOUND, q: soundQuery, checks: ['.home .sound', '.home .sound-panel', '.home .sound-plays', '.home .sound-where'] },
      { name: KEYS, q: keysQuery, checks: ['.work .right-wing', '.work .right-wing .deck', '.work .right-wing .deck-tiles'] },
    ],
    measurements: { tidyWeb: measureTidyWeb },
    rules: {
      tidyWeb: (variant, results, emit) => {
        if (variant.name !== SOUND && variant.name !== KEYS) return false;
        const found = results.tidyWeb ?? [];
        for (const failure of found) emit(`  FAIL ${failure}`);
        if (found.length) return true;
        emit(variant.name === SOUND
          ? '  ok   tidy sound: the "Suggested" mark whole and clear of the icon; the "Where" label 16 px or more'
          : '  ok   tidy keys: every key tile holds only its icon and its label, with no generated content inside');
        return false;
      },
    },
    breaks: {
      // The tag set big enough to be cut or touch the icon; the label set small; generated content added inside a key.
      'tidy-sound-tag-big': { css: '.sound-tag.sug { flex: none !important; } .sound-tag svg { flex: none !important; width: 200px !important; height: 200px !important; }', expect: /^ *FAIL tidy sound: the "Suggested" mark is (cut|-?[\d.]+ px from the chip's icon)/m, appliesTo: (v) => v.name === SOUND },
      'tidy-sound-label': { css: '.sound-lbl { font-size: 12px !important; }', expect: /^ *FAIL tidy sound: the "Where" label is [\d.]+ px \(16 or more\)/m, appliesTo: (v) => v.name === SOUND },
      'tidy-key-corner': { css: '.key-tile .deck-lbl::after { content: "x"; }', expect: /^ *FAIL tidy keys: key ".*" has generated content inside it/m, appliesTo: (v) => v.name === KEYS },
    },
  },
};
