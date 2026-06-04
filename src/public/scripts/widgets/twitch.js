/* ================================================================
   TWITCH WIDGET MODULE
   Twitch Embed API integration with Helix API for stream info
   Version: 2.9.3 - Filled SVG icons (white fill, no stroke)
   Cache bust: 20260115-012
   ================================================================ */

// Twitch API Client ID (Widget Wall Dashboard app)
const TWITCH_CLIENT_ID = '6og5fv8xx0tq8xw67itgl8whmoa5ru';
const TWITCH_REDIRECT_URI = 'https://localhost:1420/auth-callback.html';

let twitchConfig = {
  channel: 'anya',
  showOfflineWhenUnavailable: true,
  showChat: false
};

let streamInfoPollInterval = null;

let twitchPlayer = null;
let twitchEmbedLoaded = false;

// Native-embed stall watchdog: the Twitch embed iframe has no live-edge API,
// so the only way to snap back to live after a stall is to rebuild the embed.
let twitchStallMonitor = null;
let twitchStallStrikes = 0;

// Expose twitchPlayer globally for smart widget control
window.twitchPlayer = null;

// Channel history for dropdown (max 10 recent channels)
const TWITCH_HISTORY_KEY = 'twitch-channel-history';
const MAX_CHANNEL_HISTORY = 10;

/**
 * Add a channel to the recent history
 * Stores up to 10 recent channels, most recent first
 */
function addToChannelHistory(channel) {
  if (!channel) return;

  const normalizedChannel = channel.toLowerCase().trim();
  let history = getTwitchChannelHistory();

  // Remove if already exists (will re-add at front)
  history = history.filter(c => c.toLowerCase() !== normalizedChannel);

  // Add to front
  history.unshift(normalizedChannel);

  // Limit to max
  if (history.length > MAX_CHANNEL_HISTORY) {
    history = history.slice(0, MAX_CHANNEL_HISTORY);
  }

  localStorage.setItem(TWITCH_HISTORY_KEY, JSON.stringify(history));
}

/**
 * Get recent channel history
 */
