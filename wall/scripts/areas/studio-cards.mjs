// Studio lights: the card that opens on a group's name (Key lights, Panels, a room group), the Panels effect row and
// its list, and the Panels brightness slider in the sheet. Every state comes from the `?studio=`, `?desktoken=` and
// `?keys2=` knobs of the development mocks (`fourlooks` and `eightlooks` list four and eight invented effects).

const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const onAirGallery = (knobs) => `hz=onair&at=${at}&clock=review&weather=ok&screen=onair&show=typical&marks=2&oatimer=run&${knobs}`;
const onAirFit = (knobs) => `?${onAirGallery(knobs)}`;

const READY = 'keys2=both&studio=ready&desktoken=set';
const FOUR = 'keys2=both&studio=fourlooks&desktoken=set';
const EIGHT = 'keys2=both&studio=eightlooks&desktoken=set';
const FINE = '[data-st-opener]';
const NAME = (id) => `[data-card-for="${id}"]`;
const EFFECT = '.st-gcard .st-effect';
const SHEET_EFFECT = '.st-drawer .st-effect';
const LINKED = '.st-gcard .st-k-hd .st-lk';

const state = (name, query, expect, actions) => ({ screen: 'onair', name: `studio cards: ${name}`, query, custom: true, expect, actions });

// What a card, its list and the sheet under it must hold. The page measures; the rule judges.
function measureCards() {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const box = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height };
  };
  const card = q('.st-gcard');
  const list = q('.st-eflist');
  const open = card ? q('[data-card-for][aria-expanded="true"]') : null;
  const tile = open ? open.closest('.st-tg') : null;
  const small = [];
  const cut = [];
  const scan = (root, label) => {
    if (!root) return;
    for (const e of [root, ...root.querySelectorAll('*')]) {
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const px = parseFloat(cs.fontSize);
      const text = (e.textContent || '').trim().slice(0, 28);
      if (px < 15.99) small.push(label + ': "' + text + '" is ' + px + ' px');
      if (cs.display !== 'inline' && e.scrollWidth > e.clientWidth + 1) cut.push(label + ': ' + text);
    }
  };
  scan(card, 'card');
  scan(list, 'list');
  const drawer = q('.st-drawer');
  const body = q('.st-d-body:not(.one)');
  const rib = q('.rib');
  const floor = Math.min(510, rib ? rib.getBoundingClientRect().top : 720);
  const kids = (root) => (root ? [...root.querySelectorAll('*')].map((e) => ({ n: String(typeof e.className === 'string' ? e.className : '') + ' ' + (e.textContent || '').trim().slice(0, 20), b: box(e) })).filter((x) => x.b && x.b.w > 0) : []);
  const stage = q('.stage');
  const sb = box(stage);
  return {
    floor,
    stage: sb,
    card: box(card),
    cardKids: kids(card).map((k) => ({ n: k.n, l: k.b.l, r: k.b.r, t: k.b.t, b: k.b.b })),
    cardCount: qa('.st-gcard').length,
    tiles: qa('.st-switches > .st-tg').map((e) => ({ n: (e.textContent || '').trim().slice(0, 24), b: box(e), name: (() => { const n = e.querySelector('.st-name'); return n ? { sw: n.scrollWidth, cw: n.clientWidth, t: (n.textContent || '').trim() } : null; })() })),
    block: box(q('.st-block')),
    tile: box(tile),
    list: box(list),
    options: qa('.st-eflist [role="option"]').length,
    ticked: qa('.st-eflist [aria-selected="true"]').length,
    effectRows: qa('.st-gcard .st-effect, .st-drawer .st-effect').length,
    drawer: box(drawer),
    bodyScroll: body ? { sh: body.scrollHeight, ch: body.clientHeight } : null,
    zones: qa('.st-zone').map((z) => ({ t: (z.textContent || '').trim(), cut: z.scrollWidth > z.clientWidth + 1 })),
    small,
    cut,
  };
}

const r1 = (n) => Math.round(n * 10) / 10;
const variant = (name, q, extra = {}) => ({ name, q, checks: ['.st-block'], ...extra });

const V_KEYS = 'Studio cards, Key lights, linked';
const V_APART = 'Studio cards, Key lights, apart';
const V_P4 = 'Studio cards, Panels, four effects';
const V_P8 = 'Studio cards, Panels, eight effects, list open';
const V_SHEET8 = 'Studio cards, sheet, eight effects, list open';
const V_REST = 'Studio cards, the four tiles at rest';
const V_ZONE = 'Studio cards, a group that cannot be switched';

