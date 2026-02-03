/* ================================================================
   WIDGET WALL DESKTOP - MAIN APPLICATION LOADER
   Loads all widget HTML partials and initializes JS modules
   Copyright (c) 2024-2025 Havens Consulting Inc. All Rights Reserved.
   ================================================================ */

// Widget configuration - maps container IDs to HTML partial paths
const widgetConfig = [
  { container: 'clock-container', path: 'widgets/clock.html' },
  { container: 'weather-container', path: 'widgets/weather.html' },
  { container: 'countdown-container', path: 'widgets/countdown.html' },
  { container: 'recent-files-container', path: 'widgets/recent-files.html' },
  { container: 'now-playing-container', path: 'widgets/now-playing.html' },
  { container: 'visualizer-container', path: 'widgets/visualizer.html' },
  { container: 'twitch-container', path: 'widgets/twitch.html' },
  { container: 'system-stats-container', path: 'widgets/system-stats.html' },
  { container: 'calculator-container', path: 'widgets/calculator.html' },
  { container: 'audio-mixer-container', path: 'widgets/audio-mixer.html' },
  { container: 'calendar-container', path: 'widgets/calendar.html' },
  { container: 'inbox-container', path: 'widgets/inbox.html' },
  { container: 'claude-stats-container', path: 'widgets/claude-stats.html' }
];

// Additional components (modals, settings panel)
const componentConfig = [
  { container: 'modals-container', path: 'widgets/modals.html' },
  { container: 'settings-panel-container', path: 'widgets/settings-panel.html' }
];

// Widget JS modules to load after HTML is ready
const widgetScripts = [
  'scripts/widgets/visibility-manager.js',  // Load first for other widgets to use
  'scripts/widgets/theme.js',
  'scripts/widgets/microsoft-auth.js',
  'scripts/widgets/clock.js',
  'scripts/widgets/radio.js',
  'scripts/widgets/skylines.js',
  'scripts/widgets/weather.js',
  'scripts/widgets/countdown.js',
  'scripts/widgets/recent-files.js',
  'scripts/widgets/now-playing.js',
  'scripts/widgets/visualizer.js',
  'scripts/widgets/twitch.js',
  'scripts/widgets/smart-widget.js',
  'scripts/widgets/system-stats.js',
  'scripts/widgets/calculator.js',
  'scripts/widgets/audio-mixer.js',
  'scripts/widgets/calendar.js',
  'scripts/widgets/twitch-chat.js',
  'scripts/widgets/text-effects.js',
  'scripts/widgets/inbox.js',
  'scripts/widgets/claude-stats.js',
  'scripts/widgets/settings-panel.js',
  'scripts/widgets/window-controls.js'
];

/**
 * Load HTML partial into a container element
 * @param {string} containerId - The ID of the container element
 * @param {string} path - Path to the HTML partial file
 * @returns {Promise<void>}
 */
async function loadWidget(containerId, path) {
  try {
    // Add cache-busting version parameter
    const response = await fetch(path + '?v=' + Date.now());
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status}`);
    }
    const html = await response.text();
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = html;
    } else {
      console.warn(`Container not found: ${containerId}`);
    }
  } catch (error) {
    console.error(`Error loading widget ${path}:`, error);
  }
}

/**
 * Load a JavaScript module dynamically
 * @param {string} src - Path to the script file
 * @returns {Promise<void>}
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Add cache-busting version parameter
    script.src = src + '?v=' + Date.now();
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.body.appendChild(script);
  });
}

/**
 * Initialize the dashboard - load all components and scripts
 */
async function initDashboard() {
  console.log('Widget Wall Desktop - Initializing...');

  // Phase 1: Load all widget HTML partials in parallel
  const widgetPromises = widgetConfig.map(w => loadWidget(w.container, w.path));
  await Promise.all(widgetPromises);
  console.log('Widget HTML loaded');

  // Phase 2: Load additional components (modals, settings)
  const componentPromises = componentConfig.map(c => loadWidget(c.container, c.path));
  await Promise.all(componentPromises);
  console.log('Components loaded');

  // Phase 3: Load widget JS modules sequentially (some may depend on others)
  for (const scriptPath of widgetScripts) {
    try {
      await loadScript(scriptPath);
    } catch (error) {
      console.error(error);
    }
  }
  console.log('Widget scripts initialized');

  // Phase 4: Dispatch custom event for any additional initialization
  window.dispatchEvent(new CustomEvent('dashboard-ready'));
  console.log('Widget Wall Desktop - Ready');
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboard);
} else {
  initDashboard();
}
