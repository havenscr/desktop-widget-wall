/* ================================================================
   SETTINGS PANEL MODULE
   Global dashboard configuration
   ================================================================ */

let dashboardConfig = JSON.parse(localStorage.getItem('dashboard-config') || '{}');

// Initialize defaults
dashboardConfig = {
  bridgePort: 8099,
  twitch: { channel: 'anya', enabled: true },
  countdown: { title: 'Days to Event', targetDate: '' },
  claude: { gistUrl: '', enabled: true },
  visualizer: { defaultMode: 'demo' },
  background: { type: 'mountains', customSvg: null },
  ...dashboardConfig
};

// Pending background SVG (before save)
let pendingBackgroundSvg = null;

function populateSettingsPanel() {
  const settingsBridgePort = document.getElementById('settings-bridge-port');
  const settingsTwitchChannel = document.getElementById('settings-twitch-channel');
  const settingsTwitchEnabled = document.getElementById('settings-twitch-enabled');
  const settingsTwitchVideoMode = document.getElementById('settings-twitch-video-mode');
  const settingsHlsWorkerUrl = document.getElementById('settings-hls-worker-url');
  const settingsHlsWorkerRow = document.getElementById('settings-hls-worker-row');
  const settingsTwitchChatMode = document.getElementById('settings-twitch-chat-mode');
  const settingsTwitchEmoteChannels = document.getElementById('settings-twitch-emote-channels');
  const settingsTwitchAutoloadFollowed = document.getElementById('settings-twitch-autoload-followed');
  const settingsCountdownTitle = document.getElementById('settings-countdown-title');
  const settingsCountdownDate = document.getElementById('settings-countdown-date');
  const settingsClaudeGist = document.getElementById('settings-claude-gist');
  const settingsClaudeEnabled = document.getElementById('settings-claude-enabled');
  const settingsVisualizerMode = document.getElementById('settings-visualizer-mode');
  const settingsHcClientId = document.getElementById('settings-hc-client-id');
  const settingsAeClientId = document.getElementById('settings-ae-client-id');

  if (settingsBridgePort) settingsBridgePort.value = dashboardConfig.bridgePort || 8099;
  if (settingsHcClientId) settingsHcClientId.value = dashboardConfig.hcClientId || '';
  if (settingsTwitchChannel) settingsTwitchChannel.value = dashboardConfig.twitch?.channel || 'anya';
  if (settingsTwitchEnabled) settingsTwitchEnabled.checked = dashboardConfig.twitch?.enabled !== false;
  if (settingsTwitchVideoMode) settingsTwitchVideoMode.value = dashboardConfig.twitch?.hlsEnabled ? 'hls' : 'embed';
  if (settingsHlsWorkerUrl) settingsHlsWorkerUrl.value = dashboardConfig.twitch?.hlsWorkerUrl || 'https://bold-art-d9fe.havenscr.workers.dev';
  if (settingsHlsWorkerRow) settingsHlsWorkerRow.style.display = dashboardConfig.twitch?.hlsEnabled ? 'flex' : 'none';
  if (settingsTwitchChatMode) settingsTwitchChatMode.value = dashboardConfig.twitch?.chatMode || 'iframe';
  if (settingsTwitchEmoteChannels) settingsTwitchEmoteChannels.value = dashboardConfig.twitch?.emoteChannels || '';
  if (settingsTwitchAutoloadFollowed) settingsTwitchAutoloadFollowed.checked = dashboardConfig.twitch?.autoloadFollowedEmotes === true;
  if (settingsAeClientId) settingsAeClientId.value = dashboardConfig.aeClientId || '';

  if (settingsCountdownTitle) settingsCountdownTitle.value = dashboardConfig.countdown?.title || '';
  if (settingsCountdownDate) settingsCountdownDate.value = dashboardConfig.countdown?.targetDate || '';
  if (settingsClaudeGist) settingsClaudeGist.value = dashboardConfig.claude?.gistUrl || '';
  if (settingsClaudeEnabled) settingsClaudeEnabled.checked = dashboardConfig.claude?.enabled !== false;
  if (settingsVisualizerMode) settingsVisualizerMode.value = dashboardConfig.visualizer?.defaultMode || 'demo';

  // Location Services settings
  const settingsGoogleMapsKey = document.getElementById('settings-google-maps-key');
  const settingsLeaveNotifications = document.getElementById('settings-leave-notifications');
  if (settingsGoogleMapsKey) settingsGoogleMapsKey.value = dashboardConfig.googleMapsApiKey || '';
  if (settingsLeaveNotifications) settingsLeaveNotifications.checked = dashboardConfig.leaveNotificationsEnabled !== false;
  const settingsHomeAddress = document.getElementById('settings-home-address');
  if (settingsHomeAddress) settingsHomeAddress.value = dashboardConfig.homeAddress || '';

  // Startup Window settings
  const settingsWindowMonitor = document.getElementById('settings-window-monitor');
  const settingsWindowWidth = document.getElementById('settings-window-width');
  const settingsWindowHeight = document.getElementById('settings-window-height');

  if (settingsWindowMonitor) settingsWindowMonitor.value = localStorage.getItem('windowMonitor') || '2';
  if (settingsWindowWidth) settingsWindowWidth.value = localStorage.getItem('windowWidth') || '2304';
  if (settingsWindowHeight) settingsWindowHeight.value = localStorage.getItem('windowHeight') || '648';

  // Background settings
  populateBackgroundSettings();

  updateBridgeStatusDisplay();
  updateMicrosoftStatusDisplay();
  renderMediaSourcesList();
}

