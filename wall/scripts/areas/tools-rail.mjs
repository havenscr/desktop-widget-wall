// Tools drawer: the rail of groups and the open panel. In each group (and the two tall states: Light sync pairing and the
// YouTube setup form) the right group is open, every rail entry shows a status line, the drawer ends at or above y 697,
// and nothing scrolls. The shared Tools checks in fit-check.mjs add the 697 and scroll rules for every `tools=` variant.
const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const Q = (knobs) => `?hz=work&at=${at}&clock=review&weather=ok&agents=3&${knobs}`;
const LS_ROW = '.tools-list[aria-label="Light sync"] [data-account="lightsync"]';
const YT_ROW = '.tools-list[aria-label="Accounts"] [data-account="youtube"]';
const BK = '.tools-drawer [data-section="briefkey"]';
const RAIL = ['.tools-drawer', '.tools-drawer .tools-rail', '.tools-drawer .tools-panel:not([hidden])'];

// The group each variant must show open.
const EXPECT = {
  'Tools rail, Accounts (the default)': 'accounts',
  'Tools rail, Health with two sources failing': 'health',
  'Tools rail, Lights and home': 'lights',
  'Tools rail, Light sync pairing': 'lights',
  'Tools rail, Display': 'display',
  'Tools rail, YouTube setup form open (tallest)': 'accounts',
  'Tools rail, Meeting brief key field open': 'accounts',
  'Tools rail, a Key lights link opens Lights and home': 'lights',
  'Tools rail, a Home app link opens Lights and home': 'lights',
};
const SP_BTN = '.tools-drawer [data-section="stagepop"] .tools-btn.cy';
const SP = 'tools=lights&keys2=none&lightsync=paired&desktoken=set&sp=waiting&spcode=ready';
const SPV = ['Tools, Stage pop-out, code hidden', 'Tools, Stage pop-out, code shown'];
const v = (name, q, extra = {}) => ({ name, q, checks: RAIL, viewportOnly: true, ...extra });

// Runs in the page.
function measureToolsRail() {
  const drawer = document.querySelector('.tools-drawer');
  if (!drawer) return { found: false };
  const open = drawer.querySelector('.tools-tab[aria-selected="true"]');
  const panels = [...drawer.querySelectorAll('.tools-panel:not([hidden])')];
  const tabs = [...drawer.querySelectorAll('.tools-tab')].map((t) => ({ group: t.getAttribute('data-group'), line: (t.querySelector('.tools-tabline')?.textContent || '').trim() }));
  return { found: true, active: open ? open.getAttribute('data-group') : null, panels: panels.length, tabs, bottom: Math.round(drawer.getBoundingClientRect().bottom * 10) / 10 };
}

// Runs in the page. The Stage pop-out block in Tools: the code field with its focus ring (3 px outline at 2 px offset, so 5 px
// out) must touch no other control, no two controls overlap, and no text is under 16 px.
function measureStagePopTools() {
  const box = document.querySelector('.tools-drawer [data-section="stagepop"]');
  if (!box) return { found: false, fails: [] };
  const fails = [];
  const r1 = (n) => Math.round(n * 10) / 10;
  const RING = 5;
  const code = box.querySelector('.oa2-spt-code');
  const controls = [...box.querySelectorAll('button, input:not(.oa2-spt-code)')];
  const named = (e) => e.getAttribute('aria-label') || (e.textContent || '').trim().slice(0, 20) || e.tagName;
  const hit = (a, b, m) => a.left < b.right - 0.5 + m && a.right > b.left + 0.5 - m && a.top < b.bottom - 0.5 + m && a.bottom > b.top + 0.5 - m;
  if (code) {
    const c = code.getBoundingClientRect();
    const ring = { left: c.left - RING, right: c.right + RING, top: c.top - RING, bottom: c.bottom + RING };
    for (const e of controls) if (hit(ring, e.getBoundingClientRect(), 0)) fails.push('stage pop-out: the code field ring (' + r1(ring.top) + ' to ' + r1(ring.bottom) + ') overlaps "' + named(e) + '" (' + r1(e.getBoundingClientRect().top) + ' to ' + r1(e.getBoundingClientRect().bottom) + ')');
    const row = code.parentElement.getBoundingClientRect();
    if (ring.top < row.top - 0.5 || ring.bottom > row.bottom + 0.5) fails.push('stage pop-out: the code field ring leaves its own row');
  }
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) if (hit(controls[i].getBoundingClientRect(), controls[j].getBoundingClientRect(), 0)) fails.push('stage pop-out: "' + named(controls[i]) + '" overlaps "' + named(controls[j]) + '"');
  for (const el of [box, ...box.querySelectorAll('*')]) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    const px = parseFloat(getComputedStyle(el).fontSize);
    if ((own || el === code) && px < 15.99) fails.push('stage pop-out: "' + (el.textContent.trim() || named(el)).slice(0, 30) + '" is ' + px + ' px, under 16');
  }
  return { found: true, code: !!code, fails };
}

