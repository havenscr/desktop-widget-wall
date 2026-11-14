// Settings for each Watch look (the sheet's section, the picture boxes at both ends of every range).
// One area file: gallery states, fit variants, the in-page measurement, its rule and the deliberate breaks.

const SETTLED = 'the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet';

/**
 * In the page (self-contained: it is serialised into the page). With `tunecheck=look` the picture the look draws is the
 * box the code uses (data-sky-box), uncropped 16:9, clear of the left block, the clock, the tabs and the list card and
 * inside the strip; for the drive-in the whole tower stays clear and nothing of it (or of the travelling light) paints
 * on the picture, and hiding the sign moves nothing else. With `tunecheck=sheet`: the Looks sheet inside the stage and
 * clear of the office slot, rows 40 px, every control 32 px at least, no text under 16 px, no value cut, the rows
 * scrolling with a fade only when they overflow, and the chooser of the look to adjust like a kind row.
 */
const measureTune = () => {
  const mode = new URLSearchParams(location.search).get('tunecheck');
  if (!mode) return null;
  try {
    return tuneMeasure(mode);
  } catch (e) {
    return { fails: ['look settings: the check broke: ' + e.message], mode };
  }
  function tuneMeasure(mode) {
    const fails = [];
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const rnd = (r) => [r.l, r.t, r.w, r.h].map(Math.round).join(',');
    const meet = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    if (mode === 'sheet') {
      const sheet = document.querySelector('.w-sheet.w-tune');
      const set = sheet && sheet.querySelector('.wk-set');
      if (!sheet || !set) return { fails: ['look settings: the Looks sheet has no settings section'], mode };
      const s = R(sheet);
      if (s.t < -0.5 || s.b > 658.5 || s.r > 2560.5) fails.push('look settings: the sheet is ' + Math.round(s.h) + ' px tall, y ' + Math.round(s.t) + ' to ' + Math.round(s.b) + ' (inside the stage and clear of the office slot at y 662)');
      const rowsBox = set.querySelector('.wk-rows');
      const rb = R(rowsBox);
      const scrolls = rowsBox.scrollHeight > rowsBox.clientHeight + 1;
      for (const row of set.querySelectorAll('.ln-row')) {
        const r = R(row);
        if (r.h < 39.5) fails.push('look settings: row "' + row.textContent.trim().slice(0, 24) + '" is ' + Math.round(r.h * 10) / 10 + ' px tall (40 at least)');
      }
      // Rows may overflow only into a scroll with a cue; the last control must be reachable.
      const inRows = [...rowsBox.querySelectorAll('button, input')];
      const cut = inRows.filter((el) => { const r = R(el); return r.t < rb.t - 0.5 || r.b > rb.b + 0.5; });
      if (cut.length) {
        const cs = getComputedStyle(rowsBox);
        if (!scrolls || !(cs.overflowY === 'auto' || cs.overflowY === 'scroll')) fails.push('look settings: ' + cut.length + ' control(s) are cut off by the sheet with no scrolling');
        else {
          rowsBox.scrollTop = rowsBox.scrollHeight;
          const lb = R(inRows[inRows.length - 1]);
          if (lb.b > R(rowsBox).b + 0.5) fails.push('look settings: the last control cannot be scrolled to');
          rowsBox.scrollTop = 0;
        }
      }
      // At rest (scrolled to the top): a fade on the edge that has more, 12 px of padding, a row cut by the edge showing only what lies in the fade; nothing faded when all fits.
      const cs0 = getComputedStyle(rowsBox);
      const masked = (cs0.maskImage || cs0.webkitMaskImage || 'none') !== 'none';
      if (!scrolls && masked) fails.push('look settings: a fade is drawn on the rows with nothing more to scroll');
      if (scrolls) {
        const rb1 = R(rowsBox);
        if (!masked) fails.push('look settings: the scrolling rows end with no fade');
        const rowEls = [...rowsBox.querySelectorAll('.ln-row')];
        const first = R(rowEls[0]);
        if (first.t < rb1.t + 11.5) fails.push('look settings: the first row starts ' + Math.round((first.t - rb1.t) * 10) / 10 + ' px under the top of the rows (12 at least, clear of the fade)');
        for (const row of rowEls) {
          const r = R(row);
          if (r.t < rb1.b && r.b > rb1.b + 0.5 && rb1.b - r.t > 28.5) fails.push('look settings: row "' + row.textContent.trim().slice(0, 24) + '" shows ' + Math.round(rb1.b - r.t) + ' px at the bottom edge, more than the 28 px fade covers');
        }
      }
      // The chooser of the look to adjust: its buttons as tall and as big in type as the kind rows' buttons, 8 px apart, nothing clipped.
      const pick = [...sheet.querySelectorAll('.wk-pick .w-seg button')];
      if (pick.length) {
        const ref = sheet.querySelector('.w-kinds .w-srow:not(.wk-pick) .w-seg button');
        const refH = ref ? R(ref).h : 0;
        const refFs = ref ? getComputedStyle(ref).fontSize : '';
        pick.forEach((b, i) => {
          const r = R(b);
          if (ref && (Math.abs(r.h - refH) > 0.5 || getComputedStyle(b).fontSize !== refFs)) fails.push('look settings: the "' + b.textContent.trim() + '" button is ' + Math.round(r.h) + ' px tall at ' + getComputedStyle(b).fontSize + ', not like the rows above (' + refH + ' px, ' + refFs + ')');
          if (b.scrollWidth > b.clientWidth + 0.5) fails.push('look settings: the "' + b.textContent.trim() + '" button is clipped');
          if (i > 0) { const gap = r.l - R(pick[i - 1]).r; if (gap < 7.5) fails.push('look settings: the "Settings for" buttons are ' + Math.round(gap * 10) / 10 + ' px apart (8 at least)'); }
        });
      }
      for (const el of set.querySelectorAll('button, input')) {
        const r = R(el);
        const name = el.getAttribute('aria-label') || el.textContent.trim() || (document.getElementById(el.getAttribute('aria-labelledby') || '') || {}).textContent || el.id;
        if (!(scrolls && rowsBox.contains(el)) && (r.l < s.l - 0.5 || r.r > s.r + 0.5 || r.t < s.t - 0.5 || r.b > s.b + 0.5)) fails.push('look settings: control "' + name + '" is cut by the sheet');
        if (r.h < 31.5) fails.push('look settings: control "' + name + '" is ' + Math.round(r.h * 10) / 10 + ' px tall (32 at least)');
      }
      for (const el of [set, ...set.querySelectorAll('*')]) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 15.5) fails.push('look settings: text under 16 px in "' + el.textContent.trim().slice(0, 30) + '" (' + fs + ' px)');
        if (el.scrollWidth > el.clientWidth + 0.5) fails.push('look settings: "' + el.textContent.trim().slice(0, 30) + '" is cut (' + el.scrollWidth + ' px in ' + el.clientWidth + ')');
        if (el.scrollHeight > el.clientHeight + 1.5) fails.push('look settings: "' + el.textContent.trim().slice(0, 30) + '" is cut (' + el.scrollHeight + ' px high in ' + el.clientHeight + ')');
      }
      const foot = set.querySelector('.wk-foot');
      const sfoot = sheet.querySelector('.w-sfoot');
      if (foot && sfoot && meet(R(foot), R(sfoot))) fails.push('look settings: the foot line "' + foot.textContent.trim().slice(0, 30) + '" overlaps the saved-items line');
      if (!sfoot || !R(sfoot).h) fails.push('look settings: the saved-items foot is not shown');
      if (set.querySelectorAll('.ln-row').length < 4) fails.push('look settings: the section has fewer than three controls');
      return { fails, mode };
    }
    const stage = document.querySelector('.w-stage');
    const scr = stage && stage.querySelector('.w-screen');
    const frame = scr && scr.querySelector('.w-frame');
    if (!stage || !scr || !frame) return { fails: ['look settings: no stage, screen or frame'], mode };
    const look = stage.getAttribute('data-look');
    const sb = (stage.getAttribute('data-sky-box') || '').split(',').map(Number);
    const box = { l: sb[0], t: sb[1], w: sb[2], h: sb[3], r: sb[0] + sb[2], b: sb[1] + sb[3] };
    const pic = R(scr);
    if (look === 'holo') {
      if (pic.l < box.l - 1 || pic.t < box.t - 1 || pic.r > box.r + 1 || pic.b > box.b + 1 || box.w - pic.w > 30 || box.h - pic.h > 12) fails.push('look settings: the tilted picture is at ' + rnd(pic) + ', not inside the box the code uses ' + [box.l, box.t, box.w, box.h].map(Math.round).join(','));
    } else if (!(Math.abs(pic.l - box.l) <= 1 && Math.abs(pic.t - box.t) <= 1 && Math.abs(pic.w - box.w) <= 1 && Math.abs(pic.h - box.h) <= 1)) {
      fails.push('look settings: the picture is at ' + rnd(pic) + ', not the box the code uses ' + [box.l, box.t, box.w, box.h].map(Math.round).join(','));
    }
    const ratio = frame.offsetWidth / frame.offsetHeight;
    if (Math.abs(ratio - 16 / 9) > 0.02) fails.push('look settings: the frame is ' + frame.offsetWidth + ' by ' + frame.offsetHeight + ', not 16:9 (cropped or stretched)');
    const top = look === 'sun' ? 8 : 0;
    if (box.l < 1090 || box.r > 2000 || box.t < top - 0.5 || box.b > 720) fails.push('look settings: the picture box ' + [box.l, box.t, box.w, box.h].map(Math.round).join(',') + ' is outside x 1090 to 2000, y ' + top + ' to 720');
    const keep = ['.w-now', '.w-lookbar', '.w-card', '.u-tabs'].map((sel) => [sel, document.querySelector(sel)]).filter((k) => k[1]);
    const clk = document.querySelector('.clk');
    const clockBox = (() => { if (!clk) return null; const rg = document.createRange(); rg.selectNodeContents(clk); const r = rg.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })();
    const clash = keep.find((k) => meet(box, R(k[1]))) || (clockBox && meet(box, clockBox) ? ['the clock'] : null);
    if (clash) fails.push("look settings: the picture's box " + [box.l, box.t, box.w, box.h].map(Math.round).join(',') + ' overlaps ' + clash[0]);
    const svg = stage.querySelector('.w-tower');
    if (svg) {
      const inv = svg.getScreenCTM().inverse();
      const shapes = [...svg.querySelectorAll('path, rect')].filter((e) => !e.closest('defs') && !e.closest('g[mask]'));
      let l = 1e9, r = -1e9, t = 1e9;
      for (const e of shapes) { const b = R(e); if (!b.w && !b.h) continue; l = Math.min(l, b.l); r = Math.max(r, b.r); t = Math.min(t, b.t); }
      if (l < 1090 || r > 1996 || t < 0) fails.push('look settings: the tower reaches x ' + Math.round(l) + ' to ' + Math.round(r) + ', top ' + Math.round(t) + ' (inside x 1090 to 1996 and the strip)');
      const tower = shapes.map(R);
      const bad = keep.find((k) => tower.some((b) => meet({ l: b.l - 8, t: b.t - 8, r: b.r + 8, b: b.b + 8 }, R(k[1]))));
      if (bad) fails.push('look settings: the tower is within 8 px of ' + bad[0]);
      // Nothing of the frame paints on the picture: points of its box, in the svg's own pixels, against every shape's fill and stroke.
      const pts = [];
      for (let i = 0; i <= 12; i++) for (let j = 0; j <= 7; j++) pts.push(new DOMPoint(pic.l + 0.5 + (pic.w - 1) * i / 12, pic.t + 0.5 + (pic.h - 1) * j / 7).matrixTransform(inv));
      for (const e of svg.querySelectorAll('path, rect, ellipse, circle, line')) {
        if (e.closest('defs') || e.closest('g[mask]') || e.getAttribute('clip-path')) continue;
        const cs = getComputedStyle(e);
        if (cs.display === 'none') continue;
        const fill = cs.fill !== 'none' && Number(cs.fillOpacity) > 0, stroke = cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0;
        const hit = pts.find((pt) => (fill && e.isPointInFill(pt)) || (stroke && e.isPointInStroke(pt)));
        if (hit) { fails.push('look settings: the tower ' + e.tagName + ' paints over the picture'); break; }
      }
      // Hiding the sign moves nothing else: the same measures with the property taken off and put back.
      if (stage.style.getPropertyValue('--w-sign') === 'none') {
        const measure = () => [...svg.querySelectorAll('path, rect, ellipse, text')].filter((e) => !e.closest('.w-sign') && !e.closest('defs')).map((e) => rnd(R(e))).join('|') + '#' + rnd(R(scr));
        const hidden = measure();
        stage.style.removeProperty('--w-sign');
        const shown = measure();
        stage.style.setProperty('--w-sign', 'none');
        if (hidden !== shown) fails.push('look settings: hiding the sign moved something else');
        if ([...svg.querySelectorAll('.w-sign')].some((e) => getComputedStyle(e).display !== 'none')) fails.push('look settings: the sign is still drawn with it hidden');
      }
      // The travelling light follows the line outside the picture: its path encloses the box and no point of the box lies on its stroke.
      const lightSvg = stage.querySelector('.w-light');
      if (lightSvg) {
        const linv = lightSvg.getScreenCTM().inverse();
        const lp = linv && [...lightSvg.querySelectorAll('path')];
        for (const e of lp) {
          const b = R(e);
          if (!(b.l < pic.l - 3 && b.t < pic.t - 3 && b.r > pic.r + 3 && b.b > pic.b + 3 && b.l > pic.l - 30)) { fails.push('look settings: the travelling light path ' + rnd(b) + ' is not a line round the picture ' + rnd(pic)); break; }
          const lpts = [];
          for (let i = 0; i <= 12; i++) for (let j = 0; j <= 7; j++) lpts.push(new DOMPoint(pic.l + 0.5 + (pic.w - 1) * i / 12, pic.t + 0.5 + (pic.h - 1) * j / 7).matrixTransform(linv));
          if (lpts.some((pt) => e.isPointInStroke(pt))) { fails.push('look settings: the travelling light paints on the picture'); break; }
        }
      }
    }
    return { fails, mode, look };
  }

};

