/* ================================================================
   THEME MODULE
   Theme switching with 6 color schemes and auto-cycling.
   Fade mode uses JS driven requestAnimationFrame interpolation
   so every CSS variable updates in lockstep each frame.
   ================================================================ */

const ThemeModule = (function() {
  const themes = [
    { name: 'Pink/Purple', key: 'pink' },
    { name: 'Teal/Cyan', key: 'teal' },
    { name: 'Sunset Orange', key: 'sunset' },
    { name: 'Midnight Blue', key: 'midnight' },
    { name: 'Emerald Forest', key: 'emerald' },
    { name: 'Rose Berry', key: 'rose' }
  ];

  /* ---- Color variable definitions per theme ----
     Each theme maps CSS variable names to their values.
     'pink' is the :root default; others match [data-theme="..."] blocks. */
  const themeVars = {
    pink: {
      '--gradient-1': '#3d1a54',
      '--gradient-2': '#3a1c71',
      '--gradient-3': '#d76d77',
      '--gradient-4': '#ff6b9d',
      '--gradient-5': '#667eea',
      '--gradient-6': '#84a4fc',
      '--accent-primary': '#ff2d85',
      '--accent-primary-rgb': '255, 45, 133',
      '--accent-secondary': '#5ac8fa',
      '--accent-gold': '#fdb800',
      '--accent-green': '#30d158',
      '--accent-orange': '#ff9500',
      '--accent-purple': '#bf5af2',
      '--ring-cpu': '#ff2d85',
      '--ring-ram': '#5ac8fa',
      '--ring-hd': '#bf5af2',
      '--ring-gpu': '#30d158',
      '--vis-color-1': '#ff2d85',
      '--vis-color-2': '#bf5af2',
      '--vis-color-3': '#5ac8fa',
      '--glass-bg-dark': 'rgba(20, 20, 35, 0.55)',
      '--shadow-glow': '0 0 30px rgba(255, 45, 133, 0.3)',
      '--clock-panel-bg': 'rgba(71, 44, 75, 0.8)',
      '--clock-digit-color': '#fdb800',
      '--calc-operator-bg': 'rgba(255, 149, 0, 0.3)',
      '--calc-operator-bg-hover': 'rgba(255, 149, 0, 0.5)',
      '--calc-operator-color': '#ff9500',
      '--bg-hue-rotate': '0deg',
      '--bg-saturate': '1.2',
      '--bg-brightness': '1.4',
      '--custom-bg-hue': '280deg'
    },
    teal: {
      '--gradient-1': '#0a1f1f',
      '--gradient-2': '#0d3f3f',
      '--gradient-3': '#009999',
      '--gradient-4': '#00B8B8',
      '--gradient-5': '#00d4d4',
      '--gradient-6': '#4dfff3',
      '--accent-primary': '#00B8B8',
      '--accent-primary-rgb': '0, 184, 184',
      '--accent-secondary': '#00d4d4',
      '--accent-gold': '#fdb800',
      '--accent-green': '#30d158',
      '--accent-orange': '#ff9500',
      '--accent-purple': '#bf5af2',
      '--ring-cpu': '#00d4d4',
      '--ring-ram': '#4dfff3',
      '--ring-hd': '#30d158',
      '--ring-gpu': '#ffd700',
      '--vis-color-1': '#00B8B8',
      '--vis-color-2': '#009999',
      '--vis-color-3': '#4dfff3',
      '--glass-bg-dark': 'rgba(20, 20, 35, 0.55)',
      '--shadow-glow': '0 0 30px rgba(0, 184, 184, 0.3)',
      '--clock-panel-bg': 'rgba(13, 63, 63, 0.8)',
      '--clock-digit-color': '#4dfff3',
      '--calc-operator-bg': 'rgba(0, 212, 212, 0.3)',
      '--calc-operator-bg-hover': 'rgba(0, 212, 212, 0.5)',
      '--calc-operator-color': '#00d4d4',
      '--bg-hue-rotate': '210deg',
      '--bg-saturate': '1.2',
      '--bg-brightness': '1.3',
      '--custom-bg-hue': '120deg'
    },
    sunset: {
      '--gradient-1': '#1a0a00',
      '--gradient-2': '#4a1a00',
      '--gradient-3': '#ff6b35',
      '--gradient-4': '#f7931e',
      '--gradient-5': '#ffcc00',
      '--gradient-6': '#fff4b0',
      '--accent-primary': '#ff6b35',
      '--accent-primary-rgb': '255, 107, 53',
      '--accent-secondary': '#f7931e',
      '--accent-gold': '#fdb800',
      '--accent-green': '#30d158',
      '--accent-orange': '#ff9500',
      '--accent-purple': '#bf5af2',
      '--ring-cpu': '#ff4444',
      '--ring-ram': '#ff9500',
      '--ring-hd': '#e040fb',
      '--ring-gpu': '#ffcc00',
      '--vis-color-1': '#ff6b35',
      '--vis-color-2': '#f7931e',
      '--vis-color-3': '#ffcc00',
      '--glass-bg-dark': 'rgba(20, 20, 35, 0.55)',
      '--shadow-glow': '0 0 30px rgba(255, 107, 53, 0.3)',
      '--clock-panel-bg': 'rgba(74, 26, 0, 0.8)',
      '--clock-digit-color': '#ffcc00',
      '--calc-operator-bg': 'rgba(247, 147, 30, 0.3)',
      '--calc-operator-bg-hover': 'rgba(247, 147, 30, 0.5)',
      '--calc-operator-color': '#f7931e',
      '--bg-hue-rotate': '60deg',
      '--bg-saturate': '1.5',
      '--bg-brightness': '1.3',
      '--custom-bg-hue': '350deg'
    },
    midnight: {
      '--gradient-1': '#0a0a1a',
      '--gradient-2': '#0f1a3a',
      '--gradient-3': '#1e3a5f',
      '--gradient-4': '#3a7bd5',
      '--gradient-5': '#5a9fd4',
      '--gradient-6': '#87ceeb',
      '--accent-primary': '#3a7bd5',
      '--accent-primary-rgb': '58, 123, 213',
      '--accent-secondary': '#5a9fd4',
      '--accent-gold': '#fdb800',
      '--accent-green': '#30d158',
      '--accent-orange': '#ff9500',
      '--accent-purple': '#bf5af2',
      '--ring-cpu': '#3a7bd5',
      '--ring-ram': '#00d4ff',
      '--ring-hd': '#34d399',
      '--ring-gpu': '#a855f7',
      '--vis-color-1': '#3a7bd5',
      '--vis-color-2': '#5a9fd4',
      '--vis-color-3': '#87ceeb',
      '--glass-bg-dark': 'rgba(20, 20, 35, 0.55)',
      '--shadow-glow': '0 0 30px rgba(58, 123, 213, 0.3)',
      '--clock-panel-bg': 'rgba(15, 26, 58, 0.8)',
      '--clock-digit-color': '#87ceeb',
      '--calc-operator-bg': 'rgba(90, 159, 212, 0.3)',
      '--calc-operator-bg-hover': 'rgba(90, 159, 212, 0.5)',
      '--calc-operator-color': '#5a9fd4',
      '--bg-hue-rotate': '240deg',
      '--bg-saturate': '1.3',
      '--bg-brightness': '1.2',
      '--custom-bg-hue': '190deg'
    },
    emerald: {
      '--gradient-1': '#0a1a0f',
      '--gradient-2': '#0f2a1a',
      '--gradient-3': '#1a4a2a',
      '--gradient-4': '#2d8a4e',
      '--gradient-5': '#34d399',
      '--gradient-6': '#a7f3d0',
      '--accent-primary': '#2d8a4e',
      '--accent-primary-rgb': '45, 138, 78',
      '--accent-secondary': '#34d399',
      '--accent-gold': '#fdb800',
      '--accent-green': '#30d158',
      '--accent-orange': '#ff9500',
      '--accent-purple': '#bf5af2',
      '--ring-cpu': '#22c55e',
      '--ring-ram': '#34d399',
      '--ring-hd': '#06b6d4',
      '--ring-gpu': '#fbbf24',
      '--vis-color-1': '#2d8a4e',
      '--vis-color-2': '#34d399',
      '--vis-color-3': '#a7f3d0',
      '--glass-bg-dark': 'rgba(20, 20, 35, 0.55)',
      '--shadow-glow': '0 0 30px rgba(45, 138, 78, 0.3)',
      '--clock-panel-bg': 'rgba(15, 42, 26, 0.8)',
      '--clock-digit-color': '#a7f3d0',
      '--calc-operator-bg': 'rgba(52, 211, 153, 0.3)',
      '--calc-operator-bg-hover': 'rgba(52, 211, 153, 0.5)',
      '--calc-operator-color': '#34d399',
      '--bg-hue-rotate': '145deg',
      '--bg-saturate': '1.3',
      '--bg-brightness': '1.15',
      '--custom-bg-hue': '90deg'
    },
    rose: {
      '--gradient-1': '#1a0a10',
      '--gradient-2': '#3a1020',
      '--gradient-3': '#6b1a3a',
      '--gradient-4': '#db2777',
      '--gradient-5': '#f472b6',
      '--gradient-6': '#fbcfe8',
      '--accent-primary': '#db2777',
      '--accent-primary-rgb': '219, 39, 119',
      '--accent-secondary': '#f472b6',
      '--accent-gold': '#fdb800',
      '--accent-green': '#30d158',
      '--accent-orange': '#ff9500',
      '--accent-purple': '#bf5af2',
      '--ring-cpu': '#f43f5e',
      '--ring-ram': '#f472b6',
      '--ring-hd': '#fbbf24',
      '--ring-gpu': '#a855f7',
      '--vis-color-1': '#db2777',
      '--vis-color-2': '#f472b6',
      '--vis-color-3': '#fbcfe8',
      '--glass-bg-dark': 'rgba(20, 20, 35, 0.55)',
      '--shadow-glow': '0 0 30px rgba(219, 39, 119, 0.3)',
      '--clock-panel-bg': 'rgba(58, 16, 32, 0.8)',
      '--clock-digit-color': '#fbcfe8',
      '--calc-operator-bg': 'rgba(244, 114, 182, 0.3)',
      '--calc-operator-bg-hover': 'rgba(244, 114, 182, 0.5)',
      '--calc-operator-color': '#f472b6',
      '--bg-hue-rotate': '45deg',
      '--bg-saturate': '1.3',
      '--bg-brightness': '1.25',
      '--custom-bg-hue': '310deg'
    }
  };

  /* ---- Color parsing / interpolation helpers ---- */

  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return [
      parseInt(hex.substring(0, 2), 16),
      parseInt(hex.substring(2, 4), 16),
      parseInt(hex.substring(4, 6), 16)
    ];
  }

  function rgbToHex(r, g, b) {
    return '#' +
      Math.round(r).toString(16).padStart(2, '0') +
      Math.round(g).toString(16).padStart(2, '0') +
      Math.round(b).toString(16).padStart(2, '0');
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Parse an rgba(...) string into [r, g, b, a].
   * Also handles rgb(...) (alpha defaults to 1).
   */
  function parseRgba(str) {
    const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
    if (!m) return null;
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1];
  }

  function formatRgba(r, g, b, a) {
    return 'rgba(' + Math.round(r) + ', ' + Math.round(g) + ', ' + Math.round(b) + ', ' + parseFloat(a.toFixed(3)) + ')';
  }

  /**
   * Parse a "R, G, B" triplet string (used by --accent-primary-rgb).
   */
  function parseRgbTriplet(str) {
    const parts = str.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 3 && parts.every(n => !isNaN(n))) return parts;
    return null;
  }

  function formatRgbTriplet(r, g, b) {
    return Math.round(r) + ', ' + Math.round(g) + ', ' + Math.round(b);
  }

  /**
   * Parse a degree value like "210deg" into a number.
   */
  function parseDeg(str) {
    const m = str.match(/([\d.]+)\s*deg/);
    return m ? parseFloat(m[1]) : NaN;
  }

  /**
   * Interpolate a single CSS variable value between two themes.
   * Returns the blended string value at progress t (0..1).
   */
  function interpolateVar(varName, fromVal, toVal, t) {
    if (fromVal === toVal) return fromVal;

    /* shadow-glow: complex box-shadow with embedded rgba */
    if (varName === '--shadow-glow') {
      const fromRgba = parseRgba(fromVal);
      const toRgba = parseRgba(toVal);
      if (fromRgba && toRgba) {
        return '0 0 30px rgba(' +
          Math.round(lerp(fromRgba[0], toRgba[0], t)) + ', ' +
          Math.round(lerp(fromRgba[1], toRgba[1], t)) + ', ' +
          Math.round(lerp(fromRgba[2], toRgba[2], t)) + ', ' +
          parseFloat(lerp(fromRgba[3], toRgba[3], t).toFixed(3)) + ')';
      }
      return t < 0.5 ? fromVal : toVal;
    }

    /* RGB triplet string like "255, 45, 133" */
    if (varName === '--accent-primary-rgb') {
      const fromT = parseRgbTriplet(fromVal);
      const toT = parseRgbTriplet(toVal);
      if (fromT && toT) {
        return formatRgbTriplet(
          lerp(fromT[0], toT[0], t),
          lerp(fromT[1], toT[1], t),
          lerp(fromT[2], toT[2], t)
        );
      }
      return t < 0.5 ? fromVal : toVal;
    }

    /* Degree values */
    if (fromVal.includes('deg') && toVal.includes('deg')) {
      const fDeg = parseDeg(fromVal);
      const tDeg = parseDeg(toVal);
      if (!isNaN(fDeg) && !isNaN(tDeg)) {
        return lerp(fDeg, tDeg, t) + 'deg';
      }
    }

    /* Plain numbers (saturate, brightness) */
    const fNum = parseFloat(fromVal);
    const tNum = parseFloat(toVal);
    if (!isNaN(fNum) && !isNaN(tNum) && !/[#(]/.test(fromVal)) {
      return String(parseFloat(lerp(fNum, tNum, t).toFixed(4)));
    }

    /* rgba() values */
    const fRgba = parseRgba(fromVal);
    const tRgba = parseRgba(toVal);
    if (fRgba && tRgba) {
      return formatRgba(
        lerp(fRgba[0], tRgba[0], t),
        lerp(fRgba[1], tRgba[1], t),
        lerp(fRgba[2], tRgba[2], t),
        lerp(fRgba[3], tRgba[3], t)
      );
    }

    /* Hex colors */
    if (fromVal.startsWith('#') && toVal.startsWith('#')) {
      const fC = hexToRgb(fromVal);
      const tC = hexToRgb(toVal);
      return rgbToHex(
        lerp(fC[0], tC[0], t),
        lerp(fC[1], tC[1], t),
        lerp(fC[2], tC[2], t)
      );
    }

    /* Fallback: snap at midpoint */
    return t < 0.5 ? fromVal : toVal;
  }

  /* ---- State ---- */

  let currentThemeIndex = 0;
  let autoCycleTimer = null;
  let fadeAnimFrame = null;
  let fadeTargetIndex = -1;   /* tracks where an in-progress fade is heading */
  let autoCycleActive = false;
  let themeToggle = null;

  /**
   * Cancel any running fade animation.
   * If snapForward is true, jump to the fade target instead of staying put.
   */
  function cancelFade(snapForward) {
    if (fadeAnimFrame) {
      cancelAnimationFrame(fadeAnimFrame);
      fadeAnimFrame = null;
    }
    if (snapForward && fadeTargetIndex >= 0) {
      currentThemeIndex = fadeTargetIndex;
      const theme = themes[currentThemeIndex];
      clearInlineVars();
      document.body.dataset.theme = theme.key;
      if (themeToggle) themeToggle.dataset.themeName = theme.name;
      localStorage.setItem('dashboard-theme', theme.key);
    }
    fadeTargetIndex = -1;
  }

  /**
   * Clear all inline style overrides on :root that we set during fade,
   * letting the [data-theme] CSS take over.
   */
  function clearInlineVars() {
    const el = document.body;
    const allVarNames = Object.keys(themeVars.pink);
    allVarNames.forEach(v => el.style.removeProperty(v));
  }

  /**
   * Apply a theme instantly (no fade). Used for rotate mode and manual clicks.
   */
  function applyThemeInstant(index) {
    cancelFade(false);
    currentThemeIndex = index % themes.length;
    const theme = themes[currentThemeIndex];

    clearInlineVars();
    document.body.dataset.theme = theme.key;
    if (themeToggle) themeToggle.dataset.themeName = theme.name;
    localStorage.setItem('dashboard-theme', theme.key);
  }

  /**
   * Start a JS driven fade from the current theme to the next,
   * over durationMs milliseconds.
   */
  function fadeToNext(durationMs, onComplete) {
    cancelFade(true);

    const fromIndex = currentThemeIndex;
    const toIndex = (currentThemeIndex + 1) % themes.length;
    fadeTargetIndex = toIndex;

    const fromKey = themes[fromIndex].key;
    const toKey = themes[toIndex].key;
    const fromVals = themeVars[fromKey];
    const toVals = themeVars[toKey];

    if (!fromVals || !toVals) {
      applyThemeInstant(toIndex);
      if (onComplete) onComplete();
      return;
    }

    const el = document.body;
    /* Only interpolate variables that actually differ between the two
       themes - identical vars (accent-gold, glass-bg-dark, ...) would
       otherwise be rewritten every tick for nothing. */
    const varNames = Object.keys(fromVals).filter(v => fromVals[v] !== toVals[v]);
    const startTime = performance.now();

    /* Writing CSS vars on <body> invalidates var-dependent styles
       document-wide, and --bg-hue-rotate re-rasterizes the full-screen
       background filter. At a monitor's full refresh rate that is the
       single biggest standing GPU cost of fade mode, so apply at ~10fps -
       imperceptible for multi-second color fades. rAF still drives the
       loop so it suspends for free while the window is hidden. */
    const FADE_APPLY_MS = 100;
    let lastApplyTime = -Infinity;

    function tick(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / durationMs, 1);

      if (t < 1 && now - lastApplyTime < FADE_APPLY_MS) {
        fadeAnimFrame = requestAnimationFrame(tick);
        return;
      }
      lastApplyTime = now;

      /* Smooth ease in/out */
      const eased = t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;

      for (let i = 0; i < varNames.length; i++) {
        const v = varNames[i];
        const blended = interpolateVar(v, fromVals[v], toVals[v], eased);
        el.style.setProperty(v, blended);
      }

      if (t < 1) {
        fadeAnimFrame = requestAnimationFrame(tick);
      } else {
        /* Fade complete: commit the target theme and clear overrides */
        fadeAnimFrame = null;
        fadeTargetIndex = -1;
        currentThemeIndex = toIndex;
        const theme = themes[currentThemeIndex];
        document.body.dataset.theme = theme.key;
        if (themeToggle) themeToggle.dataset.themeName = theme.name;
        localStorage.setItem('dashboard-theme', theme.key);
        clearInlineVars();
        if (onComplete) onComplete();
      }
    }

    fadeAnimFrame = requestAnimationFrame(tick);
  }

  /**
   * Read theme config from dashboardConfig.
   */
  function getThemeConfig() {
    const config = typeof dashboardConfig !== 'undefined' ? dashboardConfig : {};
    return config.theme || { autoCycle: false, mode: 'fade', interval: 30 };
  }

  /**
   * Start auto-cycling through themes.
   * Fade mode chains: each fade's completion triggers the next.
   * Rotate mode uses setInterval for instant snaps.
   */
  function startAutoCycle() {
    stopAutoCycle();

    const config = getThemeConfig();
    if (!config.autoCycle) return;

    autoCycleActive = true;
    const intervalMs = config.interval * 1000;
    const instant = config.mode === 'rotate';

    if (instant) {
      applyThemeInstant(currentThemeIndex + 1);
      autoCycleTimer = setInterval(() => {
        applyThemeInstant(currentThemeIndex + 1);
      }, intervalMs);
    } else {
      /* Fade mode: chain fades so each one starts exactly when the previous ends */
      function chainFade() {
        if (!autoCycleActive) return;
        /* Re-read config each cycle in case interval was changed */
        const cfg = getThemeConfig();
        const ms = cfg.interval * 1000;
        fadeToNext(ms, function() {
          if (autoCycleActive) chainFade();
        });
      }
      chainFade();
    }
  }

  /**
   * Stop auto-cycling. Snaps to the fade target if one is in progress.
   */
  function stopAutoCycle() {
    autoCycleActive = false;
    if (autoCycleTimer) {
      clearInterval(autoCycleTimer);
      autoCycleTimer = null;
    }
    cancelFade(true);
  }

  /**
   * Show the tooltip animation on the theme button.
   */
  function showTooltip() {
    if (!themeToggle) return;
    themeToggle.classList.remove('tooltip-fading');
    themeToggle.classList.add('tooltip-visible');
    void themeToggle.offsetWidth;
    themeToggle.classList.add('tooltip-fading');

    setTimeout(() => {
      themeToggle.classList.remove('tooltip-visible', 'tooltip-fading');
    }, 2000);
  }

  /**
   * Initialize the theme module.
   */
  function init() {
    themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;

    /* Load saved theme */
    const savedTheme = localStorage.getItem('dashboard-theme');
    if (savedTheme) {
      currentThemeIndex = themes.findIndex(t => t.key === savedTheme);
      if (currentThemeIndex === -1) currentThemeIndex = 0;
      document.body.dataset.theme = themes[currentThemeIndex].key;
    }

    themeToggle.dataset.themeName = themes[currentThemeIndex].name;

    /* Manual click: advance to next theme instantly */
    themeToggle.addEventListener('click', () => {
      applyThemeInstant(currentThemeIndex + 1);
      showTooltip();

      const config = getThemeConfig();
      if (config.autoCycle) {
        setTimeout(() => startAutoCycle(), 600);
      }
    });

    /* Listen for config changes from settings panel */
    window.addEventListener('dashboard-config-changed', () => {
      const config = getThemeConfig();
      if (config.autoCycle) {
        startAutoCycle();
      } else {
        stopAutoCycle();
      }
    });

    /* dashboardConfig may not exist yet; listen for dashboard-ready */
    window.addEventListener('dashboard-ready', () => {
      const cfg = getThemeConfig();
      if (cfg.autoCycle) {
        startAutoCycle();
      }
    });
  }

  /* Auto-initialize */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { themes, startAutoCycle, stopAutoCycle };
})();
