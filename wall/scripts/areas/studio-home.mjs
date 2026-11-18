// Studio lights, the home half: the preset row, the summary line and the room switches on On Air, the offer bar, the
// sheet's presets and rooms column, the chips on Work and Meet, and the Home app section in Tools. Gallery states, fit
// variants, rules and their deliberate breaks live here; the two big review scripts are not edited for it. Every state
// comes from the `?studio=`, `?studiowrite=`, `?desktoken=` and `?keys2=` knobs of the development mocks.

const at = encodeURIComponent('2026-11-11T10:24:00-08:00');
const onAirGallery = (knobs) => `hz=onair&at=${at}&clock=review&weather=ok&screen=onair&show=typical&marks=2&oatimer=run&${knobs}`;
const onAirFit = (knobs) => `?hz=onair&at=${at}&clock=review&weather=ok&screen=onair&show=typical&marks=2&oatimer=run&${knobs}`;
const workGallery = (knobs) => `hz=work&at=${at}&clock=review&weather=ok&agents=3&${knobs}`;
const workFit = (knobs) => `?hz=work&at=${at}&clock=review&weather=ok&${knobs}`;
const meetGallery = (knobs) => `hz=work&at=${at}&clock=review&weather=ok&screen=meet&${knobs}`;
const meetFit = (knobs) => `?${meetGallery(knobs)}`;

const READY = 'keys2=both&studio=ready&desktoken=set';
const FINE = '[data-st-opener]';
const LINKED = '.st-k-hd .st-lk';
const CLOSE = '.st-x';
const START = '[aria-label="Start timer"]';
const STOP = '[aria-label="Stop timer"]';

const state = (screen, name, query, expect, actions) => ({ screen, name: `studio home: ${name}`, query, custom: true, expect, actions });

const BLOCK_CHECKS = ['.onair .oa-right', '.st-block', '.st-block .st-presets', '.st-block .st-switches'];
const OFFER_CHECKS = ['.onair .oa-right', '.st-block', '.st-block .st-offer', '.st-block .st-switches'];
const COMPAT_CHECKS = ['.onair .oa-right', '.st-block', '.st-block .st-homeline'];
const SHEET_CHECKS = ['.st-drawer', '.st-d-keys', '.st-d-rooms'];
const TOOLS_CHECKS = ['.tools-drawer', '.tools-drawer .tools-col', '.tools-drawer .tools-block', '.tools-drawer .tools-list', '.tools-drawer .tools-foot'];

