/* ================================================================
   SMART WIDGET MODULE
   Apple-style page indicators for multi-source widgets
   Supports Twitch streams and YouTube videos
   ================================================================ */

/**
 * Smart Widget Configuration
 * Each source has: type ('twitch' | 'youtube'), url, label
 */
let smartWidgetConfig = {
  sources: [],
  currentPage: 0
};

let youtubeAPILoaded = false;
let youtubeAPIPromise = null; // Shared promise for API loading
let youtubePlayer = null;

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

/**
 * Extract YouTube video ID from various URL formats
 */
function parseYouTubeUrl(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Load YouTube IFrame API
 * Uses a shared promise so multiple simultaneous calls all resolve correctly
 */
function loadYouTubeAPI() {
  // Already loaded
  if (youtubeAPILoaded || window.YT) {
    youtubeAPILoaded = true;
    return Promise.resolve();
  }

  // Already loading - return the existing promise
  if (youtubeAPIPromise) {
    return youtubeAPIPromise;
  }

  // First call - create the shared promise
  youtubeAPIPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => {
      youtubeAPILoaded = true;
      resolve();
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });

  return youtubeAPIPromise;
}

/**
 * Create YouTube embed for a source
 */
function createYouTubeEmbed(containerId, videoId, muted = true) {
  return new Promise((resolve) => {
    loadYouTubeAPI().then(() => {
      const container = document.getElementById(containerId);
      if (!container) {
        resolve(null);
        return;
      }

      // Check if this YouTube page should auto-start based on saved page
      // Don't autoplay if Twitch (page 0) is the active page - saves CPU/bandwidth
      const savedPage = localStorage.getItem('smart-widget-current-page');
      const shouldAutoplay = savedPage !== null && savedPage !== '0';

      const player = new YT.Player(containerId, {
        videoId: videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: shouldAutoplay ? 1 : 0,
          mute: muted ? 1 : 0,
          controls: 1,
          loop: 1,
          playlist: videoId,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          origin: window.location.origin,
          widget_referrer: window.location.origin
        },
        events: {
          onReady: (event) => {
            // Check if this player's page is currently active and play if so
            // This fixes the race condition where switchToPage() runs before player is ready
            // Use getIframe() since YouTube replaces the original container div
            const iframe = event.target.getIframe();
            const page = iframe?.closest('.smart-widget-page');
            if (page && page.classList.contains('active')) {
              // Small delay to ensure iframe is fully rendered
              setTimeout(() => {
                event.target.playVideo();
              }, 100);
            } else {
              // Not active page - ensure video is stopped to save resources
              event.target.stopVideo();
            }

            // DISABLED: Ambient background was cloning iframe and breaking playback
            // const youtubeWrapper = iframe?.closest('.smart-widget-youtube');
            // if (youtubeWrapper) {
            //   setTimeout(() => {
            //     createAmbientBackground(youtubeWrapper);
            //   }, 200);
            // }

            resolve(player);
          },
          onStateChange: (event) => {
            if (event.data === YT.PlayerState.PLAYING) {
              // Notify other widgets that YouTube is playing (auto-pause Twitch)
              window.dispatchEvent(new CustomEvent('video-playback-start', {
                detail: { source: 'youtube', player: event.target }
              }));
            }
          }
        }
      });
    });
  });
}

/**
 * Initialize smart widget functionality for the media widget
 */
