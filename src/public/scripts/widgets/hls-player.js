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
  let playbackSession = null;

  function cancelled() {
    const error = new Error('Playback request cancelled');
    error.name = 'AbortError';
    return error;
  }

  function isCurrent(session) {
    return playbackSession === session && !session.controller.signal.aborted;
  }

  function requireCurrent(session) {
    if (!isCurrent(session)) throw cancelled();
  }

  // Abort promptly even when an SDK promise does not support AbortSignal.
  function whileCurrent(promise, session) {
    return new Promise((resolve, reject) => {
      const signal = session.controller.signal;
      const onAbort = () => reject(cancelled());
      if (!isCurrent(session)) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(promise).then(value => {
        signal.removeEventListener('abort', onAbort);
        if (isCurrent(session)) resolve(value);
        else reject(cancelled());
      }, error => {
        signal.removeEventListener('abort', onAbort);
        reject(isCurrent(session) ? error : cancelled());
      });
    });
  }

  function watchPlayback(session) {
    const video = session.video;
    for (const event of ['waiting', 'stalled', 'playing', 'error']) {
      const listener = () => {
        if (!window._debugLogging || !isCurrent(session)) return;
        let bufferAhead = 0;
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= video.currentTime && video.currentTime <= video.buffered.end(i)) {
            bufferAhead = video.buffered.end(i) - video.currentTime;
            break;
          }
        }
        const quality = video.getVideoPlaybackQuality?.();
        window.dlog?.('HLSPlayer: playback', {
          event, channel: session.channel, currentTime: video.currentTime,
          readyState: video.readyState, bufferAhead,
          droppedFrames: quality?.droppedVideoFrames,
          totalFrames: quality?.totalVideoFrames, errorCode: video.error?.code
        });
      };
      video.addEventListener(event, listener);
      session.cleanup.push(() => video.removeEventListener(event, listener));
    }
  }

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
    // Default-on: HLS is used unless the user explicitly picked Embed mode.
    return config.twitch?.hlsEnabled !== false;
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

      // Vendored locally (scripts/lib/hls.min.js, pinned hls.js 1.6.16) to match
      // the project's no-CDN-dependency convention: no jsDelivr uptime reliance
      // and no risk of an unpinned @latest shipping a breaking build.
      const version = window.ASSET_VERSION ? '?v=' + window.ASSET_VERSION : '';
      const script = document.createElement('script');
      script.src = 'scripts/lib/hls.min.js' + version;
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
  async function getStreamToken(channel, signal) {
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
      signal,
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
  function initHLSjs(video, session) {
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
      lowLatencyMode: true,          // KEEP: Twitch serves LL-HLS parts (fast_bread=true)
      liveSyncDuration: 4,           // target ~4s behind live (mid of 3-6s window)
      liveMaxLatencyDuration: 8,     // hard ceiling: latency > 8s => corrective seek to live
      maxLiveSyncPlaybackRate: 1.08, // gentle catch-up (<=8% faster) to close small drift
      backBufferLength: 10,          // was 30; low-latency never rewinds, saves RAM
      maxBufferLength: 12,           // cap forward buffer; a big fwd buffer = more drift
      liveDurationInfinity: true     // correct seekable handling for true live
    });
    const instance = hlsInstance;

    // --- Live-edge resync: snap back toward live after a stall or excess drift ---
    const resyncToLive = (reason) => {
      try {
        if (!isCurrent(session)) return;
        const live = (typeof instance.liveSyncPosition === 'number')
          ? instance.liveSyncPosition
          : (video.seekable.length ? video.seekable.end(video.seekable.length - 1) : null);
        if (live == null) return;
        const behind = live - video.currentTime;
        // Only hard-seek when meaningfully behind; let maxLiveSyncPlaybackRate handle small drift
        if (behind > 6) {
          console.log(`HLSPlayer: resync (${reason}) - ${behind.toFixed(1)}s behind, seeking to live`);
          video.currentTime = live;
          if (video.paused) video.play().catch(() => {});
        }
      } catch (e) {
        console.warn('HLSPlayer: resync failed', e);
      }
    };

    const recoverLater = reason => {
      const timer = setTimeout(() => resyncToLive(reason), 2000);
      session.cleanup.push(() => clearTimeout(timer));
    };
    instance.on(Hls.Events.ERROR, (event, data) => {
      if (!isCurrent(session)) return;
      console.warn('HLSPlayer: HLS.js error', data.type, data.details);
      // Non-fatal buffer stall (decoder starved): snap back to live
      if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
        resyncToLive('buffer-stalled');
      }
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('HLSPlayer: Fatal network error, attempting recovery');
            instance.startLoad();
            recoverLater('post-network-recovery');
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('HLSPlayer: Fatal media error, attempting recovery');
            instance.recoverMediaError();
            recoverLater('post-media-recovery');
            break;
          default:
            console.error('HLSPlayer: Unrecoverable error');
            if (session.started) stop();
            break;
        }
      }
    });

    for (const event of ['waiting', 'stalled']) {
      const listener = () => resyncToLive(event);
      video.addEventListener(event, listener);
      session.cleanup.push(() => video.removeEventListener(event, listener));
    }

    // Periodic drift guard for slow creep the rate-catchup can't close
    if (window._hlsDriftTimer) clearInterval(window._hlsDriftTimer);
    window._hlsDriftTimer = setInterval(() => {
      if (!isCurrent(session) || video.paused) return;
      const lat = (typeof instance.latency === 'number') ? instance.latency : null;
      if (lat != null && lat > 8) resyncToLive(`latency=${lat.toFixed(1)}s`);
    }, 5000);

    // Expose instance globally for quality menu access
    window._hlsInstance = instance;

    return instance;
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
    const session = { controller: new AbortController(), cleanup: [], channel, video };
    playbackSession = session;
    watchPlayback(session);

    try {
      const token = await whileCurrent(getStreamToken(channel, session.controller.signal), session);
      requireCurrent(session);
      const hlsUrl = buildHLSUrl(channel, token);

      if (supportsNativeHLS()) {
        window.dlog?.('HLSPlayer: playback path = native');
        video.src = hlsUrl;
        video.load();
        await whileCurrent(video.play(), session);
        requireCurrent(session);
      } else {
        window.dlog?.('HLSPlayer: playback path = hls.js');
        await whileCurrent(loadHLSjs(), session);
        requireCurrent(session);
        const instance = initHLSjs(video, session);
        if (!instance) throw new Error('Failed to initialize HLS.js');

        const ready = new Promise((resolve, reject) => {
          const onManifest = () => {
            if (!isCurrent(session)) return;
            video.play().then(resolve, error => {
              if (error.name === 'NotAllowedError') resolve();
              else reject(error);
            });
          };
          const onError = (event, data) => {
            if (data.fatal) reject(new Error(`HLS startup failed: ${data.details || data.type}`));
          };
          const timer = setTimeout(() => reject(new Error('Timeout loading stream')), 10000);
          const cleanup = () => {
            clearTimeout(timer);
            instance.off(Hls.Events.MANIFEST_PARSED, onManifest);
            instance.off(Hls.Events.ERROR, onError);
          };
          instance.on(Hls.Events.MANIFEST_PARSED, onManifest);
          instance.on(Hls.Events.ERROR, onError);
          session.cleanup.push(cleanup);
          session.startupCleanup = cleanup;
          instance.loadSource(hlsUrl);
          instance.attachMedia(video);
        });
        await whileCurrent(ready, session);
        requireCurrent(session);
        session.startupCleanup();
      }

      session.started = true;
      scheduleTokenRefresh(session);
      return true;
    } catch (error) {
      if (isCurrent(session)) stop();
      throw error;
    }
  }

  /**
   * Schedule token refresh to maintain playback
   */
  function scheduleTokenRefresh(session) {
    if (!isCurrent(session)) return;
    clearTokenRefresh();

    // Refresh token every 90 minutes (tokens last ~2 hours)
    tokenRefreshTimeout = setTimeout(async () => {
      if (isCurrent(session)) {
        console.log('HLSPlayer: Refreshing stream token');
        try {
          const token = await whileCurrent(getStreamToken(session.channel, session.controller.signal), session);
          requireCurrent(session);
          const hlsUrl = buildHLSUrl(session.channel, token);

          if (supportsNativeHLS()) {
            // For native HLS, we need to reload
            const currentTime = session.video.currentTime;
            session.video.src = hlsUrl;
            session.video.load();
            session.video.currentTime = currentTime;
            await whileCurrent(session.video.play(), session);
            requireCurrent(session);
          } else if (hlsInstance) {
            // HLS.js can load new source without interruption
            hlsInstance.loadSource(hlsUrl);
          }

          scheduleTokenRefresh(session);
        } catch (e) {
          if (!isCurrent(session)) return;
          console.error('HLSPlayer: Token refresh failed', e);
          scheduleTokenRefresh(session);
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
    const session = playbackSession;
    playbackSession = null;
    if (session) {
      session.controller.abort();
      session.cleanup.forEach(cleanup => cleanup());
    }
    clearTokenRefresh();

    if (window._hlsDriftTimer) {
      clearInterval(window._hlsDriftTimer);
      window._hlsDriftTimer = null;
    }

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
    videoElement = null;
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