// What the block, the offer, the sheet, the chips and the Tools section must hold. The page measures; the rule judges.
function measureHome() {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const box = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height };
  };
  const rib = q('.rib');
  const floor = Math.min(510, rib ? rib.getBoundingClientRect().top : 720);
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
      if (cs.display !== 'inline' && e.scrollWidth > e.clientWidth + 1 && !e.closest('.st-sum')) cut.push(label + ': ' + text);
    }
  };
  const block = q('.st-block');
  const drawer = q('.st-drawer');
  const section = q('[data-section="desktoken"]');
  const chip = q('.lights-chip');
  scan(block, 'block');
  scan(drawer, 'sheet');
  scan(section, 'tools');
  scan(chip, 'chip');
  const kids = (root) => (root ? qa(root + ' *').map((e) => ({ n: String(typeof e.className === 'string' ? e.className : '') + ' ' + (e.textContent || '').trim().slice(0, 20), b: box(e) })).filter((x) => x.b && x.b.w > 0) : []);
  const row = (sel) => qa(sel).map((e) => ({ n: (e.textContent || '').trim().slice(0, 24), b: box(e) }));
  const hd = chip ? chip.closest('.lanes-hd') : null;
  // A preset tile's name and line must show whole (the line may take up to three lines).
  const tiles = qa('.st-pt').map((t) => {
    const l = t.querySelector('.st-pt-l');
    const n = t.querySelector('.st-pt-n');
    return { n: (n ? n.textContent : '').trim().slice(0, 24), lineCut: !!l && l.scrollHeight > l.clientHeight + 1, nameCut: !!n && n.scrollWidth > n.clientWidth + 1 };
  });
  // The sheet's body scrolls when the rooms column is taller than the sheet allows.
  const body = q('.st-d-body:not(.one)');
  const bodyScroll = body ? { sh: body.scrollHeight, ch: body.clientHeight, ov: getComputedStyle(body).overflowY } : null;
  const scrolls = !!body && body.scrollHeight > body.clientHeight + 1;
  const lastRoom = qa('.st-d-rooms .st-srow').pop();
  const inScroll = (e) => scrolls && body.contains(e);
  const ask = q('.lanes-hd .ask-btn');
  const rec = q('.meet-hero-last .rec-chip');
  const recCut = rec ? [rec, ...rec.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 1) : false;
  return {
    floor,
    block: box(block),
    blockKids: kids('.st-block').map((k) => ({ n: k.n, l: k.b.l, r: k.b.r, t: k.b.t, b: k.b.b })),
    foot: box(q('.oa-foot')),
    sumCut: (() => { const e = q('.st-sum'); return e ? { sw: e.scrollWidth, cw: e.clientWidth, text: (e.textContent || '').trim().slice(0, 30) } : null; })(),
    column: box(q('.oa-right')),
    presets: row('.st-presets > *:not(.st-spacer)'),
    presetsBox: box(q('.st-presets')),
    switches: row('.st-switches > *'),
    offer: box(q('.st-offer')),
    drawer: box(drawer),
    drawerKids: qa('.st-drawer *')
      .filter((e) => !inScroll(e))
      .map((e) => ({ n: String(typeof e.className === 'string' ? e.className : '') + ' ' + (e.textContent || '').trim().slice(0, 20), b: box(e) }))
      .filter((x) => x.b && x.b.w > 0)
      .map((k) => ({ n: k.n, l: k.b.l, r: k.b.r, t: k.b.t, b: k.b.b })),
    tiles,
    bodyScroll,
    bodyBox: box(body),
    overheadSlider: box(lastRoom),
    tools: box(q('.tools-drawer')),
    section: box(section),
    sectionKids: kids('[data-section="desktoken"]').map((k) => ({ n: k.n, l: k.b.l, r: k.b.r, t: k.b.t, b: k.b.b })),
    chip: box(chip),
    chipLines: chip ? new Set([...chip.querySelectorAll('span')].map((s) => Math.round(s.getBoundingClientRect().top / 4))).size : 0,
    header: hd ? { sw: hd.scrollWidth, cw: hd.clientWidth, r: hd.getBoundingClientRect().right } : null,
    ask: ask ? box(ask) : null,
    hero: box(q('.meet-hero')),
    rec: box(rec),
    recCut,
    small,
    cut,
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

const variant = (name, q, extra = {}) => ({ name, q, checks: BLOCK_CHECKS, ...extra });
const sheetVariant = (name, q, click) => ({ name, q, click, checks: SHEET_CHECKS });
const toolsVariant = (name, q, extra = {}) => ({ name, q, checks: TOOLS_CHECKS, viewportOnly: true, ...extra });

const BLOCK_V = 'Studio home, block, ready';
const OFFER_V = 'Studio home, block, offer after the timer starts';
const SHEET_V = 'Studio home, sheet, linked';
const SIX_V = 'Studio home, sheet, six panel effects, the list open';
const MEET_V = 'Studio home, Meet chip, in a call';
const TOOLS_V = 'Studio home, Tools, typing a token';

export default {
  name: 'studio-home',
  gallery: {
    states: [
      state('onair', 'block, ready, nothing on', onAirGallery(READY), ['Studio lights', 'No preset on.', 'Key lights 60%, 4400 K', 'On air', 'Recording', 'Back to normal', 'Panels', 'Behind monitor', 'Overhead', 'Fine tune']),
      state('onair', 'block, On air is on', onAirGallery('keys2=both&studio=onair&desktoken=set'), ['On air:', 'Key lights on, panels glow, monitor and overhead white', 'Fine tune']),
      state('onair', 'block, Recording is on', onAirGallery('keys2=both&studio=recording&desktoken=set'), ['Recording:', 'Room 80%, panels calm, key lights on, overhead white']),
      state('onair', 'block, changed since it was set', onAirGallery('keys2=both&studio=changed&desktoken=set'), ['On air, changed', 'since it was set']),
      state('onair', 'block, the home app could not read every light', onAirGallery('keys2=both&studio=stale&desktoken=set'), ['(not fresh)', 'Overhead']),
      state('onair', 'block, the home app went away', onAirGallery(READY.replace('studio=ready', 'studio=lost')), ['The home app is not answering.', 'Try again', 'On air', 'Overhead'], `${FINE} >> ${CLOSE}`),
      state('onair', 'block, no desk token on this PC', onAirGallery('keys2=both&studio=ready&desktoken=unset'), ["These lights are view only here. To switch them from the wall, add the home app's desk token in Tools.", 'Open Tools']),
      state('onair', 'block, a base the token may not go to', onAirGallery('keys2=both&studio=ready&desktoken=insecure'), ['The home app must be reached over https or the tailnet to take changes.', 'Check again']),
      state('onair', 'block, Overhead needs a Hue zone', onAirGallery('keys2=both&studio=nozone&desktoken=set'), ['The home app needs a Hue zone for this light group. Its README says how.'], 'hover:[data-group="overhead"] .st-tg-sw'),
      state('onair', 'block, the home app has no desk token yet', onAirGallery(`${READY}&studiowrite=homeunset`), ['The home app has no desk token yet. Set the same token there.', 'Try again'], '[data-preset="onAir"]'),
      state('onair', 'block, the home app refused the token', onAirGallery(`${READY}&studiowrite=forbidden`), ['The home app refused the desk token. Type it again in Tools.', 'Open Tools'], '[data-preset="onAir"]'),
      state('onair', 'block, the room would be dark', onAirGallery(`${READY}&studiowrite=dark`), ['One room light stays on, so the room is never dark around the monitor.'], '[data-group="overhead"] .st-tg-sw'),
      state('onair', 'block, the home app is busy', onAirGallery(`${READY}&studiowrite=busy`), ['The home app is busy with another light change. Try again in a moment.'], '[data-preset="onAir"]'),
      state('onair', 'block, a light did not answer', onAirGallery(`${READY}&studiowrite=lights`), ['A light did not answer the home app. This shows what it reports now.'], '[data-preset="onAir"]'),
      state('onair', 'block, the home app did not answer in time', onAirGallery(`${READY}&studiowrite=unreachable`), ['The home app did not answer in time. This is what it reports now.'], '[data-preset="onAir"]'),
      state('onair', 'block, a click on On air applies it', onAirGallery(READY), ['On air:', 'Key lights on, panels glow, monitor and overhead white', 'Back to normal'], '[data-preset="onAir"]'),
      state('onair', 'block, offer after the timer starts', onAirGallery(`${READY}`).replace('oatimer=run', 'oatimer=idle'), ['Studio lights are not set.', 'The timer started just now.', 'Set for the stream', 'Not now', 'Panels'], START),
      state('onair', 'block, offer after the timer stops', onAirGallery('keys2=both&studio=onair&desktoken=set'), ['The show timer stopped.', 'The room is still on On air.', 'Back to normal', 'Keep'], STOP),
      state('onair', 'block, a click the token cannot be sent for', onAirGallery(`${READY}&studiowrite=private`), ['The desk token is not sent over plain http. Use https or the tailnet.'], '[data-preset="onAir"]'),
      state('onair', 'block, a refused click says why', onAirGallery(`${READY}&studiowrite=unknown`), ['The home app no longer lists that one. This is what it reports now.'], '[data-preset="onAir"]'),
      state('onair', 'sheet, six panel effects, the list open', onAirGallery('keys2=both&studio=sixlooks&desktoken=set'), ['Ocean waves', 'Aurora', 'Behind monitor'], `${FINE} >> .st-drawer .st-effect`),
      state('onair', 'block, a hover tip on a preset', onAirGallery(READY), ['Key lights on, panels glow, monitor and overhead white'], 'hover:[data-preset="onAir"]'),
      state('onair', 'sheet, ready, linked', onAirGallery(READY), ['On air', 'Recording', 'Back to normal', 'Linked', 'Panels', 'Effect', 'Behind monitor', 'Floor 45%', 'Overhead'], FINE),
      state('onair', 'sheet, ready, split', onAirGallery(`${READY.replace('keys2=both', 'keys2=mismatch')}`), ['Split', 'Left', 'Right', '45%', '4700 K', 'Behind monitor'], `${FINE} >> ${LINKED}`),
      state('onair', 'sheet, On air is on', onAirGallery('keys2=both&studio=onair&desktoken=set'), ['On air', 'Glow', 'Back to normal', 'Goes back to how the room was before'], FINE),
      state('onair', 'sheet, changed since it was set', onAirGallery('keys2=both&studio=changed&desktoken=set'), ['On air, changed', 'Back to normal'], FINE),
      state('onair', 'sheet, no desk token', onAirGallery('keys2=both&studio=ready&desktoken=unset'), ["These lights are view only here. To switch them from the wall, add the home app's desk token in Tools.", 'Open Tools', 'Behind monitor'], FINE),
      state('onair', 'sheet, Overhead needs a Hue zone', onAirGallery('keys2=both&studio=nozone&desktoken=set'), ['Needs a Hue zone', 'Behind monitor'], FINE),
      state('onair', 'sheet, the home app is away', onAirGallery(READY.replace('studio=ready', 'studio=lost')), ['The home app is not answering.', 'Try again', 'Behind monitor'], `${FINE} >> ${CLOSE} >> ${FINE}`),
      state('onair', 'sheet, the home app does not offer presets', onAirGallery('keys2=both&studio=absent'), ['Presets and room lights: the home app does not offer them here yet.', 'Linked'], FINE),
      state('work', 'Work chip names the preset', workGallery('rec=1&keys2=both&studio=onair&desktoken=set'), ['Lights: On air', 'Recording']),
      state('work', 'Work chip, key light words without a preset', workGallery('rec=1&keys2=both&studio=ready&desktoken=set'), ['Lights 60%', 'Recording']),
      state('work', 'Work chip, a tight header', workGallery('agents=ask&long=1&rec=1&keys2=both&studio=onair&desktoken=set'), ['Lights', 'Recording']),
      state('meet', 'Meet chip in a call', meetGallery('meet=known&call=teams&camera=1&rec=1&checklist=four&keys2=both&studio=onair&desktoken=set'), ['In call, Teams', 'Recording', 'Lights: On air']),
      state('meet', 'Meet chip opens the sheet', meetGallery('meet=known&call=teams&camera=1&rec=1&checklist=four&keys2=both&studio=onair&desktoken=set'), ['Lights: On air', 'Back to normal', 'Linked', 'Behind monitor'], '.lights-chip'),
      state('work', 'Tools, Home app, not set', workGallery('tools=1&desktoken=unset'), ['Home app', 'Desk token', 'Not set', 'Set up']),
      state('work', 'Tools, Home app, typing the token', workGallery('tools=1&desktoken=unset'), ['Save', 'Cancel'], '[data-section="desktoken"] .tools-btn'),
      state('work', 'Tools, Home app, set', workGallery('tools=1&desktoken=set'), ['Home app', 'Set', 'Change', 'Forget']),
      state('work', 'Tools, Home app, unreadable', workGallery('tools=1&desktoken=unreadable'), ['The saved token could not be read. Type it again.', 'Change']),
      state('work', 'Tools, Home app, a token with a space is refused', workGallery('tools=1&desktoken=unset'), ['That token has characters the home app cannot take'], '[data-section="desktoken"] .tools-btn >> type:.dt-field=two words >> [data-section="desktoken"] .tools-btn.cy'),
    ],
  },
  fit: {
    variants: [
      variant(BLOCK_V, onAirFit(READY)),
      variant('Studio home, block, On air is on', onAirFit('keys2=both&studio=onair&desktoken=set')),
      variant('Studio home, block, changed', onAirFit('keys2=both&studio=changed&desktoken=set')),
      variant('Studio home, block, the home app went away', onAirFit(READY.replace('studio=ready', 'studio=lost')), { click: `${FINE} >> ${CLOSE}` }),
      ...['unknown', 'refused', 'private', 'notset', 'failed', 'busy', 'lights', 'dark', 'unreachable'].map((w) => variant('Studio home, block, refused line, ' + w, onAirFit(READY + '&studiowrite=' + w), { click: '[data-preset="onAir"]' })),
      variant('Studio home, block, no desk token', onAirFit('keys2=both&studio=ready&desktoken=unset')),
      variant('Studio home, block, a base the token may not go to', onAirFit('keys2=both&studio=ready&desktoken=insecure')),
      variant('Studio home, block, one key light silent', onAirFit(`${READY.replace('keys2=both', 'keys2=left-silent')}`)),
      variant('Studio home, block, no key lights set up', onAirFit(`${READY.replace('keys2=both', 'keys2=none')}`)),
      variant('Studio home, block, the home app does not offer presets', onAirFit('keys2=both&studio=absent'), { checks: COMPAT_CHECKS }),
      variant(OFFER_V, onAirFit(READY).replace('oatimer=run', 'oatimer=idle'), { click: START, checks: OFFER_CHECKS }),
      variant('Studio home, block, offer after the timer stops', onAirFit('keys2=both&studio=onair&desktoken=set'), { click: STOP, checks: OFFER_CHECKS }),
      sheetVariant(SHEET_V, onAirFit(READY), FINE),
      sheetVariant('Studio home, sheet, linked, three looks', onAirFit('keys2=both&studio=threelooks&desktoken=set'), FINE),
      sheetVariant('Studio home, sheet, split, three looks', onAirFit('keys2=mismatch&studio=threelooks&desktoken=set'), `${FINE} >> ${LINKED}`),
      sheetVariant('Studio home, sheet, split', onAirFit(READY.replace('keys2=both', 'keys2=mismatch')), `${FINE} >> ${LINKED}`),
      sheetVariant('Studio home, sheet, On air is on and changed', onAirFit('keys2=both&studio=changed&desktoken=set'), FINE),
      sheetVariant('Studio home, sheet, no desk token', onAirFit('keys2=both&studio=ready&desktoken=unset'), FINE),
      sheetVariant(SIX_V, onAirFit('keys2=both&studio=sixlooks&desktoken=set'), `${FINE} >> .st-drawer .st-effect`),
      sheetVariant('Studio home, sheet, one key light silent', onAirFit(READY.replace('keys2=both', 'keys2=left-silent')), FINE),
      { name: 'Studio home, Work chip, a preset, tight header', q: workFit('agents=ask&long=1&rec=1&keys2=both&studio=onair&desktoken=set'), checks: ['.lanes-hd', '.lanes-hd-l'] },
      { name: MEET_V, q: meetFit('meet=known&call=teams&camera=1&rec=1&checklist=four&keys2=both&studio=onair&desktoken=set'), checks: ['.meet .meet-hero'] },
      { name: 'Studio home, Meet chip, sheet from the chip', q: meetFit('meet=known&call=teams&camera=1&rec=1&checklist=four&keys2=both&studio=onair&desktoken=set'), click: '.lights-chip', checks: SHEET_CHECKS },
      toolsVariant('Studio home, Tools, set', workFit('agents=3&tools=1&desktoken=set')),
      toolsVariant(TOOLS_V, workFit('agents=3&tools=1&desktoken=unset'), { click: '[data-section="desktoken"] .tools-btn >> type:.dt-field=abcdefghijklmnopqrstuvwxyz0123456789' }),
    ],
    measurements: { studioHome: measureHome },
    rules: {
      studioHome: (v, results, emit) => {
        const s = results.studioHome;
        if (!v.name.startsWith('Studio home')) return false;
        const fails = [];
        const isBlock = v.name.startsWith('Studio home, block');
        const isSheet = v.name.startsWith('Studio home, sheet') || v.name.includes('sheet from the chip');
        const isTools = v.name.startsWith('Studio home, Tools');
        const isWork = v.name.startsWith('Studio home, Work chip');
        const isMeet = v.name.startsWith('Studio home, Meet chip') && !v.name.includes('sheet');
        if (isBlock) {
          const b = s.block;
          if (!b) fails.push('studiohome: the block is not on the page');
          else {
            // x 1920 to 2540, from y 314 (plus or minus 2), ending by y 462, the footnote below it inside the column.
            if (Math.abs(b.l - 1920) > 2 || b.r > 2542 || Math.abs(b.t - 314) > 2) fails.push('studiohome: the block is at x ' + r1(b.l) + ' to ' + r1(b.r) + ', y from ' + r1(b.t) + ' (wanted x 1920 to 2540, y 314 plus or minus 2)');
            if (b.b > 464) fails.push('studiohome: the block ends at y ' + r1(b.b) + ' (462 at most), and the footnote below it must still fit the column');
            if (s.foot && s.foot.t < b.b + 4) fails.push('studiohome: the footnote starts at y ' + r1(s.foot.t) + ', inside the block (ends ' + r1(b.b) + ')');
            if (s.foot && s.foot.b > s.floor + 0.5) fails.push('studiohome: the footnote ends at y ' + r1(s.foot.b) + ', below the column (' + r1(s.floor) + ')');
            for (const k of s.blockKids) if (k.l < 1920 - 2 || k.r > 2540 + 2 || k.t < b.t - 2 || k.b > b.b + 2) fails.push('studiohome: block part "' + k.n.trim() + '" leaves the block (x ' + r1(k.l) + ' to ' + r1(k.r) + ', y ' + r1(k.t) + ' to ' + r1(k.b) + ')');
            if (s.presets.length) {
              // The preset row: chips, Back to normal and Fine tune on one 40 px line inside the block.
              const top = s.presets[0].b.t;
              for (const p of s.presets) {
                if (p.b.h < 39.5 || p.b.h > 40.5) fails.push('studiohome: preset row part "' + p.n + '" is ' + r1(p.b.h) + ' px high (40)');
                if (Math.abs(p.b.t - top) > 1) fails.push('studiohome: preset row part "' + p.n + '" is on another line');
                if (p.b.l < b.l - 1 || p.b.r > b.r + 1) fails.push('studiohome: preset row part "' + p.n + '" leaves the block (x ' + r1(p.b.l) + ' to ' + r1(p.b.r) + ')');
              }
              for (const c of s.cut) if (c.startsWith('block: ') && s.presets.some((p) => c.includes(p.n.slice(0, 10)))) fails.push('studiohome: preset row text is cut: ' + c);
            }
            if (s.switches.length) {
              // The switch row: four tiles on one 40 px line inside the block.
              const top = s.switches[0].b.t;
              if (s.switches.length !== 4) fails.push('studiohome: switch row has ' + s.switches.length + ' tiles (four)');
              for (const p of s.switches) {
                if (p.b.h < 39.5 || p.b.h > 40.5) fails.push('studiohome: switch row tile "' + p.n + '" is ' + r1(p.b.h) + ' px high (40)');
                if (Math.abs(p.b.t - top) > 1) fails.push('studiohome: switch row tile "' + p.n + '" is on another line');
                if (p.b.l < b.l - 1 || p.b.r > b.r + 1) fails.push('studiohome: switch row tile "' + p.n + '" leaves the block (x ' + r1(p.b.l) + ' to ' + r1(p.b.r) + ')');
              }
              for (const c of s.cut) if (c.startsWith('block: ') && s.switches.some((p) => c.includes(p.n.slice(0, 8)))) fails.push('studiohome: switch row text is cut: ' + c);
            }
            if (s.offer) {
              if (s.offer.h < 67.5 || s.offer.h > 68.5) fails.push('studiohome: the offer bar is ' + r1(s.offer.h) + ' px high (68)');
              if (s.offer.l < b.l - 1 || s.offer.r > b.r + 1 || s.offer.b > b.b + 1) fails.push('studiohome: the offer bar leaves the block');
            }
          }
        }
        if (isSheet) {
          const d = s.drawer;
          if (!d) fails.push('studiohome: the sheet is not on the page');
          else {
            if (d.l < 0 || d.r > 2560 || d.t < 0 || d.b > s.floor + 0.5) fails.push('studiohome: the sheet is at x ' + r1(d.l) + ' to ' + r1(d.r) + ', y ' + r1(d.t) + ' to ' + r1(d.b) + ' (inside the wall, above ' + r1(s.floor) + ')');
            if (s.column && v.name.startsWith('Studio home, sheet') && (d.r > s.column.r + 2 || d.l < s.column.l - 2)) fails.push('studiohome: the sheet at x ' + r1(d.l) + ' to ' + r1(d.r) + ' is outside the right column at x ' + r1(s.column.l) + ' to ' + r1(s.column.r));
            for (const k of s.drawerKids) if (k.l < d.l - 1 || k.r > d.r + 1 || k.b > d.b + 1) fails.push('studiohome: sheet part "' + k.n.trim() + '" leaves the sheet');
          }
        }
        if (isBlock && v.name.includes('refused line') && s.sumCut && s.sumCut.sw > s.sumCut.cw + 1) fails.push('studiohome: the refused line is cut: "' + s.sumCut.text + '"');
        if (isSheet) {
          for (const t of s.tiles) if (t.lineCut || t.nameCut) fails.push('studiohome: preset tile text is cut: "' + t.n + '"');
          // In the normal states (up to three looks on one row) nothing scrolls and the last room's slider lies whole inside the body.
          if (s.bodyScroll && s.bodyBox) {
            if (s.bodyScroll.sh > s.bodyScroll.ch + 1) fails.push('studiohome: the sheet body scrolls (' + s.bodyScroll.sh + ' of ' + s.bodyScroll.ch + ' px) in a state that must show every row whole');
            if (s.overheadSlider && s.overheadSlider.b > s.bodyBox.b + 0.5) fails.push('studiohome: the last room slider ends at y ' + r1(s.overheadSlider.b) + ', below the sheet body (' + r1(s.bodyBox.b) + ')');
          }
        }
        if (isTools) {
          const t = s.tools;
          const c = s.section;
          if (!t || !c) fails.push('studiohome: the Home app section is not in Tools');
          else {
            if (c.l < t.l || c.r > t.r || c.t < t.t || c.b > t.b) fails.push('studiohome: the Home app section at x ' + r1(c.l) + ' to ' + r1(c.r) + ', y ' + r1(c.t) + ' to ' + r1(c.b) + ' is outside the Tools drawer');
            for (const k of s.sectionKids) if (k.r > t.r - 1 || k.l < t.l + 1 || k.b > t.b + 1) fails.push('studiohome: "' + k.n.trim() + '" in Tools Home app is cut by the drawer edge');
          }
        }
        if (isWork) {
          const c = s.chip;
          if (!c) fails.push('studiohome: the Lights chip is not in the Work header');
          else {
            if (c.h > 32.5 || s.chipLines > 1) fails.push('studiohome: the Work chip is ' + r1(c.w) + ' x ' + r1(c.h) + ' px over ' + s.chipLines + ' lines (one 32 px line)');
            if (s.header && (s.header.sw > s.header.cw + 1 || c.r > s.header.r + 0.5)) fails.push('studiohome: the Work header is cut by the chip (scroll ' + s.header.sw + ' of ' + s.header.cw + ')');
            if (s.ask && s.ask.w < 160) fails.push('studiohome: the waiting line shrank to ' + r1(s.ask.w) + ' px beside the chip (160 at least)');
          }
        }
        if (isMeet) {
          const c = s.chip;
          const h = s.hero;
          if (!c || !h) fails.push('studiohome: the Meet chip or the hero is not on the page');
          else {
            // One 32 px line inside the hero (x 124 to 944, y up to 510), the recording chip uncut.
            if (c.h < 31.5 || c.h > 32.5 || s.chipLines > 1) fails.push('studiohome: the Meet chip is ' + r1(c.w) + ' x ' + r1(c.h) + ' px over ' + s.chipLines + ' lines (one 32 px line)');
            if (c.l < h.l - 1 || c.r > h.r + 1 || c.b > 511) fails.push('studiohome: the Meet chip at x ' + r1(c.l) + ' to ' + r1(c.r) + ', y ' + r1(c.t) + ' to ' + r1(c.b) + ' leaves the hero (x ' + r1(h.l) + ' to ' + r1(h.r) + ', y up to 510)');
            if (!s.rec) fails.push('studiohome: the recording chip is missing beside the Meet chip');
            else if (s.recCut || s.rec.r > c.l + 0.5) fails.push('studiohome: the recording chip is cut or overlapped by the Meet chip');
          }
        }
        if (isBlock || isSheet || isTools || isWork || isMeet) {
          for (const x of s.small) fails.push('studiohome: text under 16 px: ' + x);
          if (isSheet || isTools) for (const x of s.cut) fails.push('studiohome: cut text "' + x + '"');
        }
        for (const f of fails) emit('  FAIL ' + f);
        if (fails.length) return true;
        emit('  ok   studiohome: inside their boxes, one line where one line is drawn, text 16 px or more, nothing cut');
        return false;
      },
    },
    breaks: {
      'studiohome-block': { css: '.st-block { height: 260px !important; }', expect: /^ *FAIL studiohome: .*(block|footnote)/m, appliesTo: (v) => v.name === BLOCK_V },
      'studiohome-presets': { css: '.st-preset { min-width: 400px !important; }', expect: /^ *FAIL studiohome: preset row part/m, appliesTo: (v) => v.name === BLOCK_V },
      'studiohome-switches': { css: '.st-room { min-width: 300px !important; }', expect: /^ *FAIL studiohome: switch row tile/m, appliesTo: (v) => v.name === BLOCK_V },
      'studiohome-noscroll': { css: '.st-d-rooms { padding-top: 60px !important; }', expect: /^ *FAIL studiohome: (the sheet body scrolls|the last room slider)/m, appliesTo: (v) => v.name === SHEET_V },
      'studiohome-tiles': { css: '.st-pt-l { max-height: 19px !important; min-height: 0 !important; }', expect: /^ *FAIL studiohome: preset tile text is cut/m, appliesTo: (v) => v.name === SHEET_V },
      'studiohome-sheet': { css: '.st-drawer { max-height: none !important; } .st-d-rooms { height: 600px !important; }', expect: /^ *FAIL studiohome: (the sheet is at|sheet part)/m, appliesTo: (v) => v.name === SHEET_V },
      'studiohome-offer': { css: '.st-offer { height: 120px !important; }', expect: /^ *FAIL studiohome: the offer bar/m, appliesTo: (v) => v.name === OFFER_V },
      'studiohome-meet': { css: '.lights-chip { width: 700px !important; }', expect: /^ *FAIL studiohome: (the Meet chip|the recording chip)/m, appliesTo: (v) => v.name === MEET_V },
      'studiohome-tools': { css: '.dt-field { width: 900px !important; flex: none !important; }', expect: /^ *FAIL studiohome: .*(Tools|Home app)/m, appliesTo: (v) => v.name === TOOLS_V },
    },
  },
};
