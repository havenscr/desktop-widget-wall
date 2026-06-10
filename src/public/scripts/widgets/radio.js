/* ================================================================
   RADIO MODULE
   Audio streaming player controls with Media Session API integration
   ================================================================ */

let radioAudio = null;
let isRadioPlaying = false;
let currentStationIndex = 0;

const radioStations = [
  { name: 'Lofi Hip Hop', url: 'https://streams.ilovemusic.de/iloveradio17.mp3', genre: 'Lo-Fi' },
  { name: 'Chillhop', url: 'https://streams.fluxfm.de/Chillhop/mp3-320/audio/', genre: 'Chillhop' },
  { name: 'Jazz Radio', url: 'https://jazz-wr04.ice.infomaniak.ch/jazz-wr04-128.mp3', genre: 'Jazz' },
  { name: 'Classical', url: 'https://live.musopen.org:8085/streamvbr0', genre: 'Classical' }
];

// Expose radio state globally so now-playing can detect it
window.radioState = {
  isPlaying: false,
  station: null,
  audio: null
};

// Update Media Session API with current radio info
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;

  const station = radioStations[currentStationIndex];

  navigator.mediaSession.metadata = new MediaMetadata({
    title: station.name,
    artist: 'Internet Radio',
    album: station.genre || 'Live Stream'
  });

  navigator.mediaSession.playbackState = isRadioPlaying ? 'playing' : 'paused';

  // Set up media session action handlers
  navigator.mediaSession.setActionHandler('play', () => {
    if (!isRadioPlaying) toggleRadio();
  });

  navigator.mediaSession.setActionHandler('pause', () => {
    if (isRadioPlaying) toggleRadio();
  });

  navigator.mediaSession.setActionHandler('previoustrack', () => {
    const newIndex = (currentStationIndex - 1 + radioStations.length) % radioStations.length;
    selectStation(newIndex);
  });

  navigator.mediaSession.setActionHandler('nexttrack', () => {
    const newIndex = (currentStationIndex + 1) % radioStations.length;
    selectStation(newIndex);
  });
}

// Update global radio state for now-playing widget
function updateRadioState() {
  // Always keep station reference so audio element check can work
  window.radioState = {
    isPlaying: isRadioPlaying,
    station: radioStations[currentStationIndex],
    audio: radioAudio
  };

  // DIRECTLY set the override flag on window (bypasses event system issues)
  window.forceRadioOverride = isRadioPlaying;

  dlog('Radio state updated:', window.radioState.isPlaying, window.radioState.station?.name, 'forceRadioOverride:', window.forceRadioOverride);

  // Dispatch custom event so now-playing can react immediately
  window.dispatchEvent(new CustomEvent('radio-state-change', {
    detail: window.radioState
  }));
}

function initRadio() {
  // Support both standalone radio widget IDs and clock-embedded radio IDs
  const radioToggle = document.getElementById('radio-toggle') || document.getElementById('clock-radio-toggle');
  const radioDropdown = document.getElementById('radio-dropdown') || document.getElementById('clock-radio-dropdown');
  const radioStation = document.getElementById('radio-station') || document.getElementById('radio-freq');
  const radioVolume = document.getElementById('radio-volume');
  const radioStationList = document.getElementById('radio-station-list');

  // Get ALL possible play buttons - attach listeners to each
  const playButtons = [
    document.getElementById('radio-play'),
    document.getElementById('radio-btn'),
    document.getElementById('clock-radio-inline')
  ].filter(Boolean); // Remove nulls

  if (playButtons.length === 0) {
    console.log('Radio: No play button found, radio disabled');
    return;
  }

  console.log('Radio: Initializing with', playButtons.length, 'play button(s):', playButtons.map(b => b.id).join(', '));

  // Initialize audio element
  radioAudio = new Audio();
  radioAudio.volume = 0.5;

  // Populate station list
  if (radioStationList) {
    radioStations.forEach((station, index) => {
      const btn = document.createElement('button');
      btn.className = 'radio-station-btn';
      btn.textContent = station.name;
      btn.addEventListener('click', () => selectStation(index));
      radioStationList.appendChild(btn);
    });
  }

  // Toggle dropdown
  radioToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    radioDropdown.classList.toggle('active');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    radioDropdown?.classList.remove('active');
  });

  // Play/pause buttons - attach to ALL found buttons
  playButtons.forEach(btn => {
    btn.addEventListener('click', toggleRadio);
    console.log('Radio: Attached click listener to', btn.id);
  });

  // Volume slider
  radioVolume?.addEventListener('input', (e) => {
    if (radioAudio) {
      radioAudio.volume = e.target.value / 100;
    }
  });

  // Load saved station
  const savedStation = localStorage.getItem('radio-station');
  if (savedStation !== null) {
    currentStationIndex = parseInt(savedStation) || 0;
    updateStationDisplay();
  }

  // Initialize the global state with audio element reference
  updateRadioState();
}

function selectStation(index) {
  currentStationIndex = index;
  localStorage.setItem('radio-station', index);
  updateStationDisplay();

  if (isRadioPlaying) {
    radioAudio.src = radioStations[index].url;
    radioAudio.play().catch(e => console.log('Radio play error:', e));
    updateMediaSession();
    updateRadioState();
  }

  const dropdown = document.getElementById('radio-dropdown') || document.getElementById('clock-radio-dropdown');
  dropdown?.classList.remove('active');
}

function updateStationDisplay() {
  const radioStation = document.getElementById('radio-station') || document.getElementById('radio-freq');
  if (radioStation) {
    radioStation.textContent = radioStations[currentStationIndex].name;
  }
}

// Update radio button icons (play/pause)
function updateRadioButtonIcons(playing) {
  const inlineBtn = document.getElementById('clock-radio-inline');
  const dropdownBtn = document.getElementById('radio-btn');

  // Update inline button SVG
  if (inlineBtn) {
    const svg = inlineBtn.querySelector('svg');
    if (svg) {
      if (playing) {
        svg.innerHTML = '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'; // Pause icon
      } else {
        svg.innerHTML = '<path d="M8 5v14l11-7z"/>'; // Play icon
      }
    }
  }

  // Update dropdown button class
  if (dropdownBtn) {
    dropdownBtn.classList.toggle('active', playing);
  }
}

function toggleRadio() {
  const radioPlay = document.getElementById('radio-play') || document.getElementById('radio-btn') || document.getElementById('clock-radio-inline');

  if (isRadioPlaying) {
    radioAudio.pause();
    radioAudio.src = '';
    isRadioPlaying = false;
    window.forceRadioOverride = false; // Clear immediately
    radioPlay?.classList.remove('playing');
    updateRadioButtonIcons(false);
    updateMediaSession();
    updateRadioState();
  } else {
    // Set flag IMMEDIATELY before async play
    isRadioPlaying = true;
    window.forceRadioOverride = true;
    dlog('RADIO: Play clicked - window.forceRadioOverride set to TRUE');
    radioPlay?.classList.add('playing');
    updateRadioButtonIcons(true);

    radioAudio.src = radioStations[currentStationIndex].url;
    radioAudio.play()
      .then(() => {
        updateMediaSession();
        updateRadioState();
      })
      .catch(e => {
        // Revert on failure
        console.log('Radio play error:', e);
        isRadioPlaying = false;
        window.forceRadioOverride = false;
        radioPlay?.classList.remove('playing');
        updateRadioButtonIcons(false);
      });
  }
}

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRadio);
} else {
  initRadio();
}
