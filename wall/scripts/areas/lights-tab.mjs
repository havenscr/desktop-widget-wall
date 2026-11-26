// The Lights tab of the Looks and Lines sheet (the gear on Listen): the sheet stays on the wall, every row and helper line
// is inside it, uncut, at 16 px or more, and the controls keep a usable size. Mock moods and audio are invented.
const at = '2026-11-11T10:24:00-08:00';
const Q = (extra = '') => `?hz=unwind&at=${encodeURIComponent(at)}&long=1&agents=3&audio=demo&desktoken=set&office=six&officeoff=offered&officemood=relax${extra}`;
const OPEN = '.w-gear >> .ln-pages button:nth-child(4)';

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
  const strips = [...sheet.querySelectorAll('.ls-strip')].map((e) => ({ name: e.getAttribute('data-row'), ...bx(e), kids: [...e.querySelectorAll('b, .ls-pn, .ls-play')].map((k) => { if (k.tagName !== 'B') return bx(k); const rg = document.createRange(); rg.selectNodeContents(k); const t = rg.getBoundingClientRect(); const box = k.getBoundingClientRect(); return { l: t.left, t: t.top, r: t.right, b: t.bottom, boxR: box.right }; }) }));
  const preview = { head: hb ? { l: hb.left, t: hb.top, r: hb.right, b: hb.bottom } : null, usual: bx(sheet.querySelector('.ls-usualbtn')), live: liveEl ? bx(lab) : null, strips, pn: sheet.querySelectorAll('.ls-pn').length, pl: [...sheet.querySelectorAll('.ls-play em')].map((e) => e.textContent), oldBar: !!sheet.querySelector('.ls-bar') };
  return { preview, found: true, top: sr.top, bottom: sr.bottom, left: sr.left, right: sr.right, vh: window.innerHeight, vw: window.innerWidth, small, cut, outside, overlap, tinyControl, heads, titleTabs: title && tabs ? title.right - tabs.left : -999, tiles: sheet.querySelectorAll('.ls-tile').length, rowCount: sheet.querySelectorAll('.ls-row').length };
}

// Runs in the page: the heading row of whichever tab of the sheet is open (Looks, Lines or Lights). The title's drawn text ends
// at least 12 px before the tabs, each tab's text sits 10 px or more from its button's edges, the whole title shows (no line cut), and the tabs end before the cross.
function measureSheetHead() {
  const sheet = document.querySelector('.w-sheet');
  const head = sheet && sheet.querySelector(':scope > .w-head');
  if (!head) return { found: false };
  const title = head.querySelector('.u-k');
  const tabs = head.querySelector('.ln-pages');
  const x = sheet.querySelector('.w-x');
  const tr = document.createRange();
  tr.selectNodeContents(title);
  const text = tr.getBoundingClientRect();
  const tb = tabs.getBoundingClientRect();
  const xb = x.getBoundingClientRect();
  return { found: true, words: title.textContent.trim(), gap: tb.left - text.right,
    tabPad: [...tabs.querySelectorAll('button')].map((b) => {
      const r = document.createRange();
      r.selectNodeContents(b);
      const t = r.getBoundingClientRect();
      const bb = b.getBoundingClientRect();
      return { words: b.textContent.trim(), pad: Math.min(t.left - bb.left, bb.right - t.right) };
    }), cut: title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1, lines: Math.round(text.height / (parseFloat(getComputedStyle(title).lineHeight) || text.height)), crossGap: xb.left - tb.right, fontsReady: document.fonts ? document.fonts.status : 'unknown' };
}

