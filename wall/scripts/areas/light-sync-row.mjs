// Tools, Accounts: the Light sync row (Pair, Test the light link, Forget). In each state its name, line, buttons and
// note stay inside the drawer, text is 16 px or more, nothing is cut, and the row's line is never cut.
const Q = (state, extra = '') => `?hz=work&at=${encodeURIComponent('2026-11-11T10:24:00-08:00')}&clock=review&weather=ok&tools=accounts&lightsync=${state}${extra}`;
const ROW = '.tools-list[aria-label="Accounts"] [data-account="lightsync"]';

// Runs in the page.
function measureLightSyncRow() {
  const row = document.querySelector('[data-account="lightsync"]');
  if (!row) return { found: false };
  const drawer = document.querySelector('.tools-drawer')?.getBoundingClientRect();
  const parts = [...row.querySelectorAll('.tools-name, .tools-line, .tools-btn')];
  const note = document.querySelector('[data-lightsync-note]');
  if (note) parts.push(note);
  const small = parts.filter((e) => e.textContent && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => (e.textContent || '').trim());
  const cut = parts.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e.textContent || '').trim());
  const outside = drawer ? parts.filter((e) => { const r = e.getBoundingClientRect(); return r.left < drawer.left - 0.5 || r.right > drawer.right + 0.5; }).length : 0;
  const rr = row.getBoundingClientRect();
  const btnsOut = [...row.querySelectorAll('.tools-btn')].filter((b) => b.getBoundingClientRect().right > rr.right + 0.5).length;
  return { found: true, small, cut, outside, btnsOut, buttons: row.querySelectorAll('.tools-btn').length };
}

export default {
  name: 'light-sync-row',
  fit: {
    variants: [
      { name: 'Light sync, not paired', q: Q('unpaired'), checks: ['.tools-drawer', ROW], viewportOnly: true },
      { name: 'Light sync, pairing and the link button line', q: Q('unpaired'), click: ROW + ' .tools-btn.cy', checks: ['.tools-drawer', ROW, '[data-lightsync-note]'], viewportOnly: true },
      { name: 'Light sync, paired', q: Q('paired'), checks: ['.tools-drawer', ROW], viewportOnly: true },
      { name: 'Light sync, testing', q: Q('paired'), click: ROW + ' .tools-btn', checks: ['.tools-drawer', ROW, '[data-lightsync-note]'], viewportOnly: true },
      { name: 'Light sync, bridge changed', q: Q('changed'), checks: ['.tools-drawer', ROW, '[data-lightsync-note]'], viewportOnly: true },
      { name: 'Light sync, could not check', q: Q('down'), checks: ['.tools-drawer', ROW], viewportOnly: true },
    ],
    measurements: { lightSyncRow: measureLightSyncRow },
    rules: {
      lightSyncRow: (variant, results, emit) => {
        if (!variant.name.startsWith('Light sync')) return false;
        const m = results.lightSyncRow;
        if (!m || !m.found) {
          emit('  FAIL light sync: the row is not in the Accounts list');
          return true;
        }
        let bad = false;
        if (m.small.length > 0) { emit(`  FAIL light sync: text under 16 px (${m.small[0]})`); bad = true; }
        if (m.cut.length > 0) { emit(`  FAIL light sync: text is cut (${m.cut[0]})`); bad = true; }
        if (m.outside > 0 || m.btnsOut > 0) { emit(`  FAIL light sync: ${m.outside + m.btnsOut} part(s) outside the drawer or the row`); bad = true; }
        if (!bad) emit(`  ok   light sync: ${m.buttons} button(s), all text 16 px or more, nothing cut, everything inside the drawer`);
        return bad;
      },
    },
    breaks: {
      'light-sync-small': {
        css: '[data-account="lightsync"] .tools-line, [data-lightsync-note] { font-size: 12px !important; }',
        expect: /^ *FAIL light sync: text under 16 px/m,
        appliesTo: (variant) => variant.name === 'Light sync, paired' || variant.name === 'Light sync, bridge changed',
      },
      'light-sync-cut': {
        css: '[data-account="lightsync"] .tools-name { width: 20px !important; overflow: hidden !important; display: block; }',
        expect: /^ *FAIL light sync: text is cut/m,
        appliesTo: (variant) => variant.name === 'Light sync, paired',
      },
    },
  },
};
