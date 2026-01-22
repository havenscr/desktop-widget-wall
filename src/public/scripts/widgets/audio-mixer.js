/* ================================================================
   CONTROLS WIDGET MODULE
   Native Tauri integration for volume control + action buttons
   ================================================================ */

(function() {
  // Background config (works even without Tauri)
  let controlsConfig = {
    background: 'none',
    customSvg: null,
    svgBlur: 0
  };

  // Load config from localStorage
  function loadControlsConfig() {
    try {
      const saved = localStorage.getItem('controlsConfig');
      if (saved) {
        const parsed = JSON.parse(saved);
        controlsConfig = { ...controlsConfig, ...parsed };
      }
    } catch (e) {
      console.warn('Failed to load controls config:', e);
    }
  }

  // Save config to localStorage
  function saveControlsConfig() {
    try {
      localStorage.setItem('controlsConfig', JSON.stringify(controlsConfig));
    } catch (e) {
      console.warn('Failed to save controls config:', e);
    }
  }

  // Apply background to widget
  function applyControlsBackground(bgType) {
    const widget = document.querySelector('.widget-controls');
    if (widget) {
      if (bgType && bgType !== 'none') {
        widget.setAttribute('data-bg', bgType);
        if (bgType === 'svg') {
          if (controlsConfig.customSvg) {
            widget.style.setProperty('--controls-custom-svg', `url("${controlsConfig.customSvg}")`);
          }
          const blurVal = controlsConfig.svgBlur ?? 0;
          widget.style.setProperty('--controls-svg-blur', `${blurVal}px`);
          widget.style.setProperty('--controls-svg-blur-scale', blurVal * 0.007);
        }
      } else {
        widget.removeAttribute('data-bg');
        widget.style.removeProperty('--controls-custom-svg');
        widget.style.removeProperty('--controls-svg-blur');
        widget.style.removeProperty('--controls-svg-blur-scale');
      }
    }
  }

  // Initialize background config modal handlers
  function initControlsBackground() {
    loadControlsConfig();
    applyControlsBackground(controlsConfig.background);

    // Use event delegation for async-loaded modal elements
    document.addEventListener('click', (e) => {
      // Config button click
      if (e.target.closest('#controls-config-btn')) {
        const modal = document.getElementById('controls-modal');
        if (modal) {
          // Set current values in modal
          const currentBg = controlsConfig.background || 'none';
          const radio = modal.querySelector(`input[name="controls-bg"][value="${currentBg}"]`);
          if (radio) radio.checked = true;

          // Show/hide SVG upload section
          const svgUpload = document.getElementById('controls-svg-upload');
          if (svgUpload) {
            svgUpload.style.display = currentBg === 'svg' ? 'block' : 'none';
          }

          // Initialize blur controls
          const blurSlider = document.getElementById('controls-blur-slider');
          const blurInput = document.getElementById('controls-blur-input');
          if (blurSlider && blurInput) {
            const blurVal = controlsConfig.svgBlur ?? 0;
            blurSlider.value = blurVal;
            blurInput.value = blurVal;
          }

          // Show SVG preview if exists
          const preview = document.getElementById('controls-svg-preview');
          if (preview && controlsConfig.customSvg) {
            preview.innerHTML = `<img src="${controlsConfig.customSvg}" alt="SVG Preview" style="max-width: 100%; max-height: 60px; border-radius: 4px;">`;
          } else if (preview) {
            preview.innerHTML = '';
          }

          modal.classList.add('active');
        }
      }

      // Cancel button
      if (e.target.closest('#controls-cancel-btn')) {
        const modal = document.getElementById('controls-modal');
        if (modal) modal.classList.remove('active');
      }

      // Save button
      if (e.target.closest('#controls-save-btn')) {
        const modal = document.getElementById('controls-modal');
        if (modal) {
          const selectedBg = modal.querySelector('input[name="controls-bg"]:checked')?.value || 'none';
          const blurSlider = document.getElementById('controls-blur-slider');
          controlsConfig.background = selectedBg;
          controlsConfig.svgBlur = parseInt(blurSlider?.value) || 0;
          saveControlsConfig();
          applyControlsBackground(selectedBg);
          modal.classList.remove('active');
        }
      }

      // Clear SVG button
      if (e.target.closest('#controls-svg-clear')) {
        controlsConfig.customSvg = null;
        const preview = document.getElementById('controls-svg-preview');
        if (preview) preview.innerHTML = '';
        const fileInput = document.getElementById('controls-svg-input');
        if (fileInput) fileInput.value = '';
      }
    });

    // Background option change
    document.addEventListener('change', (e) => {
      if (e.target.name === 'controls-bg') {
        const svgUpload = document.getElementById('controls-svg-upload');
        if (svgUpload) {
          svgUpload.style.display = e.target.value === 'svg' ? 'block' : 'none';
        }
      }

      // SVG file input change
      if (e.target.id === 'controls-svg-input') {
        const file = e.target.files?.[0];
        if (file && file.type === 'image/svg+xml') {
          if (file.size > 500 * 1024) {
            alert('SVG file too large. Please use a file under 500KB.');
            e.target.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = (ev) => {
            controlsConfig.customSvg = ev.target.result;
            const preview = document.getElementById('controls-svg-preview');
            if (preview) {
              preview.innerHTML = `<img src="${ev.target.result}" alt="SVG Preview" style="max-width: 100%; max-height: 60px; border-radius: 4px;">`;
            }
          };
          reader.readAsDataURL(file);
        }
      }
    });

    // Blur slider/input sync
    document.addEventListener('input', (e) => {
      const target = e.target;
      if (target.id === 'controls-blur-slider') {
        const blurInput = document.getElementById('controls-blur-input');
        if (blurInput) blurInput.value = target.value;
      }
      if (target.id === 'controls-blur-input') {
        let val = parseInt(target.value) || 0;
        val = Math.max(0, Math.min(30, val));
        target.value = val;
        const blurSlider = document.getElementById('controls-blur-slider');
        if (blurSlider) blurSlider.value = val;
      }
    });

    // Close modal on backdrop click
    document.addEventListener('mousedown', (e) => {
      if (e.target.id === 'controls-modal') {
        e.target.classList.remove('active');
      }
    });
  }

  // Initialize background config (works even without Tauri)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initControlsBackground);
  } else {
    initControlsBackground();
  }

  // Check if Tauri is available
  if (!window.__TAURI__?.tauri?.invoke) {
    console.warn('Controls Widget: Tauri not available, skipping initialization');
    return;
  }
  const { invoke } = window.__TAURI__.tauri;
  const { open } = window.__TAURI__.shell;

  // Browser apps that should be grouped together (without .exe for flexible matching)
  const browserApps = ['firefox', 'chrome', 'msedge', 'brave', 'opera', 'vivaldi', 'browser'];
  const spotifyApps = ['spotify'];
  const teamsApps = ['teams', 'ms-teams', 'discord', 'slack', 'zoom', 'webex'];

  // Helper to check if session name matches any app in list
  function matchesApp(sessionName, appList) {
    const name = sessionName.toLowerCase();
    return appList.some(app => name.includes(app.toLowerCase()));
  }

  // Track state
  let allMuted = false;
  let lastSessions = [];

  async function fetchAudioLevels() {
    try {
      const data = await invoke('get_audio_sessions');
      console.log('[Controls] Audio data:', {
        master: data?.master,
        sessionCount: data?.sessions?.length || 0,
        sessions: data?.sessions?.map(s => s.name) || []
      });
      return data;
    } catch (e) {
      console.error('[Controls] Failed to fetch audio levels:', e);
      return null;
    }
  }

  async function setAudioLevel(sessionName, level) {
    try {
      await invoke('set_audio_session_volume', { sessionName: sessionName, level: level });
      return true;
    } catch (e) {
      console.warn('Failed to set audio level:', e);
      return false;
    }
  }

  async function toggleMute(sessionName) {
    try {
      const newMuteState = await invoke('toggle_audio_session_mute', { sessionName: sessionName });
      return { success: true, muted: newMuteState };
    } catch (e) {
      console.warn('Failed to toggle mute:', e);
      return null;
    }
  }

  // Set volume for a group of apps
  async function setGroupVolume(appList, level) {
    for (const session of lastSessions) {
      if (matchesApp(session.name, appList)) {
        await setAudioLevel(session.name, level);
      }
    }
  }

  // Toggle mute for a group of apps
  async function toggleGroupMute(appList) {
    let anyMuted = false;
    for (const session of lastSessions) {
      if (matchesApp(session.name, appList)) {
        const result = await toggleMute(session.name);
        if (result) anyMuted = result.muted;
      }
    }
    return anyMuted;
  }

  // Get grouped volume (average of all matching apps, or first found)
  function getGroupedData(sessions, appList) {
    const matching = sessions.filter(s => matchesApp(s.name, appList));

    if (matching.length === 0) {
      return { volume: null, muted: false, found: false };
    }

    // Use the first one's volume (they should be synced anyway)
    return {
      volume: matching[0].volume,
      muted: matching[0].muted,
      found: true
    };
  }

  // Helper to update slider value and force thumb position update
  function setSliderValue(slider, value) {
    if (slider && document.activeElement !== slider) {
      slider.value = value;
      // Force layout recalc to ensure thumb position updates
      void slider.offsetWidth;
    }
  }

  function updateUI(data) {
    if (!data) return;

    lastSessions = data.sessions || [];

    // Master volume
    const masterSlider = document.getElementById('master-slider');
    const masterFill = document.getElementById('master-fill');
    const masterValue = document.getElementById('master-value');
    const masterMute = document.getElementById('master-mute');

    if (data.master) {
      setSliderValue(masterSlider, data.master.volume);
      if (masterFill) masterFill.style.width = `${data.master.volume}%`;
      if (masterValue) masterValue.textContent = data.master.volume;
      if (masterMute) masterMute.classList.toggle('muted', data.master.muted);
    }

    // Browsers (grouped)
    const browserData = getGroupedData(data.sessions, browserApps);
    const browsersSlider = document.getElementById('browsers-slider');
    const browsersFill = document.getElementById('browsers-fill');
    const browsersValue = document.getElementById('browsers-value');
    const browsersMute = document.getElementById('browsers-mute');

    if (browserData.found) {
      setSliderValue(browsersSlider, browserData.volume);
      if (browsersFill) browsersFill.style.width = `${browserData.volume}%`;
      if (browsersValue) browsersValue.textContent = browserData.volume;
      if (browsersMute) browsersMute.classList.toggle('muted', browserData.muted);
    } else {
      if (browsersValue) browsersValue.textContent = '--';
    }

    // Spotify
    const spotifyData = getGroupedData(data.sessions, spotifyApps);
    const spotifySlider = document.getElementById('spotify-slider');
    const spotifyFill = document.getElementById('spotify-fill');
    const spotifyValue = document.getElementById('spotify-value');
    const spotifyMute = document.getElementById('spotify-mute');

    if (spotifyData.found) {
      setSliderValue(spotifySlider, spotifyData.volume);
      if (spotifyFill) spotifyFill.style.width = `${spotifyData.volume}%`;
      if (spotifyValue) spotifyValue.textContent = spotifyData.volume;
      if (spotifyMute) spotifyMute.classList.toggle('muted', spotifyData.muted);
    } else {
      if (spotifyValue) spotifyValue.textContent = '--';
    }

    // Teams/Comms
    const teamsData = getGroupedData(data.sessions, teamsApps);
    const teamsSlider = document.getElementById('teams-slider');
    const teamsFill = document.getElementById('teams-fill');
    const teamsValue = document.getElementById('teams-value');
    const teamsMute = document.getElementById('teams-mute');

    if (teamsData.found) {
      setSliderValue(teamsSlider, teamsData.volume);
      if (teamsFill) teamsFill.style.width = `${teamsData.volume}%`;
      if (teamsValue) teamsValue.textContent = teamsData.volume;
      if (teamsMute) teamsMute.classList.toggle('muted', teamsData.muted);
    } else {
      if (teamsValue) teamsValue.textContent = '--';
    }
  }

  function setConnected(connected) {
    const statusDot = document.getElementById('controls-status-dot');
    const statusText = document.getElementById('controls-status-text');
    const placeholder = document.getElementById('controls-placeholder');
    const audioSection = document.getElementById('controls-audio');

    statusDot?.classList.toggle('connected', connected);
    if (statusText) statusText.textContent = connected ? 'Connected' : 'Offline';

    if (placeholder) placeholder.style.display = connected ? 'none' : 'flex';
    if (audioSection) audioSection.style.display = connected ? 'flex' : 'none';
  }

  async function pollAudio() {
    try {
      const data = await fetchAudioLevels();
      if (data) {
        setConnected(true);
        updateUI(data);
      } else {
        setConnected(false);
      }
    } catch (e) {
      console.error('Poll error:', e);
      setConnected(false);
    }
  }

  // Action button handlers
  async function handleMuteAll() {
    const btn = document.getElementById('action-mute-all');
    allMuted = !allMuted;
    btn?.classList.toggle('active', allMuted);
    await toggleMute('master');
  }

  async function handleMuteMics() {
    const btn = document.getElementById('action-mute-mics');
    btn?.classList.toggle('active');
    // TODO: Implement mic muting via Windows API
    console.log('Mute mics clicked - feature pending');
  }

  async function handleOpenMixer() {
    try {
      // Volume mixer on primary monitor with full-width display
      const monitor = 1;
      const width = 910;
      const height = 450;

      // Use dedicated Tauri command with configurable parameters
      await invoke('open_volume_mixer', { monitor, width, height });
    } catch (e) {
      console.warn('[Controls] Failed to open mixer:', e);
      // Fallback: try shell open with ms-settings URI
      if (open) {
        try {
          await open('ms-settings:sound');
        } catch (e2) {
          console.warn('[Controls] Shell open also failed:', e2);
        }
      }
    }
  }

  async function handleMonitorsOff() {
    try {
      await invoke('turn_off_monitors');
      console.log('[Controls] Monitors turned off');
    } catch (e) {
      console.warn('[Controls] Failed to turn off monitors:', e);
    }
  }

  function setupSliderHandlers() {
    // Master slider
    const masterSlider = document.getElementById('master-slider');
    const masterFill = document.getElementById('master-fill');
    const masterValue = document.getElementById('master-value');
    const masterMute = document.getElementById('master-mute');

    masterSlider?.addEventListener('input', async (e) => {
      const value = parseInt(e.target.value);
      if (masterFill) masterFill.style.width = `${value}%`;
      if (masterValue) masterValue.textContent = value;
      await setAudioLevel('master', value);
    });

    masterMute?.addEventListener('click', async () => {
      const result = await toggleMute('master');
      if (result?.success) {
        masterMute.classList.toggle('muted', result.muted);
      }
    });

    // Browsers slider (grouped)
    const browsersSlider = document.getElementById('browsers-slider');
    const browsersFill = document.getElementById('browsers-fill');
    const browsersValue = document.getElementById('browsers-value');
    const browsersMute = document.getElementById('browsers-mute');

    browsersSlider?.addEventListener('input', async (e) => {
      const value = parseInt(e.target.value);
      if (browsersFill) browsersFill.style.width = `${value}%`;
      if (browsersValue) browsersValue.textContent = value;
      await setGroupVolume(browserApps, value);
    });

    browsersMute?.addEventListener('click', async () => {
      const muted = await toggleGroupMute(browserApps);
      browsersMute.classList.toggle('muted', muted);
    });

    // Spotify slider
    const spotifySlider = document.getElementById('spotify-slider');
    const spotifyFill = document.getElementById('spotify-fill');
    const spotifyValue = document.getElementById('spotify-value');
    const spotifyMute = document.getElementById('spotify-mute');

    spotifySlider?.addEventListener('input', async (e) => {
      const value = parseInt(e.target.value);
      if (spotifyFill) spotifyFill.style.width = `${value}%`;
      if (spotifyValue) spotifyValue.textContent = value;
      await setGroupVolume(spotifyApps, value);
    });

    spotifyMute?.addEventListener('click', async () => {
      const muted = await toggleGroupMute(spotifyApps);
      spotifyMute.classList.toggle('muted', muted);
    });

    // Teams slider
    const teamsSlider = document.getElementById('teams-slider');
    const teamsFill = document.getElementById('teams-fill');
    const teamsValue = document.getElementById('teams-value');
    const teamsMute = document.getElementById('teams-mute');

    teamsSlider?.addEventListener('input', async (e) => {
      const value = parseInt(e.target.value);
      if (teamsFill) teamsFill.style.width = `${value}%`;
      if (teamsValue) teamsValue.textContent = value;
      await setGroupVolume(teamsApps, value);
    });

    teamsMute?.addEventListener('click', async () => {
      const muted = await toggleGroupMute(teamsApps);
      teamsMute.classList.toggle('muted', muted);
    });
  }

  function initControls() {
    console.log('Initializing Controls widget...');

    // Show connected state immediately
    setConnected(true);

    // Setup slider handlers
    setupSliderHandlers();

    // Action button handlers
    document.getElementById('action-mute-all')?.addEventListener('click', handleMuteAll);
    document.getElementById('action-mute-mics')?.addEventListener('click', handleMuteMics);
    document.getElementById('action-volume-mixer')?.addEventListener('click', handleOpenMixer);
    document.getElementById('action-monitors-off')?.addEventListener('click', handleMonitorsOff);

    // Visibility-aware polling - pause when app is hidden to save CPU
    let audioIntervalId = null;

    function startAudioPolling() {
      if (audioIntervalId) return;
      pollAudio();
      audioIntervalId = setInterval(pollAudio, 2000);
    }

    function stopAudioPolling() {
      if (audioIntervalId) {
        clearInterval(audioIntervalId);
        audioIntervalId = null;
      }
    }

    // Start polling initially
    startAudioPolling();

    // Listen for visibility changes
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopAudioPolling();
      } else {
        startAudioPolling();
      }
    });
  }

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initControls);
  } else {
    initControls();
  }
})();
