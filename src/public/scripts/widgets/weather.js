/* ================================================================
   WEATHER MODULE - iOS Widget Wall Style
   Fetches weather data from Open-Meteo API
   ================================================================ */

// Shared weather data for other widgets (e.g., Calendar)
window.WeatherData = {
  current: null,  // {temp, code, icon} - current conditions
  daily: [],  // Array of {date, high, low, code, icon}
  updated: null
};

// WMO Weather Codes
const WMO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Slight showers', 81: 'Moderate showers', 82: 'Violent showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail'
};

const weatherConfig = {
  latitude: 47.6815,
  longitude: -122.2087,
  city: 'Kirkland'
};

async function fetchWeather() {
  try {
    // Fetch current, hourly, and daily data
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${weatherConfig.latitude}&longitude=${weatherConfig.longitude}&current=temperature_2m,weather_code,is_day,relative_humidity_2m,wind_speed_10m,uv_index&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=7`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Weather fetch failed');
    const data = await response.json();

    // Update current weather
    const currentTemp = Math.round(data.current.temperature_2m);
    const currentCode = data.current.weather_code;
    const isDay = data.current.is_day;
    const uvIndex = Math.round(data.current.uv_index);

    // Update temp next to city name
    document.getElementById('weather-temp').textContent = currentTemp + '°';
    document.getElementById('weather-condition').textContent = WMO_CODES[currentCode] || 'Unknown';

    // Update today's high/low
    if (data.daily && data.daily.temperature_2m_max && data.daily.temperature_2m_min) {
      const todayHigh = Math.round(data.daily.temperature_2m_max[0]);
      const todayLow = Math.round(data.daily.temperature_2m_min[0]);
      document.getElementById('weather-highlow').textContent = `H:${todayHigh}° L:${todayLow}°`;
    }

    // Update UV index
    const uvEl = document.getElementById('weather-uv');
    if (uvEl) {
      uvEl.textContent = `UV ${uvIndex}`;
      // Add color coding based on UV level
      uvEl.className = 'weather-uv';
      if (uvIndex >= 8) {
        uvEl.classList.add('uv-extreme');
      } else if (uvIndex >= 6) {
        uvEl.classList.add('uv-high');
      } else if (uvIndex >= 3) {
        uvEl.classList.add('uv-moderate');
      }
    }

    // Update humidity
    const humidity = Math.round(data.current.relative_humidity_2m);
    const humidityEl = document.getElementById('weather-humidity');
    if (humidityEl) {
      humidityEl.textContent = `H ${humidity}%`;
    }

    // Update wind speed
    const windSpeed = Math.round(data.current.wind_speed_10m);
    const windEl = document.getElementById('weather-wind');
    if (windEl) {
      windEl.textContent = `W ${windSpeed}`;
    }

    // Update background based on weather
    updateWeatherBackgroundWMO(currentCode, isDay);

    // Update hourly forecast (5 hours starting from current hour)
    updateHourlyForecast(data);

    // Update daily forecast (6 days)
    updateDailyForecast(data);

    // Share weather data with other widgets
    // Store current conditions
    window.WeatherData.current = {
      temp: currentTemp,
      code: currentCode,
      icon: getWeatherIcon(currentCode)
    };

    if (data.daily) {
      window.WeatherData.daily = data.daily.time.map((time, i) => ({
        date: new Date(time).toDateString(),
        high: Math.round(data.daily.temperature_2m_max[i]),
        low: Math.round(data.daily.temperature_2m_min[i]),
        code: data.daily.weather_code[i],
        icon: getWeatherIcon(data.daily.weather_code[i])
      }));
      window.WeatherData.updated = new Date();
      window.dispatchEvent(new CustomEvent('weather-updated', { detail: window.WeatherData }));
    }

  } catch (e) {
    console.log('Weather fetch error:', e.message);
  }
}

function updateHourlyForecast(data) {
  const hourlyContainer = document.getElementById('weather-hourly');
  if (!hourlyContainer || !data.hourly) return;

  hourlyContainer.innerHTML = '';

  // Find current hour index
  const now = new Date();
  const currentHour = now.getHours();

  // Find the index for the current hour
  let startIndex = 0;
  for (let i = 0; i < data.hourly.time.length; i++) {
    const hourTime = new Date(data.hourly.time[i]);
    if (hourTime.getDate() === now.getDate() && hourTime.getHours() >= currentHour) {
      startIndex = i;
      break;
    }
  }

  // Show 5 hours with icons
  for (let i = 0; i < 5; i++) {
    const idx = startIndex + i;
    if (idx >= data.hourly.time.length) break;

    const hourTime = new Date(data.hourly.time[idx]);
    const temp = Math.round(data.hourly.temperature_2m[idx]);
    const code = data.hourly.weather_code[idx];

    // Format hour (e.g., "7PM", "8PM")
    let hourLabel;
    if (i === 0) {
      hourLabel = 'Now';
    } else {
      const hour = hourTime.getHours();
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      hourLabel = `${hour12}${ampm}`;
    }

    const hourEl = document.createElement('div');
    hourEl.className = 'hourly-item';
    hourEl.innerHTML = `
      <span class="hourly-time">${hourLabel}</span>
      <span class="hourly-icon">${getWeatherIcon(code)}</span>
      <span class="hourly-temp">${temp}°</span>
    `;
    hourlyContainer.appendChild(hourEl);
  }
}

function updateDailyForecast(data) {
  const dailyContainer = document.getElementById('weather-daily');
  if (!dailyContainer || !data.daily) return;

  dailyContainer.innerHTML = '';

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Show 6 days (today + 5 more)
  for (let i = 0; i < Math.min(6, data.daily.time.length); i++) {
    const date = new Date(data.daily.time[i]);
    const high = Math.round(data.daily.temperature_2m_max[i]);
    const low = Math.round(data.daily.temperature_2m_min[i]);
    const code = data.daily.weather_code[i];

    let dayName;
    if (i === 0) {
      dayName = 'Today';
    } else if (i === 1) {
      dayName = 'Tomorrow';
    } else {
      dayName = days[date.getDay()];
    }

    const dayEl = document.createElement('div');
    dayEl.className = 'daily-row';
    dayEl.innerHTML = `
      <span class="daily-day">${dayName}</span>
      <span class="daily-icon">${getWeatherIcon(code)}</span>
      <span class="daily-temps">
        <span class="daily-high">${high}°</span>
        <span class="daily-low">${low}°</span>
      </span>
    `;
    dailyContainer.appendChild(dayEl);
  }
}

function getWeatherIcon(code) {
  // Using basic Unicode symbols that render consistently in WebView2
  // Avoiding surrogate pairs (emoji beyond U+FFFF) which can show boxes
  if (code === 0 || code === 1) return '\u2600'; // Sun (☀)
  if (code === 2) return '\u26C5'; // Sun behind cloud (⛅)
  if (code === 3) return '\u2601'; // Cloud (☁)
  if (code === 45 || code === 48) return '\u2601'; // Fog - use cloud
  if (code >= 51 && code <= 67) return '\u2614'; // Rain - umbrella with drops (☔)
  if (code >= 71 && code <= 77) return '\u2744'; // Snowflake (❄)
  if (code >= 80 && code <= 82) return '\u2614'; // Showers - umbrella with drops (☔)
  if (code >= 85 && code <= 86) return '\u2744'; // Snow showers - snowflake (❄)
  if (code >= 95) return '\u26A1'; // Lightning bolt (⚡)
  return '\u2601'; // Cloud default (☁)
}

// Track current weather type to avoid unnecessary DOM recreation
let currentWeatherType = null;

function updateWeatherBackgroundWMO(code, isDay) {
  const widget = document.querySelector('.widget-weather');
  const effectsContainer = document.getElementById('weather-effects');
  if (!widget || !effectsContainer) return;

  // Determine weather type
  let weatherType = 'sunny';
  if (!isDay) {
    weatherType = 'night';
  } else if (code === 0 || code === 1) {
    weatherType = 'sunny';
  } else if (code >= 95) {
    weatherType = 'thunder';
  } else if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    weatherType = 'snow';
  } else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    weatherType = 'rainy';
  } else if (code === 45 || code === 48) {
    weatherType = 'foggy';
  } else if (code === 2 || code === 3) {
    weatherType = 'cloudy';
  }

  // Skip DOM recreation if weather type hasn't changed
  if (weatherType === currentWeatherType) {
    return;
  }

  // Remove previous weather classes
  widget.classList.remove('weather-sunny', 'weather-cloudy', 'weather-rainy',
                          'weather-snow', 'weather-thunder', 'weather-foggy', 'weather-night');
  effectsContainer.innerHTML = '';

  widget.classList.add(`weather-${weatherType}`);
  createWeatherEffects(weatherType, effectsContainer);
  currentWeatherType = weatherType;
}

function createWeatherEffects(type, container) {
  switch(type) {
    case 'rainy':
      const rainContainer = document.createElement('div');
      rainContainer.className = 'weather-rain';
      for (let i = 0; i < 50; i++) {
        const drop = document.createElement('div');
        drop.className = 'raindrop';
        drop.style.left = Math.random() * 100 + '%';
        drop.style.animationDuration = (0.5 + Math.random() * 0.5) + 's';
        drop.style.animationDelay = Math.random() * 2 + 's';
        drop.style.height = (15 + Math.random() * 10) + 'px';
        rainContainer.appendChild(drop);
      }
      container.appendChild(rainContainer);
      break;

    case 'snow':
      const snowContainer = document.createElement('div');
      snowContainer.className = 'weather-snow-container';
      for (let i = 0; i < 30; i++) {
        const flake = document.createElement('div');
        flake.className = 'snowflake';
        flake.style.left = Math.random() * 100 + '%';
        flake.style.animationDuration = (2 + Math.random() * 3) + 's';
        flake.style.animationDelay = Math.random() * 3 + 's';
        flake.style.width = (3 + Math.random() * 5) + 'px';
        flake.style.height = flake.style.width;
        flake.style.opacity = 0.4 + Math.random() * 0.6;
        snowContainer.appendChild(flake);
      }
      container.appendChild(snowContainer);
      break;

    case 'thunder':
      const thunderRainContainer = document.createElement('div');
      thunderRainContainer.className = 'weather-rain';
      for (let i = 0; i < 60; i++) {
        const drop = document.createElement('div');
        drop.className = 'raindrop';
        drop.style.left = Math.random() * 100 + '%';
        drop.style.animationDuration = (0.4 + Math.random() * 0.3) + 's';
        drop.style.animationDelay = Math.random() * 1.5 + 's';
        drop.style.height = (18 + Math.random() * 12) + 'px';
        thunderRainContainer.appendChild(drop);
      }
      container.appendChild(thunderRainContainer);

      const lightning = document.createElement('div');
      lightning.className = 'weather-lightning';
      container.appendChild(lightning);
      break;

    case 'foggy':
      const fog = document.createElement('div');
      fog.className = 'weather-fog';
      container.appendChild(fog);
      break;

    case 'cloudy':
      const cloudsContainer = document.createElement('div');
      cloudsContainer.className = 'weather-clouds';
      for (let i = 0; i < 4; i++) {
        const cloud = document.createElement('div');
        cloud.className = 'cloud';
        cloud.style.top = (10 + i * 15 + Math.random() * 10) + '%';
        cloud.style.width = (60 + Math.random() * 40) + 'px';
        cloud.style.height = (20 + Math.random() * 15) + 'px';
        cloud.style.animationDuration = (25 + Math.random() * 15) + 's';
        cloud.style.animationDelay = (i * 5 - 10) + 's';
        cloudsContainer.appendChild(cloud);
      }
      container.appendChild(cloudsContainer);
      break;

    case 'night':
      for (let i = 0; i < 8; i++) {
        const star = document.createElement('div');
        star.style.cssText = `
          position: absolute;
          width: 2px;
          height: 2px;
          background: white;
          border-radius: 50%;
          top: ${5 + Math.random() * 40}%;
          left: ${Math.random() * 100}%;
          opacity: ${0.3 + Math.random() * 0.5};
          animation: twinkle ${1 + Math.random() * 2}s ease-in-out infinite;
        `;
        container.appendChild(star);
      }
      break;
  }
}

function initWeather() {
  fetchWeather();
  setInterval(fetchWeather, 600000); // Refresh every 10 minutes

  // Initialize skyline feature
  initSkyline();
}

// Initialize the configurable skyline feature
function initSkyline() {
  // Render the saved skyline
  if (window.SkylineUtils) {
    window.SkylineUtils.renderSkyline('weather-skyline');
  }

  // Setup config button and dropdown
  const configBtn = document.getElementById('weather-skyline-config');
  const dropdown = document.getElementById('weather-skyline-dropdown');

  if (!configBtn || !dropdown || !window.SkylineRegistry) return;

  // Build dropdown with skylines and "Add City" option
  function buildDropdown() {
    const currentId = window.SkylineUtils ? window.SkylineUtils.getSelectedSkylineId() : 'seattle';
    let html = '';

    window.SkylineRegistry.forEach(skyline => {
      const isSelected = skyline.id === currentId;
      const showDelete = !skyline.builtin;
      html += `
        <div class="weather-skyline-dropdown-item${isSelected ? ' selected' : ''}" data-skyline-id="${skyline.id}">
          <span class="skyline-item-name">${skyline.name}</span>
          ${showDelete ? `<button class="skyline-delete-btn" data-delete-id="${skyline.id}" title="Delete">&times;</button>` : ''}
        </div>
      `;
    });

    // Add "Add City" option
    html += `<div class="weather-skyline-dropdown-item add-city-option" id="add-city-btn">+ Add City</div>`;

    dropdown.innerHTML = html;
  }

  buildDropdown();

  // Toggle dropdown on config button click
  configBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Handle dropdown clicks (selection, delete, add city)
  dropdown.addEventListener('click', (e) => {
    // Handle delete button
    const deleteBtn = e.target.closest('.skyline-delete-btn');
    if (deleteBtn) {
      e.stopPropagation();
      const deleteId = deleteBtn.dataset.deleteId;
      if (window.SkylineUtils && confirm('Delete this skyline?')) {
        window.SkylineUtils.deleteCustomSkyline(deleteId);
        buildDropdown();
        window.SkylineUtils.renderSkyline('weather-skyline');
      }
      return;
    }

    // Handle "Add City" click
    if (e.target.closest('#add-city-btn')) {
      dropdown.classList.remove('open');
      openSkylineModal();
      return;
    }

    // Handle skyline selection
    const item = e.target.closest('.weather-skyline-dropdown-item');
    if (!item || item.id === 'add-city-btn') return;

    const skylineId = item.dataset.skylineId;
    if (window.SkylineUtils) {
      window.SkylineUtils.setSelectedSkylineId(skylineId);
      window.SkylineUtils.renderSkyline('weather-skyline');
    }

    // Update selected state
    dropdown.querySelectorAll('.weather-skyline-dropdown-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.skylineId === skylineId);
    });

    dropdown.classList.remove('open');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !configBtn.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  // Initialize modal functionality
  initSkylineModal(buildDropdown);
}

// Modal state
let pendingSvgData = null;

function openSkylineModal() {
  const modal = document.getElementById('skyline-modal');
  if (modal) {
    modal.classList.add('open');
    // Reset form
    document.getElementById('skyline-name-input').value = '';
    document.getElementById('skyline-file-input').value = '';
    document.getElementById('skyline-preview-container').style.display = 'none';
    document.getElementById('skyline-preview').innerHTML = '';
    document.getElementById('skyline-save-btn').disabled = true;
    document.querySelector('.skyline-file-label').textContent = 'Drop SVG here or click to browse';
    pendingSvgData = null;
  }
}

function closeSkylineModal() {
  const modal = document.getElementById('skyline-modal');
  if (modal) {
    modal.classList.remove('open');
    pendingSvgData = null;
  }
}

function initSkylineModal(rebuildDropdownCallback) {
  const modal = document.getElementById('skyline-modal');
  const closeBtn = document.getElementById('skyline-modal-close');
  const cancelBtn = document.getElementById('skyline-cancel-btn');
  const saveBtn = document.getElementById('skyline-save-btn');
  const nameInput = document.getElementById('skyline-name-input');
  const fileInput = document.getElementById('skyline-file-input');
  const fileDrop = document.getElementById('skyline-file-drop');
  const previewContainer = document.getElementById('skyline-preview-container');
  const preview = document.getElementById('skyline-preview');
  const fileLabel = document.querySelector('.skyline-file-label');

  if (!modal) return;

  // Close modal handlers
  closeBtn?.addEventListener('click', closeSkylineModal);
  cancelBtn?.addEventListener('click', closeSkylineModal);

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeSkylineModal();
    }
  });

  // File input change handler
  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleSvgFile(file);
  });

  // Drag and drop handlers
  fileDrop?.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileDrop.classList.add('dragover');
  });

  fileDrop?.addEventListener('dragleave', () => {
    fileDrop.classList.remove('dragover');
  });

  fileDrop?.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDrop.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.svg')) {
      handleSvgFile(file);
    }
  });

  // Handle SVG file
  function handleSvgFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const svgText = e.target.result;
        const parsed = window.SkylineUtils.parseSvgContent(svgText);

        pendingSvgData = parsed;
        fileLabel.textContent = file.name;

        // Show preview
        previewContainer.style.display = 'block';
        preview.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="${parsed.viewBox}" preserveAspectRatio="xMidYMax slice">
            ${parsed.svg}
          </svg>
        `;

        updateSaveButton();
      } catch (err) {
        alert('Failed to parse SVG file: ' + err.message);
        pendingSvgData = null;
        updateSaveButton();
      }
    };
    reader.readAsText(file);
  }

  // Update save button state
  function updateSaveButton() {
    const hasName = nameInput?.value.trim().length > 0;
    const hasSvg = pendingSvgData !== null;
    saveBtn.disabled = !(hasName && hasSvg);
  }

  nameInput?.addEventListener('input', updateSaveButton);

  // Save handler
  saveBtn?.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name || !pendingSvgData) return;

    const newId = window.SkylineUtils.addCustomSkyline(name, pendingSvgData.svg, pendingSvgData.viewBox);

    // Select the new skyline
    window.SkylineUtils.setSelectedSkylineId(newId);
    window.SkylineUtils.renderSkyline('weather-skyline');

    // Rebuild dropdown and close modal
    rebuildDropdownCallback();
    closeSkylineModal();
  });
}

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWeather);
} else {
  initWeather();
}
