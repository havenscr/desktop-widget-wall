/* ================================================================
   HLS PLAYER MODULE
   Direct HLS playback for Twitch streams using GQL token auth
   Bypasses Twitch Embed for full CSS control (hover effects, etc.)
   Version: 1.2.1 - SVG icon fix support
   Cache bust: 20260115-003
   ================================================================ */

const HLSPlayer = (function() {
  const DEFAULT_WORKER_URL = 'https://bold-art-d9fe.havenscr.workers.dev';

  let currentChannel = null;
  let hlsInstance = null;
  let videoElement = null;
  let tokenRefreshTimeout = null;

  /**
   * Get effective config (from getDashboardConfig or localStorage fallback)
   */
  function getEffectiveConfig() {
    const dashboardConfig = window.getDashboardConfig?.() || {};
    // Fall back to raw localStorage if getDashboardConfig isn't available
    if (typeof window.getDashboardConfig === 'function') {
      return dashboardConfig;
    }
    try {
      return JSON.parse(localStorage.getItem('dashboard-config') || '{}');
    } catch {
      return {};
    }
  }

  /**
   * Check if HLS player is enabled in dashboard config
   */
  function isEnabled() {
    const config = getEffectiveConfig();
    return config.twitch?.hlsEnabled === true;
  }

  /**
   * Get the worker URL from config or use default
   */
  function getWorkerUrl() {
    const config = getEffectiveConfig();
    return config.twitch?.hlsWorkerUrl || DEFAULT_WORKER_URL;
  }

  /**
   * Check if HLS player is available (enabled + worker URL configured)
   */
  function isAvailable() {
    return isEnabled() && !!getWorkerUrl();
  }

  /**
   * Check if native HLS is supported (Safari/iOS)
   */
  function supportsNativeHLS() {
    const video = document.createElement('video');
    return video.canPlayType('application/vnd.apple.mpegurl') !== '';
  }

  /**
   * Load HLS.js library dynamically if needed
   */
  function loadHLSjs() {
    return new Promise((resolve, reject) => {
      if (typeof Hls !== 'undefined') {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load HLS.js'));
      document.head.appendChild(script);
    });
  }

  /**
   * Get PlaybackAccessToken from Twitch GQL via Cloudflare Worker
   *
   * NOTE: Twitch's GQL API does NOT accept third-party OAuth tokens.
   * We use anonymous requests which work for video playback.
   * Ad-free requires Twitch Turbo subscription (first-party auth).
   */
  async function getStreamToken(channel) {
    const workerUrl = getWorkerUrl();
    console.log('HLSPlayer: Worker URL =', workerUrl);

    if (!workerUrl) {
      throw new Error('Worker URL not configured');
    }

    // Use full GQL query for PlaybackAccessToken
    const query = {
      operationName: 'PlaybackAccessToken',
      query: `query PlaybackAccessToken($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {
        streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {
          value
          signature
          __typename
        }
        videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {
          value
          signature
          __typename
        }
      }`,
      variables: {
        isLive: true,
        login: channel,
        isVod: false,
        vodID: '',
        playerType: 'site'
      }
    };

    const headers = {
      'Content-Type': 'application/json'
    };

    const fetchUrl = `${workerUrl}/gql`;
    console.log('HLSPlayer: Fetching token from', fetchUrl);

    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(query)
    });

    console.log('HLSPlayer: Response status =', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('HLSPlayer: Error response =', errorText);
      throw new Error(`Worker request failed: ${res.status} - ${errorText}`);
    }

    const data = await res.json();
    console.log('HLSPlayer: GQL response received');

    if (data.errors) {
      console.error('HLSPlayer: GQL errors =', data.errors);
      throw new Error(data.errors[0]?.message || 'GQL error');
    }

    const token = data.data?.streamPlaybackAccessToken;
    if (!token) {
      console.error('HLSPlayer: No token in response - stream may be offline');
      throw new Error('Stream offline or unavailable');
    }

    console.log('HLSPlayer: Got token successfully');
    return token;
  }

  /**
   * Build HLS stream URL from token
   */
  function buildHLSUrl(channel, token) {
    const params = new URLSearchParams({
      player: 'twitchweb',
      p: Math.floor(Math.random() * 999999),
      type: 'any',
      allow_source: 'true',
      allow_audio_only: 'true',
      allow_spectre: 'false',
      fast_bread: 'true',
      sig: token.signature,
      token: token.value
    });

    return `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?${params.toString()}`;
  }

  /**
   * Initialize HLS.js for playback
   */
  function initHLSjs(video, url) {
    if (typeof Hls === 'undefined') {
      console.error('HLSPlayer: HLS.js not loaded');
      return false;
    }

    if (!Hls.isSupported()) {
      console.error('HLSPlayer: HLS.js not supported in this browser');
      return false;
    }

    // Destroy existing instance
    if (hlsInstance) {
      hlsInstance.destroy();
    }

    hlsInstance = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30
    });

    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      console.warn('HLSPlayer: HLS.js error', data.type, data.details);
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('HLSPlayer: Fatal network error, attempting recovery');
            hlsInstance.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('HLSPlayer: Fatal media error, attempting recovery');
            hlsInstance.recoverMediaError();
            break;
          default:
            console.error('HLSPlayer: Unrecoverable error');
            stop();
            break;
        }
      }
    });

    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(video);

    // Expose instance globally for quality menu access
    window._hlsInstance = hlsInstance;

    return true;
  }

  /**
   * Play a stream
   * @param {string} channel - Twitch channel name
   * @param {HTMLVideoElement} video - Video element to use
   * @returns {Promise<boolean>} - True if playback started successfully
   */
  async function play(channel, video) {
    if (!channel || !video) {
      throw new Error('Channel and video element required');
    }

    // Stop any existing playback
    stop();

    currentChannel = channel;
    videoElement = video;

    console.log('HLSPlayer: Getting stream token for', channel);
    const token = await getStreamToken(channel);

    const hlsUrl = buildHLSUrl(channel, token);
    console.log('HLSPlayer: Starting playback');

    // Use native HLS on Safari, HLS.js elsewhere
    if (supportsNativeHLS()) {
      video.src = hlsUrl;
      video.load();
      await video.play();
    } else {
      // Load HLS.js if not already loaded
      await loadHLSjs();

      if (!initHLSjs(video, hlsUrl)) {
        throw new Error('Failed to initialize HLS.js');
      }

      // HLS.js will auto-play when ready
      return new Promise((resolve, reject) => {
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play()
            .then(() => resolve(true))
            .catch(e => {
              console.warn('HLSPlayer: Autoplay blocked', e);
              resolve(true); // Still consider it success, user can click to unmute
            });
        });

        hlsInstance.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            reject(new Error('Network error - stream may be offline'));
          }
        });

        // Timeout for initial load
        setTimeout(() => {
          if (!video.readyState) {
            reject(new Error('Timeout loading stream'));
          }
        }, 10000);
      });
    }

    // Schedule token refresh (tokens expire after ~2 hours, refresh at 1.5 hours)
    scheduleTokenRefresh();

    return true;
  }

  /**
   * Schedule token refresh to maintain playback
   */
  function scheduleTokenRefresh() {
    clearTokenRefresh();

    // Refresh token every 90 minutes (tokens last ~2 hours)
    tokenRefreshTimeout = setTimeout(async () => {
      if (currentChannel && videoElement) {
        console.log('HLSPlayer: Refreshing stream token');
        try {
          const token = await getStreamToken(currentChannel);
          const hlsUrl = buildHLSUrl(currentChannel, token);

          if (supportsNativeHLS()) {
            // For native HLS, we need to reload
            const currentTime = videoElement.currentTime;
            videoElement.src = hlsUrl;
            videoElement.load();
            videoElement.currentTime = currentTime;
            videoElement.play();
          } else if (hlsInstance) {
            // HLS.js can load new source without interruption
            hlsInstance.loadSource(hlsUrl);
          }

          scheduleTokenRefresh(); // Schedule next refresh
        } catch (e) {
          console.error('HLSPlayer: Token refresh failed', e);
          scheduleTokenRefresh(); // Retry on next schedule
        }
      }
    }, 90 * 60 * 1000); // 90 minutes
  }

  /**
   * Clear token refresh timeout
   */
  function clearTokenRefresh() {
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
      tokenRefreshTimeout = null;
    }
  }

  /**
   * Stop playback
   */
  function stop() {
    clearTokenRefresh();

    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
      window._hlsInstance = null;
    }

    if (videoElement) {
      videoElement.pause();
      videoElement.removeAttribute('src');
      videoElement.load();
    }

    currentChannel = null;
  }

  /**
   * Check if currently playing
   */
  function isPlaying() {
    return !!currentChannel;
  }

  /**
   * Get current channel
   */
  function getCurrentChannel() {
    return currentChannel;
  }

  // Public API
  return {
    isEnabled,
    isAvailable,
    supportsNativeHLS,
    play,
    stop,
    isPlaying,
    getCurrentChannel,
    getWorkerUrl
  };
})();

// Export for global access
window.HLSPlayer = HLSPlayer;
console.log('HLSPlayer module loaded and exported to window.HLSPlayer');
