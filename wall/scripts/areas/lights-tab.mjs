// The Lights tab of the Looks and Lines sheet (the gear on Listen): the sheet stays on the wall, every row and helper line
// is inside it, uncut, at 16 px or more, and the controls keep a usable size. Mock moods and audio are invented.
const at = '2026-11-11T10:24:00-08:00';
const Q = (extra = '') => `?hz=unwind&at=${encodeURIComponent(at)}&long=1&agents=3&audio=demo&desktoken=set&office=six&officeoff=offered&officemood=relax${extra}`;
const OPEN = '.w-gear >> .ln-pages button:nth-child(3)';

// Runs in the page.
function measureLights() {
  const sheet = document.querySelector('.w-sheet.ls-sheet');
  if (!sheet) return { found: false };
  const sr = sheet.getBoundingClientRect();
  const parts = [...sheet.querySelectorAll('.u-k, .ln-label, .ln-value, .ln-hint, .ln-foot, .ls-live, .ls-tile span, .ls-tile b, .ln-reset, .ln-pages button')];
  const small = parts.filter((e) => e.textContent && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 15.99).map((e) => e.textContent.trim().slice(0, 30));
  const cut = parts.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 30));
  const outside = [...sheet.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < sr.left - 0.5 || r.right > sr.right + 0.5); }).length;
  const rows = [...sheet.querySelectorAll('.ls-row, .ls-who')].map((e) => { const r = e.getBoundingClientRect(); return { b: r.bottom, t: r.top }; });
  const overlap = rows.some((r, i) => i > 0 && r.t < rows[i - 1].b - 0.5);
  const controls = [...sheet.querySelectorAll('input[type="range"], .ls-tile, [role="switch"]')].map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, w: r.width }; });
  const tinyControl = controls.filter((c) => c.h < 24 || c.w < 24).length;
  const heads = [...sheet.querySelectorAll('.ln-pages button')].map((e) => e.textContent.trim());
  const tr = document.createRange();
  const tEl = sheet.querySelector('.u-k');
  if (tEl) tr.selectNodeContents(tEl);
  const title = tEl ? tr.getBoundingClientRect() : null;
  const tabs = sheet.querySelector('.ln-pages')?.getBoundingClientRect();
  const hb = sheet.querySelector('.ls-head')?.getBoundingClientRect();
  const bx = (e) => { const r = e?.getBoundingClientRect(); return r ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
  const lab = document.createRange();
  const liveEl = sheet.querySelector('.ls-live');
  if (liveEl) lab.selectNodeContents(liveEl);
  const strips = [...sheet.querySelectorAll('.ls-strip')].map((e) => ({ name: e.getAttribute('data-row'), ...bx(e), kids: [...e.querySelectorAll('b, .ls-pn, .ls-play')].map(bx) }));
  const preview = { head: hb ? { l: hb.left, t: hb.top, r: hb.right, b: hb.bottom } : null, usual: bx(sheet.querySelector('.ls-usualbtn')), live: liveEl ? bx(lab) : null, strips, pn: sheet.querySelectorAll('.ls-pn').length, pl: [...sheet.querySelectorAll('.ls-play em')].map((e) => e.textContent), oldBar: !!sheet.querySelector('.ls-bar') };
  return { preview, found: true, top: sr.top, bottom: sr.bottom, left: sr.left, right: sr.right, vh: window.innerHeight, vw: window.innerWidth, small, cut, outside, overlap, tinyControl, heads, titleTabs: title && tabs ? title.right - tabs.left : -999, tiles: sheet.querySelectorAll('.ls-tile').length, rowCount: sheet.querySelectorAll('.ls-row').length };
}

export default {
  name: 'lights-tab',
  gallery: {
    states: [
      { screen: 'unwind', name: 'lights tab: the Lights tab open on Listen', query: `hz=unwind&at=${encodeURIComponent(at)}&clock=review&weather=ok&audio=demo&desktoken=set&office=six&officeoff=offered&officemood=relax`, custom: true, expect: ['Preview, live', 'Colour speed', 'Brightness', 'Kick flash', 'Smoothness', 'Who follows', 'Panel ripple'], actions: '.w-gear >> .ln-pages button:nth-child(3)' },
    ],
  },
  fit: {
    variants: [
      { name: 'Lights tab, open on Listen', q: Q(), click: OPEN, checks: ['.w-sheet.ls-sheet'] },
      { name: 'Lights tab, open while sync runs', q: Q('&lsync=on'), click: OPEN, checks: ['.w-sheet.ls-sheet'] },
    ],
    measurements: { lightsTab: measureLights },
    rules: {
      lightsTab: (variant, results, emit) => {
        if (!variant.name.startsWith('Lights tab')) return false;
        const m = results.lightsTab;
        let bad = false;
        const fail = (t) => { emit('  FAIL lights tab: ' + t); bad = true; };
        if (!m || !m.found) { fail('the Lights tab is not open'); return true; }
        if (m.heads.join() !== 'Looks,Lines,Lights') fail('tabs are ' + m.heads.join());
        if (m.top < -0.5 || m.bottom > m.vh + 0.5 || m.right > m.vw + 0.5) fail(`the sheet runs off the wall (${Math.round(m.top)} to ${Math.round(m.bottom)} of ${m.vh})`);
        if (m.small.length) fail('text under 16 px: ' + m.small.join(' | '));
        if (m.cut.length) fail('cut text: ' + m.cut.join(' | '));
        if (m.outside) fail(m.outside + ' parts outside the sheet');
        if (m.overlap) fail('rows overlap');
        if (m.tinyControl) fail(m.tinyControl + ' controls under 24 px');
        if (m.titleTabs > -8) fail('the heading runs into the tabs by ' + Math.round(m.titleTabs) + ' px');
        if (m.tiles !== 5 || m.rowCount < 5) fail(`rows missing (${m.rowCount} rows, ${m.tiles} tiles)`);
        const pv = m.preview;
        const hit = (a, b) => a && b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
        if (!pv || pv.strips.length !== 2 || pv.pn !== 5 || pv.pl.length !== 4 || pv.oldBar) fail('the preview is not two strips with 5 panel tiles and 4 named plays');
        else {
          for (const st of pv.strips) {
            if (hit(st, pv.usual)) fail(`the ${st.name} strip overlaps Your usual`);
            if (pv.live && hit(st, pv.live)) fail(`the ${st.name} strip overlaps the Preview label`);
            if (st.t < pv.head.t || st.b > pv.head.b || st.l < pv.head.l || st.r > pv.head.r) fail(`the ${st.name} strip leaves the preview box`);
            for (let i = 1; i < st.kids.length; i++) if (hit(st.kids[i - 1], st.kids[i])) fail(`two parts of the ${st.name} strip overlap`);
          }
          if (hit(pv.strips[0], pv.strips[1])) fail('the two preview strips overlap');
        }
        if (!bad) emit(`  ok   lights tab: ${m.rowCount} rows and 5 light tiles inside the sheet, text 16 px or more, nothing cut`);
        return bad;
      },
    },
    breaks: {
      'lights-small': { css: '.ls-help { font-size: 12px !important; }', expect: /^ *FAIL lights tab: text under 16 px/m, appliesTo: (v) => v.name === 'Lights tab, open on Listen' },
    },
  },
};