function initSmartWidget() {
  // Load saved config
  const savedConfig = localStorage.getItem('smart-widget-config');
  if (savedConfig) {
    try {
      smartWidgetConfig = { ...smartWidgetConfig, ...JSON.parse(savedConfig) };
    } catch (e) {
      console.warn('Failed to parse smart widget config:', e);
    }
  }

  // Restore saved current page (saved separately from config)
  const savedPage = localStorage.getItem('smart-widget-current-page');
  if (savedPage !== null) {
    const pageIndex = parseInt(savedPage, 10);
    if (!isNaN(pageIndex) && pageIndex >= 0) {
      smartWidgetConfig.currentPage = pageIndex;
    }
  }

  // Default sources if none configured: Twitch + cozy vibes video
  if (!smartWidgetConfig.sources || smartWidgetConfig.sources.length === 0) {
    smartWidgetConfig.sources = [
      { type: 'twitch', url: '', label: 'Twitch' },
      { type: 'youtube', url: 'https://www.youtube.com/watch?v=4xDzrJKXOOY', label: 'Cozy Vibes' }
    ];
    saveSmartWidgetConfig();
  }

  // Ensure currentPage is within valid range
  if (smartWidgetConfig.currentPage >= smartWidgetConfig.sources.length) {
    smartWidgetConfig.currentPage = 0;
  }

  buildSmartWidgetUI();

  // Listen for Twitch playback to auto-pause YouTube
  window.addEventListener('video-playback-start', (e) => {
    if (e.detail.source === 'twitch') {
      // Pause all YouTube players on non-active pages
      const twitchWidget = document.getElementById('twitch-widget');
      if (!twitchWidget) return;

      const pages = twitchWidget.querySelectorAll('.smart-widget-page');
      pages.forEach((page) => {
        if (page.youtubePlayer && typeof page.youtubePlayer.pauseVideo === 'function') {
          page.youtubePlayer.pauseVideo();
          console.log('[SmartWidget] Auto-paused YouTube because Twitch started playing');
        }
      });
    }
  });
}

/**
 * Build the smart widget UI with pages and indicators
 */
function buildSmartWidgetUI() {
  const twitchWidget = document.getElementById('twitch-widget');
  if (!twitchWidget) return;

  // Only show indicators if there's more than one source
  if (smartWidgetConfig.sources.length <= 1) {
    // Remove any existing indicators
    const existingIndicators = twitchWidget.querySelector('.smart-widget-indicators');
    if (existingIndicators) existingIndicators.remove();
    return;
  }

  // Add smart-widget class
  twitchWidget.classList.add('smart-widget');

  // Create or update indicators
  let indicatorsContainer = twitchWidget.querySelector('.smart-widget-indicators');
  if (!indicatorsContainer) {
    indicatorsContainer = document.createElement('div');
    indicatorsContainer.className = 'smart-widget-indicators';
    twitchWidget.appendChild(indicatorsContainer);
  }

  // Clear existing dots
  indicatorsContainer.innerHTML = '';

  // Create a dot for each source
  smartWidgetConfig.sources.forEach((source, index) => {
    const dot = document.createElement('button');
    dot.className = 'smart-widget-dot' + (index === smartWidgetConfig.currentPage ? ' active' : '');
    dot.title = source.label || `Page ${index + 1}`;
    dot.setAttribute('data-page', index);
    dot.addEventListener('click', () => switchToPage(index));
    indicatorsContainer.appendChild(dot);
  });

  // Create pages container if it doesn't exist
  let pagesContainer = twitchWidget.querySelector('.smart-widget-pages');
  if (!pagesContainer) {
    pagesContainer = document.createElement('div');
    pagesContainer.className = 'smart-widget-pages';

    // Move existing twitch content into first page
    const twitchEmbed = document.getElementById('twitch-embed');
    const twitchOffline = document.getElementById('twitch-offline');
    const twitchFallback = document.getElementById('twitch-fallback');

    const twitchPage = document.createElement('div');
    twitchPage.className = 'smart-widget-page active';
    twitchPage.setAttribute('data-page', '0');
    twitchPage.setAttribute('data-type', 'twitch');

    if (twitchEmbed) twitchPage.appendChild(twitchEmbed);
    if (twitchOffline) twitchPage.appendChild(twitchOffline);
    if (twitchFallback) twitchPage.appendChild(twitchFallback);

    pagesContainer.appendChild(twitchPage);

    // Insert pages container after config button
    const configBtn = twitchWidget.querySelector('.twitch-config-btn');
    if (configBtn) {
      configBtn.after(pagesContainer);
    } else {
      twitchWidget.prepend(pagesContainer);
    }
  }

  // Create additional pages for non-Twitch sources
  smartWidgetConfig.sources.forEach((source, index) => {
    if (index === 0) return; // First page is Twitch

    const pageId = `smart-widget-page-${index}`;
    let page = document.getElementById(pageId);

    if (!page) {
      page = document.createElement('div');
      page.id = pageId;
      page.className = 'smart-widget-page' + (index === smartWidgetConfig.currentPage ? ' active' : '');
      page.setAttribute('data-page', index);
      page.setAttribute('data-type', source.type);
      pagesContainer.appendChild(page);
    }

    // Initialize YouTube embed if needed
    if (source.type === 'youtube' && source.url) {
      const videoId = parseYouTubeUrl(source.url);
      if (videoId) {
        const embedId = `youtube-embed-${index}`;
        if (!document.getElementById(embedId)) {
          // Create wrapper (keeps the class after YT API replaces inner div)
          const youtubeWrapper = document.createElement('div');
          youtubeWrapper.className = 'smart-widget-youtube';
          // Create inner div that YouTube API will replace with iframe
          const youtubeInner = document.createElement('div');
          youtubeInner.id = embedId;
          youtubeWrapper.appendChild(youtubeInner);
          page.appendChild(youtubeWrapper);

          // Create YouTube embed (muted by default for non-primary)
          createYouTubeEmbed(embedId, videoId, true).then(player => {
            if (player) {
              page.youtubePlayer = player;
            }
          });
        }
      }
    }
  });

  // Show correct page
  switchToPage(smartWidgetConfig.currentPage);
}

