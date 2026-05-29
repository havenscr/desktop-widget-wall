/* ================================================================
   CLOCK MODULE
   Updates time display every second with flip animation
   Includes integrated radio player functionality
   ================================================================ */

// Store previous digit values for flip animation detection
let previousDigits = { h1: '', h2: '', m1: '', m2: '' };

// Clock background config
let clockConfig = {
  background: 'none',
  customSvg: null,
  svgBlur: 0
};

// Load saved config
const savedClockConfig = localStorage.getItem('clock-config');
if (savedClockConfig) {
  try {
    clockConfig = JSON.parse(savedClockConfig);
  } catch (e) {
    console.warn('Failed to parse clock config:', e);
  }
}

function applyClockBackground(bgType) {
  const widget = document.querySelector('.widget-clock');
  if (widget) {
    if (bgType && bgType !== 'none') {
      widget.setAttribute('data-bg', bgType);
      if (bgType === 'svg') {
        if (clockConfig.customSvg) {
          widget.style.setProperty('--clock-custom-svg', `url("${clockConfig.customSvg}")`);
        }
        const blurVal = clockConfig.svgBlur ?? 0;
        widget.style.setProperty('--clock-svg-blur', `${blurVal}px`);
        widget.style.setProperty('--clock-svg-blur-scale', blurVal * 0.007);
      }
    } else {
      widget.removeAttribute('data-bg');
      widget.style.removeProperty('--clock-custom-svg');
      widget.style.removeProperty('--clock-svg-blur');
      widget.style.removeProperty('--clock-svg-blur-scale');
    }
  }
}

// Radio state
let clockRadioAudio = null;
let isClockRadioPlaying = false;
let clockCurrentStationIndex = 0;

const clockRadioStations = [
  { name: 'Lofi Hip Hop', freq: '98.7', url: 'https://streams.ilovemusic.de/iloveradio17.mp3' },
  { name: 'Chillhop', freq: '101.3', url: 'https://streams.fluxfm.de/Chillhop/mp3-320/audio/' },
  { name: 'Jazz Radio', freq: '104.5', url: 'https://jazz-wr04.ice.infomaniak.ch/jazz-wr04-128.mp3' },
  { name: 'Classical', freq: '91.9', url: 'https://live.musopen.org:8085/streamvbr0' }
];

/**
 * Animate a digit flip when value changes
 * @param {HTMLElement} digitEl - The digit element to animate
 * @param {string} oldValue - Previous digit value
 * @param {string} newValue - New digit value
 */
function animateDigitFlip(digitEl, oldValue, newValue) {
  if (!digitEl || oldValue === newValue) return;

  // Create the flip animation structure
  const flipper = document.createElement('div');
  flipper.className = 'digit-flipper';

  // Top half (shows old value, flips down)
  const topHalf = document.createElement('div');
  topHalf.className = 'flip-top';
  topHalf.innerHTML = `<span>${oldValue}</span>`;

  // Bottom half (reveals new value)
  const bottomHalf = document.createElement('div');
  bottomHalf.className = 'flip-bottom';
  bottomHalf.innerHTML = `<span>${newValue}</span>`;

  // Back of top (shows new value as it flips)
  const topBack = document.createElement('div');
  topBack.className = 'flip-top-back';
  topBack.innerHTML = `<span>${newValue}</span>`;

  flipper.appendChild(topHalf);
  flipper.appendChild(bottomHalf);
  flipper.appendChild(topBack);

  // Set the new value immediately (will be revealed by animation)
  digitEl.textContent = newValue;
  digitEl.appendChild(flipper);

  // Trigger the animation
  requestAnimationFrame(() => {
    flipper.classList.add('flipping');
  });

  // Clean up after animation
  setTimeout(() => {
    flipper.remove();
  }, 600);
}

/**
 * Update a digit with optional flip animation
 * @param {string} id - Element ID
 * @param {string} newValue - New digit value
 */
function updateDigit(id, newValue) {
  const el = document.getElementById(id);
  if (!el) return;

  const oldValue = previousDigits[id];

  if (oldValue !== '' && oldValue !== newValue) {
    animateDigitFlip(el, oldValue, newValue);
  } else {
    el.textContent = newValue;
  }

  previousDigits[id] = newValue;
}

function updateClock() {
  const now = new Date();
  let hours = now.getHours();
  const mins = now.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const hoursStr = hours.toString().padStart(2, '0');

  // Update digit groups with flip animation
  updateDigit('h1', hoursStr[0]);
  updateDigit('h2', hoursStr[1]);
  updateDigit('m1', mins[0]);
  updateDigit('m2', mins[1]);

  document.getElementById('clock-ampm').textContent = ampm;

  // Update date
  const options = { weekday: 'long', month: 'long', day: 'numeric' };
  document.getElementById('clock-date').textContent = now.toLocaleDateString('en-US', options);
}