// Runs in the page. Each Key lights row keeps its status on the name's line, and the Stage pop-out place status sits on the
// Save button's line; each status stays inside its row.
function measureInlineStatus() {
  const out = [];
  const add = (label, lead, status, row) => {
    if (!lead || !status || !row) { out.push({ label, missing: true }); return; }
    const a = lead.getBoundingClientRect(), b = status.getBoundingClientRect(), r = row.getBoundingClientRect();
    const after = [...row.querySelectorAll('button, input')].filter((c) => c.getBoundingClientRect().left >= b.left - 0.5 && c !== status);
    const clear = after.every((c) => { const k = c.getBoundingClientRect(); return k.left >= b.right - 0.5 || k.bottom <= b.top || k.top >= b.bottom; });
    out.push({ label, dy: Math.round(Math.abs((b.top + b.bottom) / 2 - (a.top + a.bottom) / 2) * 10) / 10, inside: b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5 && b.right <= r.right + 0.5, width: Math.round(b.width), clear });
  };
  for (const row of document.querySelectorAll('.tools-drawer [data-section="keylights"] .kl-row'))
    add('key light ' + row.getAttribute('data-side'), row.querySelector('.kl-name'), row.querySelector('.kl-state'), row);
  const sp = document.querySelector('.tools-drawer [data-section="stagepop"]');
  if (sp) {
    const save = [...sp.querySelectorAll('.dt-row .tools-btn')].find((b) => (b.textContent || '').trim() === 'Save');
    const row = save ? save.parentElement : null;
    add('stage pop-out place', save, row && row.querySelector('.kl-state'), row);
  }
  return out;
}

const G = (name, knobs, expect, actions) => ({ screen: 'work', name: `tools rail: ${name}`, query: Q(knobs).slice(1), custom: true, expect, ...(actions ? { actions } : {}) });

