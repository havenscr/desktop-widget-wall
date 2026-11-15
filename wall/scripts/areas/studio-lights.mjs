// Studio lights: the key light block on On Air, its Fine tune drawer, the Lights chip on Work and the Key lights
// section in Tools. Gallery states, fit variants, rules and their deliberate breaks live here; the two big review
// scripts are not edited for it. Every state comes from the `?keys2=` knob of the development mocks.

const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const onAirGallery = (knobs) => `hz=onair&at=${at}&clock=review&weather=ok&screen=onair&show=typical&marks=2&oatimer=run&${knobs}`;
const onAirFit = (knobs) => `?hz=onair&at=${at}&clock=review&weather=ok&screen=onair&show=typical&marks=2&oatimer=run&${knobs}`;
const workGallery = (knobs) => `hz=work&at=${at}&clock=review&weather=ok&agents=3&${knobs}`;
const workFit = (knobs) => `?hz=work&at=${at}&clock=review&weather=ok&${knobs}`;

const FINE = '[data-st-opener]';
const LINKED = '.st-k-hd .st-lk';
const LEFT_BRI = '.st-side[data-side="left"] .st-sl';

const state = (screen, name, query, expect, actions) => ({ screen, name, query, custom: true, expect, actions });

const BLOCK_CHECKS = ['.onair .oa-right', '.st-block', '.st-block .st-row'];

// What the block, the drawer, the chip and the Tools section must hold. The page measures; the rule below judges.
function measureStudio() {
  const q = (s) => document.querySelector(s);
  const box = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height };
  };
  const rib = q('.rib');
  const floor = Math.min(510, rib ? rib.getBoundingClientRect().top : 720);
  const small = [];
  const textOf = (root, label) => {
    if (!root) return;
    for (const e of [root, ...root.querySelectorAll('*')]) {
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const px = parseFloat(cs.fontSize);
      if (px < 15.99) small.push(label + ': "' + e.textContent.trim().slice(0, 28) + '" is ' + px + ' px');
    }
  };
  const block = q('.st-block');
  const drawer = q('.st-drawer');
  const tools = q('.tools-drawer');
  const section = q('[data-section="keylights"]');
  const chip = q('.lights-chip');
  textOf(block, 'block');
  textOf(drawer, 'drawer');
  textOf(chip, 'chip');
  textOf(section, 'tools');
  const controls = block ? [...block.querySelectorAll('.st-chip, .st-tg')].map((e) => ({ name: (e.textContent || '').trim().slice(0, 24), h: e.getBoundingClientRect().height })) : [];
  // Anything in the block or the drawer wider than its own box (cut text).
  const cut = [];
  for (const root of [block, drawer, section]) {
    if (!root) continue;
    for (const e of root.querySelectorAll('*')) {
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'inline') continue;
      if (e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis') cut.push((e.textContent || '').trim().slice(0, 28));
    }
  }
  const sum = q('.st-sum');
  const hd = chip ? chip.closest('.lanes-hd') : q('.lanes-hd');
  const ask = q('.lanes-hd .ask-btn');
  const kids = (root) => (root ? [...root.querySelectorAll('*')].map((e) => ({ n: (e.className && e.className.baseVal === undefined ? e.className : '') + ' ' + (e.textContent || '').trim().slice(0, 20), b: box(e) })).filter((x) => x.b && x.b.w > 0) : []);
  return {
    floor,
    block: box(block),
    blockKids: kids(block).map((k) => ({ n: k.n, l: k.b.l, r: k.b.r, t: k.b.t, b: k.b.b })),
    foot: box(q('.oa-foot')),
    column: box(q('.oa-right')),
    drawer: box(drawer),
    drawerKids: kids(drawer).map((k) => ({ n: k.n, l: k.b.l, r: k.b.r, t: k.b.t, b: k.b.b })),
    tools: box(tools),
    section: box(section),
    sectionKids: kids(section).map((k) => ({ n: k.n, l: k.b.l, r: k.b.r, t: k.b.t, b: k.b.b })),
    chip: box(chip),
    chipLines: chip ? new Set([...chip.querySelectorAll('span')].map((s) => Math.round(s.getBoundingClientRect().top / 4))).size : 0,
    header: hd ? { sw: hd.scrollWidth, cw: hd.clientWidth, r: hd.getBoundingClientRect().right } : null,
    ask: ask ? box(ask) : null,
    sum: sum ? { sw: sum.scrollWidth, cw: sum.clientWidth } : null,
    controls,
    small,
    cut,
  };
}

