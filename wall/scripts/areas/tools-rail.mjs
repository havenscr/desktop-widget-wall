// Tools drawer: the rail of groups and the open panel. In each group (and the two tall states: Light sync pairing and the
// YouTube setup form) the right group is open, every rail entry shows a status line, the drawer ends at or above y 697,
// and nothing scrolls. The shared Tools checks in fit-check.mjs add the 697 and scroll rules for every `tools=` variant.
const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const Q = (knobs) => `?hz=work&at=${at}&clock=review&weather=ok&agents=3&${knobs}`;
const LS_ROW = '.tools-list[aria-label="Light sync"] [data-account="lightsync"]';
const YT_ROW = '.tools-list[aria-label="Accounts"] [data-account="youtube"]';
const RAIL = ['.tools-drawer', '.tools-drawer .tools-rail', '.tools-drawer .tools-panel:not([hidden])'];

// The group each variant must show open.
const EXPECT = {
  'Tools rail, Accounts (the default)': 'accounts',
  'Tools rail, Health with two sources failing': 'health',
  'Tools rail, Lights and home': 'lights',
  'Tools rail, Light sync pairing': 'lights',
  'Tools rail, Display': 'display',
  'Tools rail, YouTube setup form open (tallest)': 'accounts',
  'Tools rail, a Key lights link opens Lights and home': 'lights',
  'Tools rail, a Home app link opens Lights and home': 'lights',
};
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

const G = (name, knobs, expect, actions) => ({ screen: 'work', name: `tools rail: ${name}`, query: Q(knobs).slice(1), custom: true, expect, ...(actions ? { actions } : {}) });

export default {
  name: 'tools-rail',
  gallery: {
    states: [
      G('Accounts', 'tools=1&meet=signedout', ['Accounts', 'need sign-in', 'Weather on']),
      G('Health, two failing', 'weather=stale&tasks=down&tools=health', ['Health', 'Sources', 'Keys file']),
      G('Lights and home', 'tools=lights&keys2=none&lightsync=paired&desktoken=set', ['Key lights', 'Light sync', 'Home app']),
      G('Light sync pairing', 'tools=lights&keys2=none&lightsync=unpaired&desktoken=set', ['Press the link button on the Hue bridge'], LS_ROW + ' .tools-btn.cy'),
      G('Display', 'tools=display', ['Weather in the scene', 'Video look']),
      G('YouTube setup form open', 'youtube=off&meet=signedout&tools=1', ['Client ID', 'Client secret'], YT_ROW + ' .tools-btn'),
    ],
  },
  fit: {
    variants: [
      v('Tools rail, Accounts (the default)', Q('tools=1&meet=signedout')),
      v('Tools rail, Health with two sources failing', Q('weather=stale&tasks=down&tools=health')),
      v('Tools rail, Lights and home', Q('tools=lights&keys2=both&lightsync=paired&desktoken=set')),
      v('Tools rail, Light sync pairing', Q('tools=lights&keys2=none&lightsync=unpaired&desktoken=set'), { click: LS_ROW + ' .tools-btn.cy', checks: [...RAIL, LS_ROW, '[data-lightsync-note]'] }),
      v('Tools rail, Display', Q('tools=display')),
      v('Tools rail, YouTube setup form open (tallest)', Q('youtube=off&meet=signedout&tools=1'), { click: YT_ROW + ' .tools-btn' }),
      v('Tools rail, a Key lights link opens Lights and home', Q('tools=keylights&keys2=none')),
      v('Tools rail, a Home app link opens Lights and home', Q('tools=desktoken&desktoken=unset')),
    ],
    measurements: { toolsRail: measureToolsRail },
    rules: {
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