export default {
  name: 'tools-rail',
  gallery: {
    states: [
      G('Accounts', 'tools=1&meet=signedout', ['Accounts', 'need sign-in', 'Weather on', 'Meeting brief', 'Brief key']),
      G('Health, two failing', 'weather=stale&tasks=down&tools=health', ['Health', 'Sources', 'Reload']),
      G('Lights and home', 'tools=lights&keys2=none&lightsync=paired&desktoken=set', ['Key lights', 'Light sync', 'Home app']),
      G('Light sync pairing', 'tools=lights&keys2=none&lightsync=unpaired&desktoken=set', ['Press the link button on the Hue bridge'], LS_ROW + ' .tools-btn.cy'),
      G('Display', 'tools=display', ['Sky', 'Show on', 'Weather in the scene', 'Video look']),
      G('YouTube setup form open', 'youtube=off&meet=signedout&tools=1', ['Client ID', 'Client secret'], YT_ROW + ' .tools-btn'),
    ],
  },
  fit: {
    variants: [
      v('Tools rail, Accounts (the default)', Q('tools=1&meet=signedout'), { checks: [...RAIL, BK] }),
      v('Tools rail, Meeting brief key field open', Q('tools=1&meet=signedout'), { click: BK + ' .tools-btn', checks: [...RAIL, BK, BK + ' .tools-input'] }),
      v('Tools rail, Health with two sources failing', Q('weather=stale&tasks=down&tools=health')),
      v('Tools rail, Lights and home', Q('tools=lights&keys2=both&lightsync=paired&desktoken=set')),
      v('Tools rail, Light sync pairing', Q('tools=lights&keys2=none&lightsync=unpaired&desktoken=set'), { click: LS_ROW + ' .tools-btn.cy', checks: [...RAIL, LS_ROW, '[data-lightsync-note]'] }),
      v('Tools rail, Display', Q('tools=display')),
      v('Tools rail, YouTube setup form open (tallest)', Q('youtube=off&meet=signedout&tools=1'), { click: YT_ROW + ' .tools-btn' }),
      v('Tools rail, a Key lights link opens Lights and home', Q('tools=keylights&keys2=none')),
      v('Tools rail, a Home app link opens Lights and home', Q('tools=desktoken&desktoken=unset')),
      v(SPV[0], Q(SP), { checks: [...RAIL, '.tools-drawer [data-section="stagepop"]'] }),
      v(SPV[1], Q(SP), { click: SP_BTN, checks: [...RAIL, '.tools-drawer [data-section="stagepop"]'] }),
    ],
    measurements: { inlineStatus: measureInlineStatus, toolsRail: measureToolsRail, stagePopTools: measureStagePopTools },
    rules: {
      inlineStatus: (variant, results, emit) => {
        if (variant.name !== 'Tools rail, Lights and home' && variant.name !== SPV[0]) return false;
        const rows = (results.inlineStatus || []).filter((m) => (variant.name === SPV[0]) === m.label.startsWith('stage'));
        if (rows.length === 0) { emit('  FAIL inline status: no rows measured'); return true; }
        let bad = false;
        for (const m of rows) {
          if (m.missing) { emit('  FAIL inline status: ' + m.label + ' is missing its status'); bad = true; }
          else if (m.dy > 4) { emit('  FAIL inline status: ' + m.label + ' status is ' + m.dy + ' px below its line, not beside it'); bad = true; }
          else if (!m.inside) { emit('  FAIL inline status: ' + m.label + ' status leaves its row'); bad = true; }
          else if (m.width < 24) { emit('  FAIL inline status: ' + m.label + ' status is ' + m.width + ' px wide, too narrow to read'); bad = true; }
          else if (!m.clear) { emit('  FAIL inline status: ' + m.label + ' status runs under a button'); bad = true; }
        }
        if (!bad) emit('  ok   inline status: ' + rows.map((m) => m.label).join(', ') + ' sit on their own line, inside the row');
        return bad;
      },
      stagePopTools: (variant, results, emit) => {
        if (!SPV.includes(variant.name)) return false;
        const m = results.stagePopTools;
        if (!m || !m.found) { emit('  FAIL stage pop-out: the block is not shown in Tools'); return true; }
        if ((variant.name === SPV[1]) !== m.code) { emit('  FAIL stage pop-out: the code field is ' + (m.code ? 'shown' : 'missing') + ' in the wrong variant'); return true; }
        for (const f of m.fails) emit('  FAIL ' + f);
        if (!m.fails.length) emit('  ok   stage pop-out in Tools: the code field and its ring touch no other control, text at least 16 px');
        return m.fails.length > 0;
      },
      toolsRail: (variant, results, emit) => {
        const want = EXPECT[variant.name];
        if (!want) return false;
        const m = results.toolsRail;
        if (!m || !m.found) {
          emit('  FAIL tools rail: the drawer is not open');
          return true;
        }
        let bad = false;
        if (m.active !== want) { emit(`  FAIL tools rail: ${m.active} is open, expected ${want}`); bad = true; }
        if (m.panels !== 1) { emit(`  FAIL tools rail: ${m.panels} panels are shown, expected one`); bad = true; }
        const empty = m.tabs.filter((t) => !t.line);
        if (m.tabs.length < 4 || empty.length > 0) { emit(`  FAIL tools rail: ${empty.length || 'a'} rail entr${empty.length === 1 ? 'y has' : 'ies have'} no status line`); bad = true; }
        if (!bad) emit(`  ok   tools rail: ${want} open, ${m.tabs.length} status lines, bottom edge y ${m.bottom}`);
        return bad;
      },
    },
    breaks: {
      'inline-status-stacked': {
        css: '.kl-head { flex-wrap: wrap !important; } .kl-head .kl-state { flex: 1 0 100% !important; } .dt-row .kl-state { flex: 1 0 100% !important; } .dt-row:has(.oa2-spt-num) { flex-wrap: wrap !important; }',
        expect: /^ *FAIL inline status: .* not beside it/m,
        appliesTo: (variant) => variant.name === 'Tools rail, Lights and home' || variant.name === SPV[0],
      },
      'stagepop-code-overlap': {
        css: '.dt-row.dt-code { padding: 0 !important; margin: -8px 0 !important; }',
        expect: /^ *FAIL stage pop-out: the code field ring/m,
        appliesTo: (variant) => variant.name === SPV[1],
      },
      'tools-rail-tall': {
        css: '.tools-panel { min-height: 700px !important; }',
        expect: /^ *FAIL tools drawer: bottom edge y [\d.]+, past y 697/m,
        appliesTo: (variant) => variant.name === 'Tools rail, Display',
      },
      'tools-rail-small': {
        css: '.tools-tabline { font-size: 12px !important; }',
        expect: /^ *FAIL tools rail: status line under 16 px/m,
        appliesTo: (variant) => variant.name === 'Tools rail, Lights and home',
      },
    },
  },
};