/**
 * Toggle radio playback
 */
function toggleClockRadio() {
  const inlineBtn = document.getElementById('clock-radio-inline');
  const dropdownBtn = document.getElementById('radio-btn');

  if (isClockRadioPlaying) {
    clockRadioAudio.pause();
    clockRadioAudio.src = '';
    isClockRadioPlaying = false;
    inlineBtn?.classList.remove('playing');
    dropdownBtn?.classList.remove('active');
    updateRadioButtonIcon(false);
  } else {
    clockRadioAudio.src = clockRadioStations[clockCurrentStationIndex].url;
    clockRadioAudio.play()
      .then(() => {
        isClockRadioPlaying = true;
        inlineBtn?.classList.add('playing');
        dropdownBtn?.classList.add('active');
        updateRadioButtonIcon(true);
      })
      .catch(e => console.log('Radio play error:', e));
  }
}

/**
 * Update the radio button icon between play/pause
 */
function updateRadioButtonIcon(playing) {
  const inlineBtn = document.getElementById('clock-radio-inline');
  if (!inlineBtn) return;

  const svg = inlineBtn.querySelector('svg');
  if (svg) {
    if (playing) {
      // Pause icon (two vertical bars)
      svg.innerHTML = '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>';
    } else {
      // Play icon (triangle)
      svg.innerHTML = '<path d="M8 5v14l11-7z"/>';
    }
  }
  // Keep "Radio" text - don't change it
}

/**
 * Cycle to next radio station
 */
function nextStation() {
  clockCurrentStationIndex = (clockCurrentStationIndex + 1) % clockRadioStations.length;
  localStorage.setItem('clock-radio-station', clockCurrentStationIndex);
  updateStationDisplay();

  if (isClockRadioPlaying) {
    clockRadioAudio.src = clockRadioStations[clockCurrentStationIndex].url;
    clockRadioAudio.play().catch(e => console.log('Radio play error:', e));
  }
}

/**
 * Update station frequency display
 */
function updateStationDisplay() {
  const freqDisplay = document.getElementById('radio-freq');
  if (freqDisplay) {
    freqDisplay.textContent = clockRadioStations[clockCurrentStationIndex].freq;
  }
}

/**
 * Initialize radio controls
 */
function initClockRadio() {
  // Initialize audio element
  clockRadioAudio = new Audio();
  clockRadioAudio.volume = 0.5;

  // Load saved station
  const savedStation = localStorage.getItem('clock-radio-station');
  if (savedStation !== null) {
    clockCurrentStationIndex = parseInt(savedStation) || 0;
  }
  updateStationDisplay();

  // Load saved volume
  const savedVolume = localStorage.getItem('clock-radio-volume');
  if (savedVolume !== null) {
    clockRadioAudio.volume = parseFloat(savedVolume);
    const volumeSlider = document.getElementById('radio-volume');
    if (volumeSlider) {
      volumeSlider.value = parseFloat(savedVolume) * 100;
    }
  }

  // Inline radio button (main toggle)
  const inlineBtn = document.getElementById('clock-radio-inline');
  inlineBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleClockRadio();
  });

  // Radio toggle button (top-right, opens dropdown)
  const radioToggle = document.getElementById('clock-radio-toggle');
  const radioDropdown = document.getElementById('clock-radio-dropdown');

  radioToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    radioDropdown?.classList.toggle('active');
    radioToggle.classList.toggle('active');
  });

  // Dropdown play/pause button
  const dropdownBtn = document.getElementById('radio-btn');
  dropdownBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleClockRadio();
  });

  // Volume slider
  const volumeSlider = document.getElementById('radio-volume');
  volumeSlider?.addEventListener('input', (e) => {
    const volume = e.target.value / 100;
    clockRadioAudio.volume = volume;
    localStorage.setItem('clock-radio-volume', volume);
  });

  // Frequency display click to change station
  const freqDisplay = document.getElementById('radio-freq');
  freqDisplay?.addEventListener('click', (e) => {
    e.stopPropagation();
    nextStation();
  });
  freqDisplay?.style.setProperty('cursor', 'pointer');

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    radioDropdown?.classList.remove('active');
    radioToggle?.classList.remove('active');
  });

  // Prevent dropdown clicks from closing it
  radioDropdown?.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

