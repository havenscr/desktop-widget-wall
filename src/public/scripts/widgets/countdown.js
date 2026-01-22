/* ================================================================
   COUNTDOWN & FOCUS TIMER MODULE
   Countdown timer with SVG ring updates + Focus Timer mode
   ================================================================ */

const COUNTDOWN_CIRCUMFERENCE = 97.4; // 2 * PI * 15.5
const FOCUS_TIMER_CIRCUMFERENCE = 263.89; // 2 * PI * 42

// Current widget mode: 'countdown' or 'focus'
let currentWidgetMode = 'countdown';

// Countdown configuration
let countdownConfig = {
  title: 'Days to Event',
  targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  targetTime: '00:00',
  background: 'none',
  customSvg: null,  // Base64 data URL for custom SVG background
  svgBlur: 0
};

// Focus Timer configuration
let focusTimerConfig = {
  defaultDuration: 25,  // minutes
  intervalEnabled: false,
  intervalMinutes: 25,
  alarmType: 'default',  // 'default' or 'custom'
  customAlarmBase64: null,
  customAlarmFilename: null,
  background: 'none',  // 'none', 'inherit', or 'svg'
  customSvg: null,
  svgBlur: 0
};

// Focus Timer state
let focusTimerState = {
  duration: 25 * 60,    // seconds (total duration)
  remaining: 25 * 60,   // seconds (remaining)
  isRunning: false,
  intervalId: null,
  lastIntervalAlert: 0  // track last interval reminder
};

// Audio elements for alarm
let alarmAudio = null;
let isAlarmPlaying = false;
let alarmAutoStopTimeout = null;
const ALARM_AUTO_STOP_MS = 10 * 60 * 1000; // 10 minutes

// Load saved configs
const savedCountdown = localStorage.getItem('countdown-config');
if (savedCountdown) {
  try {
    countdownConfig = JSON.parse(savedCountdown);
  } catch (e) {
    console.warn('Failed to parse countdown config:', e);
  }
}

const savedFocusConfig = localStorage.getItem('focus-timer-config');
if (savedFocusConfig) {
  try {
    focusTimerConfig = JSON.parse(savedFocusConfig);
    // Apply default duration to state
    focusTimerState.duration = focusTimerConfig.defaultDuration * 60;
    focusTimerState.remaining = focusTimerConfig.defaultDuration * 60;
  } catch (e) {
    console.warn('Failed to parse focus timer config:', e);
  }
}

// Load saved mode preference
const savedMode = localStorage.getItem('countdown-widget-mode');
if (savedMode === 'focus' || savedMode === 'countdown') {
  currentWidgetMode = savedMode;
}

function applyCountdownBackground(bgType) {
  const widget = document.querySelector('.widget-countdown');
  if (widget) {
    if (bgType && bgType !== 'none') {
      widget.setAttribute('data-bg', bgType);
      // If custom SVG, set the CSS variable for the background image
      if (bgType === 'svg') {
        if (countdownConfig.customSvg) {
          widget.style.setProperty('--countdown-custom-svg', `url("${countdownConfig.customSvg}")`);
        }
        const blurVal = countdownConfig.svgBlur ?? 0;
        widget.style.setProperty('--countdown-svg-blur', `${blurVal}px`);
        widget.style.setProperty('--countdown-svg-blur-scale', blurVal * 0.007);
      }
    } else {
      widget.removeAttribute('data-bg');
      widget.style.removeProperty('--countdown-custom-svg');
      widget.style.removeProperty('--countdown-svg-blur');
      widget.style.removeProperty('--countdown-svg-blur-scale');
    }
  }
}

function applyFocusTimerBackground() {
  const widget = document.querySelector('.widget-countdown');
  if (!widget) return;

  const bgType = focusTimerConfig.background;

  if (bgType === 'none') {
    widget.removeAttribute('data-bg');
    widget.style.removeProperty('--countdown-custom-svg');
    widget.style.removeProperty('--countdown-svg-blur');
    widget.style.removeProperty('--countdown-svg-blur-scale');
  } else if (bgType === 'inherit') {
    // Use countdown's background settings
    applyCountdownBackground(countdownConfig.background);
  } else if (bgType === 'svg') {
    widget.setAttribute('data-bg', 'svg');
    if (focusTimerConfig.customSvg) {
      widget.style.setProperty('--countdown-custom-svg', `url("${focusTimerConfig.customSvg}")`);
    }
    const blurVal = focusTimerConfig.svgBlur ?? 0;
    widget.style.setProperty('--countdown-svg-blur', `${blurVal}px`);
    widget.style.setProperty('--countdown-svg-blur-scale', blurVal * 0.007);
  }
}

