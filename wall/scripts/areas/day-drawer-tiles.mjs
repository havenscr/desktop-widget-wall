// An agenda tile in the Day drawer never cuts off its time: a one hour or 90 minute tile with a long title and a
// Join button, alone or sharing the width with one or two others, keeps the time box wholly inside the tile and on
// the title's row, keeps Join inside the tile, and leaves a sliver of the title.
const NAME = 'Day drawer tiles, long titles with Join';
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

export default {
  name: 'day-drawer-tiles',
  fit: {
    variants: [{
      name: NAME,
      q: `?hz=work&at=${TYPICAL}&clock=review&weather=ok&meet=agenda`,
      click: '.rib-handle',
      checks: ['.day-drawer'],
      strip: true,
      viewportOnly: true,
    }],
    measurements: { drawerTiles: measureTiles },
    rules: {
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
      'drawer-tiles-wrap': {
        css: '.day-drawer .dd-ev.one { flex-wrap: wrap !important; }',
        expect: /^ *FAIL day drawer tiles: (the time box is not|Join is clipped)/m,
        appliesTo: (v) => v.name === NAME,
      },
    },
  },
};
