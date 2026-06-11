/* ================================================================
   NOW PLAYING MODULE
   Windows Media Session integration via Tauri backend
   Copyright (c) 2024-2025 Havens Consulting Inc. All Rights Reserved.
   Fingerprint: AE-WWD-8B4F2C1E | analyticendeavors.com
   ================================================================ */

let isTauriAvailable = false;
let nowPlayingInterval = null;
let lastAlbumArtHash = null;
let currentDuration = 0; // Store duration for seek calculations
let currentTrackId = null; // Track ID for like functionality
let likedTracks = {}; // Store liked tracks in memory (persisted to localStorage)

// Now Playing background config
let nowPlayingConfig = {
  background: 'none',  // 'none' | 'album-blur' | 'color-mesh' | 'svg'
  customSvg: null,
  albumBlur: 11,       // Default blur for album-blur background
  colorMeshBlur: 0,    // Default blur for color-mesh background
  svgBlur: 0           // Default blur for custom SVG background
};

// Load saved config
const savedNowPlayingConfig = localStorage.getItem('nowplaying-config');
if (savedNowPlayingConfig) {
  try {
    nowPlayingConfig = JSON.parse(savedNowPlayingConfig);
  } catch (e) {
    console.warn('Failed to parse now playing config:', e);
  }
}

function applyNowPlayingBackground(bgType) {
  const widget = document.querySelector('.widget-nowplaying');
  if (widget) {
    if (bgType && bgType !== 'none') {
      widget.setAttribute('data-bg', bgType);

      // Apply blur based on background type
      if (bgType === 'album-blur') {
        const blurVal = nowPlayingConfig.albumBlur ?? 11;
        widget.style.setProperty('--nowplaying-album-blur', `${blurVal}px`);
        widget.style.setProperty('--nowplaying-album-blur-scale', blurVal * 0.007);
      } else if (bgType === 'color-mesh') {
        const blurVal = nowPlayingConfig.colorMeshBlur ?? 0;
        widget.style.setProperty('--nowplaying-colormesh-blur', `${blurVal}px`);
      } else if (bgType === 'svg') {
        if (nowPlayingConfig.customSvg) {
          widget.style.setProperty('--nowplaying-custom-svg', `url("${nowPlayingConfig.customSvg}")`);
        }
        const blurVal = nowPlayingConfig.svgBlur ?? 0;
        widget.style.setProperty('--nowplaying-svg-blur', `${blurVal}px`);
        widget.style.setProperty('--nowplaying-svg-blur-scale', blurVal * 0.007);
      }
    } else {
      widget.removeAttribute('data-bg');
      widget.style.removeProperty('--nowplaying-custom-svg');
      widget.style.removeProperty('--nowplaying-album-blur');
      widget.style.removeProperty('--nowplaying-album-blur-scale');
      widget.style.removeProperty('--nowplaying-colormesh-blur');
      widget.style.removeProperty('--nowplaying-svg-blur');
      widget.style.removeProperty('--nowplaying-svg-blur-scale');
    }
  }
  // Toggle color mesh animation based on current setting
  // Use setTimeout to ensure DOM is ready
  setTimeout(() => {
    if (bgType === 'color-mesh') {
      // Initialize with default colors if no album art yet
      updateColorMesh(null, null);
    } else {
      stopColorMeshAnimation();
    }
  }, 100);
}

// Update album blur background with current album art
// Accepts either base64 data (albumArtBase64 + albumArtMime) or a URL (imageUrl)
function updateAlbumBlurBackground(albumArtBase64, albumArtMime, imageUrl = null) {
  const blurBg = document.getElementById('nowplaying-blur-bg');
  if (!blurBg) return;

  if (nowPlayingConfig.background === 'album-blur') {
    if (imageUrl) {
      // Use URL directly (for Twitch/YouTube thumbnails)
      blurBg.style.backgroundImage = `url("${imageUrl}")`;
    } else if (albumArtBase64 && albumArtMime) {
      // Use base64 data (for Spotify/other sources)
      blurBg.style.backgroundImage = `url("data:${albumArtMime};base64,${albumArtBase64}")`;
    }
  } else {
    blurBg.style.backgroundImage = '';
  }
}

// ================================================================
// COLOR MESH BACKGROUND - Ambient gradient from album colors
// ================================================================

// Color mesh animation state
let colorMeshAnimationId = null;
let colorMeshColors = null;
let colorMeshBlobs = [];

// Extract dominant colors from an image using canvas sampling
function extractColorsFromImage(imgSrc) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const size = 50; // Sample at small size for performance
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);

      try {
        const imageData = ctx.getImageData(0, 0, size, size).data;
        const colors = quantizeColors(imageData, 5); // Extract 5 dominant colors
        resolve(colors);
      } catch (e) {
        console.log('Color extraction failed:', e);
        resolve(getDefaultMeshColors());
      }
    };
    img.onerror = () => resolve(getDefaultMeshColors());
    img.src = imgSrc;
  });
}

// Simple color quantization using modified median cut
function quantizeColors(imageData, numColors) {
  const pixels = [];
  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    const a = imageData[i + 3];
    // Skip transparent or very dark pixels
    if (a > 128 && (r + g + b) > 30) {
      pixels.push({ r, g, b });
    }
  }

  if (pixels.length < numColors) {
    return getDefaultMeshColors();
  }

  // Simple k-means-like clustering
  const clusters = [];
  const step = Math.floor(pixels.length / numColors);
  for (let i = 0; i < numColors; i++) {
    const idx = i * step;
    clusters.push({
      r: pixels[idx].r,
      g: pixels[idx].g,
      b: pixels[idx].b,
      count: 0,
      sumR: 0,
      sumG: 0,
      sumB: 0
    });
  }

  // Assign pixels to nearest cluster and recalculate centers
  for (let iter = 0; iter < 3; iter++) {
    // Reset sums
    clusters.forEach(c => {
      c.count = 0;
      c.sumR = 0;
      c.sumG = 0;
      c.sumB = 0;
    });

    // Assign pixels
    for (const pixel of pixels) {
      let minDist = Infinity;
      let nearestCluster = clusters[0];
      for (const cluster of clusters) {
        const dist = Math.pow(pixel.r - cluster.r, 2) +
                     Math.pow(pixel.g - cluster.g, 2) +
                     Math.pow(pixel.b - cluster.b, 2);
        if (dist < minDist) {
          minDist = dist;
          nearestCluster = cluster;
        }
      }
      nearestCluster.count++;
      nearestCluster.sumR += pixel.r;
      nearestCluster.sumG += pixel.g;
      nearestCluster.sumB += pixel.b;
    }

    // Update centers
    for (const cluster of clusters) {
      if (cluster.count > 0) {
        cluster.r = Math.round(cluster.sumR / cluster.count);
        cluster.g = Math.round(cluster.sumG / cluster.count);
        cluster.b = Math.round(cluster.sumB / cluster.count);
      }
    }
  }

  // Sort by vibrancy (saturation * brightness) and return
  return clusters
    .map(c => {
      const max = Math.max(c.r, c.g, c.b);
      const min = Math.min(c.r, c.g, c.b);
      const sat = max > 0 ? (max - min) / max : 0;
      const brightness = max / 255;
      return { ...c, vibrancy: sat * brightness };
    })
    .sort((a, b) => b.vibrancy - a.vibrancy)
    .map(c => ({ r: c.r, g: c.g, b: c.b }));
}

