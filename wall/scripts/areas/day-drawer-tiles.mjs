// An agenda tile in the Day drawer never cuts off its time: a one hour or 90 minute tile with a long title and a
// Join button, alone or sharing the width with one or two others, keeps the time box wholly inside the tile and on
// the title's row, keeps Join inside the tile, and leaves a sliver of the title.
const NAME = 'Day drawer tiles, long titles with Join';
const FIT_NAME = 'Day drawer tiles, 15 to 180 minutes with Join, calendar colour';
const TYPICAL = encodeURIComponent('2026-11-11T10:24:00-08:00');

// Runs in the page.
function measureTiles() {
  const tiles = [...document.querySelectorAll('.day-drawer .dd-ev')];
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  return tiles.map((tile) => {
    const t = r(tile), time = r(tile.querySelector('.dd-t')), title = r(tile.querySelector('b')), join = r(tile.querySelector('.dd-join'));
    return {
      name: (tile.querySelector('b')?.textContent || '').slice(-12),
      h: Math.round(t.height * 10) / 10,
      w: Math.round(t.width),
      one: tile.classList.contains('one'),
      timeInside: !!time && time.left >= t.left - 0.5 && time.right <= t.right + 0.5 && time.top >= t.top - 0.5 && time.bottom <= t.bottom + 0.5,
      sameRow: !!time && !!title && time.top < title.bottom && time.bottom > title.top,
      joinInside: !join || (join.left >= t.left - 0.5 && join.right <= t.right + 0.5 && join.top >= t.top - 0.5 && join.bottom <= t.bottom + 0.5),
      titleW: title ? Math.round(title.width) : 0,
    };
  });
}