/**
 * Populate background settings UI
 */
function populateBackgroundSettings() {
  const bgTypeSelect = document.getElementById('settings-background-type');
  const uploadRow = document.getElementById('settings-background-upload-row');
  const previewRow = document.getElementById('settings-background-preview-row');
  const preview = document.getElementById('settings-background-preview');
  const clearBtn = document.getElementById('settings-background-clear');

  // Reset pending state
  pendingBackgroundSvg = null;

  const bgConfig = dashboardConfig.background || { type: 'mountains', customSvg: null };

  if (bgTypeSelect) {
    bgTypeSelect.value = bgConfig.type || 'mountains';
  }

  // Show/hide upload row based on type
  const isCustom = bgConfig.type === 'custom';
  if (uploadRow) uploadRow.style.display = isCustom ? 'flex' : 'none';

  // Show preview if custom SVG exists
  if (isCustom && bgConfig.customSvg) {
    if (previewRow) previewRow.style.display = 'flex';
    if (preview) {
      preview.innerHTML = `<img src="${bgConfig.customSvg}" alt="Background preview">`;
    }
    if (clearBtn) clearBtn.style.display = 'inline-block';
  } else {
    if (previewRow) previewRow.style.display = 'none';
    if (preview) preview.innerHTML = '';
    if (clearBtn) clearBtn.style.display = 'none';
  }
}

/**
 * Render the media sources list in settings panel
 */
function renderMediaSourcesList() {
  const listContainer = document.getElementById('media-sources-list');
  if (!listContainer) return;

  // Get current config from SmartWidget
  const config = window.SmartWidget?.getConfig() || { sources: [{ type: 'twitch', url: '', label: 'Twitch' }] };
  const sources = config.sources || [];

  listContainer.innerHTML = '';

  sources.forEach((source, index) => {
    const item = document.createElement('div');
    item.className = 'media-source-item' + (index === 0 ? ' is-primary' : '');
    item.setAttribute('data-index', index);

    if (index === 0) {
      // Twitch is primary and not removable
      item.innerHTML = `
        <div class="media-source-icon twitch">
          <svg viewBox="0 0 24 24"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>
        </div>
        <div class="media-source-info">
          <div class="media-source-label">Twitch Stream<span class="media-source-badge">Primary</span></div>
          <div class="media-source-url">Configured in Twitch section above</div>
        </div>
      `;
    } else {
      // YouTube sources are editable and removable
      item.innerHTML = `
        <div class="media-source-icon youtube">
          <svg viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
        </div>
        <input type="text" class="media-source-input" placeholder="YouTube URL (e.g., https://youtube.com/watch?v=...)" value="${source.url || ''}" data-index="${index}">
        <button class="media-source-remove" title="Remove" data-index="${index}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      `;

      // Add input event listener
      const input = item.querySelector('.media-source-input');
      input?.addEventListener('input', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'));
        updateMediaSourceUrl(idx, e.target.value);
      });

      // Add remove button listener
      const removeBtn = item.querySelector('.media-source-remove');
      removeBtn?.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-index'));
        removeMediaSource(idx);
      });
    }

    listContainer.appendChild(item);
  });
}