// Default theme-aware colors when no album art
function getDefaultMeshColors() {
  return [
    { r: 128, g: 64, b: 192 },  // Purple
    { r: 64, g: 128, b: 192 },  // Teal-blue
    { r: 192, g: 64, b: 128 },  // Pink
    { r: 64, g: 64, b: 128 },   // Dark blue
    { r: 96, g: 96, b: 160 }    // Muted purple
  ];
}

// Twitch-themed colors (purple/violet palette)
function getTwitchMeshColors() {
  return [
    { r: 145, g: 70, b: 255 },  // Twitch purple
    { r: 100, g: 65, b: 165 },  // Dark purple
    { r: 180, g: 100, b: 255 }, // Light purple
    { r: 70, g: 50, b: 120 },   // Deep violet
    { r: 130, g: 90, b: 200 }   // Mid purple
  ];
}

// YouTube-themed colors (red/dark palette)
function getYouTubeMeshColors() {
  return [
    { r: 255, g: 0, b: 0 },     // YouTube red
    { r: 180, g: 20, b: 20 },   // Dark red
    { r: 40, g: 40, b: 40 },    // Dark gray
    { r: 100, g: 30, b: 30 },   // Maroon
    { r: 60, g: 60, b: 60 }     // Medium gray
  ];
}

// Radio-themed colors (warm amber/gold palette)
function getRadioMeshColors() {
  return [
    { r: 253, g: 184, b: 0 },   // Gold
    { r: 200, g: 140, b: 20 },  // Amber
    { r: 160, g: 100, b: 40 },  // Bronze
    { r: 100, g: 70, b: 30 },   // Brown
    { r: 80, g: 60, b: 80 }     // Muted purple
  ];
}

// Initialize blob positions for animation
function initColorMeshBlobs(colors, width, height) {
  colorMeshBlobs = colors.map((color) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    radius: Math.min(width, height) * (0.4 + Math.random() * 0.3),
    color: color,
    phase: Math.random() * Math.PI * 2
  }));
}

// Render the color mesh on canvas
function renderColorMesh(canvas, ctx, time) {
  const width = canvas.width;
  const height = canvas.height;

  // Dark base with slight transparency
  ctx.fillStyle = 'rgba(15, 10, 25, 0.95)';
  ctx.fillRect(0, 0, width, height);

  // Update and draw each blob
  for (const blob of colorMeshBlobs) {
    // Gentle floating animation
    blob.x += blob.vx + Math.sin(time * 0.0005 + blob.phase) * 0.2;
    blob.y += blob.vy + Math.cos(time * 0.0004 + blob.phase) * 0.2;

    // Bounce off edges with padding
    const padding = blob.radius * 0.3;
    if (blob.x < -padding) blob.vx = Math.abs(blob.vx);
    if (blob.x > width + padding) blob.vx = -Math.abs(blob.vx);
    if (blob.y < -padding) blob.vy = Math.abs(blob.vy);
    if (blob.y > height + padding) blob.vy = -Math.abs(blob.vy);

    // Pulsating radius
    const pulseRadius = blob.radius * (1 + Math.sin(time * 0.001 + blob.phase) * 0.1);

    // Create radial gradient for soft blob
    const gradient = ctx.createRadialGradient(
      blob.x, blob.y, 0,
      blob.x, blob.y, pulseRadius
    );

    const { r, g, b } = blob.color;
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.6)`);
    gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.3)`);
    gradient.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, 0.1)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(blob.x, blob.y, pulseRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Overlay gradient for depth
  const overlayGradient = ctx.createLinearGradient(0, 0, width, height);
  overlayGradient.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
  overlayGradient.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
  overlayGradient.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
  ctx.fillStyle = overlayGradient;
  ctx.fillRect(0, 0, width, height);
}

// Animation loop for color mesh (30fps cap - ambient blobs don't need
// monitor refresh rate, and this canvas sits behind a backdrop-blurred widget)
let colorMeshLastFrame = 0;
const COLOR_MESH_FRAME_MS = 1000 / 30;

function animateColorMesh(canvas, ctx) {
  if (nowPlayingConfig.background !== 'color-mesh' || document.hidden) {
    colorMeshAnimationId = null;
    return;
  }

  colorMeshAnimationId = requestAnimationFrame(() => animateColorMesh(canvas, ctx));

  const time = performance.now();
  if (time - colorMeshLastFrame < COLOR_MESH_FRAME_MS) return;
  colorMeshLastFrame = time - ((time - colorMeshLastFrame) % COLOR_MESH_FRAME_MS);

  renderColorMesh(canvas, ctx, time);
}

// Update color mesh with new album art colors
// Accepts either base64 data (albumArtBase64 + albumArtMime) or a URL (imageUrl)
// sourceType hint: 'twitch', 'youtube', 'radio', or null for default fallback colors
async function updateColorMesh(albumArtBase64, albumArtMime, imageUrl = null, sourceType = null) {
  const canvas = document.getElementById('nowplaying-color-mesh');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Set canvas size to match widget at device resolution. All drawing math
  // (blob init + render) consistently uses canvas.width/height device pixels,
  // so no ctx.scale - scaling here while initializing blobs in device pixels
  // previously misplaced/oversized the blobs on scaled displays.
  const widget = canvas.closest('.widget-nowplaying');
  if (widget) {
    const rect = widget.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }

  // Get fallback colors based on source type
  function getFallbackColors() {
    switch (sourceType) {
      case 'twitch': return getTwitchMeshColors();
      case 'youtube': return getYouTubeMeshColors();
      case 'radio': return getRadioMeshColors();
      default: return getDefaultMeshColors();
    }
  }

  // Extract colors from album art or use source-appropriate defaults
  if (imageUrl) {
    // Use URL directly (for Twitch/YouTube thumbnails)
    // May fail due to CORS, so use fallback colors on error
    colorMeshColors = await extractColorsFromImage(imageUrl);
    // If extraction returned default colors (error case), use source-specific colors instead
    if (colorMeshColors === getDefaultMeshColors()) {
      colorMeshColors = getFallbackColors();
    }
  } else if (albumArtBase64 && albumArtMime) {
    // Use base64 data (for Spotify/other sources)
    const imgSrc = `data:${albumArtMime};base64,${albumArtBase64}`;
    colorMeshColors = await extractColorsFromImage(imgSrc);
  } else {
    colorMeshColors = getFallbackColors();
  }

  // Initialize blobs with new colors
  initColorMeshBlobs(colorMeshColors, canvas.width, canvas.height);

  // Start animation if not running and color-mesh is selected
  if (nowPlayingConfig.background === 'color-mesh' && !colorMeshAnimationId) {
    animateColorMesh(canvas, ctx);
  }
}

// Stop color mesh animation
function stopColorMeshAnimation() {
  if (colorMeshAnimationId) {
    cancelAnimationFrame(colorMeshAnimationId);
    colorMeshAnimationId = null;
  }
}

