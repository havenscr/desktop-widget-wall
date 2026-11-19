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
    return {
      name: (title?.textContent || '').slice(0, 14), h: Math.round(t.height * 10) / 10, tone: tile.getAttribute('data-tone') || '',
      inset: jr ? Math.round(Math.min(jr.left - t.left, t.right - jr.right, jr.top - t.top, t.bottom - jr.bottom) * 10) / 10 : null,
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
        if (!m || m.length < 6) { emit(`  FAIL day drawer fit: expected 6 tiles, found ${m ? m.length : 0}`); return true; }
        let bad = false;
        for (const x of m) {
          const at = `"${x.name}" (${x.h} px high)`;
          if (x.inset === null || x.inset < 3) { emit(`  FAIL day drawer fit: the Join pill is ${x.inset} px from a tile edge, under 3 px, ${at}`); bad = true; }
          if (x.overlap) { emit(`  FAIL day drawer fit: title, time and Join overlap, ${at}`); bad = true; }
          if (x.timeCut || x.timeCutX) { emit(`  FAIL day drawer fit: the time is cut, ${at}`); bad = true; }
          if (x.small < 16) { emit(`  FAIL day drawer fit: text is ${x.small} px, under 16, ${at}`); bad = true; }
          if (x.joinH < 20) { emit(`  FAIL day drawer fit: the Join pill is ${x.joinH} px high, too small to click, ${at}`); bad = true; }
        }
        if (!m.some((x) => x.tone === 'preset5')) { emit('  FAIL day drawer fit: no tile took the calendar colour'); bad = true; }
        if (!bad) emit(`  ok   day drawer fit: ${m.length} tiles (${m.map((x) => x.h).join(', ')} px high), Join inset ${Math.min(...m.map((x) => x.inset))} px or more, nothing overlaps or is cut`);
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
