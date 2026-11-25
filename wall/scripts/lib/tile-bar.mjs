// The switch tiles' level bar: the name text must never touch the bar or the tile's sides. Shared by the home,
// On Air and Meet fit-check areas, which each register `measureTileBar` under their own key and a rule from `tileBarRule`.

/** Runs in the page (it is serialised, so it holds no outside names): every visible switch tile, its text, its bar. */
export function measureTileBar() {
  const rows = [];
  for (const t of document.querySelectorAll('.st-tg')) {
    const tb = t.getBoundingClientRect();
    if (tb.width === 0 || tb.height === 0) continue;
    const nm = t.querySelector('.st-name');
    const sw = t.querySelector('.st-tg-sw .st-sw');
    const track = t.querySelector('.st-track');
    const text = nm ? [...nm.childNodes].find((n) => n.nodeType === 3 && (n.textContent || '').trim()) : null;
    let tx = null;
    if (text) {
      // A Range on the text node reports the font's full box (ascent and descent), so the descenders are inside it.
      const r = document.createRange();
      r.selectNodeContents(text);
      const b = r.getBoundingClientRect();
      tx = { l: b.left, r: b.right, t: b.top, b: b.bottom };
    }
    const box = (e) => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom };
    };
    rows.push({
      name: text ? (text.textContent || '').trim() : '',
      tile: { l: tb.left, r: tb.right, t: tb.top, b: tb.bottom },
      text: tx,
      track: box(track),
      sw: box(sw),
      px: nm ? parseFloat(getComputedStyle(nm).fontSize) : 0,
      cut: nm ? nm.scrollWidth > nm.clientWidth + 1 : false,
      nameW: nm ? [nm.clientWidth, nm.scrollWidth] : null,
    });
  }
  return rows;
}

const r1 = (n) => Math.round(n * 10) / 10;

/** The failures for one page's tiles: text clear of the bar by 4 px, 10 px from each side, 16 px, not cut. */
export function tileBarFails(rows, label) {
  const fails = [];
  for (const t of rows) {
    if (!t.text) continue;
    const who = label + ': tile "' + t.name + '"';
    if (t.text.l < t.tile.l + 10 - 0.5) fails.push(who + ' text starts ' + r1(t.text.l - t.tile.l) + ' px from the tile side (10 at least)');
    if (!t.cut && t.text.r > t.tile.r - 10 + 0.5) fails.push(who + ' text ends ' + r1(t.tile.r - t.text.r) + ' px from the tile side (10 at least)');
    if (t.sw && t.sw.r > t.tile.r - 10 + 0.5) fails.push(who + ' switch ends ' + r1(t.tile.r - t.sw.r) + ' px from the tile side (10 at least)');
    if (t.sw && t.text.r > t.sw.l - 10 + 0.5 && !t.cut) fails.push(who + ' text ends ' + r1(t.sw.l - t.text.r) + ' px from its switch (10 at least)');
    if (t.px < 15.99) fails.push(who + ' text is ' + t.px + ' px (16 at least)');
    if (t.cut) fails.push(who + ' name is cut (box ' + (t.nameW ? t.nameW[0] + ', text ' + t.nameW[1] : '?') + ' px, tile ' + r1(t.tile.r - t.tile.l) + ' px wide)');
    if (t.track && t.text.b > t.track.t - 4 + 0.05) fails.push(who + ' text (with descenders) ends ' + r1(t.track.t - t.text.b) + ' px above the level bar (4 at least)');
  }
  return fails;
}

/** The smallest gap between a text box and its bar across the lit tiles, or null with none lit. */
export function tileBarGap(rows) {
  const gaps = rows.filter((t) => t.text && t.track).map((t) => t.track.t - t.text.b);
  return gaps.length ? Math.min(...gaps) : null;
}

/** A fit-check rule for one measurement key; `applies(variant)` picks the pages whose tiles it judges. */
export function tileBarRule(key, label, applies) {
  return (variant, results, emit) => {
    if (!applies(variant)) return false;
    const rows = results[key] ?? [];
    const fails = tileBarFails(rows, label);
    const lit = rows.filter((t) => t.track).length;
    for (const f of fails) emit('  FAIL ' + f);
    if (fails.length) return true;
    if (rows.length) emit('  ok   ' + label + ': ' + rows.length + ' switch tiles, text 4 px or more above the level bar (smallest gap ' + r1(tileBarGap(rows) ?? NaN) + ' px over ' + lit + ' lit), 10 px from the sides, 16 px text');
    return false;
  };
}