// Start or stop color mesh based on config
function toggleColorMeshAnimation() {
  const canvas = document.getElementById('nowplaying-color-mesh');
  if (!canvas) return;

  if (nowPlayingConfig.background === 'color-mesh') {
    const ctx = canvas.getContext('2d');
    if (ctx && colorMeshBlobs.length > 0 && !colorMeshAnimationId) {
      animateColorMesh(canvas, ctx);
    }
  } else {
    stopColorMeshAnimation();
  }
}

// Handle canvas resize when widget size changes
let colorMeshResizeObserver = null;
function setupColorMeshResizeObserver() {
  const canvas = document.getElementById('nowplaying-color-mesh');
  const widget = canvas?.closest('.widget-nowplaying');
  if (!widget || colorMeshResizeObserver) return;

  colorMeshResizeObserver = new ResizeObserver(() => {
    if (nowPlayingConfig.background === 'color-mesh' && colorMeshColors) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const rect = widget.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        // Reinitialize blobs for the new size (device pixels, matching the
        // unscaled render path)
        initColorMeshBlobs(colorMeshColors, canvas.width, canvas.height);
      }
    }
  });
  colorMeshResizeObserver.observe(widget);
}

// Force radio override - on window for cross-module access
// Only initialize if not already set by radio.js
if (typeof window.forceRadioOverride === 'undefined') {
  window.forceRadioOverride = false;
}

// Browser app names that might be playing Twitch audio
const BROWSER_APPS = ['chrome', 'firefox', 'edge', 'msedge', 'opera', 'brave', 'vivaldi', 'chromium', 'msedgewebview'];

// Path to black Twitch logo for Now Playing thumbnail
const TWITCH_LOGO_PATH = './assets/black-twitch-logo.svg';

// Regex to detect garbage hex session IDs (like "30804680AF4A39C8")
const HEX_GARBAGE_REGEX = /^[0-9A-Fa-f]{8,}$/;

// Check if a string is garbage data (hex IDs, empty, etc.)
function isGarbageData(str) {
  if (!str || str === '--') return true;
  const trimmed = str.trim();
  if (!trimmed) return true;
  // Check for hex session IDs (8+ hex chars)
  if (HEX_GARBAGE_REGEX.test(trimmed)) return true;
  // Check for numeric-only strings (timestamp-like garbage)
  if (/^\d{6,}$/.test(trimmed)) return true;
  return false;
}

// Clean a metadata field, returning null if garbage
function cleanMetadataField(str) {
  if (isGarbageData(str)) return null;
  return str.trim();
}

// Path to radio icon for Now Playing thumbnail
const RADIO_ICON_PATH = './assets/radio.svg';

// Threshold for detecting live streams (24 hours in seconds)
const LIVE_STREAM_DURATION_THRESHOLD = 24 * 60 * 60;

// Check if internal radio widget is playing
function isInternalRadioPlaying() {
  // Check both the state flag AND the actual audio element
  if (!window.radioState) {
    return false;
  }

  // Primary check: the state flag and station
  if (window.radioState.isPlaying && window.radioState.station) {
    dlog('Radio detected via state flag:', window.radioState.station.name);
    return true;
  }

  // Secondary check: if audio element exists and is actually playing
  const audio = window.radioState.audio;
  if (audio && !audio.paused && !audio.ended && audio.src) {
    dlog('Radio detected via audio element, paused:', audio.paused, 'src:', audio.src);
    return true;
  }

  return false;
}

// Get internal radio info for display
function getInternalRadioInfo() {
  if (!window.radioState || !window.radioState.station) return null;

  // Double-check radio is actually playing
  const isPlaying = window.radioState.isPlaying ||
    (window.radioState.audio && !window.radioState.audio.paused && window.radioState.audio.src);

  if (!isPlaying) return null;

  const station = window.radioState.station;
  return {
    title: station.name,
    artist: 'Internet Radio',
    album: station.genre || 'Live Stream',
    source: 'Radio',
    isLive: true
  };
}

// Check if Twitch is the active media source
// Can detect from: embedded player, or external browser playing Twitch
function isTwitchActive(sourceApp, mediaInfo = null) {
  // Check if source is a browser
  const isFromBrowser = sourceApp && BROWSER_APPS.some(browser =>
    sourceApp.toLowerCase().includes(browser)
  );

  // Check if smart widget is on Twitch page (page 0) - embedded player case
  const smartWidgetOnTwitch = window.SmartWidget &&
    window.SmartWidget.getConfig().currentPage === 0;

  // Check if media info suggests Twitch (works even without browser detection)
  // This handles cases where source_app is garbage but title clearly indicates Twitch
  let mediaSuggestsTwitch = false;
  if (mediaInfo) {
    const title = (mediaInfo.title || '').toLowerCase();
    const artist = (mediaInfo.artist || '').toLowerCase();
    mediaSuggestsTwitch = title.includes('- twitch') ||
                          title.endsWith('twitch') ||
                          artist.includes('twitch') ||
                          title.includes('on twitch');
  }

  // Return true if:
  // 1. Browser is playing AND smart widget is on Twitch OR
  // 2. Browser is playing AND media suggests Twitch OR
  // 3. Media clearly suggests Twitch (even if source app is garbage/unknown)
  return (isFromBrowser && (smartWidgetOnTwitch || mediaSuggestsTwitch)) || mediaSuggestsTwitch;
}

// Parse Twitch channel info from media title
// Handles multiple formats browsers may report:
// - "channelname - StreamTitle - Twitch"
// - "channelname - Twitch"
// - "StreamTitle - channelname on Twitch"
function parseTwitchFromMediaTitle(title) {
  if (!title) return null;

  // Format: "channelname - StreamTitle - Twitch"
  const fullMatch = title.match(/^(.+?)\s*-\s*(.+?)\s*-\s*Twitch$/i);
  if (fullMatch) {
    return {
      channel: fullMatch[1].trim(),
      streamTitle: fullMatch[2].trim()
    };
  }

  // Format: "channelname - Twitch"
  const simpleMatch = title.match(/^(.+?)\s*-\s*Twitch$/i);
  if (simpleMatch) {
    return {
      channel: simpleMatch[1].trim(),
      streamTitle: ''
    };
  }

  // Format: "StreamTitle - channelname on Twitch" (some browsers)
  const altMatch = title.match(/^(.+?)\s*-\s*(.+?)\s+on\s+Twitch$/i);
  if (altMatch) {
    return {
      channel: altMatch[2].trim(),
      streamTitle: altMatch[1].trim()
    };
  }

  // Check if title just contains "Twitch" somewhere
  if (title.toLowerCase().includes('twitch')) {
    // Try to extract anything before " - " as the channel
    const dashParts = title.split(/\s*-\s*/);
    if (dashParts.length >= 1) {
      const potentialChannel = dashParts[0].trim();
      if (potentialChannel && !potentialChannel.toLowerCase().includes('twitch')) {
        return {
          channel: potentialChannel,
          streamTitle: dashParts.length > 1 ? dashParts.slice(1, -1).join(' - ').trim() : ''
        };
      }
    }
  }

  return null;
}