const r1 = (n) => Math.round(n * 10) / 10;
const inside = (b, l, r, t, bt) => b.l >= l - 2 && b.r <= r + 2 && b.t >= t - 2 && b.b <= bt + 2;

const variant = (name, q, extra = {}) => ({ name, q, checks: BLOCK_CHECKS, ...extra });
const workVariant = (name, q, extra = {}) => ({ name, q, checks: ['.lanes-hd', '.lanes-hd-l'], ...extra });
const TOOLS_CHECKS = ['.tools-drawer', '.tools-drawer .tools-col', '.tools-drawer .tools-block', '.tools-drawer .tools-list', '.tools-drawer .tools-foot'];
const toolsVariant = (name, q, extra = {}) => ({ name, q, checks: TOOLS_CHECKS, viewportOnly: true, ...extra });

const BLOCK_V = 'Studio lights, On Air, key lights live';
const DRAWER_V = 'Studio lights, drawer linked';
const TOOLS_V = 'Studio lights, Tools, Key lights saved';
const CHIP_V = 'Studio lights, Work chip, recording, busy header';

export default {
  name: 'studio-lights',
  gallery: {
    states: [
      state('onair', 'studio lights: not set up (day one)', onAirGallery('keys2=none'), ['Studio lights', 'Office only', 'Key lights: type their addresses in Tools', 'Open Tools', 'Presets and room lights come with a later home app change.', '!Fine tune']),
      state('onair', 'studio lights: key lights on, matched', onAirGallery('keys2=both'), ['Key lights 60%, 4400 K', 'Fine tune', 'Presets and room lights come with a later home app change.']),
      state('onair', 'studio lights: key lights off', onAirGallery('keys2=off'), ['Key lights are off', 'Fine tune']),
      state('onair', 'studio lights: lights differ', onAirGallery('keys2=mismatch'), ['Left 60%, 4400 K. Right 45%, 4700 K', 'Fine tune']),
      state('onair', 'studio lights: left light silent', onAirGallery('keys2=left-silent'), ['The left key light is not answering. The other one works.', 'Fine tune']),
      state('onair', 'studio lights: neither answers', onAirGallery('keys2=neither'), ['Key lights are not answering', 'Neither light answered. Check they are on and on this network.', 'Check again', '!Fine tune']),
      state('onair', 'studio lights: a different model', onAirGallery('keys2=other-model'), ['Key lights answer differently than expected', 'Both lights answered, but not in a way the wall knows.', 'Check again']),
      state('onair', 'studio lights: drawer, linked', onAirGallery('keys2=both'), ['Linked', '2900 K warm', '7000 K cool', 'Range 2900 K to 7000 K, the maker\'s figure', '60%', '4400 K'], FINE),
      state('onair', 'studio lights: drawer, split', onAirGallery('keys2=mismatch'), ['Split', 'Left', 'Right', '45%', '4700 K'], `${FINE} >> ${LINKED}`),
      state('onair', 'studio lights: drawer, not matched', onAirGallery('keys2=mismatch'), ['Not matched', 'Linked'], FINE),
      state('onair', 'studio lights: drawer, left light silent', onAirGallery('keys2=left-silent'), ['Left: not answering', 'Try again', 'Right', '60%'], FINE),
      state('onair', 'studio lights: drawer, lights off', onAirGallery('keys2=off'), ['Linked', '40%', '3800 K'], FINE),
      state('onair', 'studio lights: a write the light did not take', onAirGallery('keys2=writefail'), ['The left key light did not take that change', 'Split'], `${FINE} >> ${LINKED} >> drag:${LEFT_BRI}@1900,150`),
      state('work', 'studio lights: Work chip, both on', workGallery('rec=1&keys2=both'), ['Lights 60%', 'Recording', '4 network alerts']),
      state('work', 'studio lights: Work chip, lights differ', workGallery('rec=1&keys2=mismatch'), ['Lights on', 'Recording']),
      state('work', 'studio lights: Work chip, lights off', workGallery('rec=1&keys2=off'), ['Lights off', 'Recording']),
      state('work', 'studio lights: Work chip hidden, not set up', workGallery('rec=1&keys2=none'), ['Recording', '!Lights:']),
      state('work', 'studio lights: Work chip opens the drawer', workGallery('rec=1&keys2=both'), ['Linked', 'Range 2900 K to 7000 K'], '.lights-chip'),
      state('work', 'studio lights: Tools, Key lights empty', workGallery('tools=1&keys2=none'), ['Key lights', 'Not set up', 'Set up']),
      state('work', 'studio lights: Tools, Key lights saved', workGallery('tools=1&keys2=both'), ['Key lights', 'Saved', 'Test', 'Change']),
      state('work', 'studio lights: Tools, a Test result', workGallery('tools=1&keys2=left-silent'), ['Left key light: no answer', 'Right key light answered at'], '.kl-row[data-side="left"] .tools-btn:not(.cy) >> .kl-row[data-side="right"] .tools-btn:not(.cy)'),
      state('onair', 'studio lights: one light not set up', onAirGallery('keys2=right-unset'), ['The right key light is not set up. Add it in Tools.', 'Fine tune', 'Open Tools', '!not answering']),
      state('onair', 'studio lights: one light not set up, drawer', onAirGallery('keys2=right-unset'), ['The right key light is not set up.', 'Open Tools', '2900 K warm', '!Linked', '!Split'], FINE),
      state('onair', 'studio lights: one light set up and silent', onAirGallery('keys2=right-unset-silent'), ['The left key light is not answering. Check it is on and on this network.', 'Check again', '!Neither light']),
      state('onair', 'studio lights: a write the light accepted but did not take', onAirGallery('keys2=stuck'), ['The key lights did not take that change', 'Linked'], `${FINE} >> drag:.st-d-keys .st-sl@2300,150`),
      state('work', 'studio lights: Tools, the saved addresses could not be read', workGallery('tools=1&keys2=unreadable'), ['The saved addresses could not be read. Type them again.', 'Not set up']),
      state('work', 'studio lights: Work chip, a tight header', workGallery('agents=ask&long=1&rec=1&keys2=both'), ['Lights', 'Recording']),
      state('work', 'studio lights: Tools, typing an address', workGallery('tools=1&keys2=none'), ['Save', 'Cancel'], '.kl-row[data-side="left"] .tools-btn'),
      state('work', 'studio lights: Tools, a refused address', workGallery('tools=1&keys2=none'), ['That is not an address on your own network'], '.kl-row[data-side="left"] .tools-btn >> type:.kl-field=8.8.8.8 >> .kl-form .tools-btn.cy'),
    ],
  },
  fit: {
    variants: [
      variant(BLOCK_V, onAirFit('keys2=both')),
      variant('Studio lights, On Air, not set up', onAirFit('keys2=none')),
      variant('Studio lights, On Air, one light silent', onAirFit('keys2=left-silent')),
      variant('Studio lights, On Air, neither answers', onAirFit('keys2=neither')),
      variant('Studio lights, On Air, lights differ', onAirFit('keys2=mismatch')),
      variant(DRAWER_V, onAirFit('keys2=both'), { click: FINE, checks: ['.st-drawer', '.st-d-keys'] }),
      variant('Studio lights, drawer split, lights differ', onAirFit('keys2=mismatch'), { click: `${FINE} >> ${LINKED}`, checks: ['.st-drawer', '.st-d-keys'] }),
      variant('Studio lights, drawer, one light silent', onAirFit('keys2=left-silent'), { click: FINE, checks: ['.st-drawer', '.st-d-keys'] }),
      workVariant(CHIP_V, workFit('agents=ask&rec=1&keys2=both')),
      workVariant('Studio lights, Work chip, long names, lights differ', workFit('agents=ask&long=1&rec=1&keys2=mismatch')),
      variant('Studio lights, On Air, one light not set up', onAirFit('keys2=right-unset')),
      variant('Studio lights, On Air, one light set up and silent', onAirFit('keys2=right-unset-silent')),
      variant('Studio lights, drawer, one light not set up', onAirFit('keys2=right-unset'), { click: FINE, checks: ['.st-drawer', '.st-d-keys'] }),
      toolsVariant(TOOLS_V, workFit('agents=3&tools=1&keys2=both')),
      toolsVariant('Studio lights, Tools, the saved addresses could not be read', workFit('agents=3&tools=1&keys2=unreadable')),
      toolsVariant('Studio lights, Tools, both tests fail, the longest words', workFit('agents=3&tools=1&keys2=other-model'), { click: '.kl-row[data-side="left"] .tools-btn:not(.cy) then .kl-row[data-side="right"] .tools-btn:not(.cy)' }),
      toolsVariant('Studio lights, Tools, typing an address', workFit('agents=3&tools=1&keys2=none'), { click: '.kl-row[data-side="left"] .tools-btn then .kl-row[data-side="right"] .tools-btn >> type:.kl-field=192.168.100.200' }),
      toolsVariant('Studio lights, Tools, test results', workFit('agents=3&tools=1&keys2=left-silent'), { click: '.kl-row[data-side="left"] .tools-btn:not(.cy) then .kl-row[data-side="right"] .tools-btn:not(.cy)' }),
    ],
    measurements: { studio: measureStudio },
    rules: {
      studio: (v, results, emit) => {
        const s = results.studio;
        const fails = [];
        const isBlock = v.name.startsWith('Studio lights, On Air');
        const isDrawer = v.name.startsWith('Studio lights, drawer');
        const isChip = v.name.startsWith('Studio lights, Work chip');
        const isTools = v.name.startsWith('Studio lights, Tools');
        if (isBlock) {
          const b = s.block;
          if (!b) fails.push('studio: the block is not on the page');
          else {
            // x 1920 to 2540, from y 314 (plus or minus 2), ending above the footnote, which ends above the column's bottom.
            if (Math.abs(b.l - 1920) > 2 || b.r > 2542 || Math.abs(b.t - 314) > 2) fails.push('studio: the block is at x ' + r1(b.l) + ' to ' + r1(b.r) + ', y from ' + r1(b.t) + ' (wanted x 1920 to 2540, y 314 plus or minus 2)');
            if (b.b > 462 + 2) fails.push('studio: the block ends at y ' + r1(b.b) + ' (462 at most, and the footnote below it must still fit the column)');
            if (s.foot && s.foot.t < b.b + 4) fails.push('studio: the footnote starts at y ' + r1(s.foot.t) + ', inside the block (ends ' + r1(b.b) + ')');
            if (s.foot && s.foot.b > s.floor + 0.5) fails.push('studio: the footnote ends at y ' + r1(s.foot.b) + ', below the column (' + r1(s.floor) + ')');
            for (const k of s.blockKids) if (k.l < 1920 - 2 || k.r > 2540 + 2 || k.t < b.t - 2 || k.b > b.b + 2) fails.push('studio: "' + k.n.trim() + '" leaves the block (x ' + r1(k.l) + ' to ' + r1(k.r) + ', y ' + r1(k.t) + ' to ' + r1(k.b) + ')');
          }
          for (const c of s.controls) if (c.h < 39.5 || c.h > 48.5) fails.push('studio: control "' + c.name + '" is ' + r1(c.h) + ' px high (40 to 48)');
          if (s.sum && s.sum.sw > s.sum.cw + 1) fails.push('studio: the summary line is cut');
        }
        if (isDrawer) {
          const d = s.drawer;
          if (!d) fails.push('studio: the drawer is not on the page');
          else {
            if (d.l < 0 || d.r > 2560 || d.t < 0 || d.b > s.floor + 0.5) fails.push('studio: the drawer is at x ' + r1(d.l) + ' to ' + r1(d.r) + ', y ' + r1(d.t) + ' to ' + r1(d.b) + ' (inside the wall, above the strip at y ' + r1(s.floor) + ')');
            if (s.column && (d.r > s.column.r + 2 || (s.column.w >= 560 && d.l < s.column.l - 2))) fails.push('studio: the drawer at x ' + r1(d.l) + ' to ' + r1(d.r) + ' reaches outside the right column at x ' + r1(s.column.l) + ' to ' + r1(s.column.r) + ' (it must not cover the notes card)');
            for (const k of s.drawerKids) if (k.l < d.l - 1 || k.r > d.r + 1 || k.b > d.b + 1) fails.push('studio: "' + k.n.trim() + '" leaves the drawer');
          }
        }
        if (isTools) {
          const t = s.tools;
          const c = s.section;
          if (!t || !c) fails.push('studio: the Tools section is not on the page');
          else {
            if (c.l < t.l || c.r > t.r || c.t < t.t || c.b > t.b) fails.push('studio: the Key lights section at x ' + r1(c.l) + ' to ' + r1(c.r) + ', y ' + r1(c.t) + ' to ' + r1(c.b) + ' is outside the Tools drawer');
            if (t.b > 720.5 || t.t < -0.5) fails.push('studio: the Tools drawer is at y ' + r1(t.t) + ' to ' + r1(t.b) + ' (inside the wall, 0 to 720)');
            for (const k of s.sectionKids) if (k.r > t.r - 1 || k.l < t.l + 1 || k.b > t.b + 1) fails.push('studio: "' + k.n.trim() + '" in Tools is cut by the drawer edge');
          }
        }
        if (isChip) {
          const c = s.chip;
          if (!c) fails.push('studio: the Lights chip is not in the header');
          else {
            if (c.h > 32.5 || s.chipLines > 1) fails.push('studio: the chip is ' + r1(c.w) + ' x ' + r1(c.h) + ' px over ' + s.chipLines + ' lines (one 32 px line)');
            if (s.header && (s.header.sw > s.header.cw + 1 || c.r > s.header.r + 0.5)) fails.push('studio: the header is cut by the chip (scroll ' + s.header.sw + ' of ' + s.header.cw + ')');
            // The line that waits on the owner stays readable: its button keeps at least 160 px.
            if (s.ask && s.ask.w < 160) fails.push('studio: the waiting line shrank to ' + r1(s.ask.w) + ' px beside the chip (160 at least)');
          }
        }
        if (isBlock || isDrawer || isChip || isTools) {
          for (const x of s.small) fails.push('studio: text under 16 px: ' + x);
          for (const x of s.cut) fails.push('studio: cut text "' + x + '"');
        }
        for (const f of fails) emit('  FAIL ' + f);
        if (fails.length) return true;
        if (isBlock || isDrawer || isChip || isTools) emit('  ok   studio lights: inside their boxes, controls 40 to 48 px, text 16 px or more, nothing cut');
        return false;
      },
    },
    breaks: {
      'studio-block': { css: '.st-block { height: 260px !important; }', expect: /^ *FAIL studio: .*(block|footnote)/m, appliesTo: (v) => v.name === BLOCK_V },
      'studio-controls': { css: '.st-chip { height: 30px !important; }', expect: /^ *FAIL studio: control ".*" is \d+(\.\d)? px high/m, appliesTo: (v) => v.name === BLOCK_V },
      'studio-text': { css: '.st-line { font-size: 13px !important; }', expect: /^ *FAIL studio: text under 16 px/m, appliesTo: (v) => v.name === BLOCK_V },
      'studio-drawer-wide': { css: '.st-drawer { left: 1680px !important; width: 860px !important; }', expect: /^ *FAIL studio: the drawer at x .* reaches outside the right column/m, appliesTo: (v) => v.name === DRAWER_V },
      'studio-drawer': { css: '.st-drawer { top: 300px !important; }', expect: /^ *FAIL studio: the drawer is at/m, appliesTo: (v) => v.name === DRAWER_V },
      'studio-tools': { css: '.kl-field { width: 900px !important; flex: none !important; }', expect: /^ *FAIL studio: .*(Tools|Key lights)/m, appliesTo: (v) => v.name === 'Studio lights, Tools, typing an address' },
      'studio-chip': { css: '.lights-chip { width: 900px !important; }', expect: /^ *FAIL studio: (the header is cut|the waiting line shrank|the chip)/m, appliesTo: (v) => v.name === CHIP_V },
    },
  },
};