function updateCountdownRing(elementId, value, maxValue) {
  const ring = document.getElementById(elementId);
  if (!ring) return;
  const percent = Math.min(Math.max(value / maxValue, 0), 1);
  const offset = COUNTDOWN_CIRCUMFERENCE * (1 - percent);
  ring.style.strokeDashoffset = offset;
}

function updateCountdown() {
  const targetDateTime = new Date(`${countdownConfig.targetDate}T${countdownConfig.targetTime || '00:00'}:00`);
  const now = new Date();
  const diff = targetDateTime - now;

  if (diff <= 0) {
    document.getElementById('countdown-days').textContent = '0';
    document.getElementById('countdown-hours').textContent = '0';
    document.getElementById('countdown-mins').textContent = '0';
    document.getElementById('countdown-secs').textContent = '0';
    updateCountdownRing('countdown-days-ring', 0, 1);
    updateCountdownRing('countdown-hours-ring', 0, 1);
    updateCountdownRing('countdown-mins-ring', 0, 1);
    updateCountdownRing('countdown-secs-ring', 0, 1);
    return;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((diff % (1000 * 60)) / 1000);

  document.getElementById('countdown-days').textContent = days;
  document.getElementById('countdown-hours').textContent = hours;
  document.getElementById('countdown-mins').textContent = mins;
  document.getElementById('countdown-secs').textContent = secs;

  updateCountdownRing('countdown-days-ring', Math.min(days, 365), 365);
  updateCountdownRing('countdown-hours-ring', hours, 24);
  updateCountdownRing('countdown-mins-ring', mins, 60);
  updateCountdownRing('countdown-secs-ring', secs, 60);
}

// Function called by settings panel
function updateCountdownConfig(title, targetDate) {
  countdownConfig.title = title || 'Days to Event';
  countdownConfig.targetDate = targetDate || countdownConfig.targetDate;
  localStorage.setItem('countdown-config', JSON.stringify(countdownConfig));

  const titleEl = document.getElementById('countdown-title');
  if (titleEl) titleEl.textContent = countdownConfig.title;

  updateCountdown();
}

/* ================================================================
   FOCUS TIMER FUNCTIONS
   ================================================================ */

function switchWidgetMode(mode) {
  if (mode !== 'countdown' && mode !== 'focus') return;

  currentWidgetMode = mode;
  localStorage.setItem('countdown-widget-mode', mode);

  // Update nav dots
  const navDots = document.querySelectorAll('.countdown-nav-dots .nav-dot');
  navDots.forEach(dot => {
    dot.classList.toggle('active', dot.dataset.mode === mode);
  });

  // Show/hide mode containers
  const countdownMode = document.getElementById('countdown-mode');
  const focusMode = document.getElementById('focus-mode');

  if (countdownMode) countdownMode.style.display = mode === 'countdown' ? 'flex' : 'none';
  if (focusMode) focusMode.style.display = mode === 'focus' ? 'flex' : 'none';

  // Update title
  const titleEl = document.getElementById('countdown-title');
  if (titleEl) {
    titleEl.textContent = mode === 'countdown' ? countdownConfig.title : 'Focus Timer';
  }

  // Apply appropriate background for the mode
  if (mode === 'countdown') {
    applyCountdownBackground(countdownConfig.background);
  } else {
    applyFocusTimerBackground();
  }
}

function formatFocusTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateFocusTimerDisplay() {
  const timeDisplay = document.getElementById('focus-timer-time');
  const progressRing = document.getElementById('focus-timer-ring');

  if (timeDisplay) {
    timeDisplay.textContent = formatFocusTime(focusTimerState.remaining);
  }

  if (progressRing) {
    const progress = focusTimerState.duration > 0
      ? (focusTimerState.duration - focusTimerState.remaining) / focusTimerState.duration
      : 0;
    const offset = FOCUS_TIMER_CIRCUMFERENCE * (1 - progress);
    progressRing.style.strokeDashoffset = offset;
  }
}

function updatePlayPauseButton() {
  const playBtn = document.getElementById('focus-play-btn');
  const playIcon = playBtn?.querySelector('.focus-play-icon');
  const pauseIcon = playBtn?.querySelector('.focus-pause-icon');
  const stopIcon = playBtn?.querySelector('.focus-stop-icon');

  if (isAlarmPlaying) {
    // Show stop icon when alarm is playing
    playBtn?.classList.remove('playing');
    playBtn?.classList.add('alarm-active');
    if (playIcon) playIcon.style.display = 'none';
    if (pauseIcon) pauseIcon.style.display = 'none';
    if (stopIcon) stopIcon.style.display = 'block';
  } else if (focusTimerState.isRunning) {
    playBtn?.classList.add('playing');
    playBtn?.classList.remove('alarm-active');
    if (playIcon) playIcon.style.display = 'none';
    if (pauseIcon) pauseIcon.style.display = 'block';
    if (stopIcon) stopIcon.style.display = 'none';
  } else {
    playBtn?.classList.remove('playing');
    playBtn?.classList.remove('alarm-active');
    if (playIcon) playIcon.style.display = 'block';
    if (pauseIcon) pauseIcon.style.display = 'none';
    if (stopIcon) stopIcon.style.display = 'none';
  }
}

function playAlarm() {
  if (isAlarmPlaying) return;

  const audioSrc = focusTimerConfig.alarmType === 'custom' && focusTimerConfig.customAlarmBase64
    ? focusTimerConfig.customAlarmBase64
    : 'assets/Sounds/alarm.mp3';

  alarmAudio = new Audio(audioSrc);
  alarmAudio.loop = focusTimerConfig.alarmType === 'custom';  // Loop custom sounds

  alarmAudio.play().catch(e => console.warn('Failed to play alarm:', e));
  isAlarmPlaying = true;

  // Auto-stop alarm after 10 minutes if user doesn't interact
  if (alarmAutoStopTimeout) clearTimeout(alarmAutoStopTimeout);
  alarmAutoStopTimeout = setTimeout(() => {
    console.log('Alarm auto-stopped after 10 minutes');
    stopAlarm();
    updatePlayPauseButton();
  }, ALARM_AUTO_STOP_MS);

  // For default alarm, stop after it plays once
  if (focusTimerConfig.alarmType !== 'custom') {
    alarmAudio.onended = () => {
      isAlarmPlaying = false;
      alarmAudio = null;
      if (alarmAutoStopTimeout) {
        clearTimeout(alarmAutoStopTimeout);
        alarmAutoStopTimeout = null;
      }
    };
  }
}

function stopAlarm() {
  if (alarmAudio) {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
    alarmAudio = null;
  }
  isAlarmPlaying = false;
  if (alarmAutoStopTimeout) {
    clearTimeout(alarmAutoStopTimeout);
    alarmAutoStopTimeout = null;
  }
}

function checkIntervalReminder() {
  if (!focusTimerConfig.intervalEnabled || focusTimerConfig.intervalMinutes <= 0) return;

  const elapsed = focusTimerState.duration - focusTimerState.remaining;
  const intervalSeconds = focusTimerConfig.intervalMinutes * 60;
  const currentInterval = Math.floor(elapsed / intervalSeconds);

  if (currentInterval > focusTimerState.lastIntervalAlert && focusTimerState.remaining > 0) {
    focusTimerState.lastIntervalAlert = currentInterval;
    // Play a brief notification sound
    const notifAudio = new Audio('assets/Sounds/alarm.mp3');
    notifAudio.volume = 0.5;
    notifAudio.play().catch(() => {});
  }
}

function focusTimerTick() {
  if (!focusTimerState.isRunning || focusTimerState.remaining <= 0) return;

  focusTimerState.remaining--;
  updateFocusTimerDisplay();
  checkIntervalReminder();

  if (focusTimerState.remaining <= 0) {
    focusTimerState.isRunning = false;
    playAlarm();
    updatePlayPauseButton();  // Update after playAlarm so stop icon shows

    // Visual feedback - pulse the lotus button
    const lotusBtn = document.getElementById('focus-lotus-btn');
    lotusBtn?.classList.add('active');
  }
}

function startFocusTimer() {
  if (focusTimerState.isRunning) return;
  if (focusTimerState.remaining <= 0) {
    // Reset if timer was at zero
    resetFocusTimer();
  }

  stopAlarm();  // Stop any playing alarm
  focusTimerState.isRunning = true;
  focusTimerState.lastIntervalAlert = 0;
  updatePlayPauseButton();

  if (focusTimerState.intervalId) {
    clearInterval(focusTimerState.intervalId);
  }
  focusTimerState.intervalId = setInterval(focusTimerTick, 1000);
}

function pauseFocusTimer() {
  focusTimerState.isRunning = false;
  updatePlayPauseButton();

  if (focusTimerState.intervalId) {
    clearInterval(focusTimerState.intervalId);
    focusTimerState.intervalId = null;
  }
}

function toggleFocusTimer() {
  if (isAlarmPlaying) {
    // Stop button behavior: stop alarm and reset (but don't start)
    stopAlarm();
    resetFocusTimerState();
    return;
  }

  if (focusTimerState.isRunning) {
    pauseFocusTimer();
  } else {
    startFocusTimer();
  }
}

function resetFocusTimerState() {
  // Helper to reset timer state without starting
  pauseFocusTimer();

  // Get currently selected preset
  const activePreset = document.querySelector('.focus-preset-btn.active');
  const minutes = activePreset ? parseInt(activePreset.dataset.minutes) || 25 : focusTimerConfig.defaultDuration;

  focusTimerState.duration = minutes * 60;
  focusTimerState.remaining = minutes * 60;
  focusTimerState.lastIntervalAlert = 0;

  updateFocusTimerDisplay();
  updatePlayPauseButton();

  // Reset lotus button state
  const lotusBtn = document.getElementById('focus-lotus-btn');
  lotusBtn?.classList.remove('active');
}

function resetFocusTimer() {
  const wasAlarmPlaying = isAlarmPlaying;

  pauseFocusTimer();
  stopAlarm();
  resetFocusTimerState();

  // If alarm was playing, restart the timer immediately
  if (wasAlarmPlaying) {
    startFocusTimer();
  }
}

function setFocusDuration(minutes) {
  pauseFocusTimer();
  stopAlarm();

  focusTimerState.duration = minutes * 60;
  focusTimerState.remaining = minutes * 60;
  focusTimerState.lastIntervalAlert = 0;

  updateFocusTimerDisplay();

  // Update active preset button
  const presetBtns = document.querySelectorAll('.focus-preset-btn');
  presetBtns.forEach(btn => {
    const btnMinutes = parseInt(btn.dataset.minutes);
    btn.classList.toggle('active', btnMinutes === minutes);
  });

  // If not a preset value, clear all active states
  const isPreset = [25, 50, 90, 120].includes(minutes);
  if (!isPreset) {
    presetBtns.forEach(btn => btn.classList.remove('active'));
  }
}

function showCustomDurationInput() {
  const customInput = document.querySelector('.focus-custom-input');
  const input = document.getElementById('focus-custom-minutes');

  if (customInput && input) {
    input.value = Math.floor(focusTimerState.duration / 60);
    customInput.classList.add('active');
    input.focus();
    input.select();
  }
}

function hideCustomDurationInput() {
  const customInput = document.querySelector('.focus-custom-input');
  customInput?.classList.remove('active');
}

function applyCustomDuration() {
  const input = document.getElementById('focus-custom-minutes');
  if (input) {
    let minutes = parseInt(input.value) || 25;
    minutes = Math.max(1, Math.min(999, minutes));  // Clamp between 1-999
    setFocusDuration(minutes);
  }
  hideCustomDurationInput();
}

function saveFocusTimerConfig() {
  localStorage.setItem('focus-timer-config', JSON.stringify(focusTimerConfig));
}

function initCountdown() {
  // Update title from config
  const titleEl = document.getElementById('countdown-title');
  if (titleEl) titleEl.textContent = countdownConfig.title;

  // Apply background
  applyCountdownBackground(countdownConfig.background);

  // Temporary SVG storage for modal (only saved on Save click)
  let pendingSvg = countdownConfig.customSvg;

  // Helper to get modal elements (re-query each time since modals load async)
  function getModalElements() {
    return {
      modal: document.getElementById('countdown-modal'),
      titleInput: document.getElementById('countdown-title-input'),
      dateInput: document.getElementById('countdown-date-input'),
      timeInput: document.getElementById('countdown-time-input'),
      svgUpload: document.getElementById('countdown-svg-upload'),
      svgInput: document.getElementById('countdown-svg-input'),
      svgPreview: document.getElementById('countdown-svg-preview'),
      blurSlider: document.getElementById('countdown-blur-slider'),
      blurInput: document.getElementById('countdown-blur-input')
    };
  }

  // Show/hide SVG upload section based on radio selection
  function updateSvgUploadVisibility() {
    const els = getModalElements();
    const selectedBg = els.modal?.querySelector('input[name="countdown-bg"]:checked');
    if (els.svgUpload) {
      els.svgUpload.style.display = selectedBg?.value === 'svg' ? 'block' : 'none';
    }
  }

  // Initialize blur controls with saved value
  function initBlurControls() {
    const els = getModalElements();
    if (els.blurSlider && els.blurInput) {
      const blurValue = countdownConfig.svgBlur ?? 0;
      els.blurSlider.value = blurValue;
      els.blurInput.value = blurValue;
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

  // Temporary storage for pending custom audio
  let pendingAudioBase64 = focusTimerConfig.customAlarmBase64;
  let pendingAudioFilename = focusTimerConfig.customAlarmFilename;

  // Temporary storage for pending focus timer SVG
  let pendingFocusSvg = focusTimerConfig.customSvg;

  // Show/hide focus SVG upload section based on radio selection
  function updateFocusSvgUploadVisibility() {
    const focusSvgUpload = document.getElementById('focus-svg-upload');
    const selectedBg = document.querySelector('input[name="focus-bg"]:checked');
    if (focusSvgUpload) {
      focusSvgUpload.style.display = selectedBg?.value === 'svg' ? 'block' : 'none';
    }
  }

  // Initialize focus blur controls
  function initFocusBlurControls() {
    const blurSlider = document.getElementById('focus-blur-slider');
    const blurInput = document.getElementById('focus-blur-input');
    if (blurSlider && blurInput) {
      const blurValue = focusTimerConfig.svgBlur ?? 0;
      blurSlider.value = blurValue;
      blurInput.value = blurValue;
    }
  }

  // Update focus SVG preview
  function updateFocusSvgPreview(svgDataUrl) {
    const preview = document.getElementById('focus-svg-preview');
    if (preview) {
      if (svgDataUrl) {
        preview.innerHTML = `<img src="${svgDataUrl}" alt="SVG Preview">`;
      } else {
        preview.innerHTML = '';
      }
    }
  }

  // Helper to update focus timer modal fields
  function initFocusTimerModalFields() {
    const defaultDuration = document.getElementById('focus-default-duration');
    const intervalEnabled = document.getElementById('focus-interval-enabled');
    const intervalMinutes = document.getElementById('focus-interval-minutes');
    const intervalRow = document.getElementById('focus-interval-row');
    const alarmRadio = document.querySelector(`input[name="focus-alarm"][value="${focusTimerConfig.alarmType}"]`);
    const customAudioControls = document.getElementById('focus-custom-audio-controls');
    const audioFilename = document.getElementById('focus-audio-filename');

    // Show current timer duration (reflects any preset that was clicked)
    if (defaultDuration) defaultDuration.value = Math.floor(focusTimerState.duration / 60);
    if (intervalEnabled) intervalEnabled.checked = focusTimerConfig.intervalEnabled;
    if (intervalMinutes) intervalMinutes.value = focusTimerConfig.intervalMinutes;
    if (intervalRow) intervalRow.style.display = focusTimerConfig.intervalEnabled ? 'flex' : 'none';
    if (alarmRadio) alarmRadio.checked = true;
    if (customAudioControls) {
      customAudioControls.classList.toggle('active', focusTimerConfig.alarmType === 'custom');
    }
    if (audioFilename) {
      audioFilename.textContent = pendingAudioFilename || 'No file selected';
    }

    // Background settings
    const bgValue = focusTimerConfig.background || 'none';
    const bgRadio = document.querySelector(`input[name="focus-bg"][value="${bgValue}"]`);
    if (bgRadio) bgRadio.checked = true;

    pendingFocusSvg = focusTimerConfig.customSvg;
    updateFocusSvgUploadVisibility();
    initFocusBlurControls();
    updateFocusSvgPreview(pendingFocusSvg);

    const focusSvgInput = document.getElementById('focus-svg-input');
    if (focusSvgInput) focusSvgInput.value = '';
  }

  // Config button opens modal - shows only relevant mode config
  const countdownConfigBtn = document.getElementById('countdown-config-btn');
  countdownConfigBtn?.addEventListener('click', () => {
    const els = getModalElements();

    // Update modal title and show/hide sections based on current mode
    const modalTitle = document.getElementById('countdown-modal-title');
    const countdownModeConfig = els.modal?.querySelector('.countdown-mode-config');
    const focusModeConfig = els.modal?.querySelector('.focus-timer-config');

    if (currentWidgetMode === 'focus') {
      if (modalTitle) modalTitle.textContent = 'Configure Focus Timer';
      if (countdownModeConfig) countdownModeConfig.style.display = 'none';
      if (focusModeConfig) focusModeConfig.style.display = 'block';

      // Initialize focus timer modal fields
      pendingAudioBase64 = focusTimerConfig.customAlarmBase64;
      pendingAudioFilename = focusTimerConfig.customAlarmFilename;
      initFocusTimerModalFields();
    } else {
      if (modalTitle) modalTitle.textContent = 'Configure Countdown';
      if (countdownModeConfig) countdownModeConfig.style.display = 'block';
      if (focusModeConfig) focusModeConfig.style.display = 'none';

      if (els.titleInput) els.titleInput.value = countdownConfig.title;
      if (els.dateInput) els.dateInput.value = countdownConfig.targetDate;
      if (els.timeInput) els.timeInput.value = countdownConfig.targetTime || '00:00';

      const bgValue = countdownConfig.background || 'none';
      const bgRadio = els.modal?.querySelector(`input[name="countdown-bg"][value="${bgValue}"]`);
      if (bgRadio) bgRadio.checked = true;

      // Reset pending SVG to current saved value
      pendingSvg = countdownConfig.customSvg;
      updateSvgUploadVisibility();
      initBlurControls();
      updateSvgPreview(pendingSvg);
      if (els.svgInput) els.svgInput.value = '';
    }

    els.modal?.classList.add('active');
  });

  // Use event delegation for modal buttons (handles async-loaded modals)
  document.addEventListener('click', (e) => {
    const target = e.target;
    const els = getModalElements();

    // Save button
    if (target.id === 'countdown-save-btn' || target.closest('#countdown-save-btn')) {
      countdownConfig.title = els.titleInput?.value || 'Days to Event';
      countdownConfig.targetDate = els.dateInput?.value || countdownConfig.targetDate;
      countdownConfig.targetTime = els.timeInput?.value || '00:00';

      const selectedBg = els.modal?.querySelector('input[name="countdown-bg"]:checked');
      countdownConfig.background = selectedBg ? selectedBg.value : 'none';

      // Save the pending SVG and blur value
      countdownConfig.customSvg = pendingSvg;
      countdownConfig.svgBlur = parseInt(els.blurSlider?.value) || 0;

      // Save focus timer config
      const defaultDuration = document.getElementById('focus-default-duration');
      const intervalEnabled = document.getElementById('focus-interval-enabled');
      const intervalMinutes = document.getElementById('focus-interval-minutes');
      const selectedAlarm = els.modal?.querySelector('input[name="focus-alarm"]:checked');
      const selectedFocusBg = els.modal?.querySelector('input[name="focus-bg"]:checked');
      const focusBlurSlider = document.getElementById('focus-blur-slider');

      focusTimerConfig.defaultDuration = parseInt(defaultDuration?.value) || 25;
      focusTimerConfig.intervalEnabled = intervalEnabled?.checked || false;
      focusTimerConfig.intervalMinutes = parseInt(intervalMinutes?.value) || 25;
      focusTimerConfig.alarmType = selectedAlarm?.value || 'default';
      focusTimerConfig.customAlarmBase64 = pendingAudioBase64;
      focusTimerConfig.customAlarmFilename = pendingAudioFilename;
      focusTimerConfig.background = selectedFocusBg?.value || 'none';
      focusTimerConfig.customSvg = pendingFocusSvg;
      focusTimerConfig.svgBlur = parseInt(focusBlurSlider?.value) || 0;

      try {
        localStorage.setItem('countdown-config', JSON.stringify(countdownConfig));
        localStorage.setItem('focus-timer-config', JSON.stringify(focusTimerConfig));
      } catch (e) {
        // localStorage quota exceeded
        alert('Failed to save: File too large for storage. Please use smaller files.');
        countdownConfig.customSvg = null;
        countdownConfig.background = 'none';
        focusTimerConfig.customAlarmBase64 = null;
        focusTimerConfig.customAlarmFilename = null;
        focusTimerConfig.customSvg = null;
        focusTimerConfig.background = 'none';
        return;
      }

      if (titleEl) titleEl.textContent = countdownConfig.title;
      els.modal?.classList.remove('active');
      updateCountdown();

      // Apply appropriate background based on current mode
      if (currentWidgetMode === 'focus') {
        applyFocusTimerBackground();
      } else {
        applyCountdownBackground(countdownConfig.background);
      }

      // Apply custom duration to focus timer immediately
      const customMinutes = focusTimerConfig.defaultDuration;
      focusTimerState.duration = customMinutes * 60;
      focusTimerState.remaining = customMinutes * 60;
      focusTimerState.lastIntervalAlert = 0;
      updateFocusTimerDisplay();

      // Clear all preset buttons since this is a custom duration
      const presetBtns = document.querySelectorAll('.focus-preset-btn');
      presetBtns.forEach(btn => btn.classList.remove('active'));
    }

    // Cancel button
    if (target.id === 'countdown-cancel-btn' || target.closest('#countdown-cancel-btn')) {
      els.modal?.classList.remove('active');
    }

    // Clear SVG button (countdown)
    if (target.id === 'countdown-svg-clear' || target.closest('#countdown-svg-clear')) {
      pendingSvg = null;
      if (els.svgInput) els.svgInput.value = '';
      updateSvgPreview(null);
    }

    // Clear SVG button (focus timer)
    if (target.id === 'focus-svg-clear' || target.closest('#focus-svg-clear')) {
      pendingFocusSvg = null;
      const focusSvgInput = document.getElementById('focus-svg-input');
      if (focusSvgInput) focusSvgInput.value = '';
      updateFocusSvgPreview(null);
    }

    // Click outside modal to close
    if (target.id === 'countdown-modal') {
      els.modal?.classList.remove('active');
    }
  });

  // Use event delegation for radio buttons and file input
  document.addEventListener('change', (e) => {
    const target = e.target;

    // Background radio buttons
    if (target.name === 'countdown-bg') {
      updateSvgUploadVisibility();
    }

    // SVG file input (countdown)
    if (target.id === 'countdown-svg-input') {
      const file = target.files?.[0];
      if (!file) return;

      if (!file.type.includes('svg') && !file.name.endsWith('.svg')) {
        console.warn('Please select an SVG file');
        return;
      }

      // Check file size (localStorage limit ~5MB, base64 adds ~33%)
      const MAX_FILE_SIZE = 500 * 1024; // 500KB limit for safety
      if (file.size > MAX_FILE_SIZE) {
        alert(`SVG file too large (${(file.size / 1024).toFixed(0)}KB). Please use an SVG under 500KB.`);
        target.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const svgContent = event.target?.result;
        // Convert to base64 data URL
        const base64 = btoa(unescape(encodeURIComponent(svgContent)));
        pendingSvg = `data:image/svg+xml;base64,${base64}`;
        updateSvgPreview(pendingSvg);
      };
      reader.readAsText(file);
    }

    // Focus timer: Background radio buttons
    if (target.name === 'focus-bg') {
      updateFocusSvgUploadVisibility();
    }

    // Focus timer: SVG file input
    if (target.id === 'focus-svg-input') {
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
        pendingFocusSvg = `data:image/svg+xml;base64,${base64}`;
        updateFocusSvgPreview(pendingFocusSvg);
      };
      reader.readAsText(file);
    }

    // Focus timer: Interval checkbox
    if (target.id === 'focus-interval-enabled') {
      const intervalRow = document.getElementById('focus-interval-row');
      if (intervalRow) intervalRow.style.display = target.checked ? 'flex' : 'none';
    }

    // Focus timer: Alarm type radio buttons
    if (target.name === 'focus-alarm') {
      const customControls = document.getElementById('focus-custom-audio-controls');
      if (customControls) customControls.classList.toggle('active', target.value === 'custom');
    }

    // Focus timer: Audio file input
    if (target.id === 'focus-audio-input') {
      const file = target.files?.[0];
      if (!file) return;

      // Check file size (2MB limit for audio)
      const MAX_AUDIO_SIZE = 2 * 1024 * 1024;
      if (file.size > MAX_AUDIO_SIZE) {
        alert(`Audio file too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Please use a file under 2MB.`);
        target.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        pendingAudioBase64 = event.target?.result;
        pendingAudioFilename = file.name;
        const filenameEl = document.getElementById('focus-audio-filename');
        if (filenameEl) filenameEl.textContent = file.name;
      };
      reader.readAsDataURL(file);
    }
  });

  // Audio preview and clear buttons (event delegation)
  document.addEventListener('click', (e) => {
    const target = e.target;

    // Preview audio button
    if (target.id === 'focus-audio-preview-btn' || target.closest('#focus-audio-preview-btn')) {
      if (pendingAudioBase64) {
        const previewAudio = new Audio(pendingAudioBase64);
        previewAudio.play().catch(err => console.warn('Failed to preview audio:', err));
        // Stop after 3 seconds
        setTimeout(() => {
          previewAudio.pause();
          previewAudio.currentTime = 0;
        }, 3000);
      }
    }

    // Clear audio button
    if (target.id === 'focus-audio-clear-btn' || target.closest('#focus-audio-clear-btn')) {
      pendingAudioBase64 = null;
      pendingAudioFilename = null;
      const filenameEl = document.getElementById('focus-audio-filename');
      const audioInput = document.getElementById('focus-audio-input');
      if (filenameEl) filenameEl.textContent = 'No file selected';
      if (audioInput) audioInput.value = '';
    }
  });

  // Blur slider/input sync
  document.addEventListener('input', (e) => {
    const target = e.target;
    // Countdown blur controls
    if (target.id === 'countdown-blur-slider') {
      const blurInput = document.getElementById('countdown-blur-input');
      if (blurInput) blurInput.value = target.value;
    }
    if (target.id === 'countdown-blur-input') {
      let val = parseInt(target.value) || 0;
      val = Math.max(0, Math.min(30, val));
      target.value = val;
      const blurSlider = document.getElementById('countdown-blur-slider');
      if (blurSlider) blurSlider.value = val;
    }
    // Focus timer blur controls
    if (target.id === 'focus-blur-slider') {
      const blurInput = document.getElementById('focus-blur-input');
      if (blurInput) blurInput.value = target.value;
    }
    if (target.id === 'focus-blur-input') {
      let val = parseInt(target.value) || 0;
      val = Math.max(0, Math.min(30, val));
      target.value = val;
      const blurSlider = document.getElementById('focus-blur-slider');
      if (blurSlider) blurSlider.value = val;
    }
  });

  /* ================================================================
     FOCUS TIMER INITIALIZATION
     ================================================================ */

  // Apply saved mode on load
  switchWidgetMode(currentWidgetMode);

  // Initialize focus timer display
  updateFocusTimerDisplay();

  // Update preset buttons to match loaded duration
  const loadedMinutes = Math.floor(focusTimerState.duration / 60);
  const presets = [25, 50, 90, 120];
  const presetBtnsInit = document.querySelectorAll('.focus-preset-btn');
  presetBtnsInit.forEach(btn => {
    const btnMinutes = parseInt(btn.dataset.minutes);
    btn.classList.toggle('active', btnMinutes === loadedMinutes && presets.includes(loadedMinutes));
  });

  // Nav dots click handlers
  const navDots = document.querySelectorAll('.countdown-nav-dots .nav-dot');
  navDots.forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = dot.dataset.mode;
      if (mode) switchWidgetMode(mode);
    });
  });

  // Focus timer control buttons
  const playBtn = document.getElementById('focus-play-btn');
  playBtn?.addEventListener('click', toggleFocusTimer);

  const resetBtn = document.getElementById('focus-reset-btn');
  resetBtn?.addEventListener('click', resetFocusTimer);

  // Preset duration buttons
  const presetBtns = document.querySelectorAll('.focus-preset-btn[data-minutes]');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const minutes = parseInt(btn.dataset.minutes);
      if (minutes) setFocusDuration(minutes);
    });
  });

  // Custom duration button
  const customBtn = document.getElementById('focus-custom-btn');
  customBtn?.addEventListener('click', showCustomDurationInput);

  // Lotus button - stops alarm when clicked during alarm, opens Windows Focus Sessions
  const lotusBtn = document.getElementById('focus-lotus-btn');
  lotusBtn?.addEventListener('click', async () => {
    if (isAlarmPlaying) {
      stopAlarm();
      lotusBtn.classList.remove('active');
    }
    // Open Windows Focus Sessions (temporarily disables always-on-top)
    if (window.__TAURI__?.invoke) {
      try {
        await window.__TAURI__.invoke('open_focus_sessions');
      } catch (e) {
        console.warn('Failed to open Focus Sessions:', e);
      }
    }
  });

  // Add custom duration input to the widget if not present
  const focusMode = document.getElementById('focus-mode');
  if (focusMode && !focusMode.querySelector('.focus-custom-input')) {
    const customInputHtml = `
      <div class="focus-custom-input">
        <label>Custom Duration (minutes)</label>
        <input type="number" id="focus-custom-minutes" min="1" max="999" value="25">
        <div class="focus-custom-input-btns">
          <button class="apply" id="focus-custom-apply">Apply</button>
          <button class="cancel" id="focus-custom-cancel">Cancel</button>
        </div>
      </div>
    `;
    focusMode.insertAdjacentHTML('beforeend', customInputHtml);
  }

  // Custom duration input handlers (event delegation)
  document.addEventListener('click', (e) => {
    const target = e.target;

    if (target.id === 'focus-custom-apply' || target.closest('#focus-custom-apply')) {
      applyCustomDuration();
    }

    if (target.id === 'focus-custom-cancel' || target.closest('#focus-custom-cancel')) {
      hideCustomDurationInput();
    }
  });

  // Handle Enter key in custom duration input
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'focus-custom-minutes') {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCustomDuration();
      } else if (e.key === 'Escape') {
        hideCustomDurationInput();
      }
    }
  });

  // Start updates
  updateCountdown();
  setInterval(updateCountdown, 1000);
}

// Export for settings panel
window.updateCountdownConfig = updateCountdownConfig;

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCountdown);
} else {
  initCountdown();
}