function initClockBackground() {
  // Apply saved background on load
  applyClockBackground(clockConfig.background);

  // Temporary SVG storage for modal (only saved on Save click)
  let pendingSvg = clockConfig.customSvg;

  // Helper to get modal elements (re-query each time since modals load async)
  function getModalElements() {
    return {
      modal: document.getElementById('clock-modal'),
      svgUpload: document.getElementById('clock-svg-upload'),
      svgInput: document.getElementById('clock-svg-input'),
      svgPreview: document.getElementById('clock-svg-preview'),
      blurSlider: document.getElementById('clock-blur-slider'),
      blurInput: document.getElementById('clock-blur-input')
    };
  }

  // Show/hide SVG upload section based on radio selection
  function updateSvgUploadVisibility() {
    const els = getModalElements();
    const selectedBg = els.modal?.querySelector('input[name="clock-bg"]:checked');
    if (els.svgUpload) {
      els.svgUpload.style.display = selectedBg?.value === 'svg' ? 'block' : 'none';
    }
  }

  // Initialize blur controls with saved value
  function initBlurControls() {
    const els = getModalElements();
    if (els.blurSlider && els.blurInput) {
      const blurValue = clockConfig.svgBlur ?? 0;
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

  // Config button opens modal
  const clockConfigBtn = document.getElementById('clock-config-btn');
  clockConfigBtn?.addEventListener('click', () => {
    const els = getModalElements();
    const bgValue = clockConfig.background || 'none';
    const bgRadio = els.modal?.querySelector(`input[name="clock-bg"][value="${bgValue}"]`);
    if (bgRadio) bgRadio.checked = true;

    // Reset pending SVG to current saved value
    pendingSvg = clockConfig.customSvg;
    updateSvgUploadVisibility();
    initBlurControls();
    updateSvgPreview(pendingSvg);
    if (els.svgInput) els.svgInput.value = '';

    els.modal?.classList.add('active');
  });

  // Use event delegation for modal buttons (handles async-loaded modals)
  document.addEventListener('click', (e) => {
    const target = e.target;
    const els = getModalElements();

    // Save button
    if (target.id === 'clock-save-btn' || target.closest('#clock-save-btn')) {
      const selectedBg = els.modal?.querySelector('input[name="clock-bg"]:checked');
      clockConfig.background = selectedBg ? selectedBg.value : 'none';
      clockConfig.customSvg = pendingSvg;
      clockConfig.svgBlur = parseInt(els.blurSlider?.value) || 0;

      try {
        localStorage.setItem('clock-config', JSON.stringify(clockConfig));
      } catch (e) {
        alert('Failed to save: SVG file too large for storage. Please use a smaller SVG.');
        clockConfig.customSvg = null;
        clockConfig.background = 'none';
        return;
      }

      applyClockBackground(clockConfig.background);
      els.modal?.classList.remove('active');
    }

    // Cancel button
    if (target.id === 'clock-cancel-btn' || target.closest('#clock-cancel-btn')) {
      els.modal?.classList.remove('active');
    }

    // Clear SVG button
    if (target.id === 'clock-svg-clear' || target.closest('#clock-svg-clear')) {
      pendingSvg = null;
      if (els.svgInput) els.svgInput.value = '';
      updateSvgPreview(null);
    }

    // Click outside modal to close
    if (target.id === 'clock-modal') {
      els.modal?.classList.remove('active');
    }
  });

  // Use event delegation for radio buttons and file input
  document.addEventListener('change', (e) => {
    const target = e.target;

    // Background radio buttons
    if (target.name === 'clock-bg') {
      updateSvgUploadVisibility();
    }

    // SVG file input
    if (target.id === 'clock-svg-input') {
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
    if (target.id === 'clock-blur-slider') {
      const blurInput = document.getElementById('clock-blur-input');
      if (blurInput) blurInput.value = target.value;
    }
    if (target.id === 'clock-blur-input') {
      let val = parseInt(target.value) || 0;
      val = Math.max(0, Math.min(30, val));
      target.value = val;
      const blurSlider = document.getElementById('clock-blur-slider');
      if (blurSlider) blurSlider.value = val;
    }
  });
}

function initClock() {
  updateClock();

  // Only update when minute changes (not every second - clock doesn't show seconds)
  // This reduces CPU calls from 60/minute to 1/minute
  function scheduleNextUpdate() {
    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    setTimeout(() => {
      updateClock();
      // After first sync, update every 60 seconds
      setInterval(updateClock, 60000);
    }, msUntilNextMinute);
  }
  scheduleNextUpdate();

  initClockBackground();
  // Radio functionality moved to radio.js for Now Playing integration
  // initClockRadio();
}

// Auto-initialize if DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initClock);
} else {
  initClock();
}
