// Home's Network and Security card: two doors at the right when quiet, a row of three buttons when alerts are open.
// Everything this area needs lives here; the two big review scripts are not edited for it.

const homeQuery = (knobs) => `?hz=home&at=2026-11-12T16:36:00-08:00&clock=review&weather=ok&${knobs}`;
const galleryQuery = (knobs) => `hz=home&at=${encodeURIComponent('2026-11-14T10:28:00-08:00')}&clock=review&weather=ok&${knobs}`;
const state = (name, knobs, expect) => ({ screen: 'home', name, query: galleryQuery(knobs), custom: true, expect });
const variant = (name, knobs, kind) => ({ name, q: `${homeQuery(knobs)}&netcheck=${kind}`, checks: ['.home .network-block', '.home .panel.network.shield'] });

// What the card must hold in each kind: its size (today's, kept), how many doors or buttons, whether the right side has
// something to show. The probes (netcheck=busylong, quietlong) put a very long alert text or fact line in place first.
function measureNet() {
    const out = [];
    const kind = new URLSearchParams(location.search).get('netcheck');
    const card = document.querySelector('.home .panel.network.shield');
    if (!card) return ['net card: the card is not on the page'];
    const WANT = {
      quiet: { busy: false, doors: 2, aside: false },
      quiet1: { busy: false, doors: 1, aside: false },
      quietnone: { busy: false, doors: 0, aside: true },
      quietbare: { busy: false, doors: 0, aside: false },
      quietlong: { busy: false, doors: 2, aside: false },
      stale: { busy: false, doors: 2, aside: false },
      busy: { busy: true, doors: 3, aside: false },
      busy1: { busy: true, doors: 2, aside: false },
      busynone: { busy: true, doors: 1, aside: false },
      busylong: { busy: true, doors: 3, aside: false },
    }[kind];
    if (!WANT) return ['net card: unknown netcheck ' + kind];
    if (kind === 'busylong') {
      const b = card.querySelector('.shield-new b');
      if (b) b.textContent = 'A new device with a very long name joined the guest network and asked for the printer, the cameras and the door locks';
    }
    if (kind === 'quietlong') {
      const t = card.querySelector('.shield-fact:last-child span');
      if (t) t.textContent = '123456 devices, 1234567 blocked, 4567 alarms';
    }
    const r = (e) => e.getBoundingClientRect();
    const c = r(card);
    const wantH = WANT.busy ? 250 : 166;
    if (card.classList.contains('busy') !== WANT.busy) out.push('net card: expected the ' + (WANT.busy ? 'alerts open' : 'quiet') + ' card');
    if (Math.abs(c.width - 596) > 0.5 || Math.abs(c.height - wantH) > 0.5) out.push('net card: the card is ' + Math.round(c.width * 10) / 10 + ' by ' + Math.round(c.height * 10) / 10 + ' px, main has 596 by ' + wantH);
    const doorEls = [...card.querySelectorAll(WANT.busy ? '.shield-btn' : '.shield-door')];
    if (doorEls.length !== WANT.doors) out.push('net card: expected ' + WANT.doors + (WANT.busy ? ' buttons' : ' doors') + ', found ' + doorEls.length);
    const aside = card.querySelector('.shield-aside');
    if (!!aside !== WANT.aside) out.push('net card: expected ' + (WANT.aside ? 'the facts box at the right' : 'no facts box') + ', found ' + (aside ? 'one' : 'none'));
    // The doors, the buttons and the ring keep 16 px to the card's edge on every side; the doors and buttons are 40 px or more.
    const edged = [...doorEls, ...card.querySelectorAll('.shield-art')];
    if (aside) edged.push(aside);
    for (const e of edged.filter((x) => r(x).width > 0)) {
      const b = r(e);
      const gaps = { top: b.top - c.top, left: b.left - c.left, bottom: c.bottom - b.bottom, right: c.right - b.right };
      for (const [side, v] of Object.entries(gaps)) {
        if (v < 16 - 0.5) out.push('net card: ' + (e.className.baseVal ?? e.className) + ' is ' + Math.round(v * 10) / 10 + ' px from the card\'s ' + side + ' edge (16 px clear needed)');
      }
      if (e !== aside && !e.classList.contains('shield-art') && (b.height < 40 - 0.5 || b.width < 40)) out.push('net card: a ' + (WANT.busy ? 'button' : 'door') + ' is ' + Math.round(b.width) + ' by ' + Math.round(b.height) + ' px (40 or more each way)');
    }
    // The right half is not empty: the doors, the buttons or the facts box reach within 24 px of the card's right edge.
    if (doorEls.length || aside) {
      // A hidden door or box has no size and counts for nothing: the right side then stops at the card's left edge.
      const right = Math.max(c.left, ...[...doorEls, ...(aside ? [aside] : [])].filter((e) => r(e).width > 0).map((e) => r(e).right));
      const gap = Math.round((c.right - right) * 10) / 10;
      if (gap > 24.5) out.push('net card: the right side stops ' + gap + ' px short of the card\'s edge (24 at most)');
    }
    // Nothing overlaps: the ring, the text lines, the facts, the doors and the buttons never share pixels.
    const parts = [...card.querySelectorAll('.shield-art, .shield-title, .shield-sub, .shield-fact, .shield-door, .shield-aside, .shield-new, .shield-hint, .shield-btn')];
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        if (parts[i].contains(parts[j]) || parts[j].contains(parts[i])) continue;
        const a = r(parts[i]);
        const b = r(parts[j]);
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          out.push('net card: ' + (parts[i].className.baseVal ?? parts[i].className) + ' and ' + (parts[j].className.baseVal ?? parts[j].className) + ' overlap');
        }
      }
    }
    // Text 16 px or more (the ring's own number is drawn inside its picture and scales with it).
    const small = [...card.querySelectorAll('*')].filter((e) => !e.closest('svg') && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 16 - 0.01);
    for (const e of small) out.push('net card: text under 16 px in ' + (e.className || e.tagName.toLowerCase()) + ' (' + parseFloat(getComputedStyle(e).fontSize) + ' px)');
    // Long text ends in an ellipsis inside its own box and leaves nothing outside the card.
    const lines = kind === 'busylong' ? [card.querySelector('.shield-new b')] : kind === 'quietlong' ? [card.querySelector('.shield-fact:last-child span')] : [];
    for (const e of lines.filter(Boolean)) {
      const cs = getComputedStyle(e);
      if (cs.textOverflow !== 'ellipsis' || cs.overflow !== 'hidden' || cs.whiteSpace !== 'nowrap') out.push('net card: a long line does not end in an ellipsis (' + cs.textOverflow + ', ' + cs.overflow + ', ' + cs.whiteSpace + ')');
      if (e.scrollWidth <= e.clientWidth + 1) out.push('net card: the long line was not cut (it fits, so the probe proves nothing)');
      const b = r(e);
      if (b.right > c.right - 16 + 0.5) out.push('net card: a long line reaches ' + Math.round(c.right - b.right) + ' px from the card\'s edge (16 px clear needed)');
      for (const d of doorEls) if (!WANT.busy && b.right > r(d).left + 0.5) out.push('net card: a long line runs under a door');
    }
    return out;
}