function getTwitchChannelHistory() {
  try {
    return JSON.parse(localStorage.getItem(TWITCH_HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

// Expose for dropdown population
window.getTwitchChannelHistory = getTwitchChannelHistory;
window.fetchFollowedChannels = null; // Will be set after function is defined

// Expose Twitch stream metadata globally for Now Playing widget
window.twitchStreamInfo = {
  channel: '',
  displayName: '',
  streamTitle: '',
  gameName: '',
  viewerCount: 0,
  isLive: false,
  profileImageUrl: null,
  thumbnailUrl: null
};

/**
 * Update the global twitchStreamInfo object
 * Called when stream becomes live or channel changes
 */
function updateTwitchStreamInfo(channel, isLive, streamTitle = '', gameName = '', viewerCount = 0, thumbnailUrl = null, profileImageUrl = null, displayName = null) {
  const fallbackDisplayName = channel ? channel.charAt(0).toUpperCase() + channel.slice(1) : '';
  window.twitchStreamInfo = {
    channel: channel || '',
    displayName: displayName || fallbackDisplayName,
    streamTitle: streamTitle,
    gameName: gameName,
    viewerCount: viewerCount,
    isLive: isLive,
    profileImageUrl: profileImageUrl,
    thumbnailUrl: thumbnailUrl
  };
  // Dispatch event so Now Playing can react
  window.dispatchEvent(new CustomEvent('twitch-stream-update', { detail: window.twitchStreamInfo }));
}

/**
 * Fetch user profile from Twitch Helix API
 * Returns profile image URL, display name, etc.
 */
async function fetchTwitchUserProfile(channel) {
  const accessToken = localStorage.getItem('twitch-access-token');
  if (!accessToken) return null;

  try {
    const response = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.data && data.data.length > 0) {
      const user = data.data[0];
      return {
        profileImageUrl: user.profile_image_url,
        displayName: user.display_name,
        broadcasterType: user.broadcaster_type
      };
    }
    return null;
  } catch (e) {
    console.warn('Failed to fetch Twitch user profile:', e);
    return null;
  }
}

/**
 * Fetch stream info from Twitch Helix API
 * Returns stream title, game name, viewer count, etc.
 */
async function fetchTwitchStreamInfo(channel) {
  const accessToken = localStorage.getItem('twitch-access-token');
  if (!accessToken) {
    console.log('No Twitch access token - stream info unavailable');
    return null;
  }

  try {
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${channel}`, {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (response.status === 401) {
      // Token expired or invalid
      console.warn('Twitch token expired, clearing...');
      localStorage.removeItem('twitch-access-token');
      localStorage.setItem('twitch-logged-in', 'false');
      return null;
    }

    if (!response.ok) {
      console.warn('Twitch API error:', response.status);
      return null;
    }

    const data = await response.json();
    if (data.data && data.data.length > 0) {
      const stream = data.data[0];
      return {
        isLive: true,
        title: stream.title,
        gameName: stream.game_name,
        viewerCount: stream.viewer_count,
        thumbnailUrl: stream.thumbnail_url?.replace('{width}', '320').replace('{height}', '180'),
        startedAt: stream.started_at
      };
    } else {
      return { isLive: false };
    }
  } catch (e) {
    console.warn('Failed to fetch Twitch stream info:', e);
    return null;
  }
}

/**
 * Get the authenticated user's Twitch ID
 * Required for fetching followed channels
 * Defined directly on window to avoid Vite bundling scope issues
 */
window.getAuthenticatedUserId = async function() {
  const accessToken = localStorage.getItem('twitch-access-token');
  if (!accessToken) {
    console.log('[Twitch] getAuthenticatedUserId: No access token');
    return null;
  }

  try {
    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });

    console.log('[Twitch] getAuthenticatedUserId response status:', response.status);

    if (!response.ok) {
      console.warn('[Twitch] getAuthenticatedUserId failed:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();
    console.log('[Twitch] getAuthenticatedUserId data:', data);
    if (data.data && data.data.length > 0) {
      const user = data.data[0];
      console.log('[Twitch] Got user ID:', user.id, 'login:', user.login, 'display_name:', user.display_name);
      // Store username for IRC chat authentication (lowercase login for NICK command)
      if (user.login) {
        localStorage.setItem('twitch-username', user.login);
      }
      // Store display name separately for proper casing in chat display
      if (user.display_name) {
        localStorage.setItem('twitch-display-name', user.display_name);
      }
      return user.id;
    }
    return null;
  } catch (e) {
    console.warn('Failed to get authenticated user ID:', e);
    return null;
  }
};

/**
 * Fetch channels the authenticated user follows
 * Returns array of { login, displayName, profileImageUrl }
 * Defined directly on window to avoid Vite bundling scope issues
 */
window.fetchFollowedChannels = async function() {
  const accessToken = localStorage.getItem('twitch-access-token');
  if (!accessToken) {
    console.log('[Twitch] fetchFollowedChannels: No access token');
    return [];
  }

  console.log('[Twitch] fetchFollowedChannels: Getting user ID...');
  const userId = await window.getAuthenticatedUserId();
  if (!userId) {
    console.log('[Twitch] fetchFollowedChannels: Could not get user ID');
    return [];
  }

  try {
    console.log('[Twitch] fetchFollowedChannels: Fetching followed channels for user:', userId);
    const response = await fetch(`https://api.twitch.tv/helix/channels/followed?user_id=${userId}&first=100`, {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });

    console.log('[Twitch] fetchFollowedChannels response status:', response.status);

    if (response.status === 401) {
      console.warn('[Twitch] Token expired or missing user:read:follows scope');
      return [{ _error: 'scope_missing', message: 'Re-login required for followed channels' }];
    }

    if (response.status === 400) {
      const errorData = await response.json().catch(() => ({}));
      console.warn('[Twitch] Bad request - check if scope user:read:follows is granted:', errorData);
      return [{ _error: 'scope_missing', message: 'Missing user:read:follows scope - please re-login' }];
    }

    if (!response.ok) {
      console.warn('[Twitch] Failed to fetch followed channels:', response.status, response.statusText);
      return [];
    }

    const data = await response.json();
    console.log('[Twitch] fetchFollowedChannels data:', data);
    if (data.data && data.data.length > 0) {
      const channels = data.data.map(channel => ({
        login: channel.broadcaster_login,
        displayName: channel.broadcaster_name
      }));
      console.log('[Twitch] Found', channels.length, 'followed channels');
      return channels;
    }
    console.log('[Twitch] No followed channels found in response');
    return [];
  } catch (e) {
    console.warn('[Twitch] Failed to fetch followed channels:', e);
    return [];
  }
};

/**
 * Fetch all emotes the authenticated user has access to
 * Returns object: { emoteCode: { url, provider: 'twitch-sub' } }
 * Includes: subscribed channel emotes, follower emotes, channel points emotes
 * Defined directly on window to avoid Vite bundling scope issues
 */
window.fetchUserTwitchEmotes = async function() {
  const accessToken = localStorage.getItem('twitch-access-token');
  if (!accessToken) {
    console.log('[Twitch] fetchUserTwitchEmotes: No access token');
    return {};
  }

  const userId = await window.getAuthenticatedUserId();
  if (!userId) {
    console.log('[Twitch] fetchUserTwitchEmotes: Could not get user ID');
    return {};
  }

  try {
    console.log('[Twitch] fetchUserTwitchEmotes: Fetching emotes for user:', userId);
    const emotes = {};
    let cursor = null;

    // Paginate through all emote sets
    do {
      const url = cursor
        ? `https://api.twitch.tv/helix/chat/emotes/user?user_id=${userId}&after=${cursor}`
        : `https://api.twitch.tv/helix/chat/emotes/user?user_id=${userId}`;

      const response = await fetch(url, {
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        }
      });

      console.log('[Twitch] fetchUserTwitchEmotes response status:', response.status);

      if (response.status === 401) {
        console.warn('[Twitch] Token expired for user emotes');
        return emotes;
      }

      if (!response.ok) {
        console.warn('[Twitch] Failed to fetch user emotes:', response.status, response.statusText);
        return emotes;
      }

      const data = await response.json();

      if (data.data && data.data.length > 0) {
        for (const emote of data.data) {
          // Use 1x size for consistency with other emotes
          // Twitch emotes have format array with different scales
          const url = emote.images?.url_1x ||
                      `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/1.0`;

          emotes[emote.name] = {
            url: url,
            provider: 'twitch-sub',
            emoteType: emote.emote_type, // e.g., 'subscriptions', 'follower', 'channel_points'
            ownerId: emote.owner_id
          };
        }
      }

      cursor = data.pagination?.cursor;
    } while (cursor);

    console.log('[Twitch] fetchUserTwitchEmotes: Found', Object.keys(emotes).length, 'user emotes');
    return emotes;
  } catch (e) {
    console.warn('[Twitch] Failed to fetch user emotes:', e);
    return {};
  }
};

/**
 * Fetch live streams for a list of channel logins
 * Returns array of live channel logins with stream info
 * Defined directly on window to avoid Vite bundling scope issues
 */
window.fetchLiveStreams = async function(channelLogins) {
  if (!channelLogins || channelLogins.length === 0) {
    console.log('[Twitch] fetchLiveStreams: No channel logins provided');
    return [];
  }

  const accessToken = localStorage.getItem('twitch-access-token');
  if (!accessToken) {
    console.log('[Twitch] fetchLiveStreams: No access token');
    return [];
  }

  console.log('[Twitch] fetchLiveStreams: Checking', channelLogins.length, 'channels for live status');

  try {
    const chunks = [];
    for (let i = 0; i < channelLogins.length; i += 100) {
      chunks.push(channelLogins.slice(i, i + 100));
    }

    const allLive = [];
    for (const chunk of chunks) {
      const params = chunk.map(login => `user_login=${encodeURIComponent(login)}`).join('&');
      const response = await fetch(`https://api.twitch.tv/helix/streams?${params}`, {
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        }
      });

      console.log('[Twitch] fetchLiveStreams response status:', response.status);

      if (!response.ok) {
        console.warn('[Twitch] fetchLiveStreams failed:', response.status, response.statusText);
        continue;
      }

      const data = await response.json();
      console.log('[Twitch] fetchLiveStreams data:', data);
      if (data.data) {
        allLive.push(...data.data.map(stream => ({
          login: stream.user_login,
          displayName: stream.user_name,
          gameName: stream.game_name,
          viewerCount: stream.viewer_count,
          title: stream.title
        })));
      }
    }

    console.log('[Twitch] Found', allLive.length, 'live streams');
    return allLive;
  } catch (e) {
    console.warn('[Twitch] Failed to fetch live streams:', e);
    return [];
  }
};

/**
 * Fetch followed channels with live status
 * Returns array of { login, displayName, isLive, gameName, viewerCount }
 * Defined directly on window to avoid Vite bundling scope issues
 */
window.fetchFollowedChannelsWithLiveStatus = async function() {
  console.log('[Twitch] fetchFollowedChannelsWithLiveStatus: Starting...');
  const followedChannels = await window.fetchFollowedChannels();
  console.log('[Twitch] fetchFollowedChannelsWithLiveStatus: Got', followedChannels.length, 'followed channels');

  if (followedChannels.length === 0) {
    console.log('[Twitch] fetchFollowedChannelsWithLiveStatus: No followed channels, returning empty');
    return [];
  }

  // Pass through error markers
  if (followedChannels.length === 1 && followedChannels[0]._error) {
    console.log('[Twitch] fetchFollowedChannelsWithLiveStatus: Passing through error marker');
    return followedChannels;
  }

  const logins = followedChannels.map(c => c.login);
  const liveStreams = await window.fetchLiveStreams(logins);
  const liveMap = new Map(liveStreams.map(s => [s.login.toLowerCase(), s]));

  const result = followedChannels.map(channel => {
    const liveInfo = liveMap.get(channel.login.toLowerCase());
    return {
      ...channel,
      isLive: !!liveInfo,
      gameName: liveInfo?.gameName || '',
      viewerCount: liveInfo?.viewerCount || 0,
      title: liveInfo?.title || ''
    };
  });

  const liveCount = result.filter(c => c.isLive).length;
  console.log('[Twitch] fetchFollowedChannelsWithLiveStatus: Returning', result.length, 'channels,', liveCount, 'live');
  return result;
};

/**
 * Start polling for stream info updates
 */
function startStreamInfoPolling() {
  // Clear any existing interval
  if (streamInfoPollInterval) {
    clearInterval(streamInfoPollInterval);
  }

  // Fetch immediately
  refreshStreamInfo();

  // Poll every 60 seconds (Twitch rate limits are generous but no need to spam)
  streamInfoPollInterval = setInterval(refreshStreamInfo, 60000);
}

/**
 * Pin a fixed quality on the native embed instead of leaving it on auto-ABR.
 * Auto-ABR thrashing under GPU contention reads as buffering/stutter. We avoid
 * "chunked" (source) because the highest bitrate is the most rebuffer-prone on
 * a busy WebView2; we target a stable mid-high rung if one exists.
 */
function setNativeQuality(player) {
  try {
    if (!player || typeof player.getQualities !== 'function') return;
    const qualities = player.getQualities() || [];
    if (!qualities.length) return;
    const current = typeof player.getQuality === 'function' ? player.getQuality() : null;
    // Only override if Twitch left us on auto (don't fight a manual user choice)
    if (current && current !== 'auto') return;
    // Quality `group` names, best-to-worst, that we prefer to land on.
    const prefer = ['720p60', '720p', '900p60', '480p'];
    const names = qualities.map(q => q.group || q.name);
    const pick = prefer.find(p => names.includes(p)) || names.find(n => n && n !== 'auto');
    if (pick) {
      player.setQuality(pick);
      console.log('Twitch: pinned native quality to', pick, '(was auto)');
    }
  } catch (e) {
    console.warn('Twitch: setNativeQuality failed', e);
  }
}

/**
 * Watchdog for the native embed. The embed API has no seek-to-live, so if the
 * player gets stuck not-playing while the stream is live (and we didn't pause
 * it), we rebuild the embed via updateTwitchWidget() to jump back to the edge.
 */
function startTwitchStallMonitor() {
  stopTwitchStallMonitor();
  twitchStallStrikes = 0;
  twitchStallMonitor = setInterval(() => {
    try {
      // Only watch when the Twitch page is the active one (don't rebuild a paused-on-purpose player)
      const twitchEmbed = document.getElementById('twitch-embed');
      const twitchPage = twitchEmbed?.closest('.smart-widget-page');
      const isPageActive = !twitchPage || twitchPage.classList.contains('active');
      if (!isPageActive || !twitchPlayer) { twitchStallStrikes = 0; return; }

      const player = typeof twitchPlayer.getPlayer === 'function' ? twitchPlayer.getPlayer() : null;
      if (!player) { twitchStallStrikes = 0; return; }

      // If the user/we paused it, that's intentional - not a stall.
      const paused = typeof player.isPaused === 'function' ? player.isPaused() : false;
      const ended = typeof player.getEnded === 'function' ? player.getEnded() : false;
      if (paused) { twitchStallStrikes = 0; return; }

      // "Stuck" = reports not-paused but also not progressing/ended. getPlayerState
      // exposes playback state; treat anything other than a healthy playing state as a strike.
      const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : null;
      const playback = state && (state.playback || state.playbackState);
      const stuck = ended || (playback && playback !== 'Playing' && playback !== 'playing');

      if (stuck) {
        twitchStallStrikes += 1;
        console.log(`Twitch: stall strike ${twitchStallStrikes}/3 (playback=${playback}, ended=${ended})`);
        if (twitchStallStrikes >= 3) {
          console.log('Twitch: native player stalled - rebuilding embed to snap to live');
          twitchStallStrikes = 0;
          updateTwitchWidget(); // rebuilds the embed fresh at the live edge
        }
      } else {
        twitchStallStrikes = 0;
      }
    } catch (e) {
      console.warn('Twitch: stall monitor error', e);
    }
  }, 4000); // 3 strikes * 4s => ~12s of confirmed stall before a rebuild
}

function stopTwitchStallMonitor() {
  if (twitchStallMonitor) {
    clearInterval(twitchStallMonitor);
    twitchStallMonitor = null;
  }
}

/**
 * Refresh stream info from API
 */
async function refreshStreamInfo() {
  const channel = twitchConfig.channel;
  if (!channel) return;

  // Fetch stream info and user profile in parallel
  const [info, profile] = await Promise.all([
    fetchTwitchStreamInfo(channel),
    fetchTwitchUserProfile(channel)
  ]);

  const profileImageUrl = profile?.profileImageUrl || null;
  const displayName = profile?.displayName || null;

  if (info) {
    if (info.isLive) {
      updateTwitchStreamInfo(channel, true, info.title, info.gameName, info.viewerCount, info.thumbnailUrl, profileImageUrl, displayName);
    } else {
      updateTwitchStreamInfo(channel, false, '', '', 0, null, profileImageUrl, displayName);
    }
  }
}

function parseTwitchChannel(input) {
  if (!input) return '';
  input = input.trim();
  const urlMatch = input.match(/(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  return input.replace(/^@/, '').toLowerCase();
}

function loadTwitchEmbedAPI() {
  return new Promise((resolve, reject) => {
    if (window.Twitch) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://embed.twitch.tv/embed/v1.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/**
 * Create ambient background effect for video
 * Clones the iframe and creates a blurred, scaled background layer
 */
function createAmbientBackground(container) {
  if (!container) return;

  // Remove existing ambient wrapper if present
  const existingWrapper = container.querySelector('.ambient-video-wrapper');
  if (existingWrapper) existingWrapper.remove();

  // Find the main iframe
  const iframe = container.querySelector('iframe');
  if (!iframe) return;

  // Create ambient wrapper structure
  const wrapper = document.createElement('div');
  wrapper.className = 'ambient-video-wrapper';

  // Create background layer with cloned iframe
  const bgLayer = document.createElement('div');
  bgLayer.className = 'ambient-video-bg';
  const bgIframe = iframe.cloneNode(true);
  bgIframe.removeAttribute('id'); // Avoid duplicate IDs
  bgIframe.setAttribute('tabindex', '-1'); // Not focusable
  bgLayer.appendChild(bgIframe);

  // Create main layer and move original iframe into it
  const mainLayer = document.createElement('div');
  mainLayer.className = 'ambient-video-main';
  mainLayer.appendChild(iframe);

  // Assemble structure
  wrapper.appendChild(bgLayer);
  wrapper.appendChild(mainLayer);
  container.appendChild(wrapper);
}

function showTwitchOffline() {
  console.log('Twitch: showTwitchOffline() called');
  const twitchEmbed = document.getElementById('twitch-embed');
  const twitchFallback = document.getElementById('twitch-fallback');
  const twitchOffline = document.getElementById('twitch-offline');

  if (twitchEmbed) twitchEmbed.style.display = 'none';
  if (twitchFallback) twitchFallback.style.display = 'none';
  if (twitchOffline) twitchOffline.style.display = 'flex';
}

function showTwitchFallback() {
  const twitchEmbed = document.getElementById('twitch-embed');
  const twitchFallback = document.getElementById('twitch-fallback');
  const twitchOffline = document.getElementById('twitch-offline');

  if (twitchEmbed) twitchEmbed.style.display = 'none';
  if (twitchOffline) twitchOffline.style.display = 'none';
  if (twitchFallback) twitchFallback.style.display = 'flex';
}

/**
 * Show HLS video controls overlay and wire up event handlers
 * @param {HTMLVideoElement} videoElement - The HLS video element
 */
function showHLSControls(videoElement) {
  const controls = document.getElementById('hls-controls');
  const playBtn = document.getElementById('hls-play-btn');
  const muteBtn = document.getElementById('hls-mute-btn');
  const qualityBtn = document.getElementById('hls-quality-btn');
  const qualityMenu = document.getElementById('hls-quality-menu');

  if (!controls || !playBtn || !muteBtn) {
    console.warn('HLS controls elements not found');
    return;
  }

  // Apply inline styles for z-index (CSS caching issues)
  controls.style.cssText = `
    display: flex !important;
    position: absolute !important;
    bottom: 12px !important;
    left: 12px !important;
    right: 12px !important;
    height: 40px !important;
    background: rgba(0, 0, 0, 0.7) !important;
    border-radius: 8px !important;
    padding: 0 12px !important;
    align-items: center !important;
    gap: 8px !important;
    z-index: 55 !important;
    opacity: 0 !important;
    transition: opacity 0.3s ease !important;
    backdrop-filter: blur(8px) !important;
  `;
  controls.classList.add('active');

  // Update play/pause icon based on video state
  function updatePlayIcon() {
    const playIcon = playBtn.querySelector('.play-icon');
    const pauseIcon = playBtn.querySelector('.pause-icon');
    if (videoElement.paused) {
      if (playIcon) playIcon.style.display = 'block';
      if (pauseIcon) pauseIcon.style.display = 'none';
    } else {
      if (playIcon) playIcon.style.display = 'none';
      if (pauseIcon) pauseIcon.style.display = 'block';
    }
  }

  // Update mute icon based on video state
  function updateMuteIcon() {
    const volumeIcon = muteBtn.querySelector('.volume-icon');
    const mutedIcon = muteBtn.querySelector('.muted-icon');
    if (videoElement.muted || videoElement.volume === 0) {
      if (volumeIcon) volumeIcon.style.display = 'none';
      if (mutedIcon) mutedIcon.style.display = 'block';
    } else {
      if (volumeIcon) volumeIcon.style.display = 'block';
      if (mutedIcon) mutedIcon.style.display = 'none';
    }
  }

  // Play/Pause button handler
  playBtn.onclick = () => {
    if (videoElement.paused) {
      videoElement.play();
    } else {
      videoElement.pause();
    }
    updatePlayIcon();
  };

  // Mute button handler
  muteBtn.onclick = () => {
    videoElement.muted = !videoElement.muted;
    updateMuteIcon();
  };

  // Quality menu functionality
  if (qualityBtn && qualityMenu) {
    // Apply inline styles to quality menu (CSS caching workaround)
    qualityMenu.style.cssText = `
      position: absolute !important;
      bottom: 100% !important;
      right: 0 !important;
      margin-bottom: 12px !important;
      background: linear-gradient(135deg, rgba(20, 20, 20, 0.98), rgba(40, 40, 40, 0.98)) !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      border-radius: 8px !important;
      min-width: 140px !important;
      overflow: hidden !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6) !important;
      backdrop-filter: blur(12px) !important;
      z-index: 100 !important;
    `;

    qualityBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = qualityMenu.style.display === 'block';
      qualityMenu.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) populateQualityMenu();
      console.log('Quality menu toggled:', !isOpen ? 'open' : 'closed');
    };

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!qualityBtn.contains(e.target) && !qualityMenu.contains(e.target)) {
        qualityMenu.style.display = 'none';
      }
    });
  }

  // Populate quality levels from HLS.js
  function populateQualityMenu() {
    console.log('Populating quality menu...');
    if (!qualityMenu) {
      console.warn('Quality menu element not found');
      return;
    }
    if (typeof Hls === 'undefined') {
      console.warn('HLS.js not loaded');
      return;
    }

    const hlsInstance = window._hlsInstance;
    if (!hlsInstance) {
      console.warn('HLS instance not available');
      // Show a message in the menu
      qualityMenu.innerHTML = '<div style="padding: 10px 16px; color: rgba(255,255,255,0.6); font-size: 12px;">Loading...</div>';
      return;
    }

    qualityMenu.innerHTML = '';
    const levels = hlsInstance.levels || [];
    const currentLevel = hlsInstance.currentLevel;
    console.log('HLS levels:', levels.length, 'current:', currentLevel);

    // Add Auto option
    const autoBtn = document.createElement('button');
    autoBtn.className = 'hls-quality-option' + (currentLevel === -1 ? ' active' : '');
    autoBtn.textContent = 'Auto';
    autoBtn.onclick = (e) => {
      e.stopPropagation();
      hlsInstance.currentLevel = -1;
      qualityMenu.classList.remove('open');
      updateQualityButtons(-1);
    };
    qualityMenu.appendChild(autoBtn);

    // Add each quality level
    levels.forEach((level, index) => {
      const height = level.height;
      const label = height >= 1080 ? `${height}p (Source)` : `${height}p`;
      const btn = document.createElement('button');
      btn.className = 'hls-quality-option' + (currentLevel === index ? ' active' : '');
      btn.textContent = label;
      btn.onclick = (e) => {
        e.stopPropagation();
        hlsInstance.currentLevel = index;
        qualityMenu.classList.remove('open');
        updateQualityButtons(index);
      };
      qualityMenu.appendChild(btn);
    });
  }

  function updateQualityButtons(activeIndex) {
    const buttons = qualityMenu.querySelectorAll('.hls-quality-option');
    buttons.forEach((btn, i) => {
      btn.classList.toggle('active', i === activeIndex + 1); // +1 for Auto option
    });
  }

  // Listen for video events to keep icons in sync
  videoElement.addEventListener('play', updatePlayIcon);
  videoElement.addEventListener('pause', updatePlayIcon);
  videoElement.addEventListener('volumechange', updateMuteIcon);

  // Initial state
  updatePlayIcon();
  updateMuteIcon();

  // Add hover listeners to show/hide controls (JS fallback for CSS caching)
  const widget = document.getElementById('twitch-widget');
  if (widget) {
    widget.addEventListener('mouseenter', () => {
      controls.style.opacity = '1';
    });
    widget.addEventListener('mouseleave', () => {
      controls.style.opacity = '0';
      if (qualityMenu) qualityMenu.classList.remove('open');
    });
  }

  console.log('HLS controls initialized');
}

/**
 * Hide HLS video controls
 */
function hideHLSControls() {
  const controls = document.getElementById('hls-controls');
  if (controls) {
    controls.classList.remove('active');
    controls.style.display = 'none';
  }
}

/**
 * Update Twitch widget using HLS player mode
 * @param {string} channel - Twitch channel name
 * @param {HTMLVideoElement} hlsVideo - HLS video element
 * @param {HTMLElement} twitchEmbed - Twitch embed container
 * @param {HTMLElement} twitchOffline - Offline overlay
 * @param {HTMLElement} twitchFallback - Fallback overlay
 */
async function updateTwitchWidgetHLS(channel, hlsVideo, twitchEmbed, twitchOffline, twitchFallback) {
  // Check if Twitch should auto-start based on smart widget's saved page
  // If another page (YouTube) is the saved active page, don't auto-start Twitch
  const savedPage = localStorage.getItem('smart-widget-current-page');
  const shouldAutoStart = savedPage === null || savedPage === '0';

  // Hide embed, show HLS video
  if (twitchEmbed) twitchEmbed.style.display = 'none';
  if (twitchOffline) twitchOffline.style.display = 'none';
  if (twitchFallback) twitchFallback.style.display = 'none';

  // Apply inline styles directly (CSS file caching issues)
  hlsVideo.style.cssText = `
    display: block !important;
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    background: #000;
    z-index: 50 !important;
    transform: scale(1.05);
    transform-origin: center center;
  `;
  hlsVideo.classList.add('active');

  // Ensure buttons appear above video (z-index 60 > video's 50)
  const configBtn = document.getElementById('twitch-config-btn');
  const quickswitchBtn = document.getElementById('twitch-quickswitch-btn');
  if (configBtn) configBtn.style.zIndex = '60';
  if (quickswitchBtn) quickswitchBtn.style.zIndex = '60';

  // Show HLS video controls
  showHLSControls(hlsVideo);

  // If YouTube is the active page, don't start Twitch stream - save CPU/bandwidth
  if (!shouldAutoStart) {
    console.log('[Twitch] Skipping auto-start - YouTube tab is active');
    twitchEmbedLoaded = true; // Mark as loaded so it can start when user switches to Twitch
    return;
  }

  try {
    await window.HLSPlayer.play(channel, hlsVideo);
    console.log('HLS playback started successfully');
    twitchEmbedLoaded = true;

    // Unmute if Twitch page is currently active (page 0 in smart widget)
    const twitchPage = hlsVideo.closest('.smart-widget-page');
    const isPageActive = !twitchPage || twitchPage.classList.contains('active');
    if (isPageActive) {
      hlsVideo.muted = false;
    }

    // Start stream info polling for Now Playing widget
    startStreamInfoPolling();
  } catch (error) {
    console.error('HLS playback failed:', error.message);

    // Hide HLS controls on error
    hideHLSControls();

    // Check if it's an offline error
    if (error.message.includes('offline') || error.message.includes('unavailable')) {
      hlsVideo.classList.remove('active');
      hlsVideo.style.display = 'none';
      showTwitchOffline();
      updateTwitchStreamInfo(channel, false, '', '', 0, null);
    } else {
      // Other error - fall back to native embed
      console.log('Falling back to native Twitch embed');
      hlsVideo.classList.remove('active');
      hlsVideo.style.display = 'none';

      // Call native embed function
      updateTwitchWidgetNative(channel, twitchEmbed, twitchOffline, twitchFallback);
    }
  }
}

/**
 * Update Twitch widget using native embed (internal use for fallback)
 */
function updateTwitchWidgetNative(channel, twitchEmbed, twitchOffline, twitchFallback) {
  // Hide HLS video and controls when using native embed
  const hlsVideo = document.getElementById('hls-video');
  if (hlsVideo) {
    hlsVideo.classList.remove('active');
    hlsVideo.style.display = 'none';
  }
  hideHLSControls();

  const hostname = window.location.hostname || 'localhost';
  const parents = ['localhost', 'tauri.localhost'];
  if (hostname && hostname !== 'localhost' && hostname !== 'tauri.localhost') {
    parents.push(hostname);
  }

  loadTwitchEmbedAPI()
    .then(() => {
      if (twitchEmbed) twitchEmbed.innerHTML = '';
      twitchEmbedLoaded = false;

      if (twitchEmbed) {
        twitchEmbed.style.display = 'block';
        twitchEmbed.style.visibility = 'visible';
      }

      try {
        twitchPlayer = new Twitch.Embed('twitch-embed', {
          width: '100%',
          height: '100%',
          channel: channel,
          parent: parents,
          layout: twitchConfig.showChat ? 'video-with-chat' : 'video',
          muted: true,
          autoplay: true
        });
        window.twitchPlayer = twitchPlayer;

        twitchPlayer.addEventListener(Twitch.Embed.VIDEO_READY, () => {
          if (twitchEmbed) twitchEmbed.style.display = 'block';
          if (twitchOffline) twitchOffline.style.display = 'none';
          if (twitchFallback) twitchFallback.style.display = 'none';
          twitchEmbedLoaded = true;
          startStreamInfoPolling();
          // Stabilize the native player: pin quality + watch for stalls
          try { setNativeQuality(twitchPlayer.getPlayer()); } catch (e) {}
          startTwitchStallMonitor();
        });

        twitchPlayer.addEventListener(Twitch.Embed.OFFLINE, () => {
          updateTwitchStreamInfo(channel, false, '', '', 0, null);
          showTwitchOffline();
        });

        setTimeout(() => {
          if (!twitchEmbedLoaded) showTwitchFallback();
        }, 5000);
      } catch (e) {
        console.warn('Twitch Embed API error:', e);
        showTwitchFallback();
      }
    })
    .catch(() => {
      showTwitchFallback();
    });
}

function updateTwitchWidget() {
  const twitchEmbed = document.getElementById('twitch-embed');
  const twitchOffline = document.getElementById('twitch-offline');
  const twitchFallback = document.getElementById('twitch-fallback');
  const hlsVideo = document.getElementById('hls-video');
  const twitchAvatar = document.getElementById('twitch-avatar');
  const twitchChannelName = document.getElementById('twitch-channel-name');
  const twitchChannelLink = document.getElementById('twitch-channel-link');
  const twitchFallbackLink = document.getElementById('twitch-fallback-link');

  const channel = twitchConfig.channel || 'anya';
  const hostname = window.location.hostname || 'localhost';

  if (twitchAvatar) twitchAvatar.textContent = channel.charAt(0).toUpperCase();
  if (twitchChannelName) twitchChannelName.textContent = channel;
  if (twitchChannelLink) twitchChannelLink.href = `https://twitch.tv/${channel}`;
  if (twitchFallbackLink) twitchFallbackLink.href = `https://twitch.tv/${channel}`;

  // Check if HLS mode is enabled
  // Use getDashboardConfig if available, otherwise fall back to raw localStorage
  const dashboardConfig = window.getDashboardConfig?.() || {};
  const rawConfig = JSON.parse(localStorage.getItem('dashboard-config') || '{}');

  // Use getDashboardConfig value if function exists, otherwise use raw localStorage
  const effectiveConfig = typeof window.getDashboardConfig === 'function'
    ? dashboardConfig
    : rawConfig;
  const useHLS = effectiveConfig.twitch?.hlsEnabled === true;

  // Debug logging for HLS mode decision
  console.log('Twitch: HLS check -', {
    hlsEnabled: dashboardConfig.twitch?.hlsEnabled,
    rawHlsEnabled: rawConfig.twitch?.hlsEnabled,
    effectiveHlsEnabled: effectiveConfig.twitch?.hlsEnabled,
    useHLS: useHLS,
    hlsVideoElement: !!hlsVideo,
    hlsPlayerAvailable: !!window.HLSPlayer,
    getDashboardConfigExists: typeof window.getDashboardConfig === 'function'
  });

  // Stop any existing HLS playback before switching
  if (window.HLSPlayer?.isPlaying()) {
    window.HLSPlayer.stop();
  }

  if (useHLS && hlsVideo && window.HLSPlayer) {
    console.log('Twitch: Using HLS player mode');
    updateTwitchWidgetHLS(channel, hlsVideo, twitchEmbed, twitchOffline, twitchFallback);
    return;
  } else if (useHLS && hlsVideo && !window.HLSPlayer) {
    // HLSPlayer not yet loaded - load it dynamically
    console.log('Twitch: HLS mode enabled, dynamically loading HLSPlayer module...');
    const script = document.createElement('script');
    script.src = 'scripts/widgets/hls-player.js';
    script.onload = () => {
      console.log('Twitch: HLSPlayer module loaded dynamically');
      if (window.HLSPlayer) {
        updateTwitchWidgetHLS(channel, hlsVideo, twitchEmbed, twitchOffline, twitchFallback);
      } else {
        console.error('Twitch: HLSPlayer failed to initialize, falling back to native embed');
        updateTwitchWidgetNative(channel, twitchEmbed, twitchOffline, twitchFallback);
      }
    };
    script.onerror = () => {
      console.error('Twitch: Failed to load HLSPlayer script, falling back to native embed');
      updateTwitchWidgetNative(channel, twitchEmbed, twitchOffline, twitchFallback);
    };
    document.head.appendChild(script);
    return;
  }

  // Standard Twitch Embed mode
  console.log('Twitch: Using native embed mode (hlsEnabled:', dashboardConfig.twitch?.hlsEnabled, ')');

  // Hide HLS video when using embed
  if (hlsVideo) hlsVideo.classList.remove('active');

  // Twitch requires parent domains - include both localhost and tauri.localhost for Tauri builds
  const parents = ['localhost', 'tauri.localhost'];
  if (hostname && hostname !== 'localhost' && hostname !== 'tauri.localhost') {
    parents.push(hostname);
  }
  console.log('Twitch embed hostname:', hostname, 'parents:', parents);

  loadTwitchEmbedAPI()
    .then(() => {
      if (twitchEmbed) twitchEmbed.innerHTML = '';
      twitchEmbedLoaded = false;

      // Ensure embed container is visible before creating (required for autoplay)
      if (twitchEmbed) {
        twitchEmbed.style.display = 'block';
        twitchEmbed.style.visibility = 'visible';
      }

      // Also ensure parent smart-widget-page is visible if it exists
      const smartWidgetPage = twitchEmbed?.closest('.smart-widget-page');
      if (smartWidgetPage) {
        smartWidgetPage.style.visibility = 'visible';
        smartWidgetPage.style.opacity = '1';
      }

      try {
        twitchPlayer = new Twitch.Embed('twitch-embed', {
          width: '100%',
          height: '100%',
          channel: channel,
          parent: parents,
          layout: twitchConfig.showChat ? 'video-with-chat' : 'video',
          muted: true,
          autoplay: true
        });
        window.twitchPlayer = twitchPlayer; // Expose globally for smart widget

        twitchPlayer.addEventListener(Twitch.Embed.VIDEO_READY, () => {
          console.log('Twitch: VIDEO_READY event fired');
          if (twitchEmbed) twitchEmbed.style.display = 'block';
          if (twitchOffline) twitchOffline.style.display = 'none';
          if (twitchFallback) twitchFallback.style.display = 'none';
          twitchEmbedLoaded = true;

          // DISABLED: Ambient background was cloning iframe and breaking playback
          // createAmbientBackground(twitchEmbed);

          // Update stream info for Now Playing widget
          // Start polling Helix API for detailed stream info (title, game, etc.)
          startStreamInfoPolling();

          // Manually trigger play if autoplay failed due to visibility requirements
          // This handles the case where the embed was created before the page was fully visible
          try {
            const player = twitchPlayer.getPlayer();
            // Stabilize the native player: pin a fixed quality instead of auto-ABR thrash
            setNativeQuality(player);
            if (player && typeof player.play === 'function') {
              // Small delay to ensure visibility has been applied
              setTimeout(() => {
                // Check if Twitch page is active (page 0 in smart widget)
                const twitchPage = twitchEmbed?.closest('.smart-widget-page');
                const isPageActive = !twitchPage || twitchPage.classList.contains('active');
                // Play if page is active and player is not already playing
                if (isPageActive) {
                  const isPaused = typeof player.isPaused === 'function' ? player.isPaused() : true;
                  if (isPaused) {
                    player.play();
                    // Notify other widgets that Twitch is playing (auto-pause YouTube)
                    window.dispatchEvent(new CustomEvent('video-playback-start', {
                      detail: { source: 'twitch', player: player }
                    }));
                  }
                }
              }, 100);
            }
          } catch (e) {
            console.log('Could not trigger Twitch autoplay:', e);
          }

          // Watch for stalls and rebuild the embed to snap back to live if stuck
          startTwitchStallMonitor();

        });


        twitchPlayer.addEventListener(Twitch.Embed.OFFLINE, () => {
          console.log('Twitch: OFFLINE event fired');
          updateTwitchStreamInfo(channel, false, '', '', 0, null);
          if (streamInfoPollInterval) {
            clearInterval(streamInfoPollInterval);
            streamInfoPollInterval = null;
          }
          // Offline is not a stall - stop watching so we don't rebuild in a loop
          stopTwitchStallMonitor();
          showTwitchOffline();
        });

        setTimeout(() => {
          if (!twitchEmbedLoaded) showTwitchFallback();
        }, 5000);
      } catch (e) {
        console.warn('Twitch Embed API error:', e);
        showTwitchFallback();
      }
    })
    .catch(() => {
      showTwitchFallback();
    });
}

/**
 * Render the media sources list in the modal
 */
function renderModalMediaList() {
  const listContainer = document.getElementById('twitch-modal-media-list');
  if (!listContainer) return;

  const config = window.SmartWidget?.getConfig() || { sources: [] };
  // Skip first source (Twitch) - show only YouTube videos
  const videoSources = config.sources.slice(1);

  listContainer.innerHTML = '';

  if (videoSources.length === 0) {
    listContainer.innerHTML = '<div style="color: rgba(255,255,255,0.4); font-size: 12px; padding: 8px 0;">No videos added yet</div>';
    return;
  }

  const totalVideos = videoSources.length;
  videoSources.forEach((source, index) => {
    const actualIndex = index + 1; // Account for Twitch being index 0
    const isFirst = index === 0;
    const isLast = index === totalVideos - 1;
    const item = document.createElement('div');
    item.className = 'twitch-modal-media-item';
    item.innerHTML = `
      <div class="twitch-modal-reorder-btns">
        <button type="button" class="twitch-modal-reorder-btn" data-index="${actualIndex}" data-dir="up" title="Move up" ${isFirst ? 'disabled' : ''}>&#9650;</button>
        <button type="button" class="twitch-modal-reorder-btn" data-index="${actualIndex}" data-dir="down" title="Move down" ${isLast ? 'disabled' : ''}>&#9660;</button>
      </div>
      <input type="text" class="twitch-modal-title-input" placeholder="Title (tooltip)" value="${source.label || ''}" data-index="${actualIndex}">
      <input type="text" class="twitch-modal-url-input" placeholder="YouTube URL" value="${source.url || ''}" data-index="${actualIndex}">
      <button type="button" class="twitch-modal-remove-btn" data-index="${actualIndex}" title="Remove">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    listContainer.appendChild(item);
  });
}

/**
 * Save media sources from modal inputs
 */
function saveModalMediaSources() {
  if (!window.SmartWidget) return;

  const config = window.SmartWidget.getConfig();
  const urlInputs = document.querySelectorAll('#twitch-modal-media-list .twitch-modal-url-input[data-index]');
  const titleInputs = document.querySelectorAll('#twitch-modal-media-list .twitch-modal-title-input[data-index]');

  urlInputs.forEach(input => {
    const index = parseInt(input.getAttribute('data-index'));
    if (config.sources[index]) {
      config.sources[index].url = input.value.trim();
    }
  });

  titleInputs.forEach(input => {
    const index = parseInt(input.getAttribute('data-index'));
    if (config.sources[index]) {
      config.sources[index].label = input.value.trim();
    }
  });

  window.SmartWidget.setConfig(config);
}

function initTwitch() {
  // Load saved config
  const savedTwitchConfig = localStorage.getItem('twitch-config');
  if (savedTwitchConfig) {
    try {
      twitchConfig = { ...twitchConfig, ...JSON.parse(savedTwitchConfig) };
    } catch (e) {
      console.warn('Failed to parse Twitch config:', e);
    }
  }

  // Auto-pause Twitch when YouTube starts playing (and vice versa)
  window.addEventListener('video-playback-start', (e) => {
    if (e.detail.source === 'youtube' && twitchPlayer) {
      try {
        const player = twitchPlayer.getPlayer();
        if (player && typeof player.pause === 'function') {
          player.pause();
          console.log('Twitch: Auto-paused because YouTube started playing');
        }
      } catch (err) {
        console.log('Could not auto-pause Twitch:', err);
      }
    }
  });

  const twitchModal = document.getElementById('twitch-modal');
  const twitchConfigBtn = document.getElementById('twitch-config-btn');
  const twitchChannelInput = document.getElementById('twitch-channel-input');
  const twitchSaveBtn = document.getElementById('twitch-save-btn');
  const twitchCancelBtn = document.getElementById('twitch-cancel-btn');
  const addVideoBtn = document.getElementById('twitch-modal-add-video');
  const twitchChannelDropdown = document.getElementById('twitch-channel-dropdown');

  // Populate and show the channel dropdown
  async function populateChannelDropdown(filterText = '') {
    if (!twitchChannelDropdown) return;

    const filter = filterText.toLowerCase().trim();
    const recentChannels = getTwitchChannelHistory();
    const isLoggedIn = localStorage.getItem('twitch-logged-in') === 'true';
    console.log('[Twitch] populateChannelDropdown: isLoggedIn=', isLoggedIn, 'filter=', filter);

    // Show loading state for followed channels
    if (isLoggedIn) {
      twitchChannelDropdown.innerHTML = '<div class="twitch-channel-dropdown-loading">Loading followed channels...</div>';
    }

    let html = '';

    // Followed channels with live status (if logged in) - show live first
    if (isLoggedIn) {
      console.log('[Twitch] populateChannelDropdown: Fetching followed channels with live status...');
      const followedChannels = await window.fetchFollowedChannelsWithLiveStatus();
      console.log('[Twitch] populateChannelDropdown: Got followed channels:', followedChannels.length);

      // Check for error marker (scope missing)
      if (followedChannels.length === 1 && followedChannels[0]._error) {
        html += `<div class="twitch-channel-dropdown-section">
          <div class="twitch-channel-dropdown-error" style="color: #f87171; padding: 8px 12px; font-size: 11px;">
            ${followedChannels[0].message}<br>
            <small>Logout and login again to grant permission</small>
          </div>
        </div>`;
      }

      // Separate live and offline channels (skip error markers)
      const validChannels = followedChannels.filter(c => !c._error);
      const liveChannels = validChannels.filter(c => c.isLive);
      const offlineChannels = validChannels.filter(c => !c.isLive);

      // Filter based on search text
      const filteredLive = filter
        ? liveChannels.filter(c => c.login.toLowerCase().includes(filter) || c.displayName.toLowerCase().includes(filter))
        : liveChannels;

      const filteredOffline = filter
        ? offlineChannels.filter(c => c.login.toLowerCase().includes(filter) || c.displayName.toLowerCase().includes(filter))
        : offlineChannels.slice(0, 15); // Limit offline if no filter

      // Live channels section
      if (filteredLive.length > 0) {
        html += '<div class="twitch-channel-dropdown-section">';
        html += '<div class="twitch-channel-dropdown-header">Live Now</div>';
        filteredLive.forEach(channel => {
          const viewerText = channel.viewerCount >= 1000
            ? `${(channel.viewerCount / 1000).toFixed(1)}K`
            : channel.viewerCount;
          html += `<div class="twitch-channel-dropdown-item live" data-channel="${channel.login}">
            <span class="live-indicator"></span>
            <span class="channel-name">${channel.displayName || channel.login}</span>
            <span class="channel-game">${channel.gameName || ''}</span>
            <span class="channel-viewers">${viewerText}</span>
          </div>`;
        });
        html += '</div>';
      }

      // Offline followed channels section
      if (filteredOffline.length > 0) {
        html += '<div class="twitch-channel-dropdown-section">';
        html += '<div class="twitch-channel-dropdown-header">Followed</div>';
        filteredOffline.forEach(channel => {
          html += `<div class="twitch-channel-dropdown-item" data-channel="${channel.login}">
            <span class="channel-name">${channel.displayName || channel.login}</span>
          </div>`;
        });
        html += '</div>';
      }
    }

    // Recent channels section (always show)
    const filteredRecent = filter
      ? recentChannels.filter(c => c.toLowerCase().includes(filter))
      : recentChannels;

    if (filteredRecent.length > 0) {
      html += '<div class="twitch-channel-dropdown-section">';
      html += '<div class="twitch-channel-dropdown-header">Recent</div>';
      filteredRecent.forEach(channel => {
        html += `<div class="twitch-channel-dropdown-item" data-channel="${channel}">
          <span class="channel-name">${channel}</span>
        </div>`;
      });
      html += '</div>';
    }

    if (!html) {
      html = '<div class="twitch-channel-dropdown-empty">No channels found</div>';
    }

    twitchChannelDropdown.innerHTML = html;

    // Add click handlers to dropdown items
    twitchChannelDropdown.querySelectorAll('.twitch-channel-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        const channel = item.dataset.channel;
        if (twitchChannelInput) twitchChannelInput.value = channel;
        hideChannelDropdown();
      });
    });
  }

  function showChannelDropdown() {
    twitchChannelDropdown?.classList.add('active');
  }

  function hideChannelDropdown() {
    twitchChannelDropdown?.classList.remove('active');
  }

  // Show dropdown on input focus
  twitchChannelInput?.addEventListener('focus', () => {
    populateChannelDropdown(twitchChannelInput.value);
    showChannelDropdown();
  });

  // Filter dropdown as user types
  twitchChannelInput?.addEventListener('input', () => {
    populateChannelDropdown(twitchChannelInput.value);
    showChannelDropdown();
  });

  // Hide dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!twitchChannelDropdown?.contains(e.target) && e.target !== twitchChannelInput) {
      hideChannelDropdown();
    }
  });

  twitchConfigBtn?.addEventListener('click', () => {
    if (twitchChannelInput) twitchChannelInput.value = twitchConfig.channel || '';
    renderModalMediaList();
    twitchModal?.classList.add('active');
  });

  twitchCancelBtn?.addEventListener('click', () => {
    twitchModal?.classList.remove('active');
  });

  twitchSaveBtn?.addEventListener('click', () => {
    const newChannel = parseTwitchChannel(twitchChannelInput?.value || '');
    if (newChannel) {
      twitchConfig.channel = newChannel;
      localStorage.setItem('twitch-config', JSON.stringify(twitchConfig));

      // Track in channel history for dropdown
      addToChannelHistory(newChannel);

      // Also update dashboard-config to keep IRC chat in sync
      const dashboardConfig = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
      if (!dashboardConfig.twitch) dashboardConfig.twitch = {};
      dashboardConfig.twitch.channel = newChannel;
      localStorage.setItem('dashboard-config', JSON.stringify(dashboardConfig));

      // Notify IRC chat and other widgets
      window.dispatchEvent(new CustomEvent('dashboard-config-changed', { detail: dashboardConfig }));
    }
    // Save media sources
    saveModalMediaSources();
    twitchModal?.classList.remove('active');
    updateTwitchWidget();
  });

  // Add video button
  addVideoBtn?.addEventListener('click', () => {
    if (window.SmartWidget) {
      const config = window.SmartWidget.getConfig();
      captureCurrentFormValues(config); // Preserve unsaved changes

      // Add the new video
      config.sources.push({
        type: 'youtube',
        url: '',
        label: `Video ${config.sources.length}`
      });
      window.SmartWidget.setConfig(config);
      renderModalMediaList();
    }
  });

  // Twitch login/logout buttons
  const twitchLoginBtn = document.getElementById('twitch-login-btn');
  const twitchLogoutBtn = document.getElementById('twitch-logout-btn');
  const twitchLoginStatus = document.getElementById('twitch-login-status');

  // Helper to update login UI state
  function updateLoginUI(isLoggedIn) {
    if (twitchLoginStatus) {
      twitchLoginStatus.classList.toggle('logged-in', isLoggedIn);
      twitchLoginStatus.querySelector('.status-text').textContent = isLoggedIn ? 'Logged in' : 'Not logged in';
    }
    if (twitchLoginBtn) twitchLoginBtn.textContent = isLoggedIn ? 'Re-login' : 'Login to Twitch';
    if (twitchLogoutBtn) twitchLogoutBtn.style.display = isLoggedIn ? 'inline-flex' : 'none';
    // Notify quick-switch button to update visibility
    window.dispatchEvent(new CustomEvent('twitch-login-status-changed', { detail: { isLoggedIn } }));
  }

  // Check if logged in (stored in localStorage after successful login)
  const twitchLoggedIn = localStorage.getItem('twitch-logged-in') === 'true';
  updateLoginUI(twitchLoggedIn);

  // Logout handler
  twitchLogoutBtn?.addEventListener('click', () => {
    localStorage.removeItem('twitch-logged-in');
    localStorage.removeItem('twitch-access-token');
    localStorage.removeItem('twitch-username');
    localStorage.removeItem('twitch-display-name');
    if (streamInfoPollInterval) {
      clearInterval(streamInfoPollInterval);
      streamInfoPollInterval = null;
    }
    updateLoginUI(false);
    updateTwitchWidget(); // Refresh embed
  });

  // Build OAuth URL for Twitch authorization
  function getTwitchOAuthUrl() {
    const params = new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      redirect_uri: TWITCH_REDIRECT_URI,
      response_type: 'token',
      scope: 'user:read:email user:read:follows user:read:emotes chat:read chat:edit' // Identity + followed channels + emotes + IRC chat
    });
    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  // Show OAuth modal when clicking login
  twitchLoginBtn?.addEventListener('click', () => {
    const oauthModal = document.getElementById('twitch-oauth-modal');
    const urlInput = document.getElementById('twitch-oauth-url-input');
    const statusEl = document.getElementById('twitch-oauth-status');
    if (urlInput) urlInput.value = '';
    if (statusEl) statusEl.textContent = '';
    oauthModal?.classList.add('active');
  });

  // OAuth modal handlers
  const oauthModal = document.getElementById('twitch-oauth-modal');
  const oauthOpenBtn = document.getElementById('twitch-oauth-open-btn');
  const oauthUrlInput = document.getElementById('twitch-oauth-url-input');
  const oauthStatusEl = document.getElementById('twitch-oauth-status');
  const oauthConnectBtn = document.getElementById('twitch-oauth-connect-btn');
  const oauthCancelBtn = document.getElementById('twitch-oauth-cancel-btn');

  // Open Twitch auth in system browser
  oauthOpenBtn?.addEventListener('click', () => {
    const oauthUrl = getTwitchOAuthUrl();
    // Use Tauri shell.open if available (opens in default browser)
    if (window.__TAURI__?.opener?.openUrl) {
      window.__TAURI__.opener.openUrl(oauthUrl);
    } else {
      window.open(oauthUrl, '_blank');
    }
    if (oauthStatusEl) {
      oauthStatusEl.textContent = 'Browser opened. After authorizing, copy the URL and paste it above.';
      oauthStatusEl.style.color = 'rgba(255,255,255,0.7)';
    }
  });

  // Extract token from pasted URL
  oauthConnectBtn?.addEventListener('click', () => {
    const pastedUrl = oauthUrlInput?.value?.trim() || '';

    // Try to extract access_token from URL fragment
    let accessToken = null;
    try {
      // Handle full URL with hash
      if (pastedUrl.includes('#')) {
        const hashPart = pastedUrl.split('#')[1];
        const params = new URLSearchParams(hashPart);
        accessToken = params.get('access_token');
      }
      // Also try if they just pasted the token itself
      if (!accessToken && pastedUrl.length > 20 && !pastedUrl.includes(' ')) {
        accessToken = pastedUrl;
      }
    } catch (e) {
      console.warn('Failed to parse OAuth URL:', e);
    }

    if (accessToken) {
      // Save token
      localStorage.setItem('twitch-access-token', accessToken);
      localStorage.setItem('twitch-logged-in', 'true');

      if (oauthStatusEl) {
        oauthStatusEl.textContent = 'Connected successfully!';
        oauthStatusEl.style.color = '#4ade80';
      }

      // Close modal and update UI
      setTimeout(() => {
        oauthModal?.classList.remove('active');
        updateLoginUI(true);
        startStreamInfoPolling();
        updateTwitchWidget();
      }, 1000);
    } else {
      if (oauthStatusEl) {
        oauthStatusEl.textContent = 'Could not find access token in URL. Make sure to copy the full URL after redirect.';
        oauthStatusEl.style.color = '#f87171';
      }
    }
  });

  // Cancel OAuth modal
  oauthCancelBtn?.addEventListener('click', () => {
    oauthModal?.classList.remove('active');
  });

  // Close modal on backdrop click
  oauthModal?.addEventListener('click', (e) => {
    if (e.target === oauthModal) {
      oauthModal.classList.remove('active');
    }
  });

  // Quick-switch button and dropdown (only visible on Twitch page)
  const quickswitchBtn = document.getElementById('twitch-quickswitch-btn');
  const quickswitchDropdown = document.getElementById('twitch-quickswitch-dropdown');

  if (quickswitchBtn && quickswitchDropdown) {
    // Move dropdown to body for proper overflow handling (portal pattern)
    document.body.appendChild(quickswitchDropdown);

    // Create backdrop overlay for click-outside detection (only covers Twitch widget iframe)
    const twitchWidget = document.getElementById('twitch-widget');
    const quickswitchBackdrop = document.createElement('div');
    quickswitchBackdrop.className = 'quickswitch-backdrop';
    quickswitchBackdrop.style.cssText = 'position:absolute;inset:0;z-index:10;display:none;';
    twitchWidget?.appendChild(quickswitchBackdrop);

    // Close dropdown when backdrop is clicked
    quickswitchBackdrop.addEventListener('pointerdown', () => {
      quickswitchDropdown.classList.remove('open');
      quickswitchBackdrop.style.display = 'none';
    });

    // Track if dropdown is loading
    let isPopulatingQuickswitch = false;

    // Update quick-switch button visibility based on current page
    function updateQuickswitchVisibility() {
      const currentPage = window.SmartWidget?.getConfig()?.currentPage ?? 0;
      const isLoggedIn = localStorage.getItem('twitch-logged-in') === 'true';
      // Only show on Twitch page (page 0) and when logged in
      quickswitchBtn.style.display = (currentPage === 0 && isLoggedIn) ? 'block' : 'none';
    }

    // Initial visibility check
    updateQuickswitchVisibility();

    // Listen for page changes
    document.addEventListener('dashboard-ready', updateQuickswitchVisibility);
    // Listen for login status changes
    window.addEventListener('twitch-login-status-changed', updateQuickswitchVisibility);
    // Also update when smart widget page changes
    if (twitchWidget) {
      const observer = new MutationObserver(() => {
        updateQuickswitchVisibility();
      });
      observer.observe(twitchWidget, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    // Populate quick-switch dropdown with live channels
    async function populateQuickswitchDropdown() {
      if (isPopulatingQuickswitch) return;
      isPopulatingQuickswitch = true;

      quickswitchDropdown.innerHTML = '<div class="quickswitch-loading">Loading...</div>';

      const followedChannels = await window.fetchFollowedChannelsWithLiveStatus();

      // Check for error marker
      if (followedChannels.length === 1 && followedChannels[0]._error) {
        quickswitchDropdown.innerHTML = `<div class="quickswitch-error" style="color: #f87171; padding: 8px 12px; font-size: 11px;">
          ${followedChannels[0].message}<br>
          <small>Logout and login again</small>
        </div>`;
        isPopulatingQuickswitch = false;
        return;
      }

      const liveChannels = followedChannels.filter(c => c.isLive);

      if (liveChannels.length === 0) {
        quickswitchDropdown.innerHTML = '<div class="quickswitch-empty">No live channels</div>';
        isPopulatingQuickswitch = false;
        return;
      }

      let html = '';
      liveChannels.forEach(channel => {
        const viewerText = channel.viewerCount >= 1000
          ? `${(channel.viewerCount / 1000).toFixed(1)}K`
          : channel.viewerCount;
        const isCurrentChannel = channel.login.toLowerCase() === twitchConfig.channel?.toLowerCase();
        html += `<div class="quickswitch-item${isCurrentChannel ? ' current' : ''}" data-channel="${channel.login}">
          <span class="quickswitch-live-dot"></span>
          <span class="quickswitch-name">${channel.displayName || channel.login}</span>
          <span class="quickswitch-game">${channel.gameName || ''}</span>
          <span class="quickswitch-viewers">${viewerText}</span>
        </div>`;
      });

      quickswitchDropdown.innerHTML = html;

      // Add click handlers
      quickswitchDropdown.querySelectorAll('.quickswitch-item').forEach(item => {
        item.addEventListener('click', () => {
          const channel = item.dataset.channel;
          if (channel && channel.toLowerCase() !== twitchConfig.channel?.toLowerCase()) {
            twitchConfig.channel = channel;
            localStorage.setItem('twitch-config', JSON.stringify(twitchConfig));
            addToChannelHistory(channel);

            // Update dashboard config for IRC chat sync
            const dashboardConfig = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
            if (!dashboardConfig.twitch) dashboardConfig.twitch = {};
            dashboardConfig.twitch.channel = channel;
            localStorage.setItem('dashboard-config', JSON.stringify(dashboardConfig));
            window.dispatchEvent(new CustomEvent('dashboard-config-changed', { detail: dashboardConfig }));

            updateTwitchWidget();
          }
          quickswitchDropdown.classList.remove('open');
          quickswitchBackdrop.style.display = 'none';
        });
      });

      isPopulatingQuickswitch = false;
    }

    // Toggle dropdown on button click
    quickswitchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = quickswitchDropdown.classList.contains('open');

      if (!isOpen) {
        // Position dropdown relative to button
        const btnRect = quickswitchBtn.getBoundingClientRect();
        quickswitchDropdown.style.top = (btnRect.bottom + 4) + 'px';
        quickswitchDropdown.style.left = Math.max(8, btnRect.right - 240) + 'px';
        quickswitchDropdown.classList.add('open');
        quickswitchBackdrop.style.display = 'block';
        populateQuickswitchDropdown();
      } else {
        quickswitchDropdown.classList.remove('open');
        quickswitchBackdrop.style.display = 'none';
      }
    });

    // Close dropdown when clicking outside (handles clicks on other widgets)
    document.addEventListener('pointerdown', (e) => {
      if (!quickswitchDropdown.contains(e.target) && !quickswitchBtn.contains(e.target)) {
        quickswitchDropdown.classList.remove('open');
        quickswitchBackdrop.style.display = 'none';
      }
    });
  }

  // Helper to capture current form values into config before re-rendering
  function captureCurrentFormValues(config) {
    const urlInputs = document.querySelectorAll('#twitch-modal-media-list .twitch-modal-url-input[data-index]');
    const titleInputs = document.querySelectorAll('#twitch-modal-media-list .twitch-modal-title-input[data-index]');

    urlInputs.forEach(input => {
      const index = parseInt(input.getAttribute('data-index'));
      if (config.sources[index]) {
        config.sources[index].url = input.value;
      }
    });

    titleInputs.forEach(input => {
      const index = parseInt(input.getAttribute('data-index'));
      if (config.sources[index]) {
        config.sources[index].label = input.value;
      }
    });
  }

  // Remove and reorder video buttons (delegated)
  document.getElementById('twitch-modal-media-list')?.addEventListener('click', (e) => {
    // Handle remove button
    const removeBtn = e.target.closest('.twitch-modal-remove-btn');
    if (removeBtn && window.SmartWidget) {
      const index = parseInt(removeBtn.getAttribute('data-index'));
      const config = window.SmartWidget.getConfig();
      captureCurrentFormValues(config); // Preserve unsaved changes
      if (index > 0 && index < config.sources.length) {
        config.sources.splice(index, 1);
        window.SmartWidget.setConfig(config);
        renderModalMediaList();
      }
      return;
    }

    // Handle reorder buttons
    const reorderBtn = e.target.closest('.twitch-modal-reorder-btn');
    if (reorderBtn && window.SmartWidget && !reorderBtn.disabled) {
      const index = parseInt(reorderBtn.getAttribute('data-index'));
      const direction = reorderBtn.getAttribute('data-dir');
      const config = window.SmartWidget.getConfig();
      captureCurrentFormValues(config); // Preserve unsaved changes

      if (direction === 'up' && index > 1) {
        // Swap with previous (index-1 in sources array)
        [config.sources[index], config.sources[index - 1]] = [config.sources[index - 1], config.sources[index]];
        window.SmartWidget.setConfig(config);
        renderModalMediaList();
      } else if (direction === 'down' && index < config.sources.length - 1) {
        // Swap with next (index+1 in sources array)
        [config.sources[index], config.sources[index + 1]] = [config.sources[index + 1], config.sources[index]];
        window.SmartWidget.setConfig(config);
        renderModalMediaList();
      }
    }
  });

  twitchModal?.addEventListener('click', (e) => {
    if (e.target === twitchModal) {
      twitchModal.classList.remove('active');
    }
  });

  twitchChannelInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      twitchSaveBtn?.click();
    }
  });

  // Initialize widget
  updateTwitchWidget();
}

// Track last known HLS state for change detection
let lastKnownHlsEnabled = null;

// Listen for dashboard config changes (from settings panel)
// This keeps Twitch video in sync with settings changes
window.addEventListener('dashboard-config-changed', (e) => {
  const dashboardConfig = e.detail || {};
  const newChannel = dashboardConfig.twitch?.channel;
  const newHlsEnabled = dashboardConfig.twitch?.hlsEnabled === true;

  let needsRefresh = false;

  // Check channel change
  if (newChannel && newChannel !== twitchConfig.channel) {
    console.log('Twitch: Channel changed via settings to:', newChannel);
    twitchConfig.channel = newChannel;
    localStorage.setItem('twitch-config', JSON.stringify(twitchConfig));
    needsRefresh = true;
  }

  // Check HLS mode change (compare against last known state)
  if (lastKnownHlsEnabled !== null && newHlsEnabled !== lastKnownHlsEnabled) {
    console.log('Twitch: HLS mode changed from', lastKnownHlsEnabled, 'to', newHlsEnabled);
    needsRefresh = true;
  }
  lastKnownHlsEnabled = newHlsEnabled;

  if (needsRefresh) {
    updateTwitchWidget();
  }
});

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTwitch);
} else {
  initTwitch();
}
