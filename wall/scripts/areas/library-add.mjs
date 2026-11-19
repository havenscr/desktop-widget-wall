// "Add to a playlist" on the rows of the YouTube library on Listen (the owner's vote, option A): gallery states for the control
// at rest, on hover, with its menu open (middle row, last whole row, tall with long titles, no playlist yet, already in one, one
// full, five or more playlists capped and scrolling) and on a greyed row; fit variants with one in-page measurement and its
// rules; and a deliberate break for each rule. The playlists the owner made come from the `ytown=` knob of the Watch mock and
// the scroll from `ytscroll=` of the YouTube mock (both development knobs only). Everything this area needs lives here.

const night = encodeURIComponent('2026-11-11T22:30:00-08:00');
const day = '2026-11-11T10:24:00-08:00';
const SWITCH = '.sp-switch button:nth-child(2)';
const TALL = '.sp-grow';
const TILE = '.yt-tile';
const LIKED = '.sp-tabs button:nth-child(3)';
const steps = (...s) => s.join(' >> ');
const ctl = (row) => `.yt-row:nth-child(${row}) .yt-add`;
const own = (kind, extra = '') => `youtube=in&ytlib=full&media=none&watch=mock&wtab=listen&ytown=${kind}${extra}`;
const base = (q) => `hz=unwind&at=${night}&clock=review&weather=ok&audio=demo&${q}`;
const state = (name, query, expect, actions) => ({ screen: 'unwind', name: `library add: ${name}`, query, custom: true, ...(typeof expect === 'string' && expect.startsWith('note:') ? { expectNote: expect.slice(5) } : { expect }), ...(actions ? { actions } : {}) });

/**
 * Runs in the page (it references nothing outside its own body). `addcheck=rest|hover|open|grey` says which state the
 * variant shows, `addwant=has|full|cap|none` what the open menu must hold. Wall pixels (the page is the 2560 by 720 wall).
 *   every row that plays holds one control, a greyed row none; each is 30 by 30, at least 6 px inside its row's top, foot and end
 *   rest      every control is clear (no opacity, no pointer) and every length shows
 *   hover     the row under the pointer shows its control and hides its length; no cell of the row has another box than the same
 *             cell of a row with no pointer on it (no layout jump); the icon is at least 3 to 1 on the row
 *   grey      a greyed row under the pointer has no control, and its words stay
 *   open      as hover, for the row whose menu is open; the menu is 300 wide, inside the card, not over its own row, above the
 *             foot of the rows (and so off the foot player), its right edge on the control's, no text cut, the list part at most
 *             three rows at rest and four tall and scrolling inside itself past that; a full playlist reads "Full" in readable text
 */