// Attempt to fetch Twitch stream info for a channel detected from browser
// Uses the same Twitch API as the embedded player if user is logged in
async function fetchExternalTwitchInfo(channel) {
  const accessToken = localStorage.getItem('twitch-access-token');
  if (!accessToken || !channel) return null;

  const TWITCH_CLIENT_ID = '6og5fv8xx0tq8xw67itgl8whmoa5ru';

  try {
    // Fetch stream and user info in parallel
    const [streamRes, userRes] = await Promise.all([
      fetch(`https://api.twitch.tv/helix/streams?user_login=${channel}`, {
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        }
      }),
      fetch(`https://api.twitch.tv/helix/users?login=${channel}`, {
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        }
      })
    ]);

    if (!streamRes.ok || !userRes.ok) return null;

    const [streamData, userData] = await Promise.all([streamRes.json(), userRes.json()]);

    const stream = streamData.data?.[0];
    const user = userData.data?.[0];

    return {
      isLive: !!stream,
      channel: channel,
      displayName: user?.display_name || channel,
      streamTitle: stream?.title || '',
      gameName: stream?.game_name || '',
      viewerCount: stream?.viewer_count || 0,
      profileImageUrl: user?.profile_image_url || null,
      thumbnailUrl: stream?.thumbnail_url?.replace('{width}', '320').replace('{height}', '180') || null
    };
  } catch (e) {
    console.log('Failed to fetch external Twitch info:', e);
    return null;
  }
}

// Get Twitch channel info for display
function getTwitchDisplayInfo() {
  // Try to get channel from twitch config
  const twitchConfig = JSON.parse(localStorage.getItem('twitch-config') || '{}');
  const channel = twitchConfig.channel || 'Twitch';
  return {
    channel: channel,
    displayName: channel.charAt(0).toUpperCase() + channel.slice(1)
  };
}

// Check if YouTube is the active media source
function isYouTubeActive(sourceApp, mediaInfo = null) {
  // Check if source is a browser
  const isFromBrowser = sourceApp && BROWSER_APPS.some(browser =>
    sourceApp.toLowerCase().includes(browser)
  );

  if (!isFromBrowser || !mediaInfo) return false;

  const title = (mediaInfo.title || '').toLowerCase();
  const artist = (mediaInfo.artist || '').toLowerCase();

  // YouTube media typically has artist as channel name or "YouTube" in metadata
  // Common patterns: "- YouTube" suffix, artist contains youtube-like channel names
  const hasYouTubeIndicator =
    title.includes('- youtube') ||
    title.endsWith('youtube') ||
    artist.includes('youtube') ||
    // YouTube Music patterns
    title.includes('- youtube music') ||
    // Common YouTube live radio patterns
    title.includes('radio') ||
    title.includes('lofi') ||
    title.includes('synthwave') ||
    title.includes('24/7') ||
    title.includes('live stream');

  return hasYouTubeIndicator;
}

// Check if media appears to be a live stream based on duration
function isLiveStream(mediaInfo) {
  if (!mediaInfo) return false;

  const duration = mediaInfo.duration_seconds;
  const position = mediaInfo.position_seconds;

  // Live streams often have very long durations (> 24 hours)
  if (duration && duration > LIVE_STREAM_DURATION_THRESHOLD) {
    return true;
  }

  // Some live streams report position equal to duration (constantly updating)
  if (duration && position && Math.abs(duration - position) < 5) {
    return true;
  }

  return false;
}

// Parse YouTube channel/video info from media title
function parseYouTubeFromMediaTitle(title, artist) {
  if (!title) return null;

  // Common format: "Video Title - Channel Name"
  // Or just use artist as channel name
  let channel = artist || 'YouTube';
  let videoTitle = title;

  // Remove " - YouTube" suffix if present
  videoTitle = videoTitle.replace(/\s*-\s*youtube$/i, '').trim();

  // If title has " - ChannelName" pattern and no artist, try to extract
  if (!artist || artist === '--') {
    const dashMatch = title.match(/^(.+?)\s+-\s+(.+?)(?:\s+-\s+youtube)?$/i);
    if (dashMatch) {
      videoTitle = dashMatch[1].trim();
      channel = dashMatch[2].trim();
    }
  }

  return {
    channel: channel,
    videoTitle: videoTitle
  };
}

// Check if running in Tauri
function checkTauriAvailable() {
  return typeof window.__TAURI__ !== 'undefined';
}

