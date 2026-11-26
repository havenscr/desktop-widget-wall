// The Always here keys under the Watch list never cut a label off: with the work layer up, every key label shows whole
// (scrollWidth within clientWidth, no ellipsis), at 16 px or more, on one line.
// Fit: the five longest library labels pinned (`pins=long`), the pointer on the Unwind frame so the layer shows.
function measureKeyLabels() {
  const out = { labels: [], layerShown: !!document.querySelector('.u-keys[data-shown]') };
  for (const l of document.querySelectorAll('.u-keys .u-key-l')) {
    const cs = getComputedStyle(l);
    const tile = l.closest('.u-key');
    const tr = tile.getBoundingClientRect();
    const ts = getComputedStyle(tile);
    const lr = l.getBoundingClientRect();
    const left = tr.left + parseFloat(ts.borderLeftWidth) + parseFloat(ts.paddingLeft);
    const right = tr.right - parseFloat(ts.borderRightWidth) - parseFloat(ts.paddingRight);
    out.labels.push({
      text: l.textContent || '',
      cut: l.scrollWidth > l.clientWidth + 0.5 || lr.left < left - 0.5 || lr.right > right + 0.5,
      ellipsis: cs.textOverflow === 'ellipsis',
      size: parseFloat(cs.fontSize),
      wraps: l.getBoundingClientRect().height > parseFloat(cs.fontSize) * 1.6,
    });
  }
  out.tileHeights = [...document.querySelectorAll('.u-keys .u-key')].map((t) => Math.round(t.getBoundingClientRect().height));
  return out;
}

const NAME = 'Unwind keys, five long labels';
export default {
  name: 'unwind-keys-labels',
  fit: {
    variants: [{
      name: NAME,
      q: '?hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&agents=3&watch=mock&wlist=three&wlook=drivein&wplay=0&meet=heavy&keys=three&hold=three&pins=long',
      click: 'rest:.u-date',
      checks: ['.u-keys-tiles'],
      viewportOnly: true,
    }],
    measurements: { keyLabels: measureKeyLabels },
    rules: {
      keyLabels: (variant, results, emit) => {
        if (variant.name !== NAME) return false;
        const r = results.keyLabels;
        const bad = r.labels.filter((l) => l.cut || l.ellipsis || l.size < 16 || l.wraps).map((l) => l.text);
        const flat = new Set(r.tileHeights).size === 1;
        if (r.layerShown && r.labels.length === 5 && bad.length === 0 && flat) {
          emit(`  ok   unwind keys: ${r.labels.length} labels (${r.labels.map((l) => l.text).join(', ')}) show whole at 16 px or more, none cut, wrapped or ellipsised`);
          return false;
        }
        emit(`  FAIL unwind keys: layer shown ${r.layerShown}, tile heights [${r.tileHeights}], ${r.labels.length} labels; cut, ellipsised, small or wrapped [${bad.join(', ')}]`);
        return true;
      },
    },
    breaks: {
      'unwind-keys-clip': {
        css: '.u-keys .u-key-l { display: block !important; max-width: none !important; overflow: visible !important; padding: 0 40px !important; }',
        expect: /^ *FAIL unwind keys:/m,
        appliesTo: (variant) => variant.name === NAME,
      },
    },
  },
};
