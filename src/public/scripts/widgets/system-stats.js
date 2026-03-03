/* ================================================================
   SYSTEM STATS MODULE
   Fetches system metrics from LibreHardwareMonitor via Tauri backend
   (Direct HTTP fetch blocked due to mixed content - HTTPS app, HTTP API)
   ================================================================ */

const HD_SOURCE_KEY = 'widget-wall-hd-source';

// Arc circumferences based on radius (2 * PI * r)
const ARC_CIRCUMFERENCE = {
  'cpu-arc': 339.3,  // r=54
  'gpu-arc': 263.9,  // r=42
  'ram-arc': 188.5,  // r=30
  'hd-arc': 113.1    // r=18
};

// Store discovered drives for config dropdown
let discoveredDrives = {};

// Create a short display name from drive model
function createShortDriveName(fullName) {
  // Remove common suffixes and clean up
  let name = fullName
    .replace(/\d+\s*GB$/i, '')  // Remove "1024GB", "2000GB" etc
    .replace(/\d+\s*TB$/i, '')  // Remove "2TB" etc
    .replace(/NVMe/i, '')
    .replace(/SSD/i, '')
    .replace(/HDD/i, '')
    .replace(/HS$/i, '')        // Remove "HS" suffix
    .trim();

  // Truncate to reasonable length for dropdown
  if (name.length > 20) {
    name = name.substring(0, 20).trim();
  }

  return name || fullName.substring(0, 15);
}

function updateStatArc(elementId, percent) {
  const arc = document.getElementById(elementId);
  if (!arc) return;
  const circumference = ARC_CIRCUMFERENCE[elementId] || 339.3;
  const normalizedPercent = Math.min(Math.max(percent, 0), 100);
  const offset = circumference * (1 - normalizedPercent / 100);
  arc.style.strokeDashoffset = offset;
}

function updateStatusIndicator(connected) {
  const indicator = document.getElementById('stats-mode-indicator');
  if (!indicator) return;
  const dot = indicator.querySelector('.mode-dot');
  const text = indicator.querySelector('.mode-text');
  if (dot) {
    dot.style.background = connected ? 'var(--accent-green, #34c759)' : '#ff3b30';
  }
  if (text) {
    text.textContent = connected ? 'Connected' : 'Disconnected';
  }
}

async function fetchSystemStats() {
  try {
    // Check if Tauri is available
    if (!window.__TAURI__) {
      console.warn('[SystemStats] Tauri not available - running in browser mode');
      updateStatusIndicator(false);
      return;
    }

    if (!window.__TAURI__.core) {
      console.warn('[SystemStats] Tauri.core namespace not available');
      updateStatusIndicator(false);
      return;
    }

    console.log('[SystemStats] Invoking get_libre_hardware_stats...');
    const { invoke } = window.__TAURI__.core;
    const data = await invoke('get_libre_hardware_stats');
    console.log('[SystemStats] Received data:', data ? 'OK' : 'empty');
    parseHardwareData(data);
    updateStatusIndicator(true);
  } catch (e) {
    // LibreHardwareMonitor not running or Tauri not available
    console.error('[SystemStats] Error:', e);
    updateStatusIndicator(false);
  }
}

function parseHardwareData(data) {
  let cpuLoad = 0, gpuLoad = 0, ramUsed = 0, hdUsed = 0;
  const driveUsages = {}; // Collect all drives: { 'Micron 2300': 54, 'WD_BLACK': 78, ... }
  let currentDriveName = null;

  function traverse(node, path = '') {
    if (!node) return;

    const currentPath = path ? `${path} > ${node.Text}` : node.Text;

    // CPU Load
    if (node.Text && node.Text.includes('CPU Total') && node.Value) {
      const match = node.Value.match(/([\d.]+)/);
      if (match) cpuLoad = parseFloat(match[1]);
    }

    // GPU Load
    if (node.Text && node.Text.includes('GPU Core') && node.Value && node.Value.includes('%')) {
      const match = node.Value.match(/([\d.]+)/);
      if (match) gpuLoad = parseFloat(match[1]);
    }

    // RAM Usage
    if (node.Text && node.Text === 'Memory' && node.Value && node.Value.includes('%')) {
      const match = node.Value.match(/([\d.]+)/);
      if (match) ramUsed = parseFloat(match[1]);
    }

    // Detect storage device by ImageURL or by being a direct child with storage-like children
    if (node.ImageURL && node.ImageURL.includes('hdd.png')) {
      currentDriveName = node.Text;
    }

    // Hard Drive Usage - collect all drives using the current drive context
    if (node.Text && node.Text === 'Used Space' && node.Value && node.Value.includes('%')) {
      const match = node.Value.match(/([\d.]+)/);
      if (match && currentDriveName) {
        const usedValue = parseFloat(match[1]);
        // Create a short display name from the drive model
        const shortName = createShortDriveName(currentDriveName);
        driveUsages[shortName] = usedValue;
      }
    }

    // Traverse children
    if (node.Children) {
      node.Children.forEach(child => traverse(child, currentPath));
    }

    // Reset drive context after traversing storage device
    if (node.ImageURL && node.ImageURL.includes('hdd.png')) {
      currentDriveName = null;
    }
  }

  traverse(data, '');

  // Update discovered drives and populate dropdown if changed
  const driveKeys = Object.keys(driveUsages).sort();
  if (driveKeys.length > 0 && JSON.stringify(driveKeys) !== JSON.stringify(Object.keys(discoveredDrives).sort())) {
    discoveredDrives = { ...driveUsages };
    populateHdDriveOptions(driveKeys);
  } else {
    // Just update values
    discoveredDrives = { ...driveUsages };
  }

  // Calculate HD% based on user preference
  const hdSource = localStorage.getItem(HD_SOURCE_KEY) || 'average';
  if (hdSource === 'average' || driveKeys.length === 0) {
    const values = Object.values(driveUsages);
    hdUsed = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  } else {
    // Specific drive selected - find matching drive or fall back to average
    hdUsed = driveUsages[hdSource] || Object.values(driveUsages)[0] || 0;
  }

  // Update UI
  updateStatArc('cpu-arc', cpuLoad);
  updateStatArc('gpu-arc', gpuLoad);
  updateStatArc('ram-arc', ramUsed);
  updateStatArc('hd-arc', hdUsed);

  document.getElementById('cpu-value').textContent = Math.round(cpuLoad) + '%';
  document.getElementById('gpu-value').textContent = Math.round(gpuLoad) + '%';
  document.getElementById('ram-value').textContent = Math.round(ramUsed) + '%';
  document.getElementById('hd-value').textContent = Math.round(hdUsed) + '%';
}