/**
 * Add a new YouTube media source
 */
function addMediaSource() {
  if (!window.SmartWidget) return;

  const config = window.SmartWidget.getConfig();
  config.sources.push({
    type: 'youtube',
    url: '',
    label: `Video ${config.sources.length}`
  });
  window.SmartWidget.setConfig(config);
  renderMediaSourcesList();
}

/**
 * Update a media source URL
 */
function updateMediaSourceUrl(index, url) {
  if (!window.SmartWidget || index <= 0) return; // Can't update Twitch this way

  const config = window.SmartWidget.getConfig();
  if (config.sources[index]) {
    config.sources[index].url = url;
    // Extract video title or use index as label
    const videoId = window.SmartWidget.parseYouTubeUrl(url);
    config.sources[index].label = videoId ? `Video ${index}` : `Video ${index}`;
    // Don't call setConfig here - wait for save button
    // Just store in a pending state
    window._pendingMediaSources = config.sources;
  }
}

/**
 * Remove a media source
 */
function removeMediaSource(index) {
  if (!window.SmartWidget || index <= 0) return; // Can't remove Twitch

  const config = window.SmartWidget.getConfig();
  config.sources.splice(index, 1);
  window.SmartWidget.setConfig(config);
  renderMediaSourcesList();
}

function updateBridgeStatusDisplay() {
  const settingsBridgeStatus = document.getElementById('settings-bridge-status');
  if (!settingsBridgeStatus) return;

  const statusDot = settingsBridgeStatus.querySelector('.settings-status-dot');
  const statusText = settingsBridgeStatus.querySelector('span:last-child');
  const mixerConnected = window.mixerConnected ? window.mixerConnected() : false;

  if (statusDot && statusText) {
    if (mixerConnected) {
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
    } else {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Disconnected';
    }
  }
}

function updateMicrosoftStatusDisplay() {
  // Update HC account status
  updateAccountStatusDisplay('hc');
  // Update AE account status
  updateAccountStatusDisplay('ae');
}

function updateAccountStatusDisplay(accountType) {
  const isHc = accountType === 'hc';
  const prefix = isHc ? 'settings-microsoft' : 'settings-ae';

  const statusEl = document.getElementById(`${prefix}-status`);
  const userEl = document.getElementById(`${prefix}-user`);
  const connectBtn = document.getElementById(`${prefix}-connect`);
  const disconnectBtn = document.getElementById(`${prefix}-disconnect`);
  const authCodeRow = document.getElementById(isHc ? 'settings-auth-code-row' : 'settings-ae-auth-code-row');
  const authCodeInputRow = document.getElementById(isHc ? 'settings-auth-code-input-row' : 'settings-ae-auth-code-input-row');

  if (!statusEl) return;

  const statusDot = statusEl.querySelector('.settings-status-dot');
  const isAuthenticated = typeof MicrosoftAuth !== 'undefined' && MicrosoftAuth.isAuthenticated(accountType);
  const hasPending = typeof MicrosoftAuth !== 'undefined' && MicrosoftAuth.hasPendingSignIn();

  // For AE, check if client ID is configured
  const aeClientId = dashboardConfig.aeClientId;
  const isAeConfigured = !isHc && aeClientId && aeClientId.length > 10;

  if (isAuthenticated) {
    const account = MicrosoftAuth.getAccount(accountType);
    if (statusDot) statusDot.classList.add('connected');
    if (userEl) userEl.textContent = account?.username || 'Connected';
    if (connectBtn) {
      connectBtn.style.display = 'none';
      connectBtn.textContent = 'Connect Account';
      connectBtn.disabled = false;
    }
    if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
    if (authCodeRow) authCodeRow.style.display = 'none';
    if (authCodeInputRow) authCodeInputRow.style.display = 'none';
  } else {
    if (statusDot) statusDot.classList.remove('connected');

    if (!isHc && !isAeConfigured) {
      // AE not configured
      if (userEl) userEl.textContent = 'Not configured';
      if (connectBtn) {
        connectBtn.style.display = 'inline-block';
        connectBtn.disabled = true;
        connectBtn.textContent = 'Connect Account';
      }
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (authCodeRow) authCodeRow.style.display = 'none';
      if (authCodeInputRow) authCodeInputRow.style.display = 'none';
    } else {
      // HC or configured AE
      if (userEl) userEl.textContent = hasPending ? 'Waiting for code...' : 'Not connected';
      if (connectBtn) {
        connectBtn.style.display = hasPending ? 'none' : 'inline-block';
        connectBtn.disabled = false;
        if (!hasPending) {
          connectBtn.textContent = 'Connect Account';
        }
      }
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (authCodeRow) authCodeRow.style.display = hasPending ? 'flex' : 'none';
      if (authCodeInputRow) authCodeInputRow.style.display = hasPending ? 'flex' : 'none';
    }
  }
}