function measureLibraryAdd() {
  const mode = new URLSearchParams(location.search).get('addcheck');
  if (!mode) return null;
  const want = new URLSearchParams(location.search).get('addwant');
  const fails = [];
  const info = {};
  try {
    // Measured at the end of every transition (virtual time draws no frames for one to run).
    const st = document.createElement('style');
    st.textContent = '.yt-add, .yt-len, .w-pop-row { transition: none !important; }';
    document.head.appendChild(st);
    const R = (e) => e.getBoundingClientRect();
    const r1 = (n) => Math.round(n * 10) / 10;
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    const cardEl = document.querySelector('.sp-card');
    const scroller = document.querySelector('.yt-rowscroll');
    if (!cardEl || !scroller) return { mode, fails: ['no library rows are shown'], info };
    const tall = cardEl.getAttribute('data-tall') === 'true';
    const card = R(cardEl);
    const sc = R(scroller);
    const rows = [...document.querySelectorAll('.yt-row')];
    if (rows.length < 4) fails.push('only ' + rows.length + ' rows were drawn');
    // Every playable row holds one control of 30 by 30, 6 px inside; a greyed row holds none.
    for (const row of rows) {
      const grey = row.classList.contains('off');
      const adds = row.querySelectorAll('.yt-add');
      if (grey && adds.length) { fails.push('a greyed row holds an add control'); break; }
      if (!grey && adds.length !== 1) { fails.push('a row that plays holds ' + adds.length + ' add controls (one)'); break; }
      if (grey) continue;
      const a = R(adds[0]);
      const r = R(row);
      if (!near(a.width, 30, 0.5) || !near(a.height, 30, 0.5)) { fails.push('the control is ' + r1(a.width) + ' by ' + r1(a.height) + ' (30 by 30)'); break; }
      if (a.top - r.top < 5.5 || r.bottom - a.bottom < 5.5 || r.right - a.right < 5.5) { fails.push('the control is ' + r1(a.top - r.top) + ' px from its row top, ' + r1(r.bottom - a.bottom) + ' from its foot, ' + r1(r.right - a.right) + ' from its end (6 px inside at least)'); break; }
      if (row.querySelector('.yt-play')?.contains(adds[0])) { fails.push('the control sits inside the play button'); break; }
    }
    const target = rows.find((r) => r.classList.contains('fit-hover') || r.classList.contains('menu-open'));
    const opacity = (e) => parseFloat(getComputedStyle(e).opacity);
    if (mode === 'rest') {
      for (const row of rows) {
        const add = row.querySelector('.yt-add');
        if (add && (opacity(add) > 0.01 || getComputedStyle(add).pointerEvents !== 'none')) { fails.push('a control shows at rest (opacity ' + opacity(add) + ', pointer ' + getComputedStyle(add).pointerEvents + ')'); break; }
        const len = row.querySelector('.yt-len');
        if (len && opacity(len) < 0.99) { fails.push('a length is hidden at rest'); break; }
      }
    } else if (!target) fails.push('no row is under the pointer or has its menu open');
    if (target) {
      const add = target.querySelector('.yt-add');
      const len = target.querySelector('.yt-len');
      if (mode === 'grey') {
        if (add) fails.push('a greyed row under the pointer holds a control');
        if (len && opacity(len) < 0.99) fails.push('a greyed row hides its words under the pointer');
      } else if (add && len) {
        if (opacity(add) < 0.99) fails.push('the control is not shown on its row (opacity ' + opacity(add) + ')');
        if (opacity(len) > 0.01) fails.push('the length still shows under the control (opacity ' + opacity(len) + ')');
        // No layout jump: each cell of this row has the same box as the same cell of a row that plays and has no pointer on it.
        const ref = rows.find((r) => r !== target && !r.classList.contains('off') && !r.classList.contains('fit-hover') && !r.classList.contains('menu-open') && R(r).top >= sc.top && R(r).bottom <= sc.bottom);
        if (!ref) fails.push('no plain row to compare with');
        else {
          const rel = (row, sel) => { const e = row.querySelector(sel); const b = R(e); const rb = R(row); return [b.left - rb.left, b.top - rb.top, b.width, b.height]; };
          for (const sel of ['.yt-n', '.yt-title', '.yt-chan', '.yt-len']) {
            const [a, b] = [rel(target, sel), rel(ref, sel)];
            if (a.some((v, i) => !near(v, b[i], 0.5))) { fails.push('the cell ' + sel + ' of the row with the control has the box ' + a.map(r1).join(', ') + ' (a plain row: ' + b.map(r1).join(', ') + '): the row jumped'); break; }
          }
          info.cells = rel(target, '.yt-title').map(r1);
        }
        // The icon reads: at least 3 to 1 on the row (the row's own light and the card behind it).
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
        const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
        let bg = [12, 9, 30];
        for (const layer of [target, target.querySelector('.yt-play')]) {
          const c = layer && parse(getComputedStyle(layer).backgroundColor);
          if (c && c[3] > 0) bg = bg.map((v, i) => v * (1 - c[3]) + c[i] * c[3]);
        }
        const fg = parse(getComputedStyle(add).color);
        const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
        info.contrast = r1(ratio);
        if (ratio < 3) fails.push('the icon is ' + r1(ratio) + ' to 1 on its row (3 to 1 at least)');
      }
    }
    if (mode === 'open' && target) {
      const add = target.querySelector('.yt-add');
      const menu = document.querySelector('.w-pop');
      if (!menu) fails.push('the menu is not open');
      else {
        const m = R(menu);
        const a = R(add);
        const own = R(target);
        info.menu = [m.left, m.top, m.width, m.height].map(r1);
        info.up = m.bottom <= a.top + 0.5;
        if (add.getAttribute('aria-expanded') !== 'true') fails.push('the control does not say its menu is open');
        if (!near(m.width, 300, 0.5)) fails.push('the menu is ' + r1(m.width) + ' wide (300)');
        if (m.left < card.left - 0.5 || m.right > card.right + 0.5 || m.top < card.top - 0.5 || m.bottom > card.bottom + 0.5) fails.push('the menu sticks out of the card');
        if (m.left < own.right && m.right > own.left && m.top < own.bottom - 0.5 && m.bottom > own.top + 0.5) fails.push('the menu lies over its own row');
        if (m.bottom > sc.bottom + 8.5) fails.push('the menu passes the foot of the rows by ' + r1(m.bottom - sc.bottom) + ' px (8 at most)');
        const foot = document.querySelector('.yt-foot');
        if (foot && m.bottom > R(foot).top + 0.5 && m.top < R(foot).bottom) fails.push('the menu lies on the foot player');
        if (!near(m.right, a.right, 1.5)) fails.push('the menu ends at x ' + r1(m.right) + ', not on the control (x ' + r1(a.right) + ')');
        const cut = [...menu.querySelectorAll('.u-ell, .w-pop-k')].filter((e) => e.scrollWidth > e.clientWidth + 1);
        if (cut.length) fails.push('text cut in the menu: "' + (cut[0].textContent || '').trim().slice(0, 24) + '"');
        // The list part: three rows at rest, four tall, scrolling inside itself past that.
        const list = menu.querySelector('.w-pop-rows');
        const n = list.querySelectorAll('.w-pop-row').length;
        const cap = tall ? 4 : 3;
        info.rows = n;
        if (n > cap) {
          if (list.clientHeight > cap * 40 + 0.5) fails.push('the list part is ' + r1(list.clientHeight) + ' high with ' + n + ' playlists (' + cap * 40 + ' at most)');
          if (list.scrollHeight <= list.clientHeight + 0.5) fails.push('the list part does not scroll inside itself');
          if (getComputedStyle(list).scrollbarWidth !== 'thin') fails.push('the list part does not use the app\'s scrollbar look');
        } else if (n > 0 && list.clientHeight < n * 40 - 0.5) fails.push('the list part is cut at ' + r1(list.clientHeight) + ' with only ' + n + ' playlists');
        if (want === 'cap' && n <= cap) fails.push('only ' + n + ' playlists: nothing to cap');
        const check = menu.querySelector('.w-pop-row.has .w-pop-check');
        if (want === 'has' && (!check || getComputedStyle(check).display === 'none')) fails.push('no playlist shows the check for a video it holds');
        if (want === 'none' && menu.querySelectorAll('[role="menuitem"]').length !== 2) fails.push('the menu holds more than the Watch list row and New playlist with no playlist made');
        if (want === 'full') {
          const full = menu.querySelector('.w-pop-row.full');
          if (!full) fails.push('no playlist reads Full');
          else {
            const em = full.querySelector('em');
            if (!em || em.textContent !== 'Full') fails.push('the full playlist does not read the word Full');
            // Name and word at full strength and at least 4.5 to 1 on the menu.
            const strength = (e) => { let o = 1; for (let x = e; x && x !== menu.parentElement; x = x.parentElement) o *= parseFloat(getComputedStyle(x).opacity); return o; };
            const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
            const lum = (c) => 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
            for (const [what, e] of [['name', full.querySelector('.u-ell')], ['word', em]]) {
              if (!e) continue;
              const c = /rgba?\(([^)]+)\)/.exec(getComputedStyle(e).color)[1].split(/[ ,/]+/).filter(Boolean).map(Number);
              const o = strength(e) * (c.length > 3 ? c[3] : 1);
              const bg = [13, 10, 34];
              const mixed = [0, 1, 2].map((i) => c[i] * o + bg[i] * (1 - o));
              const ratio = (Math.max(lum(mixed), lum(bg)) + 0.05) / (Math.min(lum(mixed), lum(bg)) + 0.05);
              if (ratio < 4.5) fails.push('the full playlist ' + what + ' is ' + r1(ratio) + ' to 1 on the menu (4.5 at least)');
              info['full' + what] = r1(ratio);
            }
          }
        }
      }
    }
  } catch (e) {
    fails.push('the check broke: ' + e.message);
  }
  return { mode, want, fails, info };
}