// Runs in the page. Each tile's inset to its Join pill on every side, and whether the title, time and Join stay apart.
function measureFit() {
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  return [...document.querySelectorAll('.day-drawer .dd-ev')].map((tile) => {
    const t = r(tile), title = tile.querySelector('b'), time = tile.querySelector('.dd-t'), join = tile.querySelector('.dd-join');
    const tr = r(title), mr = r(time), jr = r(join);
    const cut = (el) => !!el && (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis');
    const hit = (a, b) => !!a && !!b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
    const px = (el) => parseFloat(getComputedStyle(el).fontSize);
    const rd = (n) => Math.round(n * 10) / 10;
    const touches = [...document.querySelectorAll('.day-drawer .dd-ev')].some((o) => {
      if (o === tile) return false;
      const b = o.getBoundingClientRect();
      return t.left < b.right - 0.5 && t.right > b.left + 0.5 && t.top < b.bottom - 0.5 && t.bottom > b.top + 0.5;
    });
    return {
      name: (title?.textContent || '').slice(0, 14), h: rd(t.height), tone: tile.getAttribute('data-tone') || '',
      left: rd(t.left), w: rd(t.width), touches,
      edges: jr ? { top: rd(jr.top - t.top), right: rd(t.right - jr.right), bottom: rd(t.bottom - jr.bottom), left: rd(jr.left - t.left) } : null,
      overlap: hit(tr, jr) || hit(mr, jr) || hit(tr, mr),
      timeCut: !!mr && (mr.left < t.left || mr.right > t.right || mr.top < t.top - 0.5 || mr.bottom > t.bottom + 0.5),
      small: Math.min(px(tile), title ? px(title) : 99, time ? px(time) : 99, join ? px(join) : 99),
      joinH: jr ? Math.round(jr.height) : 0, timeCutX: cut(time),
    };
  });
}

export default {
  name: 'day-drawer-tiles',
  fit: {
    variants: [{
      name: FIT_NAME,
      q: `?hz=work&at=${TYPICAL}&clock=review&weather=ok&meet=fit`,
      click: '.rib-handle',
      checks: ['.day-drawer'],
      strip: true,
      viewportOnly: true,
    }, {
      name: NAME,
      q: `?hz=work&at=${TYPICAL}&clock=review&weather=ok&meet=agenda`,
      click: '.rib-handle',
      checks: ['.day-drawer'],
      strip: true,
      viewportOnly: true,
    }],
    measurements: { drawerTiles: measureTiles, fitTiles: measureFit },
    rules: {
      fitTiles: (variant, results, emit) => {
        if (variant.name !== FIT_NAME) return false;
        const m = results.fitTiles;
        if (!m || m.length < 8) { emit(`  FAIL day drawer fit: expected 8 tiles, found ${m ? m.length : 0}`); return true; }
        let bad = false;
        for (const x of m) {
          const at = `"${x.name}" (${x.h} px high)`;
          if (!x.edges) { emit(`  FAIL day drawer fit: the Join pill is missing, ${at}`); bad = true; }
          else {
            for (const edge of ['top', 'right', 'bottom', 'left']) {
              if (x.edges[edge] < 3) { emit(`  FAIL day drawer fit: the Join pill is ${x.edges[edge]} px from the ${edge} edge, under 3 px, ${at}`); bad = true; }
            }
          }
          if (x.overlap) { emit(`  FAIL day drawer fit: title, time and Join overlap, ${at}`); bad = true; }
          if (x.touches) { emit(`  FAIL day drawer fit: the tile overlaps another tile, ${at}`); bad = true; }
          if (x.timeCut || x.timeCutX) { emit(`  FAIL day drawer fit: the time is cut, ${at}`); bad = true; }
          if (x.small < 16) { emit(`  FAIL day drawer fit: text is ${x.small} px, under 16, ${at}`); bad = true; }
          if (x.joinH < 20) { emit(`  FAIL day drawer fit: the Join pill is ${x.joinH} px high, too small to click, ${at}`); bad = true; }
        }
        // A 15 minute event then a 30 minute one back to back: two lanes, side by side, nothing under anything.
        const a = m.find((x) => x.name === 'Stand up'), b = m.find((x) => x.name === 'Short chat');
        if (!a || !b) { emit('  FAIL day drawer fit: the back to back 15 and 30 minute tiles are missing'); bad = true; }
        else if (!(a.left < b.left - 4) || Math.abs(a.w - b.w) > 1 || a.w > 0.6 * m.find((x) => x.name.startsWith('Workshop')).w) { emit('  FAIL day drawer fit: the back to back 15 and 30 minute tiles are not in two lanes'); bad = true; }
        if (!m.some((x) => x.tone === 'preset5')) { emit('  FAIL day drawer fit: no tile took the calendar colour'); bad = true; }
        const lane = Math.min(...m.map((x) => Math.min(...Object.values(x.edges || { n: 99 }))));
        if (!bad) emit(`  ok   day drawer fit: ${m.length} tiles (${m.map((x) => x.h).join(', ')} px high), Join inset ${lane} px or more on every edge, two lanes where 15 and 30 minutes meet, nothing overlaps or is cut`);
        return bad;
      },
      drawerTiles: (variant, results, emit) => {
        if (variant.name !== NAME) return false;
        const m = results.drawerTiles;
        if (!m || m.length < 9) { emit(`  FAIL day drawer tiles: expected 9 tiles, found ${m ? m.length : 0}`); return true; }
        let bad = false;
        for (const x of m) {
          const at = `"...${x.name}" (${x.h} x ${x.w} px)`;
          if (!x.timeInside) { emit(`  FAIL day drawer tiles: the time box is not wholly inside the tile, ${at}`); bad = true; }
          if (!x.sameRow) { emit(`  FAIL day drawer tiles: the time box is not on the title's row, ${at}`); bad = true; }
          if (!x.joinInside) { emit(`  FAIL day drawer tiles: Join is clipped by the tile, ${at}`); bad = true; }
          if (x.titleW < 40) { emit(`  FAIL day drawer tiles: the title is down to ${x.titleW} px, ${at}`); bad = true; }
        }
        if (!bad) emit(`  ok   day drawer tiles: ${m.length} tiles (${m.map((x) => x.h).join(', ')} px high), time and Join inside, time on the title's row`);
        return bad;
      },
    },
    breaks: {
      'drawer-pill-touches-border': {
        css: '.day-drawer .dd-ev.short .dd-join { height: 28px !important; }',
        expect: /^ *FAIL day drawer fit: the Join pill is/m,
        appliesTo: (v) => v.name === FIT_NAME,
      },
      'drawer-tiles-wrap': {
        css: '.day-drawer .dd-ev.one { flex-wrap: wrap !important; }',
        expect: /^ *FAIL day drawer tiles: (the time box is not|Join is clipped)/m,
        appliesTo: (v) => v.name === NAME,
      },
    },
  },
};
