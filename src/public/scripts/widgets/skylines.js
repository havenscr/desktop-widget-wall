/* ================================================================
   SKYLINES MODULE - Weather Widget Background Skylines
   Provides configurable city skyline backgrounds
   ================================================================ */

// Built-in skyline options
const BUILTIN_SKYLINES = [
  {
    id: 'seattle',
    name: 'Seattle',
    viewBox: '2.4 28 95.5 35.8',
    svg: '<path d="M2.4,54.8v9h95.5v-9.7h-1.2v0.9c0,0-0.6-0.1-1.1,0.4s-0.8,1.7-0.8,1.7l-0.5,1.2l-1.1-0.1L93,57l-0.6-0.4l-0.1-0.9h-1.7v-0.9h-0.5v-1.1H89l-0.4-0.6h-0.7v-2.4c0,0-0.4-0.7-1.3-0.7s-2.8,0-2.8,0s-0.7,0.4-0.9,0.6s-0.1,3.8-0.1,3.8l-0.4-0.5l-1.4,0.1l-0.7,0.6v-1.1L80,51.1l-0.3,0.1l-0.6,2.2l-0.1,0.7H78l0.1-0.8h-0.5l-0.1-5.1h-0.9v-2.8h-2.4h-0.5v-4.7h-1v-0.5L71,38.5l-1.4,1.9l-0.1,0.4l-1.1,0.1v13.1h-1V44h-5.4v9.1l-0.4-0.4v-3h-1.8V35.9h-0.7v-0.6h-3.3v0.6h-0.8V41h-0.4v0.8l-0.5,0.5v5.2h-0.5v0.8H53v6.9h-0.6V56h-0.6c0,0-1.2-11.9-1.1-14.1s0.8-7.8,1.1-7.9s0.4-0.6,0.4-0.6h1.4l0.1-0.5h-0.3l0.3-0.7c0,0,1.3,0.1,1.3,0s0-0.1,0-0.1l-1.1-0.4l-0.5-1.1l-1.9-0.6l-0.3-1.4H50l-0.5-5l-0.4,4.9l-1.4,0.1l-0.1,1.6l-2.4,0.8l-0.1,0.7l-1.2,0.6l1.3,0.3l0.1,0.6l-0.4,0.2l1.8,0.4c0,0,1.4,7.1,1.4,7.4c-0.7,0.1-4.1,0-4.1,0v4.1h-1.3V50h-1.6v0.9h-0.6V50h-3.2v-5.1h-0.6L36.6,44l-0.9-0.1l-0.4-0.8h-1.8L33.1,44l-0.8,0.1v1.3H32l-0.1,0.4h-0.5L30.5,46l0.1,0.8l-1.3,0.1l0.1,1.7l-0.5-0.1v-2.1h-2.6h-0.9h-2v4.6h-0.9V38.5h-0.8V38h-1c0,0,0.3-0.4,0-0.4s-1.3,0-1.3,0V39h-4v16.1h-1v-0.8h-0.6l-0.6-0.6l-0.6,0.6v0.8h-0.7v-1.8v-0.6L11,53.5h-0.5v1.9l-0.9,0.1V47H6.9v-0.6H4.5V47H3.3v8.3L2.4,54.8z"/>',
    builtin: true
  },
  {
    id: 'none',
    name: 'None',
    viewBox: null,
    svg: null,
    builtin: true
  }
];

// LocalStorage keys
const SKYLINE_STORAGE_KEY = 'widget-weather-skyline';
const CUSTOM_SKYLINES_KEY = 'widget-weather-custom-skylines';

// Load custom skylines from localStorage
function loadCustomSkylines() {
  try {
    const stored = localStorage.getItem(CUSTOM_SKYLINES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error('Failed to load custom skylines:', e);
    return [];
  }
}

// Save custom skylines to localStorage
function saveCustomSkylines(skylines) {
  localStorage.setItem(CUSTOM_SKYLINES_KEY, JSON.stringify(skylines));
  rebuildRegistry();
}

// Build the full registry (built-in + custom)
function rebuildRegistry() {
  const custom = loadCustomSkylines();
  // Insert custom skylines before "None"
  const none = BUILTIN_SKYLINES.find(s => s.id === 'none');
  const others = BUILTIN_SKYLINES.filter(s => s.id !== 'none');
  window.SkylineRegistry = [...others, ...custom, none];
}

// Initialize registry
rebuildRegistry();

// Get the currently selected skyline ID
function getSelectedSkylineId() {
  return localStorage.getItem(SKYLINE_STORAGE_KEY) || 'seattle';
}

// Set the selected skyline ID
function setSelectedSkylineId(id) {
  localStorage.setItem(SKYLINE_STORAGE_KEY, id);
}

// Get skyline config by ID
function getSkylineById(id) {
  return window.SkylineRegistry.find(s => s.id === id) || window.SkylineRegistry[0];
}

// Render the skyline SVG into a container
function renderSkyline(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const skylineId = getSelectedSkylineId();
  const skyline = getSkylineById(skylineId);

  if (!skyline || !skyline.svg) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = '';
  container.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="${skyline.viewBox}" preserveAspectRatio="xMidYMax slice">
      ${skyline.svg}
    </svg>
  `;
}

// Add a custom skyline
function addCustomSkyline(name, svgContent, viewBox) {
  const custom = loadCustomSkylines();
  const id = 'custom-' + Date.now();
  custom.push({
    id,
    name,
    viewBox,
    svg: svgContent,
    builtin: false
  });
  saveCustomSkylines(custom);
  return id;
}

// Delete a custom skyline
function deleteCustomSkyline(id) {
  const custom = loadCustomSkylines();
  const filtered = custom.filter(s => s.id !== id);
  saveCustomSkylines(filtered);
  // If the deleted skyline was selected, switch to Seattle
  if (getSelectedSkylineId() === id) {
    setSelectedSkylineId('seattle');
  }
}

// Parse SVG file content and extract paths/shapes
function parseSvgContent(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (!svg) {
    throw new Error('No SVG element found');
  }

  // Get the viewBox or compute from width/height
  let viewBox = svg.getAttribute('viewBox');
  if (!viewBox) {
    const width = svg.getAttribute('width') || '100';
    const height = svg.getAttribute('height') || '100';
    viewBox = `0 0 ${parseFloat(width)} ${parseFloat(height)}`;
  }

  // Extract inner content (paths, groups, etc.)
  const innerContent = svg.innerHTML;

  return { viewBox, svg: innerContent };
}

// Expose functions globally
window.SkylineUtils = {
  getSelectedSkylineId,
  setSelectedSkylineId,
  getSkylineById,
  renderSkyline,
  addCustomSkyline,
  deleteCustomSkyline,
  parseSvgContent,
  rebuildRegistry,
  loadCustomSkylines,
  STORAGE_KEY: SKYLINE_STORAGE_KEY
};