const rule = (variant, results, emit) => {
  const tuneCheck = results.tune;
  if (!tuneCheck) return false;
  let failed = false;
    if (tuneCheck) {
      for (const f of tuneCheck.fails) emit(`  FAIL ${f}`);
      if (tuneCheck.fails.length) failed = true;
      else if (tuneCheck.mode === 'sheet') emit('  ok   look settings: the Looks sheet is inside the stage and clear of the office slot, every control 32 px at least, no text under 16 px, no value cut');
      else emit('  ok   look settings: the picture is the box the code uses, 16:9, clear of the left block, the clock, the tabs and the list card, and nothing paints on it');
    }

  return failed;
};

export default {
  name: 'watchlooks',
  gallery: {
    states: [{"screen":"unwind","name":"look settings: sheet, the sun at 380 px","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=sun&wplay=0&wsheet=one&wtune=sun.size=380","custom":true,"expect":["The sun","Floor streak","380 px, smaller than usual","Reset to my usual","Each look keeps its own settings. Changes show at once."]},{"screen":"unwind","name":"look settings: sheet, whole sky at its usual","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=sky&wplay=0&wsheet=one&wtune=sky.floor=1","custom":true,"expect":["Whole sky","Soft edge","120 px, your usual","Saved here:","Each look keeps its own settings. Changes show at once."]},{"screen":"unwind","name":"look settings: sheet, a look per kind, the drive-in tuned","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=many&wplay=2&wsheet=kind&wtune=drivein.size=90,drivein.sign=0","custom":true,"expect":["Settings for","A look keeps its own settings, whatever kind of video plays in it. Changes show at once.","90%, smaller than usual","Off"]},{"screen":"unwind","name":"look settings: sheet, the hologram, see-through at 40","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=holo&wplay=0&wsheet=one&wtune=holo.see=40","custom":true,"expect":["Hologram","See-through","40, clearer than usual","Beam","Reset to my usual"]},{"screen":"unwind","name":"look settings: the sun small","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=sun&wplay=0&wtune=sun.size=280,sun.up=60,sun.glow=100","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: the sun large and low","query":"hz=unwind&at=2026-11-11T16%3A55%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=sun&wplay=0&wtune=sun.up=-60,sun.glow=20,sun.streak=0","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: whole sky, soft edge 0","query":"hz=unwind&at=2026-11-11T12%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=sky&wplay=0&wposter=bright&wtune=sky.soft=0","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: whole sky, soft edge 120","query":"hz=unwind&at=2026-11-11T12%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=sky&wplay=0&wposter=bright&wtune=sky.soft=120","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: whole sky, soft edge 200","query":"hz=unwind&at=2026-11-11T12%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=sky&wplay=0&wposter=bright&wtune=sky.soft=200","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: whole sky, smallest and dim, no floor light","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=sky&wplay=0&wtune=sky.size=60,sky.bright=60,sky.floor=0","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: feathered, largest, wide soft edge","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=feather&wplay=0&wtune=feather.size=108,feather.soft=30,feather.glow=100","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: feathered, small, sharp edge","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=feather&wplay=0&wtune=feather.size=60,feather.soft=10,feather.glow=0","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: drive-in, smallest, no sign","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=drivein&wplay=0&wtune=drivein.size=80,drivein.sign=0,drivein.floor=100","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: drive-in, largest","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=drivein&wplay=0&wtune=drivein.size=105,drivein.floor=0","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: drive-in, usual: no light, sign shown, neon lit","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=drivein&wplay=0","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: drive-in, sign hidden","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=drivein&wplay=0&wtune=drivein.sign=0","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: drive-in, neon line off","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=drivein&wplay=0&wtune=drivein.neon=0","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: drive-in, travelling light on, playing","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=drivein&wplay=0&wtune=drivein.light=1","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: drive-in, travelling light switched on, paused so it is not drawn","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=drivein&wplay=0&wstate=paused&wtune=drivein.light=1","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: hologram, flat, no beam, light plate","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=holo&wplay=0&wtune=holo.tilt=0,holo.beam=0,holo.see=60","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"},{"screen":"unwind","name":"look settings: hologram, steepest, dark plate","query":"hz=unwind&at=2026-11-11T22%3A30%3A00-08%3A00&clock=review&weather=ok&watch=mock&wlist=three&wlook=holo&wplay=0&wtune=holo.tilt=12,holo.see=10","custom":true,"expectNote":"the settings change the drawing only; fit-check measures the picture box, the clearances and the sheet"}],
  },
  fit: {
    variants: [{"name":"Look settings, sheet, the sun","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=sun&wsheet=one&wtune=sun.size=380&tunecheck=sheet","checks":[".w-sheet",".wk-set"]},{"name":"Look settings, sheet, whole sky","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=sky&wsheet=one&wtune=sky.soft=200&tunecheck=sheet","checks":[".w-sheet",".wk-set"]},{"name":"Look settings, sheet, the drive-in (five settings)","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=drivein&wsheet=one&wtune=drivein.size=90,drivein.sign=0,drivein.neon=0&tunecheck=sheet","checks":[".w-sheet",".wk-set"]},{"name":"Look settings, sheet, a look per kind, the drive-in","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=many&wplay=2&wsheet=kind&wtune=drivein.size=90&tunecheck=sheet","checks":[".w-sheet",".wk-set"]},{"name":"Look settings, whole sky, smallest","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=sky&wtune=sky.size=60,sky.soft=200,sky.bright=50,sky.floor=0&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, whole sky, largest (the usual size)","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=sky&wtune=sky.size=100&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, whole sky, plain edge","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=sky&wtune=sky.soft=0,sky.bright=100&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, sun, smallest and highest","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=sun&wtune=sun.size=280,sun.up=60&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, sun, largest and sunk","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=sun&wtune=sun.up=-100&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, sun, largest and highest","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=sun&wtune=sun.up=60,sun.glow=100&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, feathered, smallest","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=feather&wtune=feather.size=60,feather.soft=10,feather.glow=0&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, feathered, largest","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=feather&wtune=feather.size=108,feather.soft=30,feather.glow=100&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, drive-in, smallest, sign hidden","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=drivein&wtune=drivein.size=80,drivein.sign=0,drivein.floor=100&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, drive-in, largest","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=drivein&wtune=drivein.size=105,drivein.neon=0&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, drive-in, travelling light","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=drivein&wtune=drivein.light=1&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, drive-in, sign hidden","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=drivein&wtune=drivein.sign=0&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, hologram, flat","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=holo&wtune=holo.tilt=0,holo.beam=0,holo.see=60&tunecheck=look","checks":[".w-now"]},{"name":"Look settings, hologram, steepest","q":"?hz=unwind&at=2026-11-11T10:24:00-08:00&long=1&agents=3&watch=mock&wlist=three&wplay=0&wlook=holo&wtune=holo.tilt=12,holo.see=10&tunecheck=look","checks":[".w-now"]}],
    measurements: { tune: measureTune },
    rules: { tune: rule },
    breaks: {
      "tune-box": { css: ".w-sky { left: 700px !important; }", expect: /^ *FAIL look settings: the picture is at /m, appliesTo: (v) => v.name === "Look settings, whole sky, smallest" },
      "tune-clear": { css: ".w-now { min-width: 1500px !important; }", expect: /^ *FAIL look settings: the picture's box .* overlaps /m, appliesTo: (v) => v.name === "Look settings, drive-in, largest" },
      "tune-tower": { css: ".w-tower { transform: scale(1.5) !important; }", expect: /^ *FAIL look settings: the tower /m, appliesTo: (v) => v.name === "Look settings, drive-in, largest" },
      "tune-sign": { css: ".w-stage[style*='--w-sign'] .w-screen { left: 30px !important; }", expect: /^ *FAIL look settings: hiding the sign moved something else/m, appliesTo: (v) => v.name === "Look settings, drive-in, sign hidden" },
      "tune-light": { css: ".w-light path { transform: scale(0.75); transform-box: fill-box; transform-origin: center; }", expect: /^ *FAIL look settings: the travelling light/m, appliesTo: (v) => v.name === "Look settings, drive-in, travelling light" },
      "tune-sheet": { css: ".w-sheet.w-tune { max-height: none !important; } .wk-set .ln-row { min-height: 110px !important; }", expect: /^ *FAIL look settings: the sheet is \d+ px tall/m, appliesTo: (v) => v.name === "Look settings, sheet, the drive-in (five settings)" },
      "tune-control": { css: ".wk-set .ln-switch { height: 20px !important; }", expect: /^ *FAIL look settings: control ".*" is [\d.]+ px tall/m, appliesTo: (v) => v.name === "Look settings, sheet, the drive-in (five settings)" },
      "tune-text": { css: ".wk-set .ln-label { font-size: 12px !important; }", expect: /^ *FAIL look settings: text under 16 px/m, appliesTo: (v) => v.name === "Look settings, sheet, the drive-in (five settings)" },
      "tune-cut": { css: ".wk-set .ln-value { width: 60px !important; }", expect: /^ *FAIL look settings: ".*" is cut /m, appliesTo: (v) => v.name === "Look settings, sheet, the sun" },
      "tune-clip": { css: ".wk-set .wk-rows { overflow: hidden !important; }", expect: /^ *FAIL look settings: \d+ control\(s\) are cut off by the sheet with no scrolling/m, appliesTo: (v) => v.name === "Look settings, sheet, a look per kind, the drive-in" },
      "tune-foot": { css: ".wk-set > .wk-foot { max-height: 22px !important; overflow: hidden !important; }", expect: /^ *FAIL look settings: ".*" is cut \(\d+ px high/m, appliesTo: (v) => v.name === "Look settings, sheet, a look per kind, the drive-in" },
      "tune-fade": { css: ".wk-set .wk-rows { -webkit-mask-image: none !important; mask-image: none !important; }", expect: /^ *FAIL look settings: the scrolling rows end with no fade/m, appliesTo: (v) => v.name === "Look settings, sheet, a look per kind, the drive-in" },
      "tune-remnant": { css: ".wk-set .wk-rows { -webkit-mask-image: linear-gradient(180deg, #000, transparent) !important; mask-image: linear-gradient(180deg, #000, transparent) !important; }", expect: /^ *FAIL look settings: a fade is drawn on the rows with nothing more to scroll/m, appliesTo: (v) => v.name === "Look settings, sheet, the sun" },
      "tune-gap": { css: ".wk-pick .w-seg { gap: 0 !important; }", expect: /^ *FAIL look settings: the "Settings for" buttons are [\d.]+ px apart/m, appliesTo: (v) => v.name === "Look settings, sheet, a look per kind, the drive-in" },
      "tune-row": { css: ".wk-set .ln-row { min-height: 30px !important; height: 30px !important; }", expect: /^ *FAIL look settings: row ".*" is [\d.]+ px tall \(40 at least\)/m, appliesTo: (v) => v.name === "Look settings, sheet, the sun" },
    },
  },
};