const day24 = (extra) => `?hz=unwind&at=${day}&long=1&agents=3&${extra}`;
const variant = (name, extra, click, mode, want) => ({
  name: `YouTube add, ${name}`,
  q: day24(`${extra}&addcheck=${mode}${want ? `&addwant=${want}` : ''}`),
  checks: ['.sp-card', '.yt-lib'],
  click,
  ...(name.startsWith('tall') ? {} : { listen: true }),
});
const N = (s) => `YouTube add, ${s}`;
const V = {
  rest: N('at rest, Liked'),
  hover: N('at rest, Liked, a middle row hovered'),
  open: N('at rest, Liked, the menu open on a middle row'),
  last: N('at rest, Liked, the menu open on the last whole row'),
  tallLong: N('tall, a playlist opened, long titles, the menu open on the last whole row'),
  tallHover: N('tall, a playlist opened, a middle row hovered'),
  search: N('at rest, search results, a row hovered'),
  searchOpen: N('at rest, search results, the menu open'),
  none: N('at rest, Liked, no playlist yet'),
  has: N('at rest, Liked, already in one playlist'),
  full: N('at rest, Liked, one playlist full'),
  nine: N('at rest, Liked, nine playlists'),
  nineTall: N('tall, a playlist opened, nine playlists'),
  grey: N('at rest, Liked, a greyed row hovered'),
};