const NAMES = {
  quiet: 'Home, Network card: quiet, two doors',
  quiet1: 'Home, Network card: quiet, one door',
  quietnone: 'Home, Network card: quiet, no door, facts box',
  quietbare: 'Home, Network card: quiet, nothing sent',
  quietlong: 'Home, Network card: quiet, a long fact line',
  stale: 'Home, Network card: not live',
  busy: 'Home, Network card: alerts open, three buttons',
  busy1: 'Home, Network card: alerts open, two buttons',
  busynone: 'Home, Network card: alerts open, Show all alone',
  busylong: 'Home, Network card: alerts open, a long alert text',
};
const DOOR_NAMES = [NAMES.quiet, NAMES.quiet1, NAMES.quietlong, NAMES.stale];
const BUSY_NAMES = [NAMES.busy, NAMES.busy1, NAMES.busynone, NAMES.busylong];
const ALL_NAMES = Object.values(NAMES);
const RIGHT_NAMES = ALL_NAMES.filter((n) => n !== NAMES.quietbare);

export default {
  name: 'network-card',
  gallery: { states: [
    state('network card: quiet, all facts', 'desk=typical&alerts=0', ['All quiet', 'Nothing is open.', 'Home app alarms', 'Its own portal', '31 devices, 412 blocked', 'Scan ', '!alarms in 24 h']),
    state('network card: quiet, only the scan and the alarms', 'net=calm', ['All quiet', 'Home app alarms', 'Scan ', '3 alarms in 24 h', '!devices', '!blocked']),
    state('network card: quiet, nothing sent', 'net=calmbare', ['All quiet', 'Nothing is open.', 'Home app alarms', '!Scan ', '!alarms in 24 h', '!devices', '!blocked']),
    state('network card: quiet, one door', 'desk=typical&alerts=0&links=security', ['All quiet', 'Home app alarms', '!Its own portal']),
    state('network card: quiet, the other door', 'desk=typical&alerts=0&links=portal', ['All quiet', 'Its own portal', '!Home app alarms']),
    state('network card: quiet, no door', 'desk=typical&alerts=0&links=none', ['All quiet', '31 devices', '412 blocked', 'Scan ', '!Home app alarms', '!Its own portal']),
    state('network card: alerts open, three kinds', 'desk=typical&alerts=3', ['3 alerts open, 31 devices at home', 'New device on the guest network', 'Show all 3', '1 high, 1 medium, 1 low.', 'Security', 'Firewalla']),
    state('network card: alerts open, two kinds', 'desk=typical&alerts=2', ['2 alerts open, 31 devices at home', 'Show all 2', '1 high, 1 medium.']),
    state('network card: alerts open, one kind', 'desk=typical&alerts=1', ['1 alert open, 31 devices at home', 'Show all 1', '1 high.']),
    state('network card: alerts open, one door', 'desk=typical&alerts=3&links=portal', ['Show all 3', 'Firewalla', '!Security']),
    state('network card: alerts open, no door', 'desk=typical&alerts=3&links=none', ['Show all 3', '!Firewalla']),
    state('network card: not live', 'desk=stale&alerts=0', ['All quiet', 'Nothing was open.', 'Home app alarms', 'as of ']),
    state('network card: not live, alerts open', 'desk=stale&alerts=3', ['3 alerts open', 'Show all 3', 'as of ']),
    state('network card: not set up', 'home=off', ['Not set up', '!Home app alarms']),
  ] },
  fit: {
    variants: [
      variant(NAMES.quiet, 'desk=typical&alerts=0', 'quiet'),
      variant(NAMES.quiet1, 'desk=typical&alerts=0&links=portal', 'quiet1'),
      variant(NAMES.quietnone, 'desk=typical&alerts=0&links=none', 'quietnone'),
      variant(NAMES.quietbare, 'net=calmbare&links=none', 'quietbare'),
      variant(NAMES.quietlong, 'desk=typical&alerts=0', 'quietlong'),
      variant(NAMES.stale, 'desk=stale&alerts=0', 'stale'),
      variant(NAMES.busy, 'desk=typical&alerts=3', 'busy'),
      variant(NAMES.busy1, 'desk=typical&alerts=3&links=security', 'busy1'),
      variant(NAMES.busynone, 'desk=typical&alerts=3&links=none', 'busynone'),
      variant(NAMES.busylong, 'desk=typical&alerts=3', 'busylong'),
    ],
    measurements: { network: measureNet },
    rules: {
      network: (variantEntry, results, emit) => {
        if (!/[?&]netcheck=/.test(variantEntry.q)) return false;
        for (const failure of results.network) emit(`  FAIL ${failure}`);
        if (results.network.length) return true;
        emit('  ok   net card: today\'s size, 16 px clear of the edge, nothing overlapping, the right side filled, text 16 px or more, long text ends in an ellipsis');
        return false;
      },
    },
    breaks: {
      // The card a different height; the doors against the card's edge; the ring laid over the title; nothing at the right; small text; a long line left to run on.
      'net-size': { css: '.panel.network.shield { height: 190px !important; }', expect: /^ *FAIL net card: the card is [\d.]+ by [\d.]+ px, main has 596 by \d+/m, appliesTo: (v) => ALL_NAMES.includes(v.name) },
      'net-edge': { css: '.panel.network.shield { padding-right: 4px !important; }', expect: /^ *FAIL net card: shield-\w+ is [\d.-]+ px from the card's right edge/m, appliesTo: (v) => DOOR_NAMES.includes(v.name) },
      'net-overlap': { css: '.shield-art { transform: translateX(90px); }', expect: /^ *FAIL net card: .* overlap/m, appliesTo: (v) => ALL_NAMES.includes(v.name) },
      'net-empty-right': { css: '.shield-doors, .shield-aside, .shield-btns { display: none !important; }', expect: /^ *FAIL net card: the right side stops [\d.]+ px short/m, appliesTo: (v) => RIGHT_NAMES.includes(v.name) },
      'net-gap': { css: '.shield-doors, .shield-aside { margin-right: 60px !important; } .shield-btns { margin-right: 60px !important; }', expect: /^ *FAIL net card: the right side stops [\d.]+ px short/m, appliesTo: (v) => [...DOOR_NAMES, NAMES.quietnone, ...BUSY_NAMES].includes(v.name) },
      'net-text': { css: '.shield-door-txt span, .shield-fact, .shield-hint, .shield-btn { font-size: 12px !important; }', expect: /^ *FAIL net card: text under 16 px in /m, appliesTo: (v) => ALL_NAMES.includes(v.name) },
      'net-ellipsis': { css: '.shield-new b { text-overflow: clip !important; } .shield-fact span { text-overflow: clip !important; }', expect: /^ *FAIL net card: a long line does not end in an ellipsis/m, appliesTo: (v) => v.name === NAMES.busylong || v.name === NAMES.quietlong },
      'net-short': { css: '.shield-door, .shield-btn { max-height: 30px !important; }', expect: /^ *FAIL net card: a (door|button) is [\d]+ by [\d]+ px \(40 or more/m, appliesTo: (v) => [...DOOR_NAMES, ...BUSY_NAMES].includes(v.name) },
    },
  },
};
