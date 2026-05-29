/* ================================================================
   SPOTIFY CONFIGURATION MODULE
   Embed URL handling and OAuth setup
   ================================================================ */

const BRIDGE_URL = 'http://localhost:8099';
const spotifyConfig = JSON.parse(localStorage.getItem('spotify-config') || '{}');

function convertToEmbedUrl(url) {
  if (!url) return null;

  // Already an embed URL
  if (url.includes('/embed/')) {
    return url;
  }

  // Extract type and ID from standard Spotify URLs
  const match = url.match(/spotify\.com\/(playlist|album|track|artist|show|episode)\/([a-zA-Z0-9]+)/);
  if (match) {
    const type = match[1];
    const id = match[2];
    return `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
  }

  // Try to use as-is if it looks like an embed URL
  if (url.includes('spotify.com')) {
    return url;
  }

  return null;
}

function initSpotify() {
  const spotifyIframe = document.getElementById('spotify-iframe');
  const spotifyConfigBtn = document.getElementById('spotify-config-btn');
  const spotifyModalOverlay = document.getElementById('spotify-modal-overlay');
  const spotifyModalClose = document.getElementById('spotify-modal-close');
  const spotifyTabs = document.querySelectorAll('.spotify-tab');
  const spotifyTabContents = document.querySelectorAll('.spotify-tab-content');
  const spotifyEmbedUrlInput = document.getElementById('spotify-embed-url');
  const spotifySaveEmbedBtn = document.getElementById('spotify-save-embed');
  const spotifyClientIdInput = document.getElementById('spotify-client-id');
  const spotifyClientSecretInput = document.getElementById('spotify-client-secret');
  const spotifyConnectOAuthBtn = document.getElementById('spotify-connect-oauth');
  const spotifyOAuthStatus = document.getElementById('spotify-oauth-status');

  // Initialize inputs with saved values
  if (spotifyConfig.embedUrl && spotifyEmbedUrlInput) {
    spotifyEmbedUrlInput.value = spotifyConfig.embedUrl;
  }
  if (spotifyConfig.clientId && spotifyClientIdInput) {
    spotifyClientIdInput.value = spotifyConfig.clientId;
  }

  // Apply saved embed URL on load
  if (spotifyConfig.embedUrl && spotifyIframe) {
    const embedUrl = convertToEmbedUrl(spotifyConfig.embedUrl);
    if (embedUrl) {
      spotifyIframe.src = embedUrl;
    }
  }

  // Check for existing OAuth token
  if (spotifyConfig.accessToken && spotifyOAuthStatus) {
    spotifyOAuthStatus.innerHTML = `
      <span class="status-dot connected"></span>
      <span>Connected</span>
    `;
  }

  // Open/close modal
  spotifyConfigBtn?.addEventListener('click', () => {
    spotifyModalOverlay?.classList.add('active');
  });

  spotifyModalClose?.addEventListener('click', () => {
    spotifyModalOverlay?.classList.remove('active');
  });

  spotifyModalOverlay?.addEventListener('click', (e) => {
    if (e.target === spotifyModalOverlay) {
      spotifyModalOverlay.classList.remove('active');
    }
  });

  // Tab switching
  spotifyTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;

      spotifyTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      spotifyTabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `tab-${tabId}`) {
          content.classList.add('active');
        }
      });
    });
  });

  // Save embed URL
  spotifySaveEmbedBtn?.addEventListener('click', () => {
    const rawUrl = spotifyEmbedUrlInput?.value.trim();
    const embedUrl = convertToEmbedUrl(rawUrl);

    if (embedUrl) {
      if (spotifyIframe) spotifyIframe.src = embedUrl;
      spotifyConfig.embedUrl = rawUrl;
      localStorage.setItem('spotify-config', JSON.stringify(spotifyConfig));
      spotifyModalOverlay?.classList.remove('active');
    } else {
      alert('Please enter a valid Spotify URL (playlist, album, track, etc.)');
    }
  });

  // OAuth connection (placeholder - requires backend support)
  spotifyConnectOAuthBtn?.addEventListener('click', async () => {
    const clientId = spotifyClientIdInput?.value.trim();
    const clientSecret = spotifyClientSecretInput?.value.trim();

    if (!clientId || !clientSecret) {
      alert('Please enter both Client ID and Client Secret');
      return;
    }

    // Save credentials
    spotifyConfig.clientId = clientId;
    spotifyConfig.clientSecret = clientSecret;
    localStorage.setItem('spotify-config', JSON.stringify(spotifyConfig));

    // Build OAuth URL
    const redirectUri = encodeURIComponent('https://localhost:8099');
    const scopes = encodeURIComponent([
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'streaming',
      'playlist-read-private',
      'playlist-read-collaborative'
    ].join(' '));

    const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scopes}`;

    // Check if Desktop Bridge is running
    try {
      const response = await fetch(`${BRIDGE_URL}/health`, { method: 'GET', mode: 'cors' });
      if (response.ok) {
        window.open(authUrl, 'spotify-auth', 'width=450,height=730');

        if (spotifyOAuthStatus) {
          spotifyOAuthStatus.innerHTML = `
            <span class="status-dot pending"></span>
            <span>Waiting for authorization...</span>
          `;
        }
      }
    } catch (e) {
      alert('Desktop Bridge must be running for OAuth callback. Start the bridge service first.');
    }
  });
}

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSpotify);
} else {
  initSpotify();
}