export default {
  name: 'lights-tab',
  gallery: {
    states: [
      { screen: 'unwind', name: 'sheet pages: Looks', query: `hz=unwind&at=${encodeURIComponent(at)}&clock=review&weather=ok&audio=demo&desktoken=set&office=six&officeoff=offered&officemood=relax`, custom: true, expect: ['Same for all'], actions: '.w-gear >> .ln-pages button:nth-child(1)' },
      { screen: 'unwind', name: 'sheet pages: Looks, scrolled to the bottom', query: `hz=unwind&at=${encodeURIComponent(at)}&clock=review&weather=ok&watch=mock&wlist=many&wplay=2&wsheet=kind&wtune=drivein.size=90`, custom: true, expect: ['Settings for'], actions: 'scrollend:.wk-rows' },
      { screen: 'unwind', name: 'sheet pages: Lines', query: `hz=unwind&at=${encodeURIComponent(at)}&clock=review&weather=ok&audio=demo&desktoken=set&office=six&officeoff=offered&officemood=relax`, custom: true, expect: ['How lively'], actions: '.w-gear' },
      { screen: 'unwind', name: 'sheet pages: Vibe', query: `hz=unwind&at=${encodeURIComponent(at)}&clock=review&weather=ok&audio=demo&desktoken=set&office=six&officeoff=offered&officemood=relax`, custom: true, expect: ['Auto vibe', 'Music on other tabs'], actions: '.w-gear >> .ln-pages button:nth-child(3)' },
      { screen: 'unwind', name: 'sheet pages: Vibe, scrolled to the bottom', query: `hz=unwind&at=${encodeURIComponent(at)}&clock=review&weather=ok&audio=demo&desktoken=set&office=six&officeoff=offered&officemood=relax`, custom: true, expect: ['Music on other tabs'], actions: '.w-gear >> .ln-pages button:nth-child(3) >> scrollend:.w-sheet > .ln-body' },
      { screen: 'unwind', name: 'lights tab: the Lights tab open on Listen', query: `hz=unwind&at=${encodeURIComponent(at)}&clock=review&weather=ok&audio=demo&desktoken=set&office=six&officeoff=offered&officemood=relax`, custom: true, expect: ['Preview, live', 'Intensity', 'Colour speed', 'Brightness', 'Pulse', 'Smoothness', 'Who follows', 'Panel ripple'], actions: '.w-gear >> .ln-pages button:nth-child(4)' },
    ],
  },
  fit: {
    variants: [
      { name: 'Lights tab, open on Listen', q: Q(), click: OPEN, checks: ['.w-sheet.ls-sheet'] },
      { name: 'Lights tab, open while sync runs', q: Q('&lsync=on'), click: OPEN, checks: ['.w-sheet.ls-sheet'] },
      { name: 'Sheet heading, Looks tab', q: Q(), click: '.w-gear >> .ln-pages button:nth-child(1)', checks: ['.w-sheet', '.ln-pages'] },
      { name: 'Sheet heading, Lines tab', q: Q(), click: '.w-gear', checks: ['.w-sheet', '.ln-pages'] },
      { name: 'Sheet heading, Vibe tab', q: Q(), click: '.w-gear >> .ln-pages button:nth-child(3)', checks: ['.w-sheet', '.ln-pages'] },
      { name: 'Sheet heading, Lights tab', q: Q(), click: OPEN, checks: ['.w-sheet', '.ln-pages'] },
    ],
    measurements: { lightsTab: measureLights, sheetHead: measureSheetHead },
    rules: {
      sheetHead: (variant, results, emit) => {
        if (!variant.name.startsWith('Sheet heading')) return false;
        const m = results.sheetHead;
        let bad = false;
        const fail = (t) => { emit('  FAIL sheet heading: ' + t); bad = true; };
        if (!m || !m.found) { fail('the sheet has no heading row'); return true; }
        if (m.gap < 11.5) fail(`"${m.words}" ends ${Math.round(m.gap * 10) / 10} px from the tabs (12 at least)`);
        const tight = (m.tabPad || []).filter((b) => b.pad < 9.5);
        if (tight.length) fail('tab text under 10 px from its button edge: ' + tight.map((b) => `${b.words} ${Math.round(b.pad * 10) / 10}`).join(', '));
        if (m.cut) fail(`"${m.words}" is cut`);
        if (m.lines > 1) fail(`"${m.words}" runs over ${m.lines} lines (one line only)`);
        if (m.crossGap < 7.5) fail(`the tabs end ${Math.round(m.crossGap * 10) / 10} px from the close cross (8 at least)`);
        if (!bad) emit(`  ok   sheet heading: "${m.words}" ends ${Math.round(m.gap)} px before the tabs, whole, and the tabs clear the cross (fonts ${m.fontsReady})`);
        return bad;
      },
      lightsTab: (variant, results, emit) => {
        if (!variant.name.startsWith('Lights tab')) return false;
        const m = results.lightsTab;
        let bad = false;
        const fail = (t) => { emit('  FAIL lights tab: ' + t); bad = true; };
        if (!m || !m.found) { fail('the Lights tab is not open'); return true; }
        if (m.heads.join() !== 'Looks,Lines,Vibe,Lights') fail('tabs are ' + m.heads.join());
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
            // The label is measured by its text, not its box; every child must also end inside the head.
            const lab = st.kids[0], next = st.kids[1];
            if (lab && next && lab.r > next.l - 4) fail(`the ${st.name} label text runs to ${Math.round(lab.r)} px, within 4 px of the next part at ${Math.round(next.l)} px`);
            for (const k of st.kids) if (k.r > pv.head.r + 0.5 || k.l < pv.head.l - 0.5) fail(`a part of the ${st.name} strip runs past the preview box`);
          }
          if (hit(pv.strips[0], pv.strips[1])) fail('the two preview strips overlap');
        }
        if (!bad) emit(`  ok   lights tab: ${m.rowCount} rows and 5 light tiles inside the sheet, text 16 px or more, nothing cut`);
        return bad;
      },
    },
    breaks: {
      'sheet-head-run': { css: '.w-head > .ln-pages { position: absolute !important; top: 14px; right: 70px; }', expect: /^ *FAIL sheet heading: .* px from the tabs/m, appliesTo: (v) => v.name === 'Sheet heading, Looks tab' },
      'tab-pad': { css: '.w-head > .w-seg.ln-pages { width: 190px !important; }', expect: /^ *FAIL sheet heading: tab text under 10 px/m, appliesTo: (v) => v.name === 'Sheet heading, Lights tab' },
      'lights-small': { css: '.ls-help { font-size: 12px !important; }', expect: /^ *FAIL lights tab: text under 16 px/m, appliesTo: (v) => v.name === 'Lights tab, open on Listen' },
    },
  },
};