export default {
  name: 'studio-cards',
  gallery: {
    states: [
      state('Key lights, linked', onAirGallery(READY), ['Key lights', 'Linked', 'Left and right move together. Click Linked to set each one.'], NAME('keys')),
      state('Key lights, apart', onAirGallery(READY), ['Split', 'Left', 'Right'], `${NAME('keys')} >> ${LINKED}`),
      state('Panels, four effects', onAirGallery(FOUR), ['Panels', 'Effect', 'Studio Blue'], NAME('panels')),
      state('Panels, four effects, list open', onAirGallery(FOUR), ['Slow Ember Drift', 'Soft Daylight', 'Harbour Mist'], `${NAME('panels')} >> ${EFFECT}`),
      state('Panels, eight effects, list open', onAirGallery(EIGHT), ['Aurora', 'First Light', 'Deep Water', 'Candle'], `${NAME('panels')} >> ${EFFECT}`),
      state('Behind monitor', onAirGallery(READY), ['Behind monitor brightness', 'The 45 percent floor keeps the room comfortable on camera.'].slice(1), NAME('behindMonitor')),
      state('a group that cannot be switched', onAirGallery('keys2=both&studio=nozone&desktoken=set'), ['Needs a Hue zone before the wall can switch it.', 'The home app makes the zone. Its README says how.'], NAME('overhead')),
      state('no desk token', onAirGallery('keys2=both&studio=ready&desktoken=unset'), ['View only here.', "To switch it from the wall, add the home app's desk token in Tools."], NAME('panels')),
      state('sheet, Panels brightness and one Effect row', onAirGallery(FOUR), ['Panels brightness', 'Effect', 'Studio Blue'].slice(1), FINE),
      state('sheet, eight effects, list open', onAirGallery(EIGHT), ['Candle', 'Behind monitor'], `${FINE} >> ${SHEET_EFFECT}`),
      state('sheet, two zone groups, the words whole', onAirGallery('keys2=both&studio=nozone&desktoken=set'), ['Needs a Hue zone'], FINE),
    ],
  },
  fit: {
    variants: [
      { name: V_REST, q: onAirFit(READY), checks: ['.st-block', '.st-switches'] },
      variant(V_KEYS, onAirFit(READY), { click: NAME('keys') }),
      variant(V_APART, onAirFit(READY), { click: `${NAME('keys')} >> ${LINKED}` }),
      variant(V_P4, onAirFit(FOUR), { click: NAME('panels') }),
      variant('Studio cards, Panels, four effects, list open', onAirFit(FOUR), { click: `${NAME('panels')} >> ${EFFECT}` }),
      variant(V_P8, onAirFit(EIGHT), { click: `${NAME('panels')} >> ${EFFECT}` }),
      variant('Studio cards, a room group', onAirFit(READY), { click: NAME('behindMonitor') }),
      variant(V_ZONE, onAirFit('keys2=both&studio=nozone&desktoken=set'), { click: NAME('overhead') }),
      variant('Studio cards, no desk token', onAirFit('keys2=both&studio=ready&desktoken=unset'), { click: NAME('panels') }),
      variant('Studio cards, sheet, four effects', onAirFit(FOUR), { click: FINE, checks: ['.st-drawer', '.st-d-keys', '.st-d-rooms'] }),
      variant(V_SHEET8, onAirFit(EIGHT), { click: `${FINE} >> ${SHEET_EFFECT}`, checks: ['.st-drawer', '.st-d-keys', '.st-d-rooms'] }),
    ],
    measurements: { studioCards: measureCards },
    rules: {
      studioCards: (v, results, emit) => {
        const s = results.studioCards;
        if (!v.name.startsWith('Studio cards')) return false;
        const fails = [];
        const isSheet = v.name.includes('sheet');
        const listOpen = v.name.includes('list open');
        if (v.name === V_REST) {
          if (s.tiles.length !== 4) fails.push('studiocards: ' + s.tiles.length + ' tiles in the switch row (four)');
          for (const t of s.tiles) {
            if (t.b.h < 39.5 || t.b.h > 40.5) fails.push('studiocards: tile "' + t.n + '" is ' + r1(t.b.h) + ' px high (40)');
            if (s.block && (t.b.l < s.block.l - 1 || t.b.r > s.block.r + 1)) fails.push('studiocards: tile "' + t.n + '" leaves the block');
            if (t.name && t.name.sw > t.name.cw + 1) fails.push('studiocards: the name "' + t.name.t + '" is cut (' + t.name.sw + ' of ' + t.name.cw + ' px; tile ' + r1(t.b.w) + ' px)');
          }
        }
        if (!isSheet && v.name !== V_REST) {
          const c = s.card;
          if (!c) fails.push('studiocards: the card is not on the page');
          else {
            if (s.cardCount !== 1) fails.push('studiocards: ' + s.cardCount + ' cards are open (one at a time)');
            if (c.l < 0 || c.r > 2560 || c.t < 0) fails.push('studiocards: the card is at x ' + r1(c.l) + ' to ' + r1(c.r) + ', y from ' + r1(c.t) + ' (inside the wall)');
            if (s.tile && Math.abs(s.tile.t - c.b - 12) > 2) fails.push('studiocards: the card ends at y ' + r1(c.b) + ', ' + r1(s.tile.t - c.b) + ' px above its tile (12)');
            if (s.tile && (c.r < s.tile.l || c.l > s.tile.r)) fails.push('studiocards: the card does not sit over its own tile');
            for (const k of s.cardKids) if (!k.n.includes('st-gcard-tail') && (k.l < c.l - 1 || k.r > c.r + 1 || k.t < c.t - 1 || k.b > c.b + 1)) fails.push('studiocards: card part "' + k.n.trim() + '" leaves the card');
            const want = v.name === V_ZONE || v.name.includes('no desk token') ? 380 : 340;
            if (Math.abs(c.w - want) > 2) fails.push('studiocards: the card is ' + r1(c.w) + ' px wide (' + want + ')');
          }
        }
        if (listOpen) {
          const l = s.list;
          if (!l) fails.push('studiocards: the effect list is not on the page');
          else {
            if (l.l < 11 || l.r > 2549 || l.t < 11 || l.b > 709) fails.push('studiocards: the effect list is at x ' + r1(l.l) + ' to ' + r1(l.r) + ', y ' + r1(l.t) + ' to ' + r1(l.b) + ' (12 px inside the wall)');
            if (s.options < 4 || s.options > 8) fails.push('studiocards: the list holds ' + s.options + ' effects (four to eight)');
            if (s.ticked !== 1) fails.push('studiocards: ' + s.ticked + ' effects are ticked (the current one)');
            if (Math.abs(l.h - (s.options * 34 + 16)) > 4) fails.push('studiocards: the list is ' + r1(l.h) + ' px high for ' + s.options + ' rows of 34');
          }
        }
        if (s.effectRows > 1) fails.push('studiocards: ' + s.effectRows + ' Effect rows are drawn (one)');
        if (isSheet) {
          const d = s.drawer;
          if (!d) fails.push('studiocards: the sheet is not on the page');
          else {
            if (d.b > s.floor + 0.5) fails.push('studiocards: the sheet ends at y ' + r1(d.b) + ', below the bottom edge (' + r1(s.floor) + ')');
            if (s.bodyScroll && s.bodyScroll.sh > s.bodyScroll.ch + 1) fails.push('studiocards: the sheet body scrolls (' + s.bodyScroll.sh + ' of ' + s.bodyScroll.ch + ' px): the Effect row must hold any number of effects without growing the sheet');
          }
          for (const z of s.zones) if (z.cut) fails.push('studiocards: "' + z.t + '" is cut in the sheet');
        }
        for (const x of s.small) fails.push('studiocards: text under 16 px: ' + x);
        for (const x of s.cut) fails.push('studiocards: cut text "' + x + '"');
        for (const f of fails) emit('  FAIL ' + f);
        if (fails.length) return true;
        emit('  ok   studiocards: inside their boxes, 12 px above the tile, the list inside the wall, the sheet above the bottom edge, text 16 px or more, nothing cut');
        return false;
      },
    },
    breaks: {
      'studiocards-tiles': { css: '.st-name { padding-right: 40px !important; }', expect: /^ *FAIL studiocards: the name/m, appliesTo: (v) => v.name === V_REST },
      'studiocards-wide': { css: '.st-gcard { width: 1400px !important; }', expect: /^ *FAIL studiocards: .*(card is at|card is \d+|leaves the card)/m, appliesTo: (v) => v.name === V_KEYS },
      'studiocards-gap': { css: '.st-gcard { bottom: 20px !important; }', expect: /^ *FAIL studiocards: the card ends at/m, appliesTo: (v) => v.name === V_KEYS },
      'studiocards-list': { css: '.st-eflist { top: 640px !important; }', expect: /^ *FAIL studiocards: the effect list is at/m, appliesTo: (v) => v.name === V_P8 },
      'studiocards-small': { css: '.st-gcard .st-effect { font-size: 12px !important; }', expect: /^ *FAIL studiocards: text under 16 px/m, appliesTo: (v) => v.name === V_P4 },
      'studiocards-cut': { css: '.st-gcard-why { width: 120px !important; overflow: hidden !important; white-space: nowrap !important; }', expect: /^ *FAIL studiocards: cut text/m, appliesTo: (v) => v.name === V_ZONE },
      'studiocards-sheet': { css: '.st-d-rooms { padding-top: 120px !important; }', expect: /^ *FAIL studiocards: the sheet (ends|body scrolls)/m, appliesTo: (v) => v.name === V_SHEET8 },
    },
  },
};
