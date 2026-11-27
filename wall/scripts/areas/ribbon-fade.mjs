// A calendar chip's title that does not fit fades over its last 24 px; the chip keeps its crisp edge and colour,
// and a title that fits is not touched.
// Fit: on the typical morning, every title that is cut on a ribbon chip carries the fade (a 24 px mask on the
// title), and no title that fits carries it.
function measureFade() {
  const out = { cutNoFade: [], fitFade: [], chips: 0 };
  for (const t of document.querySelectorAll('.rib .ev:not(.s3) .ev-t')) {
    // A name carried on past its chip (spill) runs over the edge on purpose and carries no fade.
    if (t.closest('.ev.spill')) continue;
    out.chips += 1;
    const cut = t.scrollWidth > t.clientWidth + 1;
    const mask = getComputedStyle(t).maskImage || getComputedStyle(t).webkitMaskImage || 'none';
    const faded = mask !== 'none' && /24px/.test(mask);
    const name = (t.textContent || '').slice(0, 30);
    if (cut && !faded) out.cutNoFade.push(name);
    if (!cut && faded) out.fitFade.push(name);
  }
  return out;
}

export default {
  name: 'ribbon-fade',
  fit: {
    variants: [{
      name: 'Ribbon fade, typical morning',
      q: '?hz=work&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&meet=cats',
      checks: ['.rib .ev:not(.spill)'],
      strip: true,
      viewportOnly: true,
    }],
    measurements: { ribbonFade: measureFade },
    rules: {
      ribbonFade: (variant, results, emit) => {
        if (variant.name !== 'Ribbon fade, typical morning') return false;
        const r = results.ribbonFade;
        if (r.chips > 0 && r.cutNoFade.length === 0 && r.fitFade.length === 0) {
          emit(`  ok   ribbon fade: ${r.chips} chip titles, every cut one fades over its last 24 px, none that fits does`);
          return false;
        }
        emit(`  FAIL ribbon fade: ${r.chips} chips; cut without fade [${r.cutNoFade.join(', ')}]; fade on a fitting title [${r.fitFade.join(', ')}]`);
        return true;
      },
    },
    breaks: {
      'ribbon-fade-off': {
        css: '.rib .ev .ev-t[data-cut] { -webkit-mask-image: none !important; mask-image: none !important; }',
        expect: /^ *FAIL ribbon fade:/m,
        appliesTo: (variant) => variant.name === 'Ribbon fade, typical morning',
      },
    },
  },
};