/**
 * Switch to a specific page
 * Completely stops non-visible video streams to save CPU and bandwidth
 */
function switchToPage(pageIndex) {
  const twitchWidget = document.getElementById('twitch-widget');
  if (!twitchWidget) return;

  const previousPage = smartWidgetConfig.currentPage;
  smartWidgetConfig.currentPage = pageIndex;

  // Update dots
  const dots = twitchWidget.querySelectorAll('.smart-widget-dot');
  dots.forEach((dot, index) => {
    dot.classList.toggle('active', index === pageIndex);
  });

  // Update pages
  const pages = twitchWidget.querySelectorAll('.smart-widget-page');
  pages.forEach((page, index) => {
    const isActive = index === pageIndex;
    page.classList.toggle('active', isActive);

    // Handle YouTube playback - STOP completely when not visible
    if (page.youtubePlayer) {
      if (isActive) {
        page.youtubePlayer.playVideo();
      } else {
        // Stop video completely to save bandwidth/CPU (not just pause)
        page.youtubePlayer.stopVideo();
      }
    }

    // Handle Twitch playback (page 0) - STOP completely when not visible
    if (index === 0) {
      const hlsVideo = document.getElementById('hls-video');

      if (isActive) {
        // Switching TO Twitch - restart the stream if it was stopped
        if (window.HLSPlayer && !window.HLSPlayer.isPlaying()) {
          // Get current channel from twitchStreamInfo or config
          const channel = window.twitchStreamInfo?.channel ||
            (window.getDashboardConfig?.()?.twitch?.channel) ||
            JSON.parse(localStorage.getItem('dashboard-config') || '{}')?.twitch?.channel;

          if (channel && hlsVideo) {
            console.log('[SmartWidget] Restarting HLS stream for:', channel);
            window.HLSPlayer.play(channel, hlsVideo).catch(e => {
              console.log('[SmartWidget] HLS restart failed:', e);
            });
          }
        } else if (hlsVideo) {
          // HLS still playing, just unmute and ensure playing
          hlsVideo.muted = false;
          hlsVideo.play().catch(e => console.log('HLS autoplay blocked:', e));
        }

        // Handle native Twitch embed - restore iframe src
        const twitchEmbed = document.getElementById('twitch-embed');
        if (twitchEmbed) {
          const iframe = twitchEmbed.querySelector('iframe');
          if (iframe && iframe.dataset.originalSrc) {
            iframe.src = iframe.dataset.originalSrc;
            delete iframe.dataset.originalSrc;
            console.log('[SmartWidget] Twitch iframe restored');
          }
        }
      } else {
        // Switching AWAY from Twitch - STOP completely to save CPU/bandwidth
        console.log('[SmartWidget] Switching away from Twitch - stopping all playback');

        // Stop HLS player module (destroys stream connection)
        if (window.HLSPlayer) {
          try {
            window.HLSPlayer.stop();
            console.log('[SmartWidget] HLSPlayer.stop() called');
          } catch (e) {
            console.log('[SmartWidget] HLSPlayer.stop() error:', e);
          }
        }

        // Also directly stop the video element
        if (hlsVideo) {
          hlsVideo.pause();
          hlsVideo.muted = true;
          // Clear the source to fully stop network activity
          hlsVideo.removeAttribute('src');
          hlsVideo.load();
          console.log('[SmartWidget] HLS video element stopped and cleared');
        }

        // Handle native Twitch embed - clear iframe to fully stop
        const twitchEmbed = document.getElementById('twitch-embed');
        if (twitchEmbed) {
          const iframe = twitchEmbed.querySelector('iframe');
          if (iframe && iframe.src && !iframe.src.includes('about:blank')) {
            iframe.dataset.originalSrc = iframe.src;
            iframe.src = 'about:blank';
            console.log('[SmartWidget] Twitch iframe stopped');
          }
        }
      }
    }
  });

  // Save current page to localStorage
  localStorage.setItem('smart-widget-current-page', pageIndex.toString());
}