function populateHdDriveOptions(driveNames) {
  const container = document.getElementById('hd-drive-options');
  if (!container) return;

  const currentSource = localStorage.getItem(HD_SOURCE_KEY) || 'average';

  container.innerHTML = driveNames.map(drive => `
    <div class="stat-config-option${currentSource === drive ? ' selected' : ''}" data-value="${drive}">
      <span class="config-check"></span>
      ${drive}
    </div>
  `).join('');

  // Also update the "average" option selection state
  const avgOption = document.querySelector('.stat-config-option[data-value="average"]');
  if (avgOption) {
    avgOption.classList.toggle('selected', currentSource === 'average');
  }

  // If current selection is a drive letter (old format), reset to average
  if (currentSource && currentSource.match(/^[A-Z]:$/i)) {
    localStorage.setItem(HD_SOURCE_KEY, 'average');
    if (avgOption) avgOption.classList.add('selected');
  }
}

function initSystemStats() {
  // Setup clickable title to open Task Manager
  const statsTitle = document.querySelector('.widget-stats .stats-title');
  if (statsTitle) {
    statsTitle.style.cursor = 'pointer';
    statsTitle.title = 'Open Task Manager';
    statsTitle.addEventListener('click', async () => {
      if (window.__TAURI__?.core?.invoke) {
        try {
          await window.__TAURI__.core.invoke('open_task_manager');
        } catch (e) {
          console.error('[SystemStats] Failed to open Task Manager:', e);
        }
      }
    });
  }

  // Setup HD config button and dropdown
  const configBtn = document.getElementById('hd-config-btn');
  const dropdown = document.getElementById('hd-config-dropdown');

  if (configBtn && dropdown) {
    // Move dropdown to body for proper overflow handling (portal pattern)
    document.body.appendChild(dropdown);

    configBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('open');

      if (!isOpen) {
        // Position and show
        const btnRect = configBtn.getBoundingClientRect();
        dropdown.style.top = (btnRect.bottom + 4) + 'px';
        dropdown.style.left = (btnRect.right - 180) + 'px';
        dropdown.classList.add('open');
      } else {
        dropdown.classList.remove('open');
      }
    });

    // Handle option selection
    dropdown.addEventListener('click', (e) => {
      const option = e.target.closest('.stat-config-option');
      if (option) {
        const value = option.dataset.value;
        localStorage.setItem(HD_SOURCE_KEY, value);

        // Update selection state
        dropdown.querySelectorAll('.stat-config-option').forEach(opt => {
          opt.classList.toggle('selected', opt.dataset.value === value);
        });

        dropdown.classList.remove('open');
        fetchSystemStats(); // Refresh immediately
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !configBtn.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });
  } else {
    console.error('[SystemStats] Could not find button or dropdown elements!');
  }

  // Visibility-aware polling - pause when app is hidden to save CPU
  let statsIntervalId = null;

  function startStatsPolling() {
    if (statsIntervalId) return;
    fetchSystemStats();
    statsIntervalId = setInterval(fetchSystemStats, 2000);
  }

  function stopStatsPolling() {
    if (statsIntervalId) {
      clearInterval(statsIntervalId);
      statsIntervalId = null;
    }
  }

  // Start polling initially
  startStatsPolling();

  // Listen for visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopStatsPolling();
    } else {
      startStatsPolling();
    }
  });
}

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSystemStats);
} else {
  initSystemStats();
}
