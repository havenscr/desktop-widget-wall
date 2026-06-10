/* ================================================================
   CALENDAR WIDGET - Fantastical-style with Mini Calendar & Event List
   Microsoft Graph Integration with category colors and heatmap
   Copyright (c) 2024-2025 Havens Consulting Inc. All Rights Reserved.
   Fingerprint: AE-WWD-8B4F2C1E-2025
   ================================================================ */

const CalendarWidget = (function() {
  // Outlook category preset colors
  const PRESET_COLORS = {
    'preset0': '#e74c3c',   // Red
    'preset1': '#e67e22',   // Orange
    'preset2': '#8b4513',   // Brown
    'preset3': '#f1c40f',   // Yellow
    'preset4': '#229954',   // Green (darkened for readability)
    'preset5': '#1abc9c',   // Teal
    'preset6': '#808000',   // Olive
    'preset7': '#3498db',   // Blue
    'preset8': '#9b59b6',   // Purple
    'preset9': '#c0392b',   // Cranberry
    'preset10': '#607d8b',  // Steel
    'preset11': '#455a64',  // Dark Steel
    'preset12': '#9e9e9e',  // Gray
    'preset13': '#616161',  // Dark Gray
    'preset14': '#212121',  // Black
    'preset15': '#b71c1c',  // Dark Red
    'preset16': '#e65100',  // Dark Orange
    'preset17': '#5d4037',  // Dark Brown
    'preset18': '#f9a825',  // Dark Yellow
    'preset19': '#1b5e20',  // Dark Green
    'preset20': '#006064',  // Dark Teal
    'preset21': '#556b2f',  // Dark Olive
    'preset22': '#0d47a1',  // Dark Blue
    'preset23': '#4a148c',  // Dark Purple
    'preset24': '#880e4f',  // Dark Cranberry
    'none': null
  };

  const SYNC_INTERVAL = 60 * 1000; // 60 seconds
  const DRIVE_TIME_REFRESH_INTERVAL = 60 * 1000; // 60 seconds for drive time
  const LEAVE_CHECK_INTERVAL = 30 * 1000; // 30 seconds for leave notification checks
  const DRIVE_TIME_MAX_WINDOW = 4 * 60 * 60 * 1000; // 4 hours - don't fetch drive time for events further out
  const CATEGORIES_STORAGE_KEY = 'calendar-categories';
  const EVENTS_STORAGE_KEY = 'calendar-month-events';
  const ACCOUNT_STORAGE_KEY = 'inbox-active-account'; // Share with inbox widget

  // Location cache (5-minute expiry for geolocation fallback)
  let cachedLocation = null;
  let locationCacheTime = 0;
  const LOCATION_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // Home address geocoded coordinates cache (invalidates on address change only)
  let cachedHomeLocation = null;
  let cachedHomeAddress = null;

  // Location type classification
  const LocationType = {
    TEAMS: 'teams',
    ZOOM: 'zoom',
    WEB_LINK: 'web_link',
    VALIDATED_ADDRESS: 'validated',
    UNCERTAIN: 'uncertain',
    NONE: 'none'
  };

  // Cache for address validation results (persists during session)
  const addressValidationCache = new Map();

  // Drive time intervals
  let driveTimeRefreshInterval = null;
  let leaveCheckInterval = null;

  // Leave notification state
  let leaveNotificationState = {
    eventId: null,
    driveTimeSeconds: null,
    gentleAlertFired: false,
    urgentAlertFired: false
  };

  // Track current next event for drive time
  let currentNextEventId = null;
  let currentNextEventAddress = null;

  // Multi-account state
  const accountState = {
    hc: { categoryColorMap: {}, monthEventsCache: [] },
    ae: { categoryColorMap: {}, monthEventsCache: [] }
  };
  let currentAccount = 'hc'; // 'hc' or 'ae' - synced with inbox

  let refreshInterval = null;
  let categoryColorMap = {}; // category name -> hex color (reference to current account)
  let monthEventsCache = []; // All events for current month view (reference to current account)
  let currentMonth = new Date().getMonth();
  let currentYear = new Date().getFullYear();
  let selectedDate = new Date();
  selectedDate.setHours(0, 0, 0, 0); // Normalize to midnight so all events for today show

  /**
   * Invoke a Tauri command with consistent path handling.
   * Tauri 2.x with withGlobalTauri: true exposes invoke at window.__TAURI__.core.invoke
   */
  function tauriInvoke(command, args) {
    if (window.__TAURI__?.core?.invoke) {
      return window.__TAURI__.core.invoke(command, args);
    }
    throw new Error('Tauri invoke not available');
  }

  /**
   * Initialize the calendar widget
   */
  function initialize() {
    // Restore saved account preference (shared with inbox)
    const savedAccount = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (savedAccount && (savedAccount === 'hc' || savedAccount === 'ae')) {
      currentAccount = savedAccount;
    }
    // Update references to current account's state
    categoryColorMap = accountState[currentAccount].categoryColorMap;
    monthEventsCache = accountState[currentAccount].monthEventsCache;

    // Listen for auth state changes
    window.addEventListener('microsoft-auth-change', (event) => {
      const accountType = event.detail.accountType || 'hc';
      if (event.detail.isAuthenticated) {
        // If this is the current account, refresh
        if (accountType === currentAccount) {
          showCalendar();
          loadData();
          startAutoRefresh();
        }
      } else {
        // If the current account signed out, show placeholder
        if (accountType === currentAccount) {
          showPlaceholder();
          stopAutoRefresh();
        }
      }
    });

    // Listen for account switch from inbox widget
    window.addEventListener('account-switched', (event) => {
      const accountType = event.detail.accountType;
      if (accountType && accountType !== currentAccount) {
        switchAccount(accountType);
      }
    });

    // Listen for config changes to invalidate home address cache
    window.addEventListener('dashboard-config-changed', (e) => {
      const newConfig = e.detail;
      if (newConfig?.homeAddress !== cachedHomeAddress) {
        cachedHomeLocation = null;
        cachedHomeAddress = null;
        console.log('Calendar DRIVE: Home address changed, cache invalidated');
      }
    });

    // Show calendar UI immediately -- data will load when microsoft-auth-change fires.
    showCalendar();
    if (typeof MicrosoftAuth !== 'undefined' && MicrosoftAuth.isAuthenticated(currentAccount)) {
      loadData();
      startAutoRefresh();
    }

    // Setup navigation buttons
    setupNavigation();
  }

  /**
   * Switch calendar to a different account
   */
  function switchAccount(accountType) {
    if (accountType === currentAccount) return;
    if (!accountState[accountType]) return;

    currentAccount = accountType;
    // Update references to new account's state
    categoryColorMap = accountState[currentAccount].categoryColorMap;
    monthEventsCache = accountState[currentAccount].monthEventsCache;

    // Check if new account is authenticated
    if (typeof MicrosoftAuth !== 'undefined' && MicrosoftAuth.isAuthenticated(currentAccount)) {
      showCalendar();
      loadData();
    } else {
      showPlaceholder();
    }
  }

  /**
   * Setup month navigation buttons
   */
  function setupNavigation() {
    const prevBtn = document.getElementById('cal-prev-month');
    const nextBtn = document.getElementById('cal-next-month');

    prevBtn?.addEventListener('click', () => {
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
      loadMonthData();
    });

    nextBtn?.addEventListener('click', () => {
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
      loadMonthData();
    });
  }

  /**
   * Show the calendar layout, hide placeholder
   */
  function showCalendar() {
    const layout = document.getElementById('calendar-layout');
    const placeholder = document.getElementById('calendar-placeholder');
    if (layout) layout.style.display = 'flex';
    if (placeholder) placeholder.style.display = 'none';
  }

  /**
   * Show placeholder, hide calendar layout
   */
  function showPlaceholder() {
    const layout = document.getElementById('calendar-layout');
    const placeholder = document.getElementById('calendar-placeholder');
    if (layout) layout.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
  }

  /**
   * Load all data (categories, then events)
   */
  async function loadData() {
    try {
      await fetchCategories();
      await loadMonthData();
    } catch (error) {
      console.error('Calendar: Failed to load data:', error);
    }
  }

  /**
   * Load month data and render
   */
  async function loadMonthData() {
    updateMonthHeader();
    await fetchMonthEvents();
    renderCalendarGrid();
    renderEventsForDate(selectedDate);
  }

  /**
   * Start auto-refresh.
   * Paused while the dashboard is hidden; refreshes immediately on return.
   */
  function startAutoRefresh() {
    stopAutoRefresh();
    const refresh = async () => {
      await fetchMonthEvents();
      renderCalendarGrid();
      renderEventsForDate(selectedDate);
    };
    refreshInterval = window.VisibilityManager
      ? window.VisibilityManager.managedInterval(refresh, SYNC_INTERVAL)
      : { stop: ((id) => () => clearInterval(id))(setInterval(refresh, SYNC_INTERVAL)) };
  }

  /**
   * Stop auto-refresh
   */
  function stopAutoRefresh() {
    if (refreshInterval) {
      refreshInterval.stop();
      refreshInterval = null;
    }
  }

  /**
   * Fetch master categories from Outlook
   */
  async function fetchCategories() {
    try {
      const response = await MicrosoftAuth.graphRequest('/me/outlook/masterCategories', {}, currentAccount);
      const newCategoryMap = {};

      for (const category of response.value) {
        const colorKey = category.color?.toLowerCase() || 'none';
        newCategoryMap[category.displayName] = PRESET_COLORS[colorKey] || null;
      }

      // Update account state and reference
      accountState[currentAccount].categoryColorMap = newCategoryMap;
      categoryColorMap = newCategoryMap;

      const cacheKey = `${CATEGORIES_STORAGE_KEY}-${currentAccount}`;
      localStorage.setItem(cacheKey, JSON.stringify(categoryColorMap));
      dlog(`Calendar[${currentAccount.toUpperCase()}]: Loaded`, Object.keys(categoryColorMap).length, 'categories');
    } catch (error) {
      console.error(`Calendar[${currentAccount.toUpperCase()}]: Failed to fetch categories:`, error);
      // Try to load from cache
      const cacheKey = `${CATEGORIES_STORAGE_KEY}-${currentAccount}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        categoryColorMap = JSON.parse(cached);
        accountState[currentAccount].categoryColorMap = categoryColorMap;
      }
    }
  }

  /**
   * Get local timezone name for Graph API
   */
  function getLocalTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  /**
   * Fetch events for the current month view
   */
  async function fetchMonthEvents() {
    try {
      // Get first day of month and last day of month
      const startDate = new Date(currentYear, currentMonth, 1);
      const endDate = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

      const startISO = startDate.toISOString();
      const endISO = endDate.toISOString();

      // Request events in local timezone to avoid UTC conversion issues
      const timezone = getLocalTimezone();
      const response = await MicrosoftAuth.graphRequest(
        `/me/calendarView?startDateTime=${startISO}&endDateTime=${endISO}&$orderby=start/dateTime&$top=100&$select=id,subject,start,end,categories,showAs,isAllDay,isCancelled,webLink,onlineMeeting,isOnlineMeeting,onlineMeetingUrl,location`,
        {
          headers: {
            'Prefer': `outlook.timezone="${timezone}"`
          }
        },
        currentAccount
      );

      const events = response.value.filter(e => !e.isCancelled);
      // Update account state and reference
      accountState[currentAccount].monthEventsCache = events;
      monthEventsCache = events;
      dlog(`Calendar[${currentAccount.toUpperCase()}]: Loaded`, monthEventsCache.length, 'events for', currentMonth + 1, '/', currentYear, 'in timezone:', timezone);
    } catch (error) {
      console.error(`Calendar[${currentAccount.toUpperCase()}]: Failed to fetch month events:`, error);
      accountState[currentAccount].monthEventsCache = [];
      monthEventsCache = [];
    }
  }

  /**
   * Update the month/year header
   */
  function updateMonthHeader() {
    const headerEl = document.getElementById('cal-month-year');
    if (headerEl) {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
      headerEl.textContent = `${monthNames[currentMonth]} ${currentYear}`;
    }
  }

  /**
   * Render the mini calendar grid
   */
  function renderCalendarGrid() {
    const daysContainer = document.getElementById('cal-days');
    if (!daysContainer) return;

    // Calculate event count and total duration per day for heatmap and tooltips
    const dayStats = {};
    for (const event of monthEventsCache) {
      const eventDate = new Date(event.start.dateTime);
      const dateKey = eventDate.toDateString();

      if (!dayStats[dateKey]) {
        dayStats[dateKey] = { count: 0, totalMinutes: 0 };
      }
      dayStats[dateKey].count++;

      // Calculate duration for non-all-day events
      if (!event.isAllDay && event.start.dateTime && event.end.dateTime) {
        const startTime = new Date(event.start.dateTime);
        const endTime = new Date(event.end.dateTime);
        const durationMinutes = (endTime - startTime) / (1000 * 60);
        dayStats[dateKey].totalMinutes += durationMinutes;
      }
    }

    // Calculate grid
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();

    // Monday = 0, Sunday = 6 (adjust from JS Sunday = 0)
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;

    const today = new Date();
    const todayStr = today.toDateString();
    const selectedStr = selectedDate.toDateString();

    let html = '';

    // Previous month padding days
    const prevMonth = new Date(currentYear, currentMonth, 0);
    const prevMonthDays = prevMonth.getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      html += `<div class="cal-day other-month" data-date="${new Date(currentYear, currentMonth - 1, day).toISOString()}">${day}</div>`;
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth, day);
      const dateStr = date.toDateString();
      const stats = dayStats[dateStr] || { count: 0, totalMinutes: 0 };
      const count = stats.count;

      let classes = 'cal-day';
      if (dateStr === todayStr) classes += ' today';
      if (dateStr === selectedStr) classes += ' selected';

      // Heatmap intensity (5 levels for better granularity)
      if (count > 0) {
        if (count >= 5) classes += ' heat-5';
        else if (count === 4) classes += ' heat-4';
        else if (count === 3) classes += ' heat-3';
        else if (count === 2) classes += ' heat-2';
        else classes += ' heat-1';
      }

      // Build tooltip with event count and total time
      let tooltip = '';
      if (count > 0) {
        const eventLabel = count === 1 ? 'event' : 'events';
        const totalHours = stats.totalMinutes / 60;
        if (totalHours >= 1) {
          // Show hours (with half-hour precision)
          const hours = Math.round(totalHours * 2) / 2;
          tooltip = `${count} ${eventLabel} • ${hours}h`;
        } else if (stats.totalMinutes > 0) {
          // Show minutes
          tooltip = `${count} ${eventLabel} • ${Math.round(stats.totalMinutes)}min`;
        } else {
          // All-day events only
          tooltip = `${count} ${eventLabel}`;
        }
      }

      html += `<div class="${classes}" data-date="${date.toISOString()}"${tooltip ? ` title="${tooltip}"` : ''}>${day}</div>`;
    }

    // Next month padding days
    const totalCells = startDayOfWeek + daysInMonth;
    const remainingCells = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= remainingCells; i++) {
      html += `<div class="cal-day other-month" data-date="${new Date(currentYear, currentMonth + 1, i).toISOString()}">${i}</div>`;
    }

    daysContainer.innerHTML = html;

    // Add click handlers to days
    daysContainer.querySelectorAll('.cal-day').forEach(dayEl => {
      dayEl.addEventListener('click', () => {
        const dateStr = dayEl.getAttribute('data-date');
        if (dateStr) {
          selectDate(new Date(dateStr));
        }
      });
    });
  }

  /**
   * Select a date and update event list
   */
  function selectDate(date) {
    selectedDate = date;

    // Update selected class
    document.querySelectorAll('.cal-day').forEach(el => {
      el.classList.remove('selected');
      const elDate = new Date(el.getAttribute('data-date'));
      if (elDate.toDateString() === date.toDateString()) {
        el.classList.add('selected');
      }
    });

    // If selecting a date in a different month, navigate to that month
    if (date.getMonth() !== currentMonth || date.getFullYear() !== currentYear) {
      currentMonth = date.getMonth();
      currentYear = date.getFullYear();
      loadMonthData();
    } else {
      renderEventsForDate(date);
    }
  }

  /**
   * Render events grouped by date with section headers
   */
  function renderEventsForDate(startDate) {
    const eventsContainer = document.getElementById('events-list');
    if (!eventsContainer) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Normalize to start of day so all events on the selected date are included
    const dayStart = new Date(startDate);
    dayStart.setHours(0, 0, 0, 0);

    // Filter events from startDate onwards
    const filteredEvents = monthEventsCache.filter(event => {
      const eventDate = new Date(event.start.dateTime);
      return eventDate >= dayStart;
    }).sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));

    if (filteredEvents.length === 0) {
      eventsContainer.innerHTML = `
        <div class="events-empty">
          <span>No events</span>
        </div>
      `;
      updateCalendarInfo();
      return;
    }

    // Group events by date
    const eventsByDate = {};
    for (const event of filteredEvents) {
      const eventDate = new Date(event.start.dateTime);
      const dateKey = eventDate.toDateString();
      if (!eventsByDate[dateKey]) {
        eventsByDate[dateKey] = [];
      }
      eventsByDate[dateKey].push(event);
    }

    // Build HTML with date sections
    let html = '';
    for (const [dateKey, events] of Object.entries(eventsByDate)) {
      const date = new Date(dateKey);
      let dateLabel;
      let showWeather = false;

      const isToday = dateKey === today.toDateString();
      const isTomorrow = dateKey === tomorrow.toDateString();

      if (isToday) {
        dateLabel = 'TODAY';
      } else if (isTomorrow) {
        dateLabel = 'TOMORROW';
      } else {
        dateLabel = date.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric'
        }).toUpperCase();
      }

      // Get weather for this date if available
      const weatherInfo = getWeatherForDate(dateKey);

      html += `<div class="events-date-section">`;
      html += `<div class="date-header">`;
      html += `<span class="date-header-text">${dateLabel}</span>`;
      if (weatherInfo) {
        html += `<span class="date-header-weather">${weatherInfo.icon}</span>`;
        html += `<span class="date-header-temps"><span class="temp-high">${weatherInfo.high}°</span> <span class="temp-low">${weatherInfo.low}°</span></span>`;
      }
      html += `</div>`;

      // Events for this date
      for (const event of events) {
        const startTime = formatEventTimeShort(event);
        const color = getEventColor(event);
        const title = escapeHtml(event.subject || 'No Title');
        const webLink = event.webLink || '';
        const teamsUrl = event.onlineMeeting?.joinUrl || '';
        const isTeamsMeeting = event.isOnlineMeeting && teamsUrl && !teamsUrl.includes('zoom.us');

        // Detect Zoom links from various sources
        const zoomUrl = extractZoomUrl(event);
        const isZoomMeeting = !!zoomUrl;

        // Classify location type for icon display
        const locationType = classifyLocation(event.location);
        const eventAddress = isPhysicalAddress(event.location) ? getResolvedAddress(event.location) : null;

        // Trigger async validation for uncertain addresses (updates cache for next render)
        if (locationType === LocationType.UNCERTAIN && eventAddress) {
          validateAddress(eventAddress);
        }

        // Generate location button based on type
        let locationButton = '';
        if (isTeamsMeeting) {
          locationButton = `
            <button class="event-teams-btn" data-meeting-url="${escapeHtml(teamsUrl)}" title="Join Teams meeting">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
            </button>`;
        } else if (isZoomMeeting) {
          locationButton = `
            <button class="event-zoom-btn" data-meeting-url="${escapeHtml(zoomUrl)}" title="Join Zoom meeting">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
            </button>`;
        } else if (locationType === LocationType.WEB_LINK && eventAddress) {
          // Grey link icon for generic URLs
          locationButton = `
            <button class="event-link-btn" data-link-url="${escapeHtml(eventAddress)}" title="Open link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </button>`;
        } else if (locationType === LocationType.VALIDATED_ADDRESS && eventAddress) {
          // Green car icon for validated addresses
          locationButton = `
            <button class="event-maps-btn" data-address="${escapeHtml(eventAddress)}" title="Get directions">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"/>
                <path d="M7 14h.01"/><path d="M17 14h.01"/>
                <rect width="18" height="8" x="3" y="10" rx="2"/>
                <path d="M5 18v2"/><path d="M19 18v2"/>
              </svg>
            </button>`;
        } else if (locationType === LocationType.UNCERTAIN && eventAddress) {
          // Yellow car icon for uncertain locations - two-line tooltip
          const truncatedAddr = eventAddress.length > 30 ? eventAddress.substring(0, 30) + '...' : eventAddress;
          locationButton = `
            <button class="event-maps-btn uncertain" data-address="${escapeHtml(eventAddress)}" title="Unknown Address&#10;${escapeHtml(truncatedAddr)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"/>
                <path d="M7 14h.01"/><path d="M17 14h.01"/>
                <rect width="18" height="8" x="3" y="10" rx="2"/>
                <path d="M5 18v2"/><path d="M19 18v2"/>
              </svg>
            </button>`;
        }

        html += `
          <div class="event-item" style="--event-color: ${color};" data-weblink="${escapeHtml(webLink)}">
            <span class="event-time">${startTime}</span>
            <span class="event-title">${title}</span>
            ${locationButton}
          </div>
        `;
      }
      html += `</div>`;
    }

    eventsContainer.innerHTML = html;

    // Add click handlers for opening events in Outlook
    eventsContainer.querySelectorAll('.event-item[data-weblink]').forEach(item => {
      // Click on event (except meeting/maps/link buttons) opens in Outlook
      item.addEventListener('click', (e) => {
        // Don't trigger if clicking a meeting join, maps, or link button
        if (e.target.closest('.event-teams-btn') ||
            e.target.closest('.event-zoom-btn') ||
            e.target.closest('.event-maps-btn') ||
            e.target.closest('.event-link-btn')) return;
        const webLink = item.getAttribute('data-weblink');
        if (webLink) {
          openInOutlook(webLink);
        }
      });
    });

    // Add click handlers for meeting buttons (Teams and Zoom)
    eventsContainer.querySelectorAll('.event-teams-btn, .event-zoom-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent event item click
        const meetingUrl = btn.getAttribute('data-meeting-url');
        if (meetingUrl) {
          openMeetingOnPrimary(meetingUrl);
        }
      });
    });

    // Add click handlers for link buttons (generic URLs)
    eventsContainer.querySelectorAll('.event-link-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent event item click
        const linkUrl = btn.getAttribute('data-link-url');
        if (linkUrl) {
          // Open the URL - it might be a full URL or just text
          let url = linkUrl.trim();
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
          }
          openMeetingOnPrimary(url);
        }
      });
    });

    // Add click handlers for maps buttons (physical addresses)
    eventsContainer.querySelectorAll('.event-maps-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent event item click
        const address = btn.getAttribute('data-address');
        if (address) {
          openMapsDirections(address);
        }
      });

      // Add hover handler for drive time tooltip (only for non-uncertain addresses)
      btn.addEventListener('mouseenter', async (e) => {
        const address = btn.getAttribute('data-address');
        const isUncertain = btn.classList.contains('uncertain');

        if (address && !btn.dataset.driveTimeFetched) {
          btn.dataset.driveTimeFetched = 'pending';
          const driveTime = await fetchDriveTime(address);
          if (driveTime) {
            let tooltip = createDriveTooltip(driveTime);
            if (isUncertain) {
              tooltip += '\n(Location may not be a valid address)';
            }
            btn.title = tooltip;
            btn.dataset.driveTimeFetched = 'done';
          } else {
            btn.dataset.driveTimeFetched = '';
            if (isUncertain) {
              btn.title = 'Get directions (location may not be a valid address)';
            }
          }
        }
      });
    });

    updateCalendarInfo();
    setupScrollClipping();
  }

  /**
   * Setup scroll clipping to hide events that would go behind sticky headers
   */
  let scrollClippingSetup = false;
  let clipRAF = null;
  function setupScrollClipping() {
    const eventsList = document.getElementById('events-list');
    if (!eventsList || scrollClippingSetup) return;

    scrollClippingSetup = true;

    const clipEvents = () => {
      const listRect = eventsList.getBoundingClientRect();
      const headerHeight = 32; // Sticky header height + buffer
      const clipTop = listRect.top + headerHeight;

      // Clip each event item that's near or above the header
      eventsList.querySelectorAll('.event-item').forEach(item => {
        const itemRect = item.getBoundingClientRect();

        if (itemRect.bottom <= clipTop) {
          // Fully behind header - hide completely
          item.style.visibility = 'hidden';
          item.style.clipPath = 'none';
        } else if (itemRect.top < clipTop) {
          // Partially behind header - clip it (round to avoid jitter)
          const clipAmount = Math.round(clipTop - itemRect.top);
          item.style.clipPath = `inset(${clipAmount}px 0 0 0)`;
          item.style.visibility = 'visible';
        } else {
          // Fully visible - no clipping
          item.style.clipPath = 'none';
          item.style.visibility = 'visible';
        }
      });
    };

    const onScroll = () => {
      // Use RAF to smooth out clipping updates
      if (clipRAF) cancelAnimationFrame(clipRAF);
      clipRAF = requestAnimationFrame(clipEvents);
    };

    eventsList.addEventListener('scroll', onScroll, { passive: true });
    // Initial clip check
    clipEvents();
  }

  /**
   * Get weather from Weather widget's shared data
   * Returns icon, high, and low for display
   */
  function getWeatherForDate(dateKey) {
    if (!window.WeatherData?.daily) return null;

    const dayData = window.WeatherData.daily.find(d => d.date === dateKey);
    if (dayData) {
      return {
        icon: dayData.icon,
        high: dayData.high,
        low: dayData.low,
        code: dayData.code
      };
    }

    return null;
  }

  /**
   * Calculate and display next meeting countdown
   * Shows "EVENT" with "In Progress" for events in their first 10 minutes
   * Skips all-day events (typically birthday reminders) for the countdown display
   */
  function updateCalendarInfo() {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

    // Find current event (started within last 10 minutes and not ended yet)
    // Skip all-day events as they're typically reminders (birthdays, etc.)
    const currentEvent = monthEventsCache.find(e => {
      if (e.isAllDay) return false; // Skip all-day events
      const startTime = new Date(e.start.dateTime);
      const endTime = new Date(e.end.dateTime);
      return startTime <= now && startTime > tenMinutesAgo && endTime > now;
    });

    // Find next upcoming event (starts in the future)
    // Skip all-day events as they're typically reminders (birthdays, etc.)
    const nextEvent = monthEventsCache.find(e => {
      if (e.isAllDay) return false; // Skip all-day events
      return new Date(e.start.dateTime) > now;
    });

    // Use current event if exists, otherwise next event
    const displayEvent = currentEvent || nextEvent;
    const isCurrentEvent = !!currentEvent;

    const nextLabelEl = document.querySelector('.next-label');
    const nextTimeEl = document.getElementById('next-time');
    const nextTitleEl = document.getElementById('next-title');
    const nextCategoryEl = document.getElementById('next-category');
    const nextMeetingBtn = document.getElementById('next-meeting-btn');
    const nextDriveCol = document.getElementById('next-drive-col');
    const nextMapsBtn = document.getElementById('next-maps-btn');
    const nextDriveTimeEl = document.getElementById('next-drive-time');
    const leaveIndicator = document.getElementById('leave-indicator');

    if (displayEvent && nextTimeEl && nextTitleEl) {
      // Update label based on whether event is current or upcoming
      if (nextLabelEl) {
        nextLabelEl.textContent = isCurrentEvent ? 'EVENT' : 'NEXT EVENT';
      }

      if (isCurrentEvent) {
        // Show "In Progress" in green for current events
        nextTimeEl.textContent = 'In Progress';
        nextTimeEl.classList.add('in-progress');
      } else {
        // Show countdown for upcoming events
        nextTimeEl.classList.remove('in-progress');
        const eventTime = new Date(displayEvent.start.dateTime);
        const diff = eventTime - now;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 24) {
          const days = Math.floor(hours / 24);
          nextTimeEl.textContent = `${days}d ${hours % 24}h`;
        } else if (hours > 0) {
          nextTimeEl.textContent = `${hours}h ${mins}m`;
        } else {
          nextTimeEl.textContent = `${mins}m`;
        }
      }
      nextTitleEl.textContent = displayEvent.subject || 'Untitled';

      // Show category with color
      if (nextCategoryEl) {
        if (displayEvent.categories && displayEvent.categories.length > 0) {
          const categoryName = displayEvent.categories[0];
          const categoryColor = categoryColorMap[categoryName] || '#3498db';
          nextCategoryEl.textContent = categoryName;
          nextCategoryEl.style.backgroundColor = categoryColor;
          nextCategoryEl.style.display = 'inline-block';
        } else {
          nextCategoryEl.style.display = 'none';
        }
      }

      // Show meeting join button if Teams or Zoom link exists
      if (nextMeetingBtn) {
        const teamsUrl = displayEvent.onlineMeeting?.joinUrl || '';
        const isTeamsMeeting = displayEvent.isOnlineMeeting && teamsUrl && !teamsUrl.includes('zoom.us');
        const zoomUrl = extractZoomUrl(displayEvent);
        const meetingUrl = isTeamsMeeting ? teamsUrl : zoomUrl;

        if (meetingUrl) {
          nextMeetingBtn.style.display = 'inline-flex';
          nextMeetingBtn.setAttribute('data-meeting-url', meetingUrl);
          nextMeetingBtn.title = isTeamsMeeting ? 'Join Teams meeting' : 'Join Zoom meeting';
          // Remove old listener and add new one
          nextMeetingBtn.onclick = (e) => {
            e.stopPropagation();
            openMeetingOnPrimary(meetingUrl);
          };
        } else {
          nextMeetingBtn.style.display = 'none';
        }
      }

      // Show maps button if event has a physical address
      const nextLocationType = classifyLocation(displayEvent.location);
      const hasPhysicalAddress = nextLocationType === LocationType.VALIDATED_ADDRESS ||
                                 nextLocationType === LocationType.UNCERTAIN;
      const eventAddress = hasPhysicalAddress ? getResolvedAddress(displayEvent.location) : null;

      dlog('Calendar DRIVE DEBUG:', {
        subject: displayEvent.subject,
        locationType: nextLocationType,
        hasPhysicalAddress,
        eventAddress,
        locationRaw: displayEvent.location,
        nextDriveColExists: !!nextDriveCol,
        nextMapsBtnExists: !!nextMapsBtn,
        nextDriveTimeElExists: !!nextDriveTimeEl
      });

      // Trigger validation for uncertain addresses
      if (nextLocationType === LocationType.UNCERTAIN && eventAddress) {
        validateAddress(eventAddress);
      }

      // Show/hide drive column (contains leave indicator, drive time, maps button)
      if (nextDriveCol && nextMapsBtn) {
        if (hasPhysicalAddress) {
          nextDriveCol.style.display = 'flex';
          nextMapsBtn.setAttribute('data-address', eventAddress);
          // Add/remove uncertain class based on validation status
          if (nextLocationType === LocationType.UNCERTAIN) {
            nextMapsBtn.classList.add('uncertain');
            nextMapsBtn.title = 'Get directions (location may not be valid)';
          } else {
            nextMapsBtn.classList.remove('uncertain');
            nextMapsBtn.title = 'Get directions';
          }
          nextMapsBtn.onclick = (e) => {
            e.stopPropagation();
            openMapsDirections(eventAddress);
          };
        } else {
          nextDriveCol.style.display = 'none';
        }
      }

      // Track next event for notifications (only reset on event change)
      if (displayEvent.id !== currentNextEventId) {
        currentNextEventId = displayEvent.id;
        currentNextEventAddress = eventAddress;
        resetLeaveNotifications(displayEvent.id);

        // Hide leave indicator when event changes
        if (leaveIndicator) {
          leaveIndicator.style.display = 'none';
        }
      }

      // Update address if it was resolved after validation (same event, better address)
      const addressChanged = eventAddress && eventAddress !== currentNextEventAddress;
      if (addressChanged) {
        currentNextEventAddress = eventAddress;
      }

      // Fetch drive time when within window (check every cycle, not just on event change)
      if (eventAddress) {
        const eventTime = new Date(displayEvent.start.dateTime);
        const timeUntilEvent = eventTime - now;
        const isWithinDriveTimeWindow = timeUntilEvent <= DRIVE_TIME_MAX_WINDOW;

        if (isWithinDriveTimeWindow && (!driveTimeRefreshInterval || addressChanged)) {
          // Restart refresh if address was resolved to a better value
          if (addressChanged) stopDriveTimeRefresh();
          updateNextEventDriveTime();
          startDriveTimeRefresh();
        } else if (!isWithinDriveTimeWindow) {
          stopDriveTimeRefresh();
          if (nextDriveTimeEl) {
            nextDriveTimeEl.textContent = '';
            nextDriveTimeEl.title = '';
          }
        }
      } else {
        stopDriveTimeRefresh();
        if (nextDriveTimeEl) {
          nextDriveTimeEl.textContent = '';
          nextDriveTimeEl.title = '';
        }
      }
    } else if (nextTimeEl && nextTitleEl) {
      // Reset to default state when no events
      if (nextLabelEl) {
        nextLabelEl.textContent = 'NEXT EVENT';
      }
      nextTimeEl.textContent = '--';
      nextTimeEl.classList.remove('in-progress');
      nextTitleEl.textContent = 'No upcoming meetings';
      if (nextCategoryEl) nextCategoryEl.style.display = 'none';
      if (nextMeetingBtn) nextMeetingBtn.style.display = 'none';
      if (nextDriveCol) nextDriveCol.style.display = 'none';
      if (nextDriveTimeEl) {
        nextDriveTimeEl.textContent = '';
        nextDriveTimeEl.title = '';
      }
      if (leaveIndicator) leaveIndicator.style.display = 'none';

      // Reset tracking
      currentNextEventId = null;
      currentNextEventAddress = null;
      stopDriveTimeRefresh();
    }
  }

  /**
   * Get color for an event based on its categories
   */
  function getEventColor(event) {
    if (event.categories && event.categories.length > 0) {
      // Use the first category's color
      const categoryName = event.categories[0];
      if (categoryColorMap[categoryName]) {
        return categoryColorMap[categoryName];
      }
    }
    // Fallback to default Outlook blue
    return '#3498db';
  }

  /**
   * Extract Zoom URL from event data
   */
  function extractZoomUrl(event) {
    // Check onlineMeetingUrl first (Graph API field)
    if (event.onlineMeetingUrl && event.onlineMeetingUrl.includes('zoom.us')) {
      return event.onlineMeetingUrl;
    }

    // Check onlineMeeting.joinUrl
    if (event.onlineMeeting?.joinUrl && event.onlineMeeting.joinUrl.includes('zoom.us')) {
      return event.onlineMeeting.joinUrl;
    }

    // Check location for Zoom link
    const locationStr = event.location?.displayName || '';
    const zoomMatch = locationStr.match(/https?:\/\/[^\s]*zoom\.us\/[^\s]*/i);
    if (zoomMatch) {
      return zoomMatch[0];
    }

    return null;
  }

  /**
   * Classify location type for display (Teams, Zoom, URL, validated address, uncertain)
   */
  function classifyLocation(location) {
    if (!location?.displayName) return LocationType.NONE;
    const loc = location.displayName.trim();
    if (!loc || loc.length <= 3) return LocationType.NONE;

    const locLower = loc.toLowerCase();

    // Check for Teams meeting
    if (locLower.includes('teams.microsoft.com') ||
        locLower.includes('teams meeting') ||
        locLower.includes('microsoft teams')) {
      return LocationType.TEAMS;
    }

    // Check for Zoom meeting
    if (locLower.includes('zoom.us') ||
        locLower.includes('zoom meeting')) {
      return LocationType.ZOOM;
    }

    // Check for other URLs
    if (locLower.startsWith('http://') ||
        locLower.startsWith('https://') ||
        locLower.includes('meet.google.com') ||
        locLower.includes('webex.com') ||
        locLower.includes('whereby.com') ||
        locLower.includes('gotomeeting') ||
        locLower.includes('join.me')) {
      return LocationType.WEB_LINK;
    }

    // Microsoft Graph provides coordinates or full address for validated locations
    // If coordinates exist, it's a validated address from Outlook autocomplete
    if (location.coordinates?.latitude && location.coordinates?.longitude) {
      return LocationType.VALIDATED_ADDRESS;
    }

    // If Microsoft provided a street address, it's validated
    if (location.address?.street && location.address?.city) {
      return LocationType.VALIDATED_ADDRESS;
    }

    // Check if displayName looks like a valid US address pattern
    // Matches: "123 Street Name, City, ST" or "123 Street Name, City, ST 12345"
    const usAddressPattern = /^\d+\s+[\w\s]+,\s*[\w\s]+,\s*[A-Z]{2}(\s*\d{5}(-\d{4})?)?/i;
    if (usAddressPattern.test(loc)) {
      return LocationType.VALIDATED_ADDRESS;
    }

    // Not a URL - check cache for validation result
    if (addressValidationCache.has(loc)) {
      return addressValidationCache.get(loc)?.isValid ?
             LocationType.VALIDATED_ADDRESS : LocationType.UNCERTAIN;
    }

    // Default to uncertain until validated
    return LocationType.UNCERTAIN;
  }

  /**
   * Check if location is a physical address (for backwards compatibility)
   */
  function isPhysicalAddress(location) {
    const type = classifyLocation(location);
    return type === LocationType.VALIDATED_ADDRESS || type === LocationType.UNCERTAIN;
  }

  /**
   * Get the best address string for a location (for drive time / maps).
   * Prefers: Graph API address fields > validated/geocoded address > displayName
   */
  function getResolvedAddress(location) {
    if (!location?.displayName) return null;

    // 1. Try structured address from Graph API location object
    const addr = location.address;
    if (addr?.street && addr?.city) {
      const parts = [addr.street, addr.city];
      if (addr.state) parts.push(addr.state);
      if (addr.postalCode) parts.push(addr.postalCode);
      return parts.join(', ');
    }

    // 2. Check validation cache for a geocoded formatted address
    const displayName = location.displayName.trim();
    const cached = addressValidationCache.get(displayName);
    if (cached?.isValid && cached.formattedAddress) {
      return cached.formattedAddress;
    }

    // 3. Fall back to displayName
    return displayName;
  }

  /**
   * Validate an address via Google Maps Geocoding API (async, updates cache)
   * Triggers UI update when validation completes successfully
   */
  async function validateAddress(address) {
    if (!address) return false;

    // Check cache first
    if (addressValidationCache.has(address)) {
      return addressValidationCache.get(address)?.isValid;
    }

    const config = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
    const apiKey = config.googleMapsApiKey;
    if (!apiKey) {
      // No API key - can't validate, mark as uncertain
      addressValidationCache.set(address, { isValid: false, formattedAddress: null, lat: null, lng: null });
      return false;
    }

    try {
      const result = await tauriInvoke('validate_address', {
        apiKey,
        address
      });

      // Cache full result including formatted address and coordinates
      addressValidationCache.set(address, {
        isValid: result.is_valid,
        formattedAddress: result.formatted_address || null,
        lat: result.lat || null,
        lng: result.lng || null
      });

      // If validation succeeded, trigger UI update to change yellow icon to green
      if (result.is_valid) {
        updateCalendarInfo();
        // Re-render event list to update location icons
        renderEventsForDate(selectedDate);
      }

      return result.is_valid;
    } catch (e) {
      console.warn('Address validation failed:', e);
      addressValidationCache.set(address, { isValid: false, formattedAddress: null, lat: null, lng: null });
      return false;
    }
  }

  /**
   * Get Google Maps directions URL for an address
   */
  function getGoogleMapsUrl(address) {
    const encoded = encodeURIComponent(address);
    return `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
  }

  /**
   * Get user's origin location for drive time calculations.
   * Priority: 1) Stored home address (geocoded via Google Maps API) - reliable in Tauri/WebView2
   *           2) navigator.geolocation (fallback - unreliable in WebView2)
   * Home address coordinates are cached until the address string changes.
   */
  async function getUserLocation() {
    // 1. Try stored home address (preferred - WebView2 geolocation is unreliable)
    const config = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
    const homeAddress = config.homeAddress;
    const apiKey = config.googleMapsApiKey;

    if (homeAddress && apiKey) {
      // Return cached coordinates if home address hasn't changed
      if (cachedHomeLocation && cachedHomeAddress === homeAddress) {
        return cachedHomeLocation;
      }

      // Geocode the home address using existing validate_address Tauri command
      try {
        const result = await tauriInvoke('validate_address', {
          apiKey,
          address: homeAddress
        });

        if (result.is_valid && result.lat && result.lng) {
          cachedHomeLocation = { lat: result.lat, lng: result.lng };
          cachedHomeAddress = homeAddress;
          dlog('Calendar DRIVE: Using home address as origin:', homeAddress);
          return cachedHomeLocation;
        } else {
          console.warn('Calendar DRIVE: Home address could not be geocoded:', homeAddress);
        }
      } catch (e) {
        console.warn('Calendar DRIVE: Failed to geocode home address:', e);
      }
    }

    // 2. Fallback: navigator.geolocation (with existing cache)
    const now = Date.now();
    if (cachedLocation && (now - locationCacheTime) < LOCATION_CACHE_DURATION) {
      return cachedLocation;
    }

    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('No location available: geolocation not supported and no home address configured'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          cachedLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          locationCacheTime = now;
          dlog('Calendar DRIVE: Using browser geolocation as origin');
          resolve(cachedLocation);
        },
        (error) => {
          console.warn('Calendar DRIVE: Geolocation error:', error.message);
          reject(new Error('No location available: geolocation failed and no home address configured'));
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    });
  }

  /**
   * Update drive time status indicator when drive time can't be fetched.
   * Shows an amber warning icon with descriptive tooltip so the user knows what to configure.
   */
  function updateDriveStatus(status) {
    const driveTimeEl = document.getElementById('next-drive-time');
    if (!driveTimeEl) return;

    driveTimeEl.classList.remove('drive-status-error');

    switch (status) {
      case 'no-api-key':
        driveTimeEl.textContent = '';
        driveTimeEl.title = 'Drive time unavailable: No Google Maps API key (Settings > Location Services)';
        driveTimeEl.classList.add('drive-status-error');
        break;
      case 'no-location':
        driveTimeEl.textContent = '';
        driveTimeEl.title = 'Drive time unavailable: Set a home address in Settings > Location Services';
        driveTimeEl.classList.add('drive-status-error');
        break;
      case 'error':
        driveTimeEl.textContent = '';
        driveTimeEl.title = 'Drive time unavailable: API error (check console)';
        driveTimeEl.classList.add('drive-status-error');
        break;
      case 'ok':
        break;
    }
  }

  /**
   * Fetch drive time from Tauri backend
   */
  async function fetchDriveTime(destination) {
    const config = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
    const apiKey = config.googleMapsApiKey;

    if (!apiKey) {
      console.warn('Calendar DRIVE: No Google Maps API key configured');
      updateDriveStatus('no-api-key');
      return null;
    }

    try {
      const location = await getUserLocation();
      const result = await tauriInvoke('get_drive_time', {
        apiKey: apiKey,
        originLat: location.lat,
        originLng: location.lng,
        destination: destination
      });
      updateDriveStatus('ok');
      return result;
    } catch (error) {
      console.warn('Calendar DRIVE: Drive time fetch failed:', error);
      if (error.message?.includes('No location available') || error.message?.includes('no home address')) {
        updateDriveStatus('no-location');
      } else {
        updateDriveStatus('error');
      }
    }

    return null;
  }

  /**
   * Format drive time for display (e.g., "35m" or "1h 15m")
   */
  function formatDriveTime(seconds) {
    if (!seconds || seconds <= 0) return '';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);

    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
  }

  /**
   * Extract actual appointment time from event subject.
   * Handles patterns like "Chiro (145PM)", "Chiro (1:45 PM)", "Chiro (2PM)", etc.
   * Returns a Date with the extracted time on the same day as eventDate, or null if no time found.
   */
  function extractAppointmentTime(subject, eventDate) {
    if (!subject || !eventDate) return null;

    // Match time patterns in parentheses: (145PM), (1:45 PM), (1:45PM), (2PM), (2 PM), (1245PM), etc.
    const match = subject.match(/\((\d{1,4})\s*(?::?\s*(\d{2}))?\s*(AM|PM)\)/i);
    if (!match) return null;

    const digits = match[1];
    const explicitMinutes = match[2]; // only set if colon format like (1:45PM)
    const ampm = match[3].toUpperCase();

    let hours, minutes;

    if (explicitMinutes) {
      // Colon format: (1:45PM) -> digits="1", explicitMinutes="45"
      hours = parseInt(digits, 10);
      minutes = parseInt(explicitMinutes, 10);
    } else if (digits.length <= 2) {
      // Just hour: (2PM) -> 2:00 PM
      hours = parseInt(digits, 10);
      minutes = 0;
    } else if (digits.length === 3) {
      // 3 digits: (145PM) -> 1:45 PM
      hours = parseInt(digits[0], 10);
      minutes = parseInt(digits.substring(1), 10);
    } else {
      // 4 digits: (1245PM) -> 12:45 PM
      hours = parseInt(digits.substring(0, 2), 10);
      minutes = parseInt(digits.substring(2), 10);
    }

    // Convert to 24-hour
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    const result = new Date(eventDate);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }

  /**
   * Get the effective arrival time for an event (for drive/leave calculations).
   * Uses extracted title time if present, otherwise falls back to event start time.
   */
  function getEffectiveArrivalTime(event) {
    const startTime = new Date(event.start.dateTime);
    const titleTime = extractAppointmentTime(event.subject, startTime);
    return titleTime || startTime;
  }

  /**
   * Calculate leave alert times based on event time and drive time
   * leaveTime = eventTime - driveTime - 5min buffer (time to get ready)
   * countdownStartTime = 30 min before leaveTime
   */
  const BUFFER_MINUTES = 5; // Time to get ready before driving
  const COUNTDOWN_START_MINUTES = 30; // Start showing countdown this many min before leave

  function getLeaveAlertTimes(eventTime, driveTimeSeconds) {
    const driveTimeMs = driveTimeSeconds * 1000;
    const bufferMs = BUFFER_MINUTES * 60 * 1000;
    // Leave time = event time - drive time - 5 min buffer
    const leaveTime = new Date(eventTime.getTime() - driveTimeMs - bufferMs);

    return {
      leaveTime,
      countdownStartTime: new Date(leaveTime.getTime() - COUNTDOWN_START_MINUTES * 60 * 1000), // 30 min before leave
      urgentTime: leaveTime // "Leave now!" at leave time
    };
  }

  /**
   * Reset leave notification state for a new event
   */
  function resetLeaveNotifications(eventId) {
    leaveNotificationState = {
      eventId: eventId,
      driveTimeSeconds: null,
      gentleAlertFired: false,
      urgentAlertFired: false
    };
  }

  /**
   * Check and update leave notifications/countdown
   */
  function checkLeaveNotifications() {
    const config = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
    if (config.leaveNotificationsEnabled === false) return;
    if (!leaveNotificationState.driveTimeSeconds) return;
    if (!currentNextEventId) return;

    // Find the next event to get its time
    const now = new Date();
    const nextEvent = monthEventsCache.find(e => e.id === currentNextEventId);
    if (!nextEvent) return;

    const eventTime = getEffectiveArrivalTime(nextEvent);
    const times = getLeaveAlertTimes(eventTime, leaveNotificationState.driveTimeSeconds);
    const leaveIndicator = document.getElementById('leave-indicator');

    // Before countdown starts - hide indicator
    if (now < times.countdownStartTime) {
      if (leaveIndicator) {
        leaveIndicator.style.display = 'none';
      }
      return;
    }

    // Past leave time - keep showing "Leave now!" but no more updates
    if (now >= times.leaveTime) {
      // Fire urgent alert sound once when hitting leave time
      if (!leaveNotificationState.urgentAlertFired) {
        playLeaveSound('urgent');
        leaveNotificationState.urgentAlertFired = true;
      }
      if (leaveIndicator) {
        leaveIndicator.style.display = 'block';
        leaveIndicator.textContent = 'Leave now!';
        leaveIndicator.classList.add('urgent');
      }
      return;
    }

    // In countdown phase (between countdownStartTime and leaveTime)
    const msUntilLeave = times.leaveTime - now;
    const minsUntilLeave = Math.ceil(msUntilLeave / (60 * 1000));

    // Fire countdown start sound once
    if (!leaveNotificationState.gentleAlertFired) {
      playLeaveSound('gentle');
      leaveNotificationState.gentleAlertFired = true;
    }

    // Update countdown text
    if (leaveIndicator) {
      leaveIndicator.style.display = 'block';
      leaveIndicator.textContent = `Leave in ${minsUntilLeave}m`;
      leaveIndicator.classList.remove('urgent');
    }
  }

  /**
   * Play leave alert sound and flash visual effect
   */
  function playLeaveSound(type) {
    const soundFile = type === 'gentle' ? 'assets/Sounds/first notify.mp3' : 'assets/Sounds/second notify.mp3';
    const audio = new Audio(soundFile);
    audio.volume = 0.7;
    audio.play().catch(e => console.warn('Calendar: Could not play leave alert:', e));

    // Visual flash effect on next-meeting element
    const nextMeetingEl = document.getElementById('next-meeting');
    if (nextMeetingEl) {
      nextMeetingEl.classList.remove('leave-alert-gentle', 'leave-alert-urgent');
      void nextMeetingEl.offsetWidth; // Force reflow for animation restart
      nextMeetingEl.classList.add(`leave-alert-${type}`);
    }
  }

  /**
   * Start drive time and leave notification intervals
   * (both paused while the dashboard is hidden)
   */
  function startDriveTimeRefresh() {
    stopDriveTimeRefresh();

    const refreshDriveTime = () => {
      if (currentNextEventAddress) {
        updateNextEventDriveTime();
      }
    };

    if (window.VisibilityManager) {
      // Refresh drive time every 60 seconds, check leave alerts every 30
      driveTimeRefreshInterval = window.VisibilityManager.managedInterval(
        refreshDriveTime, DRIVE_TIME_REFRESH_INTERVAL);
      leaveCheckInterval = window.VisibilityManager.managedInterval(
        checkLeaveNotifications, LEAVE_CHECK_INTERVAL);
    } else {
      const wrap = (id) => ({ stop: () => clearInterval(id) });
      driveTimeRefreshInterval = wrap(setInterval(refreshDriveTime, DRIVE_TIME_REFRESH_INTERVAL));
      leaveCheckInterval = wrap(setInterval(checkLeaveNotifications, LEAVE_CHECK_INTERVAL));
    }
  }

  /**
   * Stop drive time and leave notification intervals
   */
  function stopDriveTimeRefresh() {
    if (driveTimeRefreshInterval) {
      driveTimeRefreshInterval.stop();
      driveTimeRefreshInterval = null;
    }
    if (leaveCheckInterval) {
      leaveCheckInterval.stop();
      leaveCheckInterval = null;
    }
  }

  /**
   * Update drive time display for next event
   */
  async function updateNextEventDriveTime() {
    dlog('Calendar DRIVE: updateNextEventDriveTime called, address:', currentNextEventAddress);
    if (!currentNextEventAddress) return;

    const driveTimeEl = document.getElementById('next-drive-time');
    const mapsBtn = document.getElementById('next-maps-btn');

    const driveTime = await fetchDriveTime(currentNextEventAddress);
    dlog('Calendar DRIVE: fetchDriveTime result:', driveTime);

    if (driveTime && driveTimeEl) {
      // Use traffic time if available, otherwise regular duration
      const seconds = driveTime.duration_in_traffic_seconds || driveTime.duration_seconds;
      driveTimeEl.textContent = formatDriveTime(seconds);

      // Store for leave notifications
      leaveNotificationState.driveTimeSeconds = seconds;

      // Add tooltip with breakdown
      if (driveTime.traffic_delay_seconds && driveTime.traffic_delay_seconds > 60) {
        const baseTime = formatDriveTime(driveTime.duration_seconds);
        const trafficDelay = formatDriveTime(driveTime.traffic_delay_seconds);
        const totalTime = formatDriveTime(seconds);
        driveTimeEl.title = `Base: ${baseTime} + Traffic: ${trafficDelay} = ${totalTime}`;
      } else {
        driveTimeEl.title = `Drive time: ${formatDriveTime(seconds)}`;
      }
    } else if (driveTimeEl) {
      driveTimeEl.textContent = '';
      driveTimeEl.title = '';
    }
  }

  /**
   * Create drive time tooltip HTML for event list
   */
  function createDriveTooltip(driveTime) {
    if (!driveTime) return '';

    const seconds = driveTime.duration_in_traffic_seconds || driveTime.duration_seconds;
    const totalTime = formatDriveTime(seconds);

    let tooltipContent = `Drive time: ${totalTime}`;

    if (driveTime.traffic_delay_seconds && driveTime.traffic_delay_seconds > 60) {
      const baseTime = formatDriveTime(driveTime.duration_seconds);
      const trafficDelay = formatDriveTime(driveTime.traffic_delay_seconds);
      tooltipContent = `Base: ${baseTime}\nTraffic: +${trafficDelay}\nTotal: ${totalTime}`;
    }

    return tooltipContent;
  }

  /**
   * Open Google Maps directions in browser
   */
  async function openMapsDirections(address) {
    const url = getGoogleMapsUrl(address);
    try {
      if (window.__TAURI__?.opener?.openUrl) {
        await window.__TAURI__.opener.openUrl(url);
      } else {
        window.open(url, '_blank');
      }
    } catch (error) {
      console.error('Calendar: Failed to open Maps:', error);
      window.open(url, '_blank');
    }
  }

  /**
   * Format event duration for display
   */
  function formatEventDuration(event) {
    if (!event.start?.dateTime || !event.end?.dateTime || event.isAllDay) {
      return '';
    }

    const startTime = new Date(event.start.dateTime);
    const endTime = new Date(event.end.dateTime);
    const durationMinutes = (endTime - startTime) / (1000 * 60);

    if (durationMinutes <= 0) return '';

    const hours = durationMinutes / 60;

    if (hours >= 1) {
      // Check if it's a whole hour or half hour
      if (hours === Math.floor(hours)) {
        return `(${Math.floor(hours)}hr)`;
      } else if (hours % 1 === 0.5) {
        return `(${hours}hr)`;
      } else {
        // Round to nearest half hour
        const rounded = Math.round(hours * 2) / 2;
        return `(${rounded}hr)`;
      }
    } else {
      return `(${Math.round(durationMinutes)}min)`;
    }
  }

  /**
   * Format event time for display (short version for date-grouped list)
   */
  function formatEventTimeShort(event) {
    if (!event.start || !event.start.dateTime) return '';

    if (event.isAllDay) {
      return 'All day';
    }

    const startDate = new Date(event.start.dateTime);
    const timeStr = startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // Add duration
    const duration = formatEventDuration(event);
    return duration ? `${timeStr} ${duration}` : timeStr;
  }

  /**
   * Open calendar event in Outlook desktop app
   */
  async function openInOutlook(webLink) {
    if (!webLink) return;

    try {
      // Use Tauri command to open in Outlook desktop
      if (window.__TAURI__?.core?.invoke) {
        await window.__TAURI__.core.invoke('open_in_outlook', { url: webLink });
      } else if (window.__TAURI__?.opener?.openUrl) {
        await window.__TAURI__.opener.openUrl(webLink);
      } else {
        window.open(webLink, '_blank');
      }
    } catch (error) {
      console.error('Failed to open event:', error);
      window.open(webLink, '_blank');
    }
  }

  /**
   * Open meeting (Teams/Zoom) on primary monitor
   * Uses Tauri command to position window on main display
   */
  async function openMeetingOnPrimary(meetingUrl) {
    if (!meetingUrl) return;

    try {
      // Use Tauri command that opens and positions on primary monitor
      if (window.__TAURI__?.core?.invoke) {
        await window.__TAURI__.core.invoke('open_meeting_on_primary', { url: meetingUrl });
      } else if (window.__TAURI__?.opener?.openUrl) {
        await window.__TAURI__.opener.openUrl(meetingUrl);
      } else {
        window.open(meetingUrl, '_blank');
      }
    } catch (error) {
      console.error('Failed to open meeting:', error);
      // Fallback to shell open or browser
      try {
        if (window.__TAURI__?.opener?.openUrl) {
          await window.__TAURI__.opener.openUrl(meetingUrl);
        } else {
          window.open(meetingUrl, '_blank');
        }
      } catch (e) {
        window.open(meetingUrl, '_blank');
      }
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Public API
  // Test helper for leave notifications (call from console: CalendarWidget.testLeave('countdown') or CalendarWidget.testLeave('urgent'))
  function testLeaveNotification(type) {
    const leaveIndicator = document.getElementById('leave-indicator');
    const nextDriveCol = document.getElementById('next-drive-col');

    // Ensure drive column is visible for testing
    if (nextDriveCol) nextDriveCol.style.display = 'flex';

    if (type === 'countdown') {
      playLeaveSound('gentle');
      if (leaveIndicator) {
        leaveIndicator.style.display = 'block';
        leaveIndicator.textContent = 'Leave in 15m';
        leaveIndicator.classList.remove('urgent');
      }
    } else if (type === 'urgent') {
      playLeaveSound('urgent');
      if (leaveIndicator) {
        leaveIndicator.style.display = 'block';
        leaveIndicator.textContent = 'Leave now!';
        leaveIndicator.classList.add('urgent');
      }
    }
  }

  return {
    initialize,
    refresh: loadMonthData,
    testLeave: testLeaveNotification,
    // Debug: inspect internal state from console
    _debug: () => ({ monthEventsCache, addressValidationCache: Object.fromEntries(addressValidationCache), currentNextEventAddress, currentNextEventId })
  };
})();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => CalendarWidget.initialize());
} else {
  CalendarWidget.initialize();
}