/**
 * Show error message in Microsoft status area (temporary)
 */
function showMicrosoftError(message) {
  const userEl = document.getElementById('settings-microsoft-user');
  if (userEl) {
    userEl.textContent = message;
    userEl.style.color = '#ef4444';
    // After 3 seconds, refresh the display to show correct state
    setTimeout(() => {
      userEl.style.color = '';
      updateMicrosoftStatusDisplay();
    }, 3000);
  }
}

/**
 * Show error message in AE status area (temporary)
 */
function showAeError(message) {
  const userEl = document.getElementById('settings-ae-user');
  if (userEl) {
    userEl.textContent = message;
    userEl.style.color = '#ef4444';
    setTimeout(() => {
      userEl.style.color = '';
      updateMicrosoftStatusDisplay();
    }, 3000);
  }
}

function saveSettings() {
  const settingsBridgePort = document.getElementById('settings-bridge-port');
  const settingsTwitchChannel = document.getElementById('settings-twitch-channel');
  const settingsTwitchEnabled = document.getElementById('settings-twitch-enabled');
  const settingsTwitchVideoMode = document.getElementById('settings-twitch-video-mode');
  const settingsHlsWorkerUrl = document.getElementById('settings-hls-worker-url');
  const settingsTwitchChatMode = document.getElementById('settings-twitch-chat-mode');
  const settingsTwitchEmoteChannels = document.getElementById('settings-twitch-emote-channels');
  const settingsTwitchAutoloadFollowed = document.getElementById('settings-twitch-autoload-followed');
  const settingsCountdownTitle = document.getElementById('settings-countdown-title');
  const settingsCountdownDate = document.getElementById('settings-countdown-date');
  const settingsClaudeGist = document.getElementById('settings-claude-gist');
  const settingsClaudeEnabled = document.getElementById('settings-claude-enabled');
  const settingsVisualizerMode = document.getElementById('settings-visualizer-mode');
  const settingsHcClientId = document.getElementById('settings-hc-client-id');
  const settingsAeClientId = document.getElementById('settings-ae-client-id');

  dashboardConfig.bridgePort = parseInt(settingsBridgePort?.value) || 8099;
  dashboardConfig.twitch = {
    channel: settingsTwitchChannel?.value.trim() || 'anya',
    enabled: settingsTwitchEnabled?.checked !== false,
    hlsEnabled: settingsTwitchVideoMode?.value === 'hls',
    hlsWorkerUrl: settingsHlsWorkerUrl?.value.trim() || 'https://bold-art-d9fe.havenscr.workers.dev',
    chatMode: settingsTwitchChatMode?.value || 'iframe',
    emoteChannels: settingsTwitchEmoteChannels?.value.trim() || '',
    autoloadFollowedEmotes: settingsTwitchAutoloadFollowed?.checked === true
  };
  dashboardConfig.countdown = {
    title: settingsCountdownTitle?.value.trim() || 'Days to Event',
    targetDate: settingsCountdownDate?.value || ''
  };
  dashboardConfig.claude = {
    gistUrl: settingsClaudeGist?.value.trim() || '',
    enabled: settingsClaudeEnabled?.checked !== false
  };
  dashboardConfig.visualizer = {
    defaultMode: settingsVisualizerMode?.value || 'demo'
  };
  dashboardConfig.hcClientId = settingsHcClientId?.value.trim() || '';
  dashboardConfig.aeClientId = settingsAeClientId?.value.trim() || '';

  // Location Services settings
  dashboardConfig.googleMapsApiKey = document.getElementById('settings-google-maps-key')?.value.trim() || '';
  dashboardConfig.leaveNotificationsEnabled = document.getElementById('settings-leave-notifications')?.checked !== false;
  dashboardConfig.homeAddress = document.getElementById('settings-home-address')?.value.trim() || '';

  // Save Startup Window settings
  const settingsWindowMonitor = document.getElementById('settings-window-monitor');
  const settingsWindowWidth = document.getElementById('settings-window-width');
  const settingsWindowHeight = document.getElementById('settings-window-height');

  localStorage.setItem('windowMonitor', settingsWindowMonitor?.value || '2');
  localStorage.setItem('windowWidth', settingsWindowWidth?.value || '2304');
  localStorage.setItem('windowHeight', settingsWindowHeight?.value || '648');

  localStorage.setItem('dashboard-config', JSON.stringify(dashboardConfig));

  // Notify other widgets that config changed (e.g., Twitch chat needs to reconnect)
  window.dispatchEvent(new CustomEvent('dashboard-config-changed', { detail: dashboardConfig }));

  // Update countdown if function exists
  if (typeof updateCountdownConfig === 'function') {
    updateCountdownConfig(dashboardConfig.countdown.title, dashboardConfig.countdown.targetDate);
  }

  // Update widget visibility
  const twitchWidget = document.querySelector('.widget-twitch');
  if (twitchWidget) {
    twitchWidget.style.display = dashboardConfig.twitch.enabled ? '' : 'none';
  }

  const claudeWidget = document.querySelector('.widget-claudestats');
  if (claudeWidget) {
    claudeWidget.style.display = dashboardConfig.claude.enabled ? '' : 'none';
  }

  // Save pending media sources if any
  if (window._pendingMediaSources && window.SmartWidget) {
    const config = window.SmartWidget.getConfig();
    config.sources = window._pendingMediaSources;
    window.SmartWidget.setConfig(config);
    delete window._pendingMediaSources;
  }

  // Save background settings
  const bgTypeSelect = document.getElementById('settings-background-type');
  const bgType = bgTypeSelect?.value || 'mountains';

  dashboardConfig.background = {
    type: bgType,
    customSvg: bgType === 'custom' ? (pendingBackgroundSvg || dashboardConfig.background?.customSvg || null) : null
  };

  // Clear pending state
  pendingBackgroundSvg = null;

  // Re-save with background config
  localStorage.setItem('dashboard-config', JSON.stringify(dashboardConfig));

  // Apply background immediately
  applyBackground();
}