export default {
  name: 'library-add',
  gallery: {
    states: [
      state('Liked at rest, the control is not there', base(own('two')), ['Cassette Rain', 'Aurora Set', '!Add this video to'], steps(SWITCH, LIKED)),
      state('Liked, a row pointed at', base(own('two')), 'note:the length of that one row gives way to the control; nothing moves', steps(SWITCH, LIKED, 'hover:.yt-row:nth-child(2) .yt-title')),
      state('Liked, the pointer on the control', base(own('two')), 'Add to a playlist', steps(SWITCH, LIKED, `hover:${ctl(2)}`)),
      state('Liked, the row playing now pointed at', base(own('two', '&ytplay=liked')), 'note:the control on the row that is playing', steps(SWITCH, LIKED, 'hover:.yt-row.on .yt-title')),
      state('Liked, the menu open on a middle row', base(own('two', '&ytplay=liked')), ['Add this video to', 'Friday wind down', 'Slow mornings', 'New playlist'], steps(SWITCH, LIKED, ctl(2))),
      state('Liked, the menu open on the last whole row (opens upward)', base(own('two', '&ytscroll=84')), ['Add this video to', 'Friday wind down', 'New playlist'], steps(SWITCH, LIKED, ctl(9))),
      state('tall, a playlist opened, the menu open on a row', base(own('three')), ['Add this video to', 'Weekend cooking', 'New playlist'], steps(SWITCH, TALL, TILE, ctl(3))),
      state('tall, long titles, the menu open on the last whole row', base(own('three', '&ytlib=long')), ['Add this video to', 'Friday wind down'], steps(SWITCH, TALL, TILE, ctl(9))),
      state('search results, the menu open', base(own('two', '&ytsearch=night')), ['Add this video to', 'Friday wind down'], steps(SWITCH, ctl(3))),
      state('no playlist yet', base(own('none')), ['Add this video to', 'New playlist', '!Friday wind down'], steps(SWITCH, LIKED, ctl(2))),
      state('already in one playlist', base(own('in')), ['Add this video to', 'Friday wind down', 'Slow mornings'], steps(SWITCH, LIKED, ctl(4))),
      state('one playlist full', base(own('full')), ['Add this video to', 'Full', 'Slow mornings'], steps(SWITCH, LIKED, ctl(3))),
      state('nine playlists, capped and scrolling', base(own('nine')), ['Add this video to', 'Friday wind down', 'Weekend cooking'], steps(SWITCH, LIKED, ctl(2))),
      state('a greyed row pointed at, no control', base(own('two')), 'Only on YouTube', steps(SWITCH, LIKED, 'hover:.yt-row.off .yt-title')),
    ],
  },
  fit: {
    variants: [
      variant('at rest, Liked', own('two'), steps(SWITCH, LIKED), 'rest'),
      variant('at rest, Liked, a middle row hovered', own('two'), steps(SWITCH, LIKED, 'hover:.yt-row:nth-child(2)'), 'hover'),
      variant('at rest, Liked, the menu open on a middle row', own('two'), steps(SWITCH, LIKED, ctl(2)), 'open'),
      variant('at rest, Liked, the menu open on the last whole row', own('two', '&ytscroll=84'), steps(SWITCH, LIKED, ctl(9)), 'open'),
      variant('tall, a playlist opened, long titles, the menu open on the last whole row', own('three', '&ytlib=long'), steps(SWITCH, TALL, TILE, ctl(9)), 'open'),
      variant('tall, a playlist opened, a middle row hovered', own('two'), steps(SWITCH, TALL, TILE, 'hover:.yt-row:nth-child(3)'), 'hover'),
      variant('at rest, search results, a row hovered', own('two', '&ytsearch=night'), steps(SWITCH, 'hover:.yt-row:nth-child(2)'), 'hover'),
      variant('at rest, search results, the menu open', own('two', '&ytsearch=night'), steps(SWITCH, ctl(3)), 'open'),
      variant('at rest, Liked, no playlist yet', own('none'), steps(SWITCH, LIKED, ctl(2)), 'open', 'none'),
      variant('at rest, Liked, already in one playlist', own('in'), steps(SWITCH, LIKED, ctl(4)), 'open', 'has'),
      variant('at rest, Liked, one playlist full', own('full'), steps(SWITCH, LIKED, ctl(3)), 'open', 'full'),
      variant('at rest, Liked, nine playlists', own('nine'), steps(SWITCH, LIKED, ctl(2)), 'open', 'cap'),
      variant('tall, a playlist opened, nine playlists', own('nine'), steps(SWITCH, TALL, TILE, ctl(9)), 'open', 'cap'),
      variant('at rest, Liked, a greyed row hovered', own('two'), steps(SWITCH, LIKED, 'hover:.yt-row.off'), 'grey'),
    ],
    measurements: { libraryAdd: measureLibraryAdd },
    rules: {
      libraryAdd: (variant, results, emit) => {
        const m = results.libraryAdd;
        if (!variant.name.startsWith('YouTube add, ') || !m) return false;
        for (const failure of m.fails) emit(`  FAIL library add: ${failure}`);
        if (m.fails.length) return true;
        const parts = {
          rest: 'at rest every control is clear and every length shows; each row that plays holds one 30 by 30 control 6 px inside its row, a greyed row none',
          hover: `the row under the pointer shows its control (icon ${m.info.contrast} to 1) and hides its length; every cell keeps the box it has in a plain row`,
          grey: 'a greyed row under the pointer has no control and keeps its words',
          open: `the menu (${(m.info.menu ?? []).join(', ')}, ${m.info.rows} playlists) is inside the card, ${m.info.up ? 'above' : 'under'} its control, off its own row, above the foot of the rows, 300 wide, no text cut, the list part capped and scrolling; the row keeps every cell box${m.want === 'full' ? `; Full reads ${m.info.fullname} and ${m.info.fullword} to 1` : ''}`,
        };
        emit(`  ok   library add: ${parts[m.mode]}`);
        return false;
      },
    },
    breaks: {
      'ladd-size': { css: '.yt-add { width: 24px !important; height: 24px !important; }', expect: /^ *FAIL library add: the control is [\d.]+ by [\d.]+ \(30 by 30\)/m, appliesTo: (v) => v.name === V.rest },
      'ladd-edge': { css: '.yt-add { top: 2px !important; }', expect: /^ *FAIL library add: the control is [\d.]+ px from its row top/m, appliesTo: (v) => v.name === V.rest },
      'ladd-rest': { css: '.yt-add { opacity: 1 !important; pointer-events: auto !important; }', expect: /^ *FAIL library add: a control shows at rest/m, appliesTo: (v) => v.name === V.rest },
      'ladd-hidden': { css: '.yt-row.fit-hover > .yt-add { opacity: 0 !important; }', expect: /^ *FAIL library add: the control is not shown on its row/m, appliesTo: (v) => v.name === V.hover },
      'ladd-length': { css: '.yt-row.canadd.fit-hover .yt-len { opacity: 1 !important; }', expect: /^ *FAIL library add: the length still shows under the control/m, appliesTo: (v) => v.name === V.hover },
      'ladd-jump': { css: '.yt-row.fit-hover .yt-cells { grid-template-columns: 34px minmax(0, 1.4fr) minmax(0, 1fr) 100px !important; }', expect: /^ *FAIL library add: the cell .* the row jumped/m, appliesTo: (v) => v.name === V.hover || v.name === V.search || v.name === V.tallHover },
      'ladd-contrast': { css: '.yt-add { color: #3a3560 !important; }', expect: /^ *FAIL library add: the icon is [\d.]+ to 1 on its row/m, appliesTo: (v) => v.name === V.hover },
      'ladd-grey-words': { css: '.yt-row.off.fit-hover .yt-len { opacity: 0 !important; }', expect: /^ *FAIL library add: a greyed row hides its words/m, appliesTo: (v) => v.name === V.grey },
      'ladd-menu-row': { css: '.w-pop { margin-top: -50px !important; }', expect: /^ *FAIL library add: the menu lies over its own row/m, appliesTo: (v) => v.name === V.open },
      'ladd-menu-foot': { css: '.w-pop { margin-top: 130px !important; }', expect: /^ *FAIL library add: the menu passes the foot of the rows/m, appliesTo: (v) => v.name === V.last },
      'ladd-menu-card': { css: '.w-pop { margin-left: 400px !important; }', expect: /^ *FAIL library add: the menu sticks out of the card/m, appliesTo: (v) => v.name === V.tallLong },
      'ladd-menu-width': { css: '.w-pop { width: 160px !important; }', expect: /^ *FAIL library add: text cut in the menu/m, appliesTo: (v) => v.name === V.searchOpen },
      'ladd-cap': { css: '.w-pop-rows { max-height: none !important; }', expect: /^ *FAIL library add: the list part is [\d.]+ high with \d+ playlists/m, appliesTo: (v) => v.name === V.nine || v.name === V.nineTall },
      'ladd-scrollbar': { css: '.w-pop-rows { scrollbar-width: auto !important; }', expect: /^ *FAIL library add: the list part does not use the app's scrollbar look/m, appliesTo: (v) => v.name === V.nine },
      'ladd-full-fade': { css: ".w-pop-row.full[aria-disabled='true'] { opacity: 0.5 !important; }", expect: /^ *FAIL library add: the full playlist (name|word) is [\d.]+ to 1/m, appliesTo: (v) => v.name === V.full },
      'ladd-check': { css: '.w-pop-check { display: none !important; }', expect: /^ *FAIL library add: no playlist shows the check/m, appliesTo: (v) => v.name === V.has },
    },
  },
};