// Format seconds to MM:SS
function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Simple hash for comparing album art changes (avoid flicker on re-render)
function hashString(str) {
  if (!str) return null;
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 100); i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// Generate a track ID from title and artist
function generateTrackId(title, artist) {
  if (!title) return null;
  return `${title}-${artist || 'unknown'}`.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

// Load liked tracks from localStorage
function loadLikedTracks() {
  try {
    const stored = localStorage.getItem('nowplaying-liked-tracks');
    if (stored) {
      likedTracks = JSON.parse(stored);
    }
  } catch (e) {
    console.log('Failed to load liked tracks:', e);
    likedTracks = {};
  }
}

// Save liked tracks to localStorage
function saveLikedTracks() {
  try {
    localStorage.setItem('nowplaying-liked-tracks', JSON.stringify(likedTracks));
  } catch (e) {
    console.log('Failed to save liked tracks:', e);
  }
}

// Toggle like status for current track
function toggleLike() {
  if (!currentTrackId) return;

  const likeBtn = document.getElementById('nowplaying-like');
  if (!likeBtn) return;

  const wasLiked = likedTracks[currentTrackId];

  if (wasLiked) {
    delete likedTracks[currentTrackId];
    likeBtn.classList.remove('active');
    likeBtn.title = 'Like this track';
  } else {
    likedTracks[currentTrackId] = { timestamp: Date.now() };
    likeBtn.classList.add('active');
    likeBtn.title = 'Unlike this track';
  }

  // Update icon visibility
  const likeOff = likeBtn.querySelector('.like-off');
  const likeOn = likeBtn.querySelector('.like-on');
  if (likeOff) likeOff.style.display = wasLiked ? 'block' : 'none';
  if (likeOn) likeOn.style.display = wasLiked ? 'none' : 'block';

  saveLikedTracks();
}

// Update like button state based on current track
function updateLikeButton() {
  const likeBtn = document.getElementById('nowplaying-like');
  if (!likeBtn || !currentTrackId) return;

  const isLiked = likedTracks[currentTrackId];
  likeBtn.classList.toggle('active', !!isLiked);
  likeBtn.title = isLiked ? 'Unlike this track' : 'Like this track';

  const likeOff = likeBtn.querySelector('.like-off');
  const likeOn = likeBtn.querySelector('.like-on');
  if (likeOff) likeOff.style.display = isLiked ? 'none' : 'block';
  if (likeOn) likeOn.style.display = isLiked ? 'block' : 'none';
}

// Update the widget UI with now playing info
function updateNowPlayingUI(info) {
  const elements = {
    source: document.getElementById('nowplaying-source'),
    title: document.getElementById('nowplaying-title'),
    artist: document.getElementById('nowplaying-artist'),
    album: document.getElementById('nowplaying-album'),
    art: document.getElementById('nowplaying-art'),
    progressFill: document.getElementById('nowplaying-progress-fill'),
    timeCurrent: document.getElementById('nowplaying-time-current'),
    timeTotal: document.getElementById('nowplaying-time-total'),
    statusIndicator: document.getElementById('nowplaying-status-indicator'),
    playPauseBtn: document.getElementById('nowplaying-playpause')
  };

  // PRIORITY CHECK: If radio override is active, display radio info IMMEDIATELY
  // This takes absolute priority over any Tauri backend data
  if (window.forceRadioOverride === true) {
    console.log('RADIO OVERRIDE ACTIVE - forcing radio display');
    const station = window.radioState?.station;
    const radioTitle = station?.name || 'Radio';
    const radioGenre = station?.genre || 'Live Stream';

    // Set all display elements for radio
    if (elements.source) elements.source.textContent = 'Radio';
    if (elements.title) {
      elements.title.textContent = radioTitle;
      elements.title.title = radioTitle;
    }
    if (elements.artist) {
      elements.artist.textContent = 'Internet Radio';
      elements.artist.title = 'Internet Radio';
    }
    if (elements.album) {
      elements.album.textContent = radioGenre;
      elements.album.title = radioGenre;
    }
    if (elements.progressFill) elements.progressFill.style.width = '0%';
    if (elements.timeCurrent) elements.timeCurrent.innerHTML = '<span class="live-dot"></span> LIVE';
    if (elements.timeTotal) elements.timeTotal.textContent = '';
    if (elements.statusIndicator) {
      elements.statusIndicator.classList.add('playing');
      elements.statusIndicator.classList.remove('paused');
    }

    // Update play/pause icon
    if (elements.playPauseBtn) {
      const playIcon = elements.playPauseBtn.querySelector('.play-icon');
      const pauseIcon = elements.playPauseBtn.querySelector('.pause-icon');
      if (playIcon) playIcon.style.display = 'none';
      if (pauseIcon) pauseIcon.style.display = 'block';
    }

    // Set album art to radio icon with theme gradient background
    if (elements.art) {
      elements.art.innerHTML = `
        <div class="nowplaying-radio-art">
          <img src="${RADIO_ICON_PATH}" alt="Radio">
        </div>
      `;
      elements.art.classList.add('has-art', 'radio-art');
      elements.art.classList.remove('twitch-art');
    }
    lastAlbumArtHash = null;

    // Update backgrounds for radio - use radio icon for album blur
    updateAlbumBlurBackground(null, null, RADIO_ICON_PATH);
    updateColorMesh(null, null, null, 'radio');

    return; // EXIT EARLY - don't process Tauri data at all
  }

  // Check for internal radio first (highest priority - user's explicit choice)
  // Use window.forceRadioOverride flag OR detection functions
  const internalRadioActive = isInternalRadioPlaying();
  const internalRadioInfo = getInternalRadioInfo();

  dlog('updateNowPlayingUI - window.forceRadioOverride:', window.forceRadioOverride, 'internalRadioActive:', internalRadioActive, 'info.source_app:', info?.source_app);

  // Check for Twitch as source - override display when active
  const twitchActive = !internalRadioActive && isTwitchActive(info.source_app, info);

  // Check for YouTube as source
  const youtubeActive = !internalRadioActive && !twitchActive && isYouTubeActive(info.source_app, info);

  // Check if this is a live stream (works for any source)
  const liveStreamActive = internalRadioActive || isLiveStream(info);

  // Get Twitch info - prefer embedded player info, fallback to parsing media title
  let twitchInfo = window.twitchStreamInfo;
  let twitchFromMediaTitle = null;

  // If Twitch detected from external browser, parse channel/title from media info
  if (twitchActive && (!twitchInfo || !twitchInfo.isLive)) {
    twitchFromMediaTitle = parseTwitchFromMediaTitle(info.title);
    if (twitchFromMediaTitle) {
      twitchInfo = {
        channel: twitchFromMediaTitle.channel.toLowerCase(),
        displayName: twitchFromMediaTitle.channel,
        streamTitle: twitchFromMediaTitle.streamTitle,
        isLive: true,
        profileImageUrl: null,
        gameName: null,
        thumbnailUrl: null
      };

      // Attempt to fetch richer info from Twitch API (async, will update on next poll)
      // Store channel for async fetch if we have login
      if (localStorage.getItem('twitch-access-token') && !window._lastExternalTwitchChannel) {
        window._lastExternalTwitchChannel = twitchFromMediaTitle.channel.toLowerCase();
        fetchExternalTwitchInfo(twitchFromMediaTitle.channel.toLowerCase()).then(apiInfo => {
          if (apiInfo && apiInfo.channel === window._lastExternalTwitchChannel) {
            // Update global twitchStreamInfo with API data
            window.twitchStreamInfo = {
              ...window.twitchStreamInfo,
              ...apiInfo
            };
            window.dispatchEvent(new CustomEvent('twitch-stream-update', { detail: window.twitchStreamInfo }));
          }
        });
      }
    }
  }

  // Fallback to stored config
  if (!twitchInfo || !twitchInfo.channel) {
    twitchInfo = getTwitchDisplayInfo();
  }

  // Clear external channel tracking when not watching Twitch
  if (!twitchActive) {
    window._lastExternalTwitchChannel = null;
  }

  // Get YouTube info if active
  let youtubeInfo = null;
  if (youtubeActive) {
    youtubeInfo = parseYouTubeFromMediaTitle(info.title, info.artist);
  }

  // Display values - priority: Internal Radio > Twitch > YouTube > Other
  // Clean garbage data from source_app (hex IDs, etc.)
  let displaySource = cleanMetadataField(info.source_app) || '--';
  let displayTitle = info.title || 'No Media Playing';
  let displayArtist = cleanMetadataField(info.artist) || '--';
  let displayAlbum = cleanMetadataField(info.album) || '--';

  if (internalRadioActive && internalRadioInfo) {
    // Internal radio widget is playing
    displaySource = internalRadioInfo.source;
    displayTitle = internalRadioInfo.title;
    displayArtist = internalRadioInfo.artist;
    displayAlbum = internalRadioInfo.album;
  } else if (twitchActive && twitchInfo && twitchInfo.channel) {
    // Twitch override format:
    // Title: Channel name (e.g., Anyamemby)
    // Artist: Stream title (e.g., Learning How to Fight Pt. 2)
    // Album: Game name (e.g., Kingdom Come: Deliverance) or "Twitch" fallback
    displaySource = 'Twitch';
    displayTitle = twitchInfo.displayName || twitchInfo.channel;
    displayArtist = twitchInfo.streamTitle || 'Live Stream';
    displayAlbum = twitchInfo.gameName || 'Twitch';
  } else if (youtubeActive && youtubeInfo) {
    // YouTube override format
    displaySource = 'YouTube';
    displayTitle = youtubeInfo.videoTitle || info.title;
    displayArtist = cleanMetadataField(info.artist) || youtubeInfo.channel || '--';
    displayAlbum = liveStreamActive ? 'Live Stream' : (cleanMetadataField(info.album) || 'YouTube');
  }

  // Source app
  if (elements.source) {
    elements.source.textContent = displaySource;
  }

  // Track info
  if (elements.title) {
    elements.title.textContent = displayTitle;
    elements.title.title = displayTitle;
  }
  if (elements.artist) {
    elements.artist.textContent = displayArtist;
    elements.artist.title = displayArtist;
  }
  if (elements.album) {
    elements.album.textContent = displayAlbum;
    elements.album.title = displayAlbum;
  }

  // Album art - only update if changed (avoid flicker)
  // The backend omits the art bytes and sets art_unchanged while the track
  // key is stable, so skip the whole art/background path in that case. Only
  // honor the flag for plain media: Twitch/radio art comes from other sources
  // (API thumbnails, local icons) that can change independently of the track.
  const skipArtUpdate = info.art_unchanged === true && !twitchActive && !internalRadioActive;
  // Include thumbnail URL in hash to update art when API provides thumbnail
  const twitchThumbnail = twitchActive && twitchInfo ? twitchInfo.thumbnailUrl : null;
  const artHashKey = twitchActive
    ? 'twitch-' + (twitchInfo.channel || '') + '-' + (twitchThumbnail || 'logo')
    : info.album_art_base64;
  const newArtHash = hashString(artHashKey);

  if (!skipArtUpdate && newArtHash !== lastAlbumArtHash) {
    lastAlbumArtHash = newArtHash;
    if (elements.art) {
      if (info.album_art_base64 && info.album_art_mime && !twitchActive) {
        // Has actual album art (and not Twitch)
        elements.art.innerHTML = `<img src="data:${info.album_art_mime};base64,${info.album_art_base64}" alt="Album Art">`;
        elements.art.classList.add('has-art');
        elements.art.classList.remove('twitch-art', 'radio-art');
      } else if (twitchActive) {
        // Twitch is playing - prefer stream thumbnail from API, fallback to logo
        if (twitchThumbnail) {
          // Use stream thumbnail from Twitch API
          elements.art.innerHTML = `
            <div class="nowplaying-twitch-art nowplaying-twitch-thumbnail">
              <img src="${twitchThumbnail}" alt="${twitchInfo.displayName || 'Twitch'} stream">
            </div>
          `;
        } else {
          // Fallback to Twitch logo with theme gradient background
          elements.art.innerHTML = `
            <div class="nowplaying-twitch-art">
              <img src="${TWITCH_LOGO_PATH}" alt="Twitch">
            </div>
          `;
        }
        elements.art.classList.add('has-art', 'twitch-art');
        elements.art.classList.remove('radio-art');
      } else {
        // Generic placeholder
        elements.art.innerHTML = `
          <svg class="nowplaying-art-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        `;
        elements.art.classList.remove('has-art', 'twitch-art', 'radio-art');
      }
    }
    // Update backgrounds when art changes
    // Determine the image source: URL for Twitch/YouTube thumbnails, or base64 for others
    let backgroundImageUrl = null;
    let sourceType = null;

    if (internalRadioActive) {
      sourceType = 'radio';
      backgroundImageUrl = RADIO_ICON_PATH; // Use radio icon for album blur
    } else if (twitchActive) {
      sourceType = 'twitch';
      if (twitchThumbnail) {
        backgroundImageUrl = twitchThumbnail;
      }
    } else if (youtubeActive) {
      sourceType = 'youtube';
      // YouTube doesn't provide thumbnails via media session, uses fallback colors
    }

    // Update album blur background
    updateAlbumBlurBackground(info.album_art_base64, info.album_art_mime, backgroundImageUrl);
    // Update color mesh background with source type for appropriate fallback colors
    updateColorMesh(info.album_art_base64, info.album_art_mime, backgroundImageUrl, sourceType);
  }

  // Profile image overlay (Twitch streamer avatar)
  const profileOverlay = document.getElementById('nowplaying-profile-overlay');
  const profileImg = document.getElementById('nowplaying-profile-img');
  if (profileOverlay && profileImg) {
    if (twitchActive && twitchInfo && twitchInfo.profileImageUrl) {
      profileImg.src = twitchInfo.profileImageUrl;
      profileOverlay.style.display = 'block';
    } else {
      profileOverlay.style.display = 'none';
      profileImg.src = '';
    }
  }

  // Progress bar
  if (twitchActive || liveStreamActive) {
    // Live stream - no progress bar
    if (elements.progressFill) {
      elements.progressFill.style.width = '0%';
    }
  } else if (elements.progressFill && info.position_seconds != null && info.duration_seconds != null && info.duration_seconds > 0) {
    const progress = (info.position_seconds / info.duration_seconds) * 100;
    elements.progressFill.style.width = `${Math.min(100, progress)}%`;
  } else if (elements.progressFill) {
    elements.progressFill.style.width = '0%';
  }

  // Time display
  if (twitchActive || liveStreamActive) {
    // Live stream - show LIVE indicator with red dot
    if (elements.timeCurrent) {
      elements.timeCurrent.innerHTML = '<span class="live-dot"></span> LIVE';
    }
    if (elements.timeTotal) {
      elements.timeTotal.textContent = '';
    }
  } else {
    if (elements.timeCurrent) {
      elements.timeCurrent.textContent = formatTime(info.position_seconds);
    }
    if (elements.timeTotal) {
      elements.timeTotal.textContent = formatTime(info.duration_seconds);
    }
  }

  // Playback status indicator
  if (elements.statusIndicator) {
    elements.statusIndicator.classList.toggle('playing', info.playback_status === 'playing');
    elements.statusIndicator.classList.toggle('paused', info.playback_status === 'paused');
  }

  // Play/Pause button icon
  if (elements.playPauseBtn) {
    const playIcon = elements.playPauseBtn.querySelector('.play-icon');
    const pauseIcon = elements.playPauseBtn.querySelector('.pause-icon');
    if (info.playback_status === 'playing') {
      if (playIcon) playIcon.style.display = 'none';
      if (pauseIcon) pauseIcon.style.display = 'block';
    } else {
      if (playIcon) playIcon.style.display = 'block';
      if (pauseIcon) pauseIcon.style.display = 'none';
    }
  }

  // Shuffle button state
  const shuffleBtn = document.getElementById('nowplaying-shuffle');
  if (shuffleBtn) {
    shuffleBtn.classList.toggle('active', info.shuffle_active === true);
    shuffleBtn.title = info.shuffle_active ? 'Shuffle On' : 'Shuffle Off';
  }

  // Repeat button state
  const repeatBtn = document.getElementById('nowplaying-repeat');
  if (repeatBtn) {
    const repeatOff = repeatBtn.querySelector('.repeat-off');
    const repeatList = repeatBtn.querySelector('.repeat-list');
    const repeatTrack = repeatBtn.querySelector('.repeat-track');

    // Hide all icons first
    if (repeatOff) repeatOff.style.display = 'none';
    if (repeatList) repeatList.style.display = 'none';
    if (repeatTrack) repeatTrack.style.display = 'none';

    // Show the appropriate icon and set active state
    repeatBtn.classList.remove('active', 'active-one');
    switch (info.repeat_mode) {
      case 'list':
        if (repeatList) repeatList.style.display = 'block';
        repeatBtn.classList.add('active');
        repeatBtn.title = 'Repeat All';
        break;
      case 'track':
        if (repeatTrack) repeatTrack.style.display = 'block';
        repeatBtn.classList.add('active', 'active-one');
        repeatBtn.title = 'Repeat One';
        break;
      default:
        if (repeatOff) repeatOff.style.display = 'block';
        repeatBtn.title = 'Repeat Off';
    }
  }

  // Store duration for seek calculations
  if (info.duration_seconds != null) {
    currentDuration = info.duration_seconds;
  }

  // Update track ID and like button state
  const newTrackId = generateTrackId(info.title, info.artist);
  if (newTrackId !== currentTrackId) {
    currentTrackId = newTrackId;
    updateLikeButton();
  }
}

// Fetch now playing info from Tauri backend
async function fetchNowPlaying() {
  if (!isTauriAvailable) return;

  try {
    const { invoke } = window.__TAURI__.core;
    const info = await invoke('get_now_playing');
    updateNowPlayingUI(info);
  } catch (e) {
    console.log('Failed to fetch now playing:', e);
    updateNowPlayingUI({
      title: 'Error fetching media',
      artist: '--',
      playback_status: 'unknown'
    });
  }
}

// Setup playback control buttons
function setupControls() {
  if (!isTauriAvailable) return;

  const { invoke } = window.__TAURI__.core;

  const prevBtn = document.getElementById('nowplaying-prev');
  const playPauseBtn = document.getElementById('nowplaying-playpause');
  const nextBtn = document.getElementById('nowplaying-next');
  const shuffleBtn = document.getElementById('nowplaying-shuffle');
  const repeatBtn = document.getElementById('nowplaying-repeat');
  const progressBar = document.getElementById('nowplaying-progress');

  prevBtn?.addEventListener('click', async () => {
    try {
      await invoke('media_previous');
      setTimeout(fetchNowPlaying, 300); // Refresh after action
    } catch (e) {
      console.log('Previous failed:', e);
    }
  });

  playPauseBtn?.addEventListener('click', async () => {
    try {
      await invoke('media_play_pause');
      setTimeout(fetchNowPlaying, 300);
    } catch (e) {
      console.log('Play/Pause failed:', e);
    }
  });

  nextBtn?.addEventListener('click', async () => {
    try {
      await invoke('media_next');
      setTimeout(fetchNowPlaying, 300);
    } catch (e) {
      console.log('Next failed:', e);
    }
  });

  // Shuffle toggle
  shuffleBtn?.addEventListener('click', async () => {
    try {
      const newState = await invoke('media_toggle_shuffle');
      shuffleBtn.classList.toggle('active', newState);
      setTimeout(fetchNowPlaying, 300);
    } catch (e) {
      console.log('Shuffle toggle failed:', e);
    }
  });

  // Repeat cycle (none -> list -> track -> none)
  repeatBtn?.addEventListener('click', async () => {
    try {
      await invoke('media_cycle_repeat');
      setTimeout(fetchNowPlaying, 300);
    } catch (e) {
      console.log('Repeat cycle failed:', e);
    }
  });

  // Seekable progress bar
  progressBar?.addEventListener('click', async (e) => {
    if (currentDuration <= 0) return;

    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const seekPosition = percentage * currentDuration;

    try {
      await invoke('media_seek', { positionSeconds: seekPosition });
      // Update UI immediately for responsiveness
      const progressFill = document.getElementById('nowplaying-progress-fill');
      if (progressFill) {
        progressFill.style.width = `${percentage * 100}%`;
      }
      setTimeout(fetchNowPlaying, 300);
    } catch (e) {
      console.log('Seek failed:', e);
    }
  });

  // Like button (works even without Tauri - stores locally)
  const likeBtn = document.getElementById('nowplaying-like');
  likeBtn?.addEventListener('click', toggleLike);
}

// Handle radio state changes immediately
function handleRadioStateChange(event) {
  const radioState = event.detail;
  const content = document.getElementById('nowplaying-content');
  const fallback = document.getElementById('nowplaying-fallback');

  console.log('Radio state change event received:', radioState.isPlaying, radioState.station?.name);

  if (radioState.isPlaying) {
    // Set the override flag so updateNowPlayingUI knows to show radio
    window.forceRadioOverride = true;

    // Show the now playing content when radio is playing
    if (content) content.style.display = '';
    if (fallback) fallback.style.display = 'none';

    // Update UI with radio info
    updateNowPlayingUI({
      title: radioState.station?.name || 'Radio',
      artist: 'Internet Radio',
      album: radioState.station?.genre || 'Live Stream',
      source_app: 'Radio',
      playback_status: 'playing'
    });
  } else {
    // Radio stopped - clear the override
    window.forceRadioOverride = false;

    if (!isTauriAvailable) {
      // Radio stopped and no Tauri - show fallback
      if (fallback) fallback.style.display = 'flex';
      if (content) content.style.display = 'none';
    }
  }
}

// Initialize the widget
function initNowPlayingBackground() {
  // Apply saved background on load
  applyNowPlayingBackground(nowPlayingConfig.background);

  // Setup resize observer for color mesh canvas
  setupColorMeshResizeObserver();

  // Temporary SVG storage for modal
  let pendingSvg = nowPlayingConfig.customSvg;

  // Helper to get modal elements
  function getModalElements() {
    return {
      modal: document.getElementById('nowplaying-modal'),
      svgUpload: document.getElementById('nowplaying-svg-upload'),
      svgInput: document.getElementById('nowplaying-svg-input'),
      svgPreview: document.getElementById('nowplaying-svg-preview'),
      blurRow: document.getElementById('nowplaying-blur-row'),
      blurSlider: document.getElementById('nowplaying-blur-slider'),
      blurInput: document.getElementById('nowplaying-blur-input')
    };
  }

  // Show/hide SVG upload section based on radio selection
  function updateSvgUploadVisibility() {
    const els = getModalElements();
    const selectedBg = els.modal?.querySelector('input[name="nowplaying-bg"]:checked');
    if (els.svgUpload) {
      els.svgUpload.style.display = selectedBg?.value === 'svg' ? 'block' : 'none';
    }
  }

  // Show/hide and update blur control based on background selection
  function updateBlurControlVisibility() {
    const els = getModalElements();
    const selectedBg = els.modal?.querySelector('input[name="nowplaying-bg"]:checked')?.value;

    if (els.blurRow && els.blurSlider && els.blurInput) {
      if (selectedBg === 'none') {
        els.blurRow.style.display = 'none';
      } else {
        els.blurRow.style.display = 'flex';
        // Set appropriate default value based on background type
        let blurValue = 0;
        if (selectedBg === 'album-blur') blurValue = nowPlayingConfig.albumBlur ?? 11;
        else if (selectedBg === 'color-mesh') blurValue = nowPlayingConfig.colorMeshBlur ?? 0;
        else if (selectedBg === 'svg') blurValue = nowPlayingConfig.svgBlur ?? 0;

        els.blurSlider.value = blurValue;
        els.blurInput.value = blurValue;
      }
    }
  }

  // Update SVG preview in modal
  function updateSvgPreview(svgDataUrl) {
    const els = getModalElements();
    if (els.svgPreview) {
      if (svgDataUrl) {
        els.svgPreview.innerHTML = `<img src="${svgDataUrl}" alt="SVG Preview">`;
      } else {
        els.svgPreview.innerHTML = '';
      }
    }
  }

  // Config button opens modal
  const configBtn = document.getElementById('nowplaying-config-btn');
  configBtn?.addEventListener('click', () => {
    const els = getModalElements();
    const bgValue = nowPlayingConfig.background || 'none';
    const bgRadio = els.modal?.querySelector(`input[name="nowplaying-bg"][value="${bgValue}"]`);
    if (bgRadio) bgRadio.checked = true;

    pendingSvg = nowPlayingConfig.customSvg;
    updateSvgUploadVisibility();
    updateBlurControlVisibility();
    updateSvgPreview(pendingSvg);
    if (els.svgInput) els.svgInput.value = '';

    els.modal?.classList.add('active');
  });

  // Event delegation for modal buttons
  document.addEventListener('click', (e) => {
    const target = e.target;
    const els = getModalElements();

    // Save button
    if (target.id === 'nowplaying-save-btn' || target.closest('#nowplaying-save-btn')) {
      const selectedBg = els.modal?.querySelector('input[name="nowplaying-bg"]:checked');
      const bgType = selectedBg ? selectedBg.value : 'none';
      nowPlayingConfig.background = bgType;
      nowPlayingConfig.customSvg = pendingSvg;

      // Save blur value for the current background type
      const blurValue = parseInt(els.blurSlider?.value) || 0;
      if (bgType === 'album-blur') nowPlayingConfig.albumBlur = blurValue;
      else if (bgType === 'color-mesh') nowPlayingConfig.colorMeshBlur = blurValue;
      else if (bgType === 'svg') nowPlayingConfig.svgBlur = blurValue;

      try {
        localStorage.setItem('nowplaying-config', JSON.stringify(nowPlayingConfig));
      } catch (err) {
        alert('Failed to save: SVG file too large for storage. Please use a smaller SVG.');
        nowPlayingConfig.customSvg = null;
        nowPlayingConfig.background = 'none';
        return;
      }

      applyNowPlayingBackground(nowPlayingConfig.background);
      els.modal?.classList.remove('active');
    }

    // Cancel button
    if (target.id === 'nowplaying-cancel-btn' || target.closest('#nowplaying-cancel-btn')) {
      els.modal?.classList.remove('active');
    }

    // Clear SVG button
    if (target.id === 'nowplaying-svg-clear' || target.closest('#nowplaying-svg-clear')) {
      pendingSvg = null;
      if (els.svgInput) els.svgInput.value = '';
      updateSvgPreview(null);
    }

    // Click outside modal to close
    if (target.id === 'nowplaying-modal') {
      els.modal?.classList.remove('active');
    }
  });

  // Event delegation for radio buttons and file input
  document.addEventListener('change', (e) => {
    const target = e.target;

    // Background radio buttons
    if (target.name === 'nowplaying-bg') {
      updateSvgUploadVisibility();
      updateBlurControlVisibility();
    }

    // SVG file input
    if (target.id === 'nowplaying-svg-input') {
      const file = target.files?.[0];
      if (!file) return;

      if (!file.type.includes('svg') && !file.name.endsWith('.svg')) {
        console.warn('Please select an SVG file');
        return;
      }

      const MAX_FILE_SIZE = 500 * 1024;
      if (file.size > MAX_FILE_SIZE) {
        alert(`SVG file too large (${(file.size / 1024).toFixed(0)}KB). Please use an SVG under 500KB.`);
        target.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const svgContent = event.target?.result;
        const base64 = btoa(unescape(encodeURIComponent(svgContent)));
        pendingSvg = `data:image/svg+xml;base64,${base64}`;
        updateSvgPreview(pendingSvg);
      };
      reader.readAsText(file);
    }
  });

  // Blur slider/input sync
  document.addEventListener('input', (e) => {
    const target = e.target;
    if (target.id === 'nowplaying-blur-slider') {
      const blurInput = document.getElementById('nowplaying-blur-input');
      if (blurInput) blurInput.value = target.value;
    }
    if (target.id === 'nowplaying-blur-input') {
      let val = parseInt(target.value) || 0;
      val = Math.max(0, Math.min(30, val));
      target.value = val;
      const blurSlider = document.getElementById('nowplaying-blur-slider');
      if (blurSlider) blurSlider.value = val;
    }
  });
}

function initNowPlaying() {
  isTauriAvailable = checkTauriAvailable();

  // Load liked tracks from localStorage (works in both modes)
  loadLikedTracks();

  // Initialize background config
  initNowPlayingBackground();

  const content = document.getElementById('nowplaying-content');
  const fallback = document.getElementById('nowplaying-fallback');

  // Listen for radio state changes (works in both Tauri and browser mode)
  window.addEventListener('radio-state-change', handleRadioStateChange);

  // Check if radio is already playing on init
  if (isInternalRadioPlaying()) {
    const radioInfo = getInternalRadioInfo();
    if (content) content.style.display = '';
    if (fallback) fallback.style.display = 'none';
    updateNowPlayingUI({
      title: radioInfo.title,
      artist: radioInfo.artist,
      album: radioInfo.album,
      source_app: 'Radio',
      playback_status: 'playing'
    });
  }

  if (!isTauriAvailable) {
    // Show fallback message in browser mode (unless radio is playing)
    if (!isInternalRadioPlaying()) {
      if (fallback) fallback.style.display = 'flex';
      if (content) content.style.display = 'none';
    }
    console.log('Now Playing: Running in browser mode (Tauri not available)');
    return;
  }

  console.log('Now Playing: Initializing with Tauri backend');

  // Setup controls
  setupControls();

  // Visibility-aware polling - pause when app is hidden to save CPU
  function startNowPlayingPolling() {
    if (nowPlayingInterval) return;
    fetchNowPlaying();
    nowPlayingInterval = setInterval(fetchNowPlaying, 2000);
  }

  function stopNowPlayingPolling() {
    if (nowPlayingInterval) {
      clearInterval(nowPlayingInterval);
      nowPlayingInterval = null;
    }
  }

  // Listen for visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopNowPlayingPolling();
      stopColorMeshAnimation();
    } else {
      startNowPlayingPolling();
      // Restart the color mesh if it's the configured background (it stops
      // itself when hidden and previously stayed frozen until a track change)
      toggleColorMeshAnimation();
    }
  });

  // Delay initial fetch to prevent blocking UI on startup
  setTimeout(() => {
    startNowPlayingPolling();
  }, 1500);
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  if (nowPlayingInterval) {
    clearInterval(nowPlayingInterval);
  }
  stopColorMeshAnimation();
});

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNowPlaying);
} else {
  initNowPlaying();
}