/**
 * Apply background from config
 */
function applyBackground() {
  const bgConfig = dashboardConfig.background || { type: 'mountains', customSvg: null };

  if (bgConfig.type === 'custom' && bgConfig.customSvg) {
    document.body.classList.add('custom-bg');
    document.documentElement.style.setProperty('--background-image', `url("${bgConfig.customSvg}")`);
  } else {
    document.body.classList.remove('custom-bg');
    document.documentElement.style.removeProperty('--background-image');
  }
}

function applyInitialConfig() {
  const twitchWidget = document.querySelector('.widget-twitch');
  if (twitchWidget && dashboardConfig.twitch?.enabled === false) {
    twitchWidget.style.display = 'none';
  }

  const claudeWidget = document.querySelector('.widget-claudestats');
  if (claudeWidget && dashboardConfig.claude?.enabled === false) {
    claudeWidget.style.display = 'none';
  }

  // Apply background on initial load
  applyBackground();
}

function initSettingsPanel() {
  const globalSettingsBtn = document.getElementById('global-settings-btn');
  const settingsPanelOverlay = document.getElementById('settings-panel-overlay');
  const settingsPanelClose = document.getElementById('settings-panel-close');
  const settingsSaveBtn = document.getElementById('settings-save-btn');

  globalSettingsBtn?.addEventListener('click', () => {
    populateSettingsPanel();
    settingsPanelOverlay?.classList.add('active');
  });

  settingsPanelClose?.addEventListener('click', () => {
    settingsPanelOverlay?.classList.remove('active');
  });

  settingsPanelOverlay?.addEventListener('click', (e) => {
    if (e.target === settingsPanelOverlay) {
      settingsPanelOverlay.classList.remove('active');
    }
  });

  settingsSaveBtn?.addEventListener('click', () => {
    saveSettings();
    settingsPanelOverlay?.classList.remove('active');
  });

  // Microsoft account connect/disconnect
  const msConnectBtn = document.getElementById('settings-microsoft-connect');
  const msDisconnectBtn = document.getElementById('settings-microsoft-disconnect');

  msConnectBtn?.addEventListener('click', async () => {
    console.log('HC Connect Account button clicked');
    if (typeof MicrosoftAuth === 'undefined') {
      console.error('MicrosoftAuth module not loaded');
      showMicrosoftError('Auth module not loaded');
      return;
    }

    try {
      msConnectBtn.textContent = 'Opening browser...';
      msConnectBtn.disabled = true;

      const result = await MicrosoftAuth.signIn('hc');
      console.log('MicrosoftAuth.signIn result:', result);

      // If we're in Tauri and got pendingCode, show the auth code input
      if (result?.pendingCode) {
        msConnectBtn.textContent = 'Waiting for code...';
        updateMicrosoftStatusDisplay();
      } else {
        updateMicrosoftStatusDisplay();
      }
    } catch (error) {
      console.error('Microsoft sign-in failed:', error);
      showMicrosoftError('Sign-in failed');
      msConnectBtn.textContent = 'Connect Account';
      msConnectBtn.disabled = false;
    }
  });

  // Auth code submit button
  const authCodeSubmitBtn = document.getElementById('settings-auth-code-submit');
  const authCodeInput = document.getElementById('settings-auth-code');

  authCodeSubmitBtn?.addEventListener('click', async () => {
    const code = authCodeInput?.value?.trim();
    if (!code) {
      showMicrosoftError('Please paste auth code');
      return;
    }

    if (typeof MicrosoftAuth !== 'undefined') {
      try {
        authCodeSubmitBtn.textContent = 'Verifying...';
        authCodeSubmitBtn.disabled = true;
        await MicrosoftAuth.completeSignIn(code, 'hc');
        authCodeInput.value = '';
        updateMicrosoftStatusDisplay();
        // Refresh calendar and inbox widgets
        if (typeof initCalendarWidget === 'function') {
          initCalendarWidget();
        }
        if (typeof initInboxWidget === 'function') {
          initInboxWidget();
        }
      } catch (error) {
        console.error('Auth code submission failed:', error);
        showMicrosoftError('Verification failed - try again');
        authCodeInput.value = '';
        updateMicrosoftStatusDisplay();
      } finally {
        authCodeSubmitBtn.textContent = 'Submit';
        authCodeSubmitBtn.disabled = false;
      }
    }
  });

  // Auth code cancel button (HC)
  const authCodeCancelBtn = document.getElementById('settings-auth-code-cancel');
  authCodeCancelBtn?.addEventListener('click', async () => {
    if (typeof MicrosoftAuth !== 'undefined') {
      await MicrosoftAuth.cancelPendingSignIn();
      if (authCodeInput) authCodeInput.value = '';
    }

    // Reset the UI elements for HC
    const hcConnectBtn = document.getElementById('settings-microsoft-connect');
    const hcUserEl = document.getElementById('settings-microsoft-user');
    const hcAuthCodeRow = document.getElementById('settings-auth-code-row');
    const hcAuthCodeInputRow = document.getElementById('settings-auth-code-input-row');

    if (hcConnectBtn) {
      hcConnectBtn.style.display = 'inline-block';
      hcConnectBtn.textContent = 'Connect Account';
    }
    if (hcUserEl) {
      hcUserEl.textContent = 'Not connected';
    }
    if (hcAuthCodeRow) {
      hcAuthCodeRow.style.display = 'none';
    }
    if (hcAuthCodeInputRow) {
      hcAuthCodeInputRow.style.display = 'none';
    }
  });

  msDisconnectBtn?.addEventListener('click', async () => {
    if (typeof MicrosoftAuth !== 'undefined') {
      try {
        await MicrosoftAuth.signOut('hc');
        updateMicrosoftStatusDisplay();
      } catch (error) {
        console.error('Microsoft sign-out failed:', error);
      }
    }
  });

  // AE account connect/disconnect
  const aeConnectBtn = document.getElementById('settings-ae-connect');
  const aeDisconnectBtn = document.getElementById('settings-ae-disconnect');
  const aeClientIdInput = document.getElementById('settings-ae-client-id');

  // Enable/disable AE connect button based on client ID
  aeClientIdInput?.addEventListener('input', () => {
    const hasClientId = aeClientIdInput.value.trim().length > 10;
    if (aeConnectBtn) {
      aeConnectBtn.disabled = !hasClientId;
    }
  });

  aeConnectBtn?.addEventListener('click', async () => {
    if (typeof MicrosoftAuth === 'undefined') {
      showAeError('Auth module not loaded');
      return;
    }

    // Get and validate client ID
    const clientIdValue = aeClientIdInput?.value.trim();
    if (!clientIdValue || clientIdValue.length < 30) {
      showAeError('Enter Client ID first');
      aeClientIdInput?.focus();
      return;
    }

    // Save the client ID first if it changed
    if (clientIdValue !== dashboardConfig.aeClientId) {
      dashboardConfig.aeClientId = clientIdValue;
      localStorage.setItem('dashboard-config', JSON.stringify(dashboardConfig));
      // Dispatch config change so auth module can pick up new client ID
      window.dispatchEvent(new CustomEvent('dashboard-config-changed', { detail: dashboardConfig }));
    }

    try {
      aeConnectBtn.textContent = 'Opening browser...';
      aeConnectBtn.disabled = true;

      const result = await MicrosoftAuth.signIn('ae');

      if (result?.pendingCode) {
        aeConnectBtn.textContent = 'Waiting for code...';
        updateMicrosoftStatusDisplay();
      } else {
        updateMicrosoftStatusDisplay();
      }
    } catch (error) {
      console.error('AE sign-in failed:', error);
      showAeError('Sign-in failed: ' + error.message);
      aeConnectBtn.textContent = 'Connect Account';
      aeConnectBtn.disabled = false;
    }
  });

  // AE Auth code submit button
  const aeAuthCodeSubmitBtn = document.getElementById('settings-ae-auth-code-submit');
  const aeAuthCodeInput = document.getElementById('settings-ae-auth-code');

  aeAuthCodeSubmitBtn?.addEventListener('click', async () => {
    const code = aeAuthCodeInput?.value?.trim();
    if (!code) {
      showAeError('Please paste auth code');
      return;
    }

    if (typeof MicrosoftAuth !== 'undefined') {
      try {
        aeAuthCodeSubmitBtn.textContent = 'Verifying...';
        aeAuthCodeSubmitBtn.disabled = true;
        await MicrosoftAuth.completeSignIn(code, 'ae');
        aeAuthCodeInput.value = '';
        updateMicrosoftStatusDisplay();
      } catch (error) {
        console.error('AE auth code submission failed:', error);
        showAeError('Verification failed');
        aeAuthCodeInput.value = '';
        updateMicrosoftStatusDisplay();
      } finally {
        aeAuthCodeSubmitBtn.textContent = 'Submit';
        aeAuthCodeSubmitBtn.disabled = false;
      }
    }
  });

  // AE Auth code cancel button
  const aeAuthCodeCancelBtn = document.getElementById('settings-ae-auth-code-cancel');
  aeAuthCodeCancelBtn?.addEventListener('click', async () => {
    if (typeof MicrosoftAuth !== 'undefined') {
      await MicrosoftAuth.cancelPendingSignIn();
      if (aeAuthCodeInput) aeAuthCodeInput.value = '';
    }

    // Reset the UI elements for AE
    const aeConnectBtn = document.getElementById('settings-ae-connect');
    const aeUserEl = document.getElementById('settings-ae-user');
    const aeAuthCodeRow = document.getElementById('settings-ae-auth-code-row');
    const aeAuthCodeInputRow = document.getElementById('settings-ae-auth-code-input-row');

    if (aeConnectBtn) {
      aeConnectBtn.style.display = 'inline-block';
      aeConnectBtn.textContent = 'Connect Account';
    }
    if (aeUserEl) {
      aeUserEl.textContent = dashboardConfig.aeClientId ? 'Not connected' : 'Not configured';
    }
    if (aeAuthCodeRow) {
      aeAuthCodeRow.style.display = 'none';
    }
    if (aeAuthCodeInputRow) {
      aeAuthCodeInputRow.style.display = 'none';
    }
  });

  aeDisconnectBtn?.addEventListener('click', async () => {
    if (typeof MicrosoftAuth !== 'undefined') {
      try {
        await MicrosoftAuth.signOut('ae');
        updateMicrosoftStatusDisplay();
      } catch (error) {
        console.error('AE sign-out failed:', error);
      }
    }
  });

  // Add media source button
  const addMediaSourceBtn = document.getElementById('add-media-source-btn');
  addMediaSourceBtn?.addEventListener('click', addMediaSource);

  // HLS video mode toggle - show/hide worker URL input
  const twitchVideoModeSelect = document.getElementById('settings-twitch-video-mode');
  const hlsWorkerRowEl = document.getElementById('settings-hls-worker-row');
  twitchVideoModeSelect?.addEventListener('change', () => {
    const isHls = twitchVideoModeSelect.value === 'hls';
    if (hlsWorkerRowEl) hlsWorkerRowEl.style.display = isHls ? 'flex' : 'none';
  });

  // Background settings handlers
  const bgTypeSelect = document.getElementById('settings-background-type');
  const bgUploadRow = document.getElementById('settings-background-upload-row');
  const bgInput = document.getElementById('settings-background-input');
  const bgClearBtn = document.getElementById('settings-background-clear');
  const bgPreviewRow = document.getElementById('settings-background-preview-row');
  const bgPreview = document.getElementById('settings-background-preview');

  // Toggle upload row visibility when dropdown changes
  bgTypeSelect?.addEventListener('change', () => {
    const isCustom = bgTypeSelect.value === 'custom';
    if (bgUploadRow) bgUploadRow.style.display = isCustom ? 'flex' : 'none';

    // Show existing preview if switching to custom and we have a saved SVG
    if (isCustom && dashboardConfig.background?.customSvg) {
      if (bgPreviewRow) bgPreviewRow.style.display = 'flex';
      if (bgPreview) {
        bgPreview.innerHTML = `<img src="${dashboardConfig.background.customSvg}" alt="Background preview">`;
      }
      if (bgClearBtn) bgClearBtn.style.display = 'inline-block';
    } else if (!isCustom) {
      if (bgPreviewRow) bgPreviewRow.style.display = 'none';
      if (bgPreview) bgPreview.innerHTML = '';
      if (bgClearBtn) bgClearBtn.style.display = 'none';
    }
  });

  // Handle file upload
  bgInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.includes('svg') && !file.name.endsWith('.svg')) {
      console.warn('Please select an SVG file');
      alert('Please select an SVG file');
      return;
    }

    // Validate file size (500KB limit)
    const MAX_FILE_SIZE = 500 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      alert('SVG file too large. Please use an SVG under 500KB.');
      return;
    }

    // Read and convert to base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const svgContent = event.target?.result;
      try {
        const base64 = btoa(unescape(encodeURIComponent(svgContent)));
        const dataUrl = `data:image/svg+xml;base64,${base64}`;

        // Store pending SVG
        pendingBackgroundSvg = dataUrl;

        // Show preview
        if (bgPreviewRow) bgPreviewRow.style.display = 'flex';
        if (bgPreview) {
          bgPreview.innerHTML = `<img src="${dataUrl}" alt="Background preview">`;
        }
        if (bgClearBtn) bgClearBtn.style.display = 'inline-block';
      } catch (err) {
        console.error('Failed to process SVG:', err);
        alert('Failed to process SVG file');
      }
    };
    reader.readAsText(file);
  });

  // Clear custom background
  bgClearBtn?.addEventListener('click', () => {
    pendingBackgroundSvg = null;
    if (bgPreviewRow) bgPreviewRow.style.display = 'none';
    if (bgPreview) bgPreview.innerHTML = '';
    if (bgClearBtn) bgClearBtn.style.display = 'none';
    if (bgInput) bgInput.value = '';

    // If we had a saved custom SVG, clear it from config too
    if (dashboardConfig.background?.customSvg) {
      dashboardConfig.background.customSvg = null;
    }
  });

  // Listen for auth state changes
  window.addEventListener('microsoft-auth-change', () => {
    updateMicrosoftStatusDisplay();
  });

  // Delay initial config to let other modules load
  setTimeout(applyInitialConfig, 100);
}

// Export for use by other modules
window.getDashboardConfig = () => dashboardConfig;

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSettingsPanel);
} else {
  initSettingsPanel();
}
