// Labels in full: the long song or video title, the long Watch list names, the Next up title and the
// timeline chip names, each shown whole. Gallery states only; the look is judged from the stills.

const WATCH = 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlook=sky';

export default {
  name: 'labels-full',
  gallery: {
    states: [
      {
        screen: 'unwind',
        name: 'labels in full: Watch, the long title and the long list names',
        query: `${WATCH}&wlist=three&wpins=long&wplay=0`,
        custom: true,
        expect: ['Night drive mix for the long way home'],
      },
      {
        screen: 'unwind',
        name: 'labels in full: Watch, the long title at rest',
        query: `${WATCH}&wlist=three&wpins=long&wplay=0&wctl=rest`,
        custom: true,
        expect: ['Night drive mix for the long way home'],
      },
      {
        screen: 'unwind',
        name: 'labels in full: Listen, the long song title',
        query: 'hz=unwind&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&media=long',
        custom: true,
        expect: ['An Extremely Long Song Title'],
      },
      {
        screen: 'work',
        name: 'labels in full: Work, the busy afternoon with long chip names',
        query: 'hz=work&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&long=1&meet=heavy',
        custom: true,
        expect: ['Quarterly planning'],
      },
      {
        screen: 'unwind',
        name: 'labels in full: Unwind with the timeline up, the long meeting',
        query: 'hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&ltab=listen&lctl=shown&meet=heavy&media=long',
        custom: true,
        expect: ['Customer escalation review'],
        actions: 'hover:.u-foot',
      },
    ],
  },
  fit: {
    variants: [
      { name: 'Labels full, Listen with long names keeps the player above the lines', q: '?hz=unwind&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&long=1&agents=ask&spotify=long&media=long&audio=demo', checks: ['.u-listen', '.sp-card', '.u-next', '.u-line'] },
      { name: 'Labels full, Listen with a heavy library keeps the player above the lines', q: '?hz=unwind&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&long=1&agents=ask&spotify=heavy&media=long&audio=demo', checks: ['.u-listen', '.sp-card', '.u-next', '.u-line'] },
      { name: 'Labels full, Watch with long names', q: `?${WATCH}&wlist=three&wpins=long&wplay=0&wmeta=long&long=1`, checks: ['.w-now', '.w-card'] },
      { name: 'Labels full, Work with long chip names', q: '?hz=work&at=2026-11-11T10%3A24%3A00-08%3A00&clock=review&weather=ok&long=1&meet=heavy', checks: ['.left-wing'] },
    ],
    measurements: {
      labelsFull: () => {
        const out = { cut: [], small: [], overlap: [], missing: false };
        // The old boxes hold: a Watch list row is 40 px, a pin is 48 px, and nothing grows to move what sits around it.
        for (const e of document.querySelectorAll('.w-row')) if (e.getBoundingClientRect().height > 40.5) out.cut.push(`a Watch list row is ${Math.round(e.getBoundingClientRect().height)} px, not 40`);
        for (const e of document.querySelectorAll('.u-pin')) if (e.getBoundingClientRect().height > 48.5) out.cut.push(`a pin is ${Math.round(e.getBoundingClientRect().height)} px, not 48`);
        for (const e of document.querySelectorAll('.u-listen .u-transport')) if (e.getBoundingClientRect().bottom > 300) out.cut.push(`the Listen player ends at y ${Math.round(e.getBoundingClientRect().bottom)}, past 300`);
        for (const e of document.querySelectorAll('.w-title')) if (e.getBoundingClientRect().height > 107) out.cut.push(`the Watch title is ${Math.round(e.getBoundingClientRect().height)} px, not 106`);
        const R = (e) => e.getBoundingClientRect();
        const hit = (a, b) => a.right > b.left + 0.5 && a.left < b.right - 0.5 && a.bottom > b.top + 0.5 && a.top < b.bottom - 0.5;
        for (const sel of ['.w-title', '.w-by', '.w-label', '.u-pin-name', '.u-np', '.u-artist', '.u-nu-title', '.rib .due .n', '.rib .ev .ev-t']) {
          for (const e of document.querySelectorAll(sel)) {
            const r = R(e);
            if (r.width === 0 || getComputedStyle(e).visibility === 'hidden') continue;
            const cs = getComputedStyle(e);
            // A title that does not fit at 16 px fades on its last line on purpose (data-cut, the hover has it whole).
            // A chip name carried on past its chip is meant to run over the chip's edge.
            if (e.closest('.ev.spill')) continue;
            const faded = e.hasAttribute('data-cut') && cs.maskImage !== 'none' && cs.maskImage !== '';
            if (!faded && (cs.textOverflow === 'ellipsis' || e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)) out.cut.push(`${sel} "${(e.textContent || '').slice(0, 24)}"`);
            if (parseFloat(cs.fontSize) < 16) out.small.push(`${sel} ${cs.fontSize}`);
          }
        }
        // Chip names carried past their chip, and second row names, stay off the needle, the corner button and every other chip.
        const names = [...document.querySelectorAll('.rib .ev.spill .ev-t, .rib .ev-row')].filter((e) => R(e).width > 0);
        const others = [['the needle', '.rib .ndl b'], ['the corner button', '.screens-off']].flatMap(([n, sel]) => [...document.querySelectorAll(sel)].map((e) => [n, R(e)]));
        const chips = [...document.querySelectorAll('.rib .ev:not(.spill)')].map((e) => ['a chip', R(e)]);
        for (const e of names) {
          const range = document.createRange();
          range.selectNodeContents(e);
          const r = range.getBoundingClientRect();
          for (const [n, o] of [...others, ...chips]) if (hit(r, o)) out.overlap.push(`"${(e.textContent || '').slice(0, 20)}" ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)} touches ${n} ${Math.round(o.left)},${Math.round(o.top)},${Math.round(o.right)},${Math.round(o.bottom)}`);
        }
        out.count = names.length;
        return out;
      },
    },
    rules: {
      labelsFull: (variant, results, emit) => {
        if (!variant.name.startsWith('Labels full')) return false;
        const m = results.labelsFull;
        const bad = [...m.cut.map((x) => `${x} is cut`), ...m.small.map((x) => `${x} is under 16 px`), ...m.overlap];
        if (bad.length === 0) {
          emit(`  ok   labels full: no label cut, none under 16 px, no chip name over the needle, the corner button or a chip (${m.count} chip names carried on)`);
          return false;
        }
        emit(`  FAIL labels full: ${bad.slice(0, 6).join('; ')}`);
        return true;
      },
    },
    breaks: {
      'labels-full-cut': {
        css: '.w-title, .u-nu-title, .w-label { max-height: 30px !important; overflow: hidden !important; }',
        expect: /^ *FAIL labels full: .* is cut/m,
        appliesTo: (variant) => variant.name === 'Labels full, Watch with long names',
      },
    },
  },
};