/**
 * Add a new source to the smart widget
 */
function addSmartWidgetSource(type, url, label) {
  smartWidgetConfig.sources.push({ type, url, label });
  saveSmartWidgetConfig();
  buildSmartWidgetUI();
}

/**
 * Update a source in the smart widget
 */
function updateSmartWidgetSource(index, type, url, label) {
  if (index >= 0 && index < smartWidgetConfig.sources.length) {
    smartWidgetConfig.sources[index] = { type, url, label };
    saveSmartWidgetConfig();
    buildSmartWidgetUI();
  }
}

/**
 * Remove a source from the smart widget
 */
function removeSmartWidgetSource(index) {
  if (index > 0 && index < smartWidgetConfig.sources.length) { // Can't remove first (Twitch)
    smartWidgetConfig.sources.splice(index, 1);
    if (smartWidgetConfig.currentPage >= smartWidgetConfig.sources.length) {
      smartWidgetConfig.currentPage = 0;
    }
    saveSmartWidgetConfig();
    buildSmartWidgetUI();
  }
}

/**
 * Save smart widget config to localStorage
 */
function saveSmartWidgetConfig() {
  localStorage.setItem('smart-widget-config', JSON.stringify(smartWidgetConfig));
}

/**
 * Get current smart widget config
 */
function getSmartWidgetConfig() {
  return { ...smartWidgetConfig };
}

/**
 * Set full smart widget config (used by settings panel)
 */
function setSmartWidgetConfig(config) {
  smartWidgetConfig = { ...smartWidgetConfig, ...config };
  saveSmartWidgetConfig();

  // Rebuild UI to reflect new config
  rebuildSmartWidgetPages();
}

/**
 * Rebuild smart widget pages (called after config changes)
 */
function rebuildSmartWidgetPages() {
  const twitchWidget = document.getElementById('twitch-widget');
  if (!twitchWidget) return;

  // Remove existing additional pages (keep first Twitch page)
  const pagesContainer = twitchWidget.querySelector('.smart-widget-pages');
  if (pagesContainer) {
    const additionalPages = pagesContainer.querySelectorAll('.smart-widget-page:not([data-page="0"])');
    additionalPages.forEach(page => page.remove());
  }

  // Remove existing indicators
  const indicators = twitchWidget.querySelector('.smart-widget-indicators');
  if (indicators) indicators.remove();

  // Rebuild
  buildSmartWidgetUI();
}

// Expose functions globally for settings panel
window.SmartWidget = {
  init: initSmartWidget,
  getConfig: getSmartWidgetConfig,
  setConfig: setSmartWidgetConfig,
  addSource: addSmartWidgetSource,
  updateSource: updateSmartWidgetSource,
  removeSource: removeSmartWidgetSource,
  switchToPage: switchToPage,
  parseYouTubeUrl: parseYouTubeUrl
};

// Auto-initialize after Twitch widget loads
document.addEventListener('dashboard-ready', () => {
  // Small delay to ensure Twitch widget is fully loaded
  setTimeout(initSmartWidget, 100);
});

// Also initialize if DOM is already ready
if (document.readyState !== 'loading') {
  setTimeout(() => {
    if (document.getElementById('twitch-widget')) {
      initSmartWidget();
    }
  }, 500);
}
