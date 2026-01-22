/* ================================================================
   INBOX WIDGET - Microsoft Graph Integration with Delta Sync
   Fetches and displays emails from Outlook/Microsoft 365
   Uses Delta Queries for efficient near-real-time sync
   Copyright (c) 2024-2025 Havens Consulting Inc. All Rights Reserved.
   Fingerprint: AE-WWD-8B4F2C1E-2025
   ================================================================ */

const InboxWidget = (function() {
  const AVATAR_COLORS = [
    '#5856D6', '#FF9500', '#30D158', '#FF2D55',
    '#007AFF', '#AF52DE', '#FF3B30', '#34C759'
  ];

  const SYNC_INTERVAL = 30 * 1000; // 30 seconds
  const VIEW_STORAGE_KEY = 'inbox-active-view';
  const ACCOUNT_STORAGE_KEY = 'inbox-active-account';
  const MAX_EMAILS = 50;

  // Multi-account state
  const accountState = {
    hc: {
      emailsCache: new Map(),
      deltaStorageKey: 'inbox-delta-link-hc',
      unreadCount: 0
    },
    ae: {
      emailsCache: new Map(),
      deltaStorageKey: 'inbox-delta-link-ae',
      unreadCount: 0
    }
  };

  let refreshInterval = null;
  let currentView = 'email'; // 'email' or 'twitch-chat'
  let currentAccount = 'hc'; // 'hc' or 'ae'
  let twitchChatLoaded = false;

  // Legacy compatibility
  let emailsCache = accountState.hc.emailsCache;

  /**
   * Initialize the inbox widget
   */
  function initialize() {
    // Initialize view switching
    initializeViewSwitching();

    // Initialize account tabs
    initializeAccountTabs();

    // Listen for auth state changes (with account type support)
    window.addEventListener('microsoft-auth-change', (event) => {
      const accountType = event.detail.accountType || 'hc';

      if (event.detail.isAuthenticated) {
        // Clear cache on new auth for this account
        accountState[accountType].emailsCache.clear();
        localStorage.removeItem(accountState[accountType].deltaStorageKey);
        fetchEmailsForAccount(accountType);
        updateAccountTabs();
        startAutoRefresh();
      } else {
        // Clear this account's state
        accountState[accountType].emailsCache.clear();
        accountState[accountType].unreadCount = 0;
        localStorage.removeItem(accountState[accountType].deltaStorageKey);
        updateAccountTabs();

        // If current account signed out, show placeholder
        if (accountType === currentAccount) {
          showPlaceholder();
        }

        // Stop refresh only if no accounts are authenticated
        if (!MicrosoftAuth.isAuthenticated('hc') && !MicrosoftAuth.isAuthenticated('ae')) {
          stopAutoRefresh();
        }
      }
    });

    // Check if already authenticated and fetch emails
    if (typeof MicrosoftAuth !== 'undefined') {
      // Restore saved account preference
      const savedAccount = localStorage.getItem(ACCOUNT_STORAGE_KEY);
      if (savedAccount && (savedAccount === 'hc' || savedAccount === 'ae')) {
        currentAccount = savedAccount;
      }

      // Fetch emails for all authenticated accounts
      if (MicrosoftAuth.isAuthenticated('hc')) {
        fetchEmailsForAccount('hc');
      }
      if (MicrosoftAuth.isAuthenticated('ae')) {
        fetchEmailsForAccount('ae');
      }

      // Start auto refresh if any account is authenticated
      if (MicrosoftAuth.isAuthenticated('hc') || MicrosoftAuth.isAuthenticated('ae')) {
        startAutoRefresh();
      }

      updateAccountTabs();
    }

    // Listen for config changes (Twitch channel updates)
    window.addEventListener('dashboard-config-changed', () => {
      // Always disconnect and reload chat when config changes (channel may have changed)
      if (typeof TwitchChat !== 'undefined' && TwitchChat.isConnected()) {
        TwitchChat.disconnect();
      }
      twitchChatLoaded = false;

      // Reload chat if currently viewing it
      if (currentView === 'twitch-chat') {
        loadTwitchChat();
      }

      // Re-check AE configuration
      updateAccountTabs();
    });
  }

  /**
   * Initialize account tab switching
   */
  function initializeAccountTabs() {
    const tabs = document.querySelectorAll('.inbox-account-tab');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const accountType = tab.dataset.account;
        if (!accountType) return;

        // Check if this account is connected
        if (typeof MicrosoftAuth !== 'undefined' && MicrosoftAuth.isAuthenticated(accountType)) {
          switchAccount(accountType);
        }
      });
    });

    // Set initial tab state
    updateAccountTabs();
  }

  /**
   * Switch active email account
   */
  function switchAccount(accountType) {
    if (accountType === currentAccount) return;
    if (!accountState[accountType]) return;

    currentAccount = accountType;
    localStorage.setItem(ACCOUNT_STORAGE_KEY, accountType);

    // Update emailsCache reference for legacy compatibility
    emailsCache = accountState[accountType].emailsCache;

    // Update tab UI
    updateAccountTabs();

    // Render emails for new account
    if (MicrosoftAuth.isAuthenticated(accountType)) {
      renderEmails();
    } else {
      showPlaceholder();
    }

    // Dispatch event for other widgets (calendar) to sync
    window.dispatchEvent(new CustomEvent('account-switched', {
      detail: { accountType }
    }));
  }

  /**
   * Update account tabs UI
   */
  function updateAccountTabs() {
    const tabs = document.querySelectorAll('.inbox-account-tab');

    tabs.forEach(tab => {
      const accountType = tab.dataset.account;
      if (!accountType) return;

      const isActive = accountType === currentAccount;
      const isConnected = typeof MicrosoftAuth !== 'undefined' && MicrosoftAuth.isAuthenticated(accountType);
      const badge = tab.querySelector('.inbox-tab-badge');

      // Update active state
      tab.classList.toggle('active', isActive);
      tab.classList.toggle('not-connected', !isConnected);

      // Update badge
      if (badge) {
        if (isConnected) {
          badge.textContent = accountState[accountType].unreadCount || '0';
        } else {
          badge.textContent = '-';
        }
      }
    });

    // Hide tabs container if in twitch chat view
    const tabsContainer = document.getElementById('inbox-account-tabs');
    if (tabsContainer) {
      tabsContainer.style.display = currentView === 'email' ? 'flex' : 'none';
    }
  }

  /**
   * Initialize view switching (Inbox <-> Twitch Chat)
   */
  function initializeViewSwitching() {
    const navDots = document.querySelectorAll('.inbox-nav-dots .nav-dot');

    // Restore saved view preference
    const savedView = localStorage.getItem(VIEW_STORAGE_KEY);
    if (savedView && (savedView === 'email' || savedView === 'twitch-chat')) {
      currentView = savedView;
      switchView(currentView, false);
    }

    // Add click handlers to nav dots
    navDots.forEach(dot => {
      dot.addEventListener('click', () => {
        const view = dot.dataset.view;
        if (view && view !== currentView) {
          switchView(view, true);
        }
      });
    });
  }

  /**
   * Switch between inbox and twitch chat views
   */
  function switchView(view, save = true) {
    currentView = view;

    // Update parent container data attribute (controls calendar visibility via CSS)
    const calendarInboxContainer = document.querySelector('.widget-calendarinbox');
    if (calendarInboxContainer) {
      calendarInboxContainer.dataset.view = view;
    }

    // Toggle body class for Twitch chat mode (allows CSS to override html/body overflow)
    document.body.classList.toggle('twitch-chat-active', view === 'twitch-chat');

    // Update views visibility within inbox widget
    const emailView = document.getElementById('inbox-view-email');
    const chatView = document.getElementById('inbox-view-twitch-chat');

    if (emailView) emailView.style.display = view === 'email' ? 'block' : 'none';
    if (chatView) chatView.style.display = view === 'twitch-chat' ? 'block' : 'none';

    // Update nav dots
    const navDots = document.querySelectorAll('.inbox-nav-dots .nav-dot');
    navDots.forEach(dot => {
      dot.classList.toggle('active', dot.dataset.view === view);
    });

    // Update header text
    const headerText = document.querySelector('.widget-email .inbox-header-text');
    if (headerText) {
      headerText.textContent = view === 'email' ? 'Inbox' : 'Twitch Chat';
    }

    // Hide badge when in chat view
    const badge = document.querySelector('.widget-email .badge');
    if (badge) {
      badge.style.display = view === 'email' && emailsCache.size > 0 ? 'inline-flex' : 'none';
    }

    // Load Twitch chat if switching to chat view
    if (view === 'twitch-chat' && !twitchChatLoaded) {
      loadTwitchChat();
    }

    // Save preference
    if (save) {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    }
  }

  /**
   * Load Twitch chat - supports iframe (full features) or IRC (fallback) mode
   */
  function loadTwitchChat() {
    const container = document.getElementById('twitch-chat-container');
    if (!container) return;

    // Get channel and settings from dashboard config
    const config = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
    const channel = config.twitch?.channel || 'anya';
    const useIframe = config.twitch?.chatMode !== 'irc'; // Default to iframe mode
    // Use OAuth token from login flow, fallback to manually configured token
    const oauthToken = localStorage.getItem('twitch-access-token') || config.twitch?.oauthToken || '';
    // Use authenticated username from Twitch API, fallback to manually configured
    // username = lowercase login (for IRC NICK command), displayName = properly cased (for chat display)
    const twitchUsername = localStorage.getItem('twitch-username') || config.twitch?.username || '';
    const twitchDisplayName = localStorage.getItem('twitch-display-name') || twitchUsername || '';
    const hasToken = oauthToken && oauthToken.length > 10;
    const hasUsername = twitchUsername && twitchUsername.length > 0;

    // Debug: Log config values (mask token for security)
    const maskedToken = oauthToken ? (oauthToken.length > 10 ? oauthToken.slice(0, 6) + '...' : '[short]') : '[none]';
    console.log('[TwitchChat Config]', { channel, useIframe, hasToken, hasUsername, username: twitchUsername, tokenPreview: maskedToken });
    const popoutUrl = `https://www.twitch.tv/popout/${channel}/chat?darkpopout`;

    // Determine parent domain for iframe
    // Tauri production builds use 'tauri.localhost', dev uses 'localhost'
    let hostname = window.location.hostname || 'localhost';
    // Handle Tauri production environment
    if (hostname === 'tauri.localhost' || window.__TAURI__) {
      hostname = 'tauri.localhost';
    }
    console.log('[TwitchChat] Using parent hostname:', hostname, 'location:', window.location.origin);
    const embedUrl = `https://www.twitch.tv/embed/${channel}/chat?parent=${hostname}&darkpopout`;

    if (useIframe) {
      // IFRAME MODE - Full Twitch chat with channel points, redeems, etc.
      container.innerHTML = `
        <div class="twitch-iframe-chat">
          <button class="twitch-chat-mode-toggle-btn" data-mode="irc" title="Switch to IRC mode (FFZ/7TV/BTTV emotes)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              <circle cx="9" cy="10" r="1" fill="currentColor"/>
              <circle cx="15" cy="10" r="1" fill="currentColor"/>
            </svg>
          </button>
          <iframe
            src="${embedUrl}"
            width="100%"
            height="100%"
            frameborder="0"
            scrolling="no"
            allowfullscreen="false">
          </iframe>
        </div>
      `;

      // Add mode toggle handler for iframe -> IRC
      const modeToggle = container.querySelector('.twitch-chat-mode-toggle-btn');
      if (modeToggle) {
        modeToggle.addEventListener('click', () => {
          const cfg = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
          if (!cfg.twitch) cfg.twitch = {};
          cfg.twitch.chatMode = 'irc';
          localStorage.setItem('dashboard-config', JSON.stringify(cfg));
          twitchChatLoaded = false;
          loadTwitchChat();
        });
      }
    } else {
      // IRC MODE - Lightweight WebSocket chat with FFZ/7TV/BTTV emotes
      container.innerHTML = `
        <div class="twitch-irc-chat" id="twitch-irc-chat">
          <div class="twitch-irc-header">
            <button class="twitch-chat-mode-toggle-btn" data-mode="iframe" title="Switch to iframe mode (channel points)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 9h18"/>
              </svg>
            </button>
            <div class="twitch-irc-channel-info">
              <img class="twitch-irc-avatar" id="twitch-irc-avatar" src="" alt="" style="display: none;">
              <span class="twitch-irc-channel">${channel}</span>
            </div>
            <div class="twitch-irc-actions">
              <button class="twitch-irc-btn twitch-irc-config-btn" title="Configure Chat">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="twitch-irc-messages"></div>
          <button class="twitch-irc-jump-bottom" style="display: none;" title="Jump to bottom">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 5v14M5 12l7 7 7-7"/>
            </svg>
            Jump to bottom
          </button>
          <div class="twitch-irc-input-area">
            <div class="twitch-emote-picker" style="display: none;">
              <div class="twitch-emote-picker-header">
                <input type="text" class="twitch-emote-search" placeholder="Search emotes...">
                <button class="twitch-emote-picker-close">&times;</button>
              </div>
              <div class="twitch-emote-picker-tabs">
                <button class="twitch-emote-tab active" data-provider="all">All</button>
                <button class="twitch-emote-tab" data-provider="twitch">Twitch</button>
                <button class="twitch-emote-tab" data-provider="7tv">7TV</button>
                <button class="twitch-emote-tab" data-provider="ffz">FFZ</button>
                <button class="twitch-emote-tab" data-provider="bttv">BTTV</button>
              </div>
              <div class="twitch-emote-picker-grid"></div>
            </div>
            <div class="twitch-emote-autocomplete" style="display: none;"></div>
            <div class="twitch-emote-preview" style="display: none;"></div>
            <textarea class="twitch-irc-input" rows="1" placeholder="${hasToken ? 'Type a message...' : 'Add OAuth token in Settings to chat'}" ${hasToken ? '' : 'disabled'}></textarea>
            <button class="twitch-emote-picker-btn" title="Emotes (Twitch/7TV/FFZ/BTTV)">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" fill="none"/>
                <path d="M8 14s1.5 2 4 2 4-2 4-2" fill="none"/>
                <circle cx="9" cy="9" r="1.5" stroke="none"/>
                <circle cx="15" cy="9" r="1.5" stroke="none"/>
              </svg>
            </button>
          </div>
        </div>
      `;

      // Add mode toggle handler (IRC -> iframe)
      const modeBtn = container.querySelector('.twitch-chat-mode-toggle-btn[data-mode="iframe"]');
      if (modeBtn) {
        modeBtn.addEventListener('click', () => {
          const cfg = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
          if (!cfg.twitch) cfg.twitch = {};
          cfg.twitch.chatMode = 'iframe';
          localStorage.setItem('dashboard-config', JSON.stringify(cfg));
          if (typeof TwitchChat !== 'undefined' && TwitchChat.isConnected()) {
            TwitchChat.disconnect();
          }
          twitchChatLoaded = false;
          loadTwitchChat();
        });
      }

      // Add config button handler - opens IRC chat settings modal
      const configBtn = container.querySelector('.twitch-irc-config-btn');
      if (configBtn) {
        configBtn.addEventListener('click', () => {
          const modal = document.getElementById('twitch-irc-modal');
          if (modal) {
            // Initialize modal with current config
            initTwitchIrcModal();
            modal.classList.add('active');
          }
        });
      }

      // Set up emote picker
      const emotePickerBtn = container.querySelector('.twitch-emote-picker-btn');
      const emotePicker = container.querySelector('.twitch-emote-picker');
      const emoteGrid = container.querySelector('.twitch-emote-picker-grid');
      const emoteSearch = container.querySelector('.twitch-emote-search');
      const emoteClose = container.querySelector('.twitch-emote-picker-close');
      const emoteTabs = container.querySelectorAll('.twitch-emote-tab');
      const chatInput = container.querySelector('.twitch-irc-input');
      let currentFilter = 'all';

      // Render emotes to grid
      function renderEmotesToGrid(emotes) {
        if (!emoteGrid) return;
        emoteGrid.innerHTML = '';

        // Use DocumentFragment for better performance when adding many elements
        const fragment = document.createDocumentFragment();
        let count = 0;

        for (const [code, data] of Object.entries(emotes)) {
          const btn = document.createElement('button');
          btn.className = 'twitch-emote-picker-item';
          btn.title = `${code} (${data.provider})`;
          btn.innerHTML = `<img src="${data.url}" alt="${code}" loading="lazy">`;
          btn.addEventListener('click', () => {
            if (chatInput) {
              const cursorPos = chatInput.selectionStart;
              const before = chatInput.value.substring(0, cursorPos);
              const after = chatInput.value.substring(cursorPos);
              const space = before.length > 0 && !before.endsWith(' ') ? ' ' : '';
              chatInput.value = before + space + code + ' ' + after;
              chatInput.focus();
              // Move cursor after emote
              const newPos = cursorPos + space.length + code.length + 1;
              chatInput.setSelectionRange(newPos, newPos);
            }
          });
          fragment.appendChild(btn);
          count++;
        }

        if (count === 0) {
          emoteGrid.innerHTML = '<div class="twitch-emote-picker-empty">No emotes found</div>';
        } else {
          emoteGrid.appendChild(fragment);
        }
      }

      // Collapse consecutive duplicate characters for fuzzy matching
      // "peepo" -> "pepo", "pepe" -> "pepe", "KEKW" -> "KEKW"
      function collapseChars(str) {
        return str.replace(/(.)\1+/g, '$1');
      }

      // Fuzzy match: checks if emote matches search term
      // Matches on: direct contains, collapsed form contains, or prefix match
      function fuzzyMatch(emoteName, search) {
        if (!search) return true;
        const emoteLower = emoteName.toLowerCase();
        const searchLower = search.toLowerCase();

        // Direct substring match
        if (emoteLower.includes(searchLower)) return true;

        // Collapsed form match (peepo -> pepo contains pep from pepe)
        const emoteCollapsed = collapseChars(emoteLower);
        const searchCollapsed = collapseChars(searchLower);
        if (emoteCollapsed.includes(searchCollapsed)) return true;

        // Prefix match on collapsed form (first 3+ chars)
        if (searchCollapsed.length >= 3) {
          const prefix = searchCollapsed.substring(0, 3);
          if (emoteCollapsed.includes(prefix)) return true;
        }

        return false;
      }

      // Populate emote grid with local emotes (sync) - for immediate display
      function populateEmoteGridLocal(filter = 'all', search = '') {
        if (!emoteGrid || typeof TwitchChat === 'undefined') return;

        // Use the new searchEmotesLocal for scored fuzzy matching
        const emotes = TwitchChat.searchEmotesLocal(search, filter);
        renderEmotesToGrid(emotes);
      }

      // Legacy function for backwards compatibility
      function populateEmoteGrid(filter = 'all', search = '') {
        populateEmoteGridLocal(filter, search);
      }

      // Toggle emote picker
      if (emotePickerBtn && emotePicker) {
        emotePickerBtn.addEventListener('click', () => {
          const isVisible = emotePicker.style.display !== 'none';
          emotePicker.style.display = isVisible ? 'none' : 'block';
          if (!isVisible) {
            populateEmoteGrid(currentFilter, emoteSearch?.value || '');
            emoteSearch?.focus();
          }
        });
      }

      // Clear search button (X next to search box)
      if (emoteClose && emoteSearch) {
        emoteClose.addEventListener('click', () => {
          emoteSearch.value = '';
          populateEmoteGrid(currentFilter, '');
          emoteSearch.focus();
        });
      }

      // Emote search - only shows local/channel-loaded emotes (no API search)
      // This ensures all emotes shown are actually compatible with the current channel
      if (emoteSearch) {
        emoteSearch.addEventListener('input', () => {
          const search = emoteSearch.value;
          populateEmoteGridLocal(currentFilter, search);
        });
      }

      // Emote tabs
      emoteTabs.forEach(tab => {
        tab.addEventListener('click', () => {
          emoteTabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          currentFilter = tab.dataset.provider;
          populateEmoteGrid(currentFilter, emoteSearch?.value || '');
        });
      });

      // Set up chat input with emote autocomplete and preview
      const emoteAutocomplete = container.querySelector('.twitch-emote-autocomplete');
      const emotePreview = container.querySelector('.twitch-emote-preview');
      let autocompleteIndex = -1;
      let autocompleteMatches = [];
      let autocompleteDebounceTimer = null;

      // Track if current autocomplete is for usernames or emotes
      let autocompleteType = 'emote'; // 'emote' or 'user'

      function updateAutocomplete() {
        if (!chatInput || !emoteAutocomplete || typeof TwitchChat === 'undefined') return;

        const value = chatInput.value;
        const cursorPos = chatInput.selectionStart;

        // Find the current word being typed (from last space to cursor)
        const textBeforeCursor = value.substring(0, cursorPos);
        const lastSpaceIndex = textBeforeCursor.lastIndexOf(' ');
        const currentWord = textBeforeCursor.substring(lastSpaceIndex + 1);

        // Check if this is a @mention (username autocomplete) - show on just "@"
        if (currentWord.startsWith('@')) {
          autocompleteType = 'user';
          const searchTerm = currentWord.substring(1).toLowerCase(); // Remove @ for searching

          const participants = TwitchChat.getParticipants();
          autocompleteMatches = participants
            .filter(name => searchTerm.length === 0 || name.toLowerCase().includes(searchTerm))
            .slice(0, 15)
            .map(name => ({ code: name, type: 'user' }));

          if (autocompleteMatches.length === 0) {
            emoteAutocomplete.style.display = 'none';
            autocompleteIndex = -1;
            return;
          }

          // Render username autocomplete dropdown (just names, no icon)
          emoteAutocomplete.innerHTML = autocompleteMatches.map((match, i) => `
            <div class="twitch-emote-autocomplete-item twitch-user-autocomplete-item ${i === autocompleteIndex ? 'selected' : ''}" data-index="${i}">
              <span>${match.code}</span>
            </div>
          `).join('');
          emoteAutocomplete.style.display = 'flex';

          // Add click handlers
          emoteAutocomplete.querySelectorAll('.twitch-emote-autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
              selectAutocomplete(parseInt(item.dataset.index));
            });
          });
          return;
        }

        // Need at least 2 characters to trigger emote autocomplete
        if (currentWord.length < 2) {
          emoteAutocomplete.style.display = 'none';
          autocompleteMatches = [];
          autocompleteIndex = -1;
          return;
        }

        autocompleteType = 'emote';
        const emotes = TwitchChat.getEmotes();

        // Find matching emotes using fuzzy match (limit to 20 for scrollable list)
        autocompleteMatches = [];
        for (const [code, data] of Object.entries(emotes)) {
          if (fuzzyMatch(code, currentWord)) {
            autocompleteMatches.push({ code, ...data });
            if (autocompleteMatches.length >= 20) break;
          }
        }

        if (autocompleteMatches.length === 0) {
          emoteAutocomplete.style.display = 'none';
          autocompleteIndex = -1;
          return;
        }

        // Render emote autocomplete dropdown
        emoteAutocomplete.innerHTML = autocompleteMatches.map((emote, i) => `
          <div class="twitch-emote-autocomplete-item ${i === autocompleteIndex ? 'selected' : ''}" data-index="${i}">
            <img src="${emote.url}" alt="${emote.code}">
            <span>${emote.code}</span>
            <span class="twitch-emote-autocomplete-provider">${emote.provider}</span>
          </div>
        `).join('');
        emoteAutocomplete.style.display = 'flex';

        // Add click handlers to autocomplete items
        emoteAutocomplete.querySelectorAll('.twitch-emote-autocomplete-item').forEach(item => {
          item.addEventListener('click', () => {
            selectAutocomplete(parseInt(item.dataset.index));
          });
        });
      }

      // Debounced version of updateAutocomplete
      function debouncedUpdateAutocomplete() {
        if (autocompleteDebounceTimer) clearTimeout(autocompleteDebounceTimer);
        autocompleteDebounceTimer = setTimeout(updateAutocomplete, 600);
      }

      // Update emote preview bar
      function updateEmotePreview() {
        if (!emotePreview || !chatInput || typeof TwitchChat === 'undefined') return;

        const value = chatInput.value.trim();
        if (!value) {
          emotePreview.style.display = 'none';
          return;
        }

        const emotes = TwitchChat.getEmotes();
        const words = value.split(/(\s+)/);
        let hasEmotes = false;

        const previewHtml = words.map(word => {
          if (/^\s+$/.test(word)) return word;
          const emoteData = emotes[word];
          if (emoteData) {
            hasEmotes = true;
            return `<img class="twitch-emote-preview-img" src="${emoteData.url}" alt="${word}" title="${word}">`;
          }
          return `<span>${word.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
        }).join('');

        if (hasEmotes) {
          emotePreview.innerHTML = previewHtml;
          emotePreview.style.display = 'flex';
        } else {
          emotePreview.style.display = 'none';
        }
      }

      function selectAutocomplete(index) {
        if (index < 0 || index >= autocompleteMatches.length) return;

        const match = autocompleteMatches[index];
        const value = chatInput.value;
        const cursorPos = chatInput.selectionStart;

        // Find and replace the current word
        const textBeforeCursor = value.substring(0, cursorPos);
        const lastSpaceIndex = textBeforeCursor.lastIndexOf(' ');
        const textAfterCursor = value.substring(cursorPos);

        // For usernames, include the @ prefix
        const insertText = autocompleteType === 'user' ? `@${match.code}` : match.code;

        const newValue = value.substring(0, lastSpaceIndex + 1) + insertText + ' ' + textAfterCursor.trimStart();
        chatInput.value = newValue;

        // Move cursor after the inserted text
        const newCursorPos = lastSpaceIndex + 1 + insertText.length + 1;
        chatInput.setSelectionRange(newCursorPos, newCursorPos);
        chatInput.focus();

        // Hide autocomplete and update preview
        emoteAutocomplete.style.display = 'none';
        autocompleteMatches = [];
        autocompleteIndex = -1;
        updateEmotePreview();
      }

      // Auto-resize textarea to fit content
      function autoResizeInput() {
        if (!chatInput) return;
        chatInput.style.height = 'auto';
        const newHeight = Math.min(chatInput.scrollHeight, 120);
        chatInput.style.height = newHeight + 'px';
        // Only show scrollbar when content exceeds max height
        if (chatInput.scrollHeight > 120) {
          chatInput.classList.add('has-overflow');
        } else {
          chatInput.classList.remove('has-overflow');
        }
      }

      if (chatInput) {
        // Handle input for autocomplete (debounced), preview (immediate), and auto-resize
        chatInput.addEventListener('input', () => {
          debouncedUpdateAutocomplete();
          updateEmotePreview();
          autoResizeInput();
        });

        chatInput.addEventListener('keydown', (e) => {
          // Handle autocomplete navigation
          if (emoteAutocomplete && emoteAutocomplete.style.display !== 'none' && autocompleteMatches.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              autocompleteIndex = Math.min(autocompleteIndex + 1, autocompleteMatches.length - 1);
              updateAutocomplete();
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
              updateAutocomplete();
              return;
            }
            if (e.key === 'Tab' || (e.key === 'Enter' && autocompleteIndex >= 0)) {
              e.preventDefault();
              selectAutocomplete(autocompleteIndex >= 0 ? autocompleteIndex : 0);
              return;
            }
            if (e.key === 'Escape') {
              emoteAutocomplete.style.display = 'none';
              autocompleteMatches = [];
              autocompleteIndex = -1;
              return;
            }
          }

          // Send message on Enter (when no autocomplete selected)
          // Shift+Enter allows newlines in the textarea
          if (e.key === 'Enter' && !e.shiftKey && chatInput.value.trim() && hasToken) {
            e.preventDefault();
            const sent = TwitchChat.sendMessage(chatInput.value.trim());
            if (sent) {
              chatInput.value = '';
              chatInput.style.height = 'auto'; // Reset height
              chatInput.classList.remove('has-overflow'); // Reset scrollbar
              emoteAutocomplete.style.display = 'none';
              autocompleteMatches = [];
              if (emotePreview) emotePreview.style.display = 'none';
            }
          }
          // Close emote picker on Escape
          if (e.key === 'Escape' && emotePicker) {
            emotePicker.style.display = 'none';
          }
        });

        // Hide autocomplete when input loses focus (with delay for click handling)
        chatInput.addEventListener('blur', () => {
          setTimeout(() => {
            if (emoteAutocomplete) emoteAutocomplete.style.display = 'none';
          }, 150);
        });
      }

      // Set up emote hover tooltip
      setupEmoteTooltip(container);

      // Set up reply button handler
      setupReplyHandler(container);

      // Set up jump-to-bottom button
      setupJumpToBottom(container);

      // Connect to Twitch IRC (with or without auth)
      if (typeof TwitchChat !== 'undefined') {
        // Clean up the token (remove oauth: prefix if included)
        let cleanToken = oauthToken;
        if (cleanToken.startsWith('oauth:')) {
          cleanToken = cleanToken.slice(6);
        }

        TwitchChat.connect(channel, {
          container: container.querySelector('#twitch-irc-chat'),
          oauthToken: hasToken ? cleanToken : null,
          username: hasUsername ? twitchUsername : null,
          displayName: hasUsername ? twitchDisplayName : null
        });

        // Fetch and display channel avatar
        fetchChannelAvatar(channel);

        // Load and apply saved background settings
        loadIrcConfig();
        applyIrcBackground();
      } else {
        console.error('TwitchChat module not loaded');
      }

      console.log('Twitch IRC chat connecting to:', channel, hasToken && hasUsername ? `(as ${twitchDisplayName})` : '(anonymous)');
    }

    twitchChatLoaded = true;
  }

  /**
   * Unload Twitch chat when switching away
   */
  function unloadTwitchChat() {
    if (typeof TwitchChat !== 'undefined' && TwitchChat.isConnected()) {
      TwitchChat.disconnect();
    }
    twitchChatLoaded = false;
  }

  /**
   * Start auto-refresh with delta sync
   */
  function startAutoRefresh() {
    stopAutoRefresh();
    refreshInterval = setInterval(fetchAllEmails, SYNC_INTERVAL);
  }

  /**
   * Stop auto-refresh
   */
  function stopAutoRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  /**
   * Fetch emails for all authenticated accounts
   */
  async function fetchAllEmails() {
    if (typeof MicrosoftAuth === 'undefined') return;

    const promises = [];
    if (MicrosoftAuth.isAuthenticated('hc')) {
      promises.push(fetchEmailsForAccount('hc'));
    }
    if (MicrosoftAuth.isAuthenticated('ae')) {
      promises.push(fetchEmailsForAccount('ae'));
    }

    await Promise.all(promises);
  }

  /**
   * Fetch emails for a specific account
   */
  async function fetchEmailsForAccount(accountType) {
    const state = accountState[accountType];
    if (!state) return;

    if (!MicrosoftAuth.isAuthenticated(accountType)) {
      return;
    }

    try {
      const deltaLink = localStorage.getItem(state.deltaStorageKey);

      if (deltaLink) {
        await fetchDelta(deltaLink, accountType);
      } else {
        await fetchInitial(accountType);
      }

      // Update unread count
      state.unreadCount = Array.from(state.emailsCache.values()).filter(e => e.isRead === false).length;
      updateAccountTabs();

      // Only render if this is the current account
      if (accountType === currentAccount) {
        renderEmails();
      }
    } catch (error) {
      console.error(`Failed to fetch emails for ${accountType}:`, error);
      // On error (like expired delta token), reset and try full refresh
      if (error.message.includes('410') || error.message.includes('token') || error.message.includes('syncStateNotFound')) {
        localStorage.removeItem(state.deltaStorageKey);
        state.emailsCache.clear();
        try {
          await fetchInitial(accountType);
          state.unreadCount = Array.from(state.emailsCache.values()).filter(e => e.isRead === false).length;
          updateAccountTabs();
          if (accountType === currentAccount) {
            renderEmails();
          }
        } catch (retryError) {
          if (accountType === currentAccount) {
            showError();
          }
        }
      } else if (accountType === currentAccount) {
        showError();
      }
    }
  }

  /**
   * Legacy fetchEmails - fetches for current account only
   */
  async function fetchEmails() {
    await fetchEmailsForAccount(currentAccount);
  }

  /**
   * Initial fetch - get recent emails and establish delta link
   */
  async function fetchInitial(accountType = currentAccount) {
    const state = accountState[accountType];
    if (!state) return;

    // Get recent messages (include webLink for opening in Outlook)
    const response = await MicrosoftAuth.graphRequest(
      `/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=50&$select=id,subject,from,receivedDateTime,isRead,webLink`,
      {},
      accountType
    );

    // Store emails in cache
    state.emailsCache.clear();
    for (const email of response.value) {
      state.emailsCache.set(email.id, email);
    }

    // Establish delta tracking
    const deltaResponse = await MicrosoftAuth.graphRequest(
      `/me/mailFolders/inbox/messages/delta?$select=id,subject,from,receivedDateTime,isRead,webLink`,
      {},
      accountType
    );

    // Process delta response to find the deltaLink
    let nextLink = deltaResponse['@odata.nextLink'];
    let deltaLink = deltaResponse['@odata.deltaLink'];

    // Follow nextLinks until we get a deltaLink
    while (nextLink && !deltaLink) {
      const nextResponse = await MicrosoftAuth.graphRequest(nextLink, {}, accountType);
      nextLink = nextResponse['@odata.nextLink'];
      deltaLink = nextResponse['@odata.deltaLink'];
    }

    if (deltaLink) {
      localStorage.setItem(state.deltaStorageKey, deltaLink);
    }
  }

  /**
   * Fetch changes using delta link
   */
  async function fetchDelta(deltaLink, accountType = currentAccount) {
    const state = accountState[accountType];
    if (!state) return;

    let response = await MicrosoftAuth.graphRequest(deltaLink, {}, accountType);
    let hasChanges = false;

    // Process all pages of changes
    while (true) {
      for (const email of response.value) {
        hasChanges = true;

        if (email['@removed']) {
          // Email was deleted
          state.emailsCache.delete(email.id);
        } else {
          // Update or add email (including read status changes)
          if (state.emailsCache.has(email.id)) {
            const existing = state.emailsCache.get(email.id);
            state.emailsCache.set(email.id, { ...existing, ...email });
          } else {
            // New email
            state.emailsCache.set(email.id, email);
          }
        }
      }

      // Check for more pages
      if (response['@odata.nextLink']) {
        response = await MicrosoftAuth.graphRequest(response['@odata.nextLink'], {}, accountType);
      } else {
        break;
      }
    }

    // Store new delta link
    if (response['@odata.deltaLink']) {
      localStorage.setItem(state.deltaStorageKey, response['@odata.deltaLink']);
    }

    if (hasChanges) {
      console.log(`Inbox: Delta sync found changes for ${accountType.toUpperCase()}`);
    }
  }

  /**
   * Render email list from cache
   */
  function renderEmails() {
    const emailList = document.querySelector('.email-list');
    const badge = document.querySelector('.widget-email .badge');
    if (!emailList) return;

    // Get current account's cache
    const state = accountState[currentAccount];
    const cache = state ? state.emailsCache : emailsCache;

    // Convert cache to sorted array (all emails, most recent first)
    const emails = Array.from(cache.values())
      .sort((a, b) => {
        const aTime = new Date(a.receivedDateTime).getTime();
        const bTime = new Date(b.receivedDateTime).getTime();
        return bTime - aTime; // Most recent first
      })
      .slice(0, MAX_EMAILS);

    // Count unread for badge (legacy badge hidden, using account tabs now)
    const unreadCount = Array.from(cache.values()).filter(e => e.isRead === false).length;
    if (state) {
      state.unreadCount = unreadCount;
    }

    // Hide legacy badge (using account tabs instead)
    if (badge) {
      badge.style.display = 'none';
    }

    // Update account tabs
    updateAccountTabs();

    if (emails.length === 0) {
      emailList.innerHTML = `
        <div class="email-empty">
          <span>No emails</span>
        </div>
      `;
      return;
    }

    emailList.innerHTML = emails.map((email) => {
      const sender = email.from?.emailAddress?.name || email.from?.emailAddress?.address || 'Unknown';
      const initials = getInitials(sender);
      const subject = escapeHtml(email.subject || 'No Subject');
      const time = formatRelativeTime(email.receivedDateTime);
      const color = AVATAR_COLORS[hashString(sender) % AVATAR_COLORS.length];
      const webLink = email.webLink || '';
      const isUnread = email.isRead === false;

      return `
        <div class="email-item${isUnread ? ' unread' : ''}" data-weblink="${escapeHtml(webLink)}" style="--email-color: ${color};">
          <div class="email-avatar">${initials}</div>
          <div class="email-content">
            <div class="email-sender">${escapeHtml(sender)}</div>
            <div class="email-subject">${subject}</div>
          </div>
          <span class="email-time">${time}</span>
        </div>
      `;
    }).join('');

    // Add click handlers to open emails in Outlook
    emailList.querySelectorAll('.email-item[data-weblink]').forEach(item => {
      item.addEventListener('click', () => {
        const webLink = item.getAttribute('data-weblink');
        if (webLink) {
          openInOutlook(webLink);
        }
      });
    });
  }

  /**
   * Get initials from a name
   */
  function getInitials(name) {
    if (!name) return '?';

    // Handle email addresses
    if (name.includes('@')) {
      name = name.split('@')[0];
    }

    const parts = name.trim().split(/[\s.]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  /**
   * Format relative time
   */
  function formatRelativeTime(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /**
   * Simple hash function for consistent avatar colors
   */
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Show placeholder when not connected
   */
  function showPlaceholder() {
    const emailList = document.querySelector('.email-list');
    const badge = document.querySelector('.widget-email .badge');

    if (emailList) {
      emailList.innerHTML = `
        <div class="email-connect">
          <span>Connect Microsoft account</span>
          <small>Settings > Microsoft Account</small>
        </div>
      `;
    }

    if (badge) {
      badge.style.display = 'none';
    }
  }

  /**
   * Show error state
   */
  function showError() {
    const emailList = document.querySelector('.email-list');
    if (emailList) {
      emailList.innerHTML = `
        <div class="email-error">
          <span>Failed to load emails</span>
          <small>Check console for details</small>
        </div>
      `;
    }
  }

  /**
   * Open email in Outlook desktop app
   */
  async function openInOutlook(webLink) {
    if (!webLink) return;

    try {
      // Use Tauri command to open in Outlook desktop
      if (window.__TAURI__?.tauri?.invoke) {
        await window.__TAURI__.tauri.invoke('open_in_outlook', { url: webLink });
      } else if (window.__TAURI__?.shell?.open) {
        await window.__TAURI__.shell.open(webLink);
      } else {
        window.open(webLink, '_blank');
      }
    } catch (error) {
      console.error('Failed to open email:', error);
      window.open(webLink, '_blank');
    }
  }

  /**
   * Set up emote hover tooltip for IRC chat
   */
  function setupEmoteTooltip(container) {
    // Create tooltip element once
    let tooltip = document.querySelector('.twitch-emote-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'twitch-emote-tooltip';
      tooltip.innerHTML = `
        <img src="" alt="">
        <span class="twitch-emote-tooltip-name"></span>
        <span class="twitch-emote-tooltip-provider"></span>
      `;
      document.body.appendChild(tooltip);
    }

    const tooltipImg = tooltip.querySelector('img');
    const tooltipName = tooltip.querySelector('.twitch-emote-tooltip-name');
    const tooltipProvider = tooltip.querySelector('.twitch-emote-tooltip-provider');

    let hideTimeout = null;

    // Use event delegation on the messages container
    const messagesContainer = container.querySelector('.twitch-irc-messages');
    if (!messagesContainer) return;

    messagesContainer.addEventListener('mouseover', (e) => {
      const emote = e.target.closest('.twitch-irc-emote');
      if (!emote) return;

      // Clear any pending hide
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }

      // Get emote info from alt and title attributes
      const emoteName = emote.getAttribute('alt') || 'Emote';
      const emoteTitle = emote.getAttribute('title') || '';
      const emoteSrc = emote.getAttribute('src') || '';

      // Extract provider from title (format: "emoteName (provider)")
      const providerMatch = emoteTitle.match(/\(([^)]+)\)$/);
      const provider = providerMatch ? providerMatch[1] : 'Twitch';

      // Update tooltip content
      tooltipImg.src = emoteSrc;
      tooltipImg.alt = emoteName;
      tooltipName.textContent = emoteName;
      tooltipProvider.textContent = provider;

      // Position tooltip near the emote
      const rect = emote.getBoundingClientRect();
      const tooltipWidth = 120;
      const tooltipHeight = 100;

      let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
      let top = rect.top - tooltipHeight - 8;

      // Keep tooltip in viewport
      if (left < 10) left = 10;
      if (left + tooltipWidth > window.innerWidth - 10) {
        left = window.innerWidth - tooltipWidth - 10;
      }
      if (top < 10) {
        // Show below if not enough space above
        top = rect.bottom + 8;
      }

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.classList.add('visible');
    });

    messagesContainer.addEventListener('mouseout', (e) => {
      const emote = e.target.closest('.twitch-irc-emote');
      if (!emote) return;

      // Delay hiding to allow smooth movement between emotes
      hideTimeout = setTimeout(() => {
        tooltip.classList.remove('visible');
      }, 100);
    });

    // Also handle autocomplete item hovers
    const autocompleteContainer = container.querySelector('.twitch-emote-autocomplete');
    if (autocompleteContainer) {
      autocompleteContainer.addEventListener('mouseover', (e) => {
        const item = e.target.closest('.twitch-emote-autocomplete-item');
        if (!item) return;

        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }

        const img = item.querySelector('img');
        const nameSpan = item.querySelector('span:not(.twitch-emote-autocomplete-provider)');
        const providerSpan = item.querySelector('.twitch-emote-autocomplete-provider');

        if (!img) return;

        tooltipImg.src = img.src;
        tooltipImg.alt = img.alt;
        tooltipName.textContent = nameSpan?.textContent || img.alt;
        tooltipProvider.textContent = providerSpan?.textContent || '';

        // Position tooltip to the right of the autocomplete dropdown
        const rect = item.getBoundingClientRect();
        const containerRect = autocompleteContainer.getBoundingClientRect();
        const tooltipWidth = 120;

        let left = containerRect.right + 8;
        let top = rect.top;

        // If not enough space on right, show on left
        if (left + tooltipWidth > window.innerWidth - 10) {
          left = containerRect.left - tooltipWidth - 8;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltip.classList.add('visible');
      });

      autocompleteContainer.addEventListener('mouseout', (e) => {
        const item = e.target.closest('.twitch-emote-autocomplete-item');
        if (!item) return;

        hideTimeout = setTimeout(() => {
          tooltip.classList.remove('visible');
        }, 100);
      });
    }
  }

  /**
   * Set up reply button click handler for IRC chat
   */
  function setupReplyHandler(container) {
    const messagesContainer = container.querySelector('.twitch-irc-messages');
    const chatInput = container.querySelector('.twitch-irc-input');
    if (!messagesContainer || !chatInput) return;

    // Use event delegation for reply buttons
    messagesContainer.addEventListener('click', (e) => {
      const replyBtn = e.target.closest('.twitch-irc-reply-btn');
      if (!replyBtn) return;

      // Get username from the message element
      const msgElement = replyBtn.closest('.twitch-irc-msg');
      const username = msgElement?.dataset?.username;
      if (!username) return;

      // Populate input with @username and focus
      const currentValue = chatInput.value.trim();
      const mention = `@${username} `;

      if (currentValue) {
        // Append to existing text
        chatInput.value = currentValue + ' ' + mention;
      } else {
        chatInput.value = mention;
      }

      chatInput.focus();
      // Move cursor to end
      chatInput.selectionStart = chatInput.selectionEnd = chatInput.value.length;
    });
  }

  /**
   * Set up jump-to-bottom button for IRC chat
   * Shows when user scrolls up, hides when at bottom
   */
  function setupJumpToBottom(container) {
    const messagesContainer = container.querySelector('.twitch-irc-messages');
    const jumpBtn = container.querySelector('.twitch-irc-jump-bottom');
    if (!messagesContainer || !jumpBtn) return;

    // Threshold for showing button (pixels from bottom)
    const SCROLL_THRESHOLD = 100;

    // Check if scrolled up and show/hide button
    function updateJumpButton() {
      const isNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < SCROLL_THRESHOLD;
      jumpBtn.style.display = isNearBottom ? 'none' : 'flex';
    }

    // Throttled scroll handler (100ms) - reduces CPU from firing on every pixel
    let scrollTimeout = null;
    function throttledUpdateJumpButton() {
      if (!scrollTimeout) {
        scrollTimeout = setTimeout(() => {
          updateJumpButton();
          scrollTimeout = null;
        }, 100);
      }
    }

    // Listen for scroll events with throttling
    messagesContainer.addEventListener('scroll', throttledUpdateJumpButton);

    // Jump to bottom when button clicked
    jumpBtn.addEventListener('click', () => {
      messagesContainer.scrollTo({
        top: messagesContainer.scrollHeight,
        behavior: 'smooth'
      });
    });

    // Initial check
    updateJumpButton();
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ================================================================
  // TWITCH IRC CHAT CONFIGURATION
  // ================================================================

  const IRC_CONFIG_KEY = 'twitch-irc-config';

  // Default IRC chat config
  const defaultIrcConfig = {
    bgStyle: 'none',        // 'none' or 'svg'
    blur: 16,               // Blur amount for 'none' style (px)
    darkness: 55,           // Darkness for 'none' style (0-100)
    svgFile: null,          // Base64 SVG data URL for 'svg' style
    svgBlur: 0              // Blur amount for SVG background (px)
  };

  // Current IRC config
  let ircConfig = { ...defaultIrcConfig };

  /**
   * Load IRC chat configuration from localStorage
   */
  function loadIrcConfig() {
    try {
      const saved = localStorage.getItem(IRC_CONFIG_KEY);
      if (saved) {
        ircConfig = { ...defaultIrcConfig, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to load IRC config:', e);
      ircConfig = { ...defaultIrcConfig };
    }
    return ircConfig;
  }

  /**
   * Save IRC chat configuration to localStorage
   */
  function saveIrcConfig() {
    try {
      localStorage.setItem(IRC_CONFIG_KEY, JSON.stringify(ircConfig));
    } catch (e) {
      console.warn('Failed to save IRC config:', e);
    }
  }

  /**
   * Apply IRC chat background settings
   */
  function applyIrcBackground() {
    const chatContainer = document.getElementById('twitch-irc-chat');
    if (!chatContainer) return;

    // Set the background style attribute
    chatContainer.dataset.bg = ircConfig.bgStyle;

    if (ircConfig.bgStyle === 'none') {
      // Apply blur and darkness directly as inline styles with !important to override CSS
      const alpha = (ircConfig.darkness / 100).toFixed(2);
      const blurPx = `${ircConfig.blur}px`;
      chatContainer.style.setProperty('background', `rgba(20, 20, 35, ${alpha})`, 'important');
      chatContainer.style.setProperty('backdrop-filter', `blur(${blurPx})`, 'important');
      chatContainer.style.setProperty('-webkit-backdrop-filter', `blur(${blurPx})`, 'important');
      // Clear SVG-related styles
      chatContainer.style.removeProperty('--irc-custom-svg');
      chatContainer.style.removeProperty('--irc-svg-blur');
      console.log('IRC Background applied:', { blur: blurPx, darkness: alpha, element: chatContainer });
    } else if (ircConfig.bgStyle === 'svg' && ircConfig.svgFile) {
      // For SVG mode, use transparent background and CSS variables for the ::before pseudo
      chatContainer.style.background = 'transparent';
      chatContainer.style.backdropFilter = 'none';
      chatContainer.style.webkitBackdropFilter = 'none';
      chatContainer.style.setProperty('--irc-custom-svg', `url("${ircConfig.svgFile}")`);
      chatContainer.style.setProperty('--irc-svg-blur', `${ircConfig.svgBlur}px`);
      chatContainer.style.setProperty('--irc-svg-blur-scale', ircConfig.svgBlur * 0.007);
    }
  }

  /**
   * Fetch and display Twitch channel avatar
   */
  async function fetchChannelAvatar(channel) {
    const avatarImg = document.getElementById('twitch-irc-avatar');
    if (!avatarImg) return;

    try {
      // Get OAuth token from config
      const config = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
      const oauthToken = config.twitch?.oauthToken || '';
      const clientId = config.twitch?.clientId || '';

      // Try using Twitch API if we have credentials
      if (oauthToken && clientId) {
        const cleanToken = oauthToken.startsWith('oauth:') ? oauthToken.slice(6) : oauthToken;
        const response = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, {
          headers: {
            'Authorization': `Bearer ${cleanToken}`,
            'Client-Id': clientId
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.data && data.data[0] && data.data[0].profile_image_url) {
            avatarImg.src = data.data[0].profile_image_url;
            avatarImg.style.display = 'block';
            return;
          }
        }
      }

      // Fallback: Try decapi.me service (no auth required)
      const decapiResponse = await fetch(`https://decapi.me/twitch/avatar/${channel}`);
      if (decapiResponse.ok) {
        const avatarUrl = await decapiResponse.text();
        if (avatarUrl && avatarUrl.startsWith('http')) {
          avatarImg.src = avatarUrl.trim();
          avatarImg.style.display = 'block';
          return;
        }
      }

      // If all else fails, hide the avatar
      avatarImg.style.display = 'none';
    } catch (e) {
      console.warn('Failed to fetch channel avatar:', e);
      avatarImg.style.display = 'none';
    }
  }

  // Track if modal has been initialized
  let ircModalInitialized = false;

  /**
   * Setup IRC chat settings modal event listeners (called once)
   */
  function setupTwitchIrcModal() {
    const modal = document.getElementById('twitch-irc-modal');
    if (!modal || ircModalInitialized) return;
    ircModalInitialized = true;

    const bgNoneRadio = modal.querySelector('input[name="twitch-irc-bg"][value="none"]');
    const bgSvgRadio = modal.querySelector('input[name="twitch-irc-bg"][value="svg"]');
    const noneOptions = document.getElementById('twitch-irc-none-options');
    const svgOptions = document.getElementById('twitch-irc-svg-upload');
    const blurSlider = document.getElementById('twitch-irc-blur-slider');
    const blurInput = document.getElementById('twitch-irc-blur-input');
    const darknessSlider = document.getElementById('twitch-irc-darkness-slider');
    const darknessInput = document.getElementById('twitch-irc-darkness-input');
    const svgFileInput = document.getElementById('twitch-irc-svg-input');
    const svgPreview = document.getElementById('twitch-irc-svg-preview');
    const svgBlurSlider = document.getElementById('twitch-irc-svg-blur-slider');
    const svgBlurInput = document.getElementById('twitch-irc-svg-blur-input');
    const svgClearBtn = document.getElementById('twitch-irc-svg-clear');
    const saveBtn = document.getElementById('twitch-irc-save-btn');
    const cancelBtn = document.getElementById('twitch-irc-cancel-btn');

    // Radio button change handlers
    function handleBgStyleChange() {
      const isNone = bgNoneRadio?.checked;
      if (noneOptions) noneOptions.style.display = isNone ? 'flex' : 'none';
      if (svgOptions) svgOptions.style.display = isNone ? 'none' : 'flex';
    }
    bgNoneRadio?.addEventListener('change', handleBgStyleChange);
    bgSvgRadio?.addEventListener('change', handleBgStyleChange);

    // Sync blur slider and input
    function syncBlur(value) {
      const v = Math.max(0, Math.min(30, parseInt(value) || 0));
      if (blurSlider) blurSlider.value = v;
      if (blurInput) blurInput.value = v;
    }
    blurSlider?.addEventListener('input', () => syncBlur(blurSlider.value));
    blurInput?.addEventListener('input', () => syncBlur(blurInput.value));

    // Sync darkness slider and input
    function syncDarkness(value) {
      const v = Math.max(0, Math.min(100, parseInt(value) || 0));
      if (darknessSlider) darknessSlider.value = v;
      if (darknessInput) darknessInput.value = v;
    }
    darknessSlider?.addEventListener('input', () => syncDarkness(darknessSlider.value));
    darknessInput?.addEventListener('input', () => syncDarkness(darknessInput.value));

    // Sync SVG blur slider and input
    function syncSvgBlur(value) {
      const v = Math.max(0, Math.min(30, parseInt(value) || 0));
      if (svgBlurSlider) svgBlurSlider.value = v;
      if (svgBlurInput) svgBlurInput.value = v;
    }
    svgBlurSlider?.addEventListener('input', () => syncSvgBlur(svgBlurSlider.value));
    svgBlurInput?.addEventListener('input', () => syncSvgBlur(svgBlurInput.value));

    // SVG file input handler
    svgFileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target.result;
        if (svgPreview) {
          svgPreview.style.backgroundImage = `url("${dataUrl}")`;
          svgPreview.classList.add('has-image');
        }
        svgFileInput.dataset.pendingSvg = dataUrl;
      };
      reader.readAsDataURL(file);
    });

    // SVG clear button handler
    svgClearBtn?.addEventListener('click', () => {
      if (svgPreview) {
        svgPreview.style.backgroundImage = '';
        svgPreview.classList.remove('has-image');
      }
      if (svgFileInput) {
        svgFileInput.value = '';
        svgFileInput.dataset.pendingSvg = '';
      }
    });

    // Save button handler
    saveBtn?.addEventListener('click', () => {
      // Query elements fresh to avoid stale closure references
      const freshBgSvgRadio = document.querySelector('input[name="twitch-irc-bg"][value="svg"]');
      const freshBlurSlider = document.getElementById('twitch-irc-blur-slider');
      const freshDarknessSlider = document.getElementById('twitch-irc-darkness-slider');
      const freshSvgBlurSlider = document.getElementById('twitch-irc-svg-blur-slider');
      const freshSvgFileInput = document.getElementById('twitch-irc-svg-input');
      const freshSvgPreview = document.getElementById('twitch-irc-svg-preview');
      const freshModal = document.getElementById('twitch-irc-modal');

      // Read current values from inputs (use explicit NaN check to allow 0 values)
      ircConfig.bgStyle = freshBgSvgRadio?.checked ? 'svg' : 'none';
      const blurVal = parseInt(freshBlurSlider?.value);
      const darknessVal = parseInt(freshDarknessSlider?.value);
      const svgBlurVal = parseInt(freshSvgBlurSlider?.value);
      ircConfig.blur = !isNaN(blurVal) ? blurVal : 16;
      ircConfig.darkness = !isNaN(darknessVal) ? darknessVal : 55;
      ircConfig.svgBlur = !isNaN(svgBlurVal) ? svgBlurVal : 0;

      console.log('Saving IRC config:', { blur: ircConfig.blur, darkness: ircConfig.darkness, sliderValues: { blur: freshBlurSlider?.value, darkness: freshDarknessSlider?.value } });

      // Check for pending SVG
      if (freshSvgFileInput?.dataset.pendingSvg) {
        ircConfig.svgFile = freshSvgFileInput.dataset.pendingSvg;
        freshSvgFileInput.dataset.pendingSvg = '';
      } else if (freshSvgPreview && !freshSvgPreview.classList.contains('has-image')) {
        ircConfig.svgFile = null;
      }

      // Save and apply
      saveIrcConfig();
      applyIrcBackground();
      freshModal?.classList.remove('active');
    });

    // Cancel button handler
    cancelBtn?.addEventListener('click', () => {
      modal.classList.remove('active');
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  }

  /**
   * Open the IRC chat settings modal and populate with current values
   */
  function initTwitchIrcModal() {
    // Setup event listeners once
    setupTwitchIrcModal();

    // Load current config
    loadIrcConfig();

    // Get modal elements
    const modal = document.getElementById('twitch-irc-modal');
    if (!modal) return;

    const bgNoneRadio = modal.querySelector('input[name="twitch-irc-bg"][value="none"]');
    const bgSvgRadio = modal.querySelector('input[name="twitch-irc-bg"][value="svg"]');
    const noneOptions = document.getElementById('twitch-irc-none-options');
    const svgOptions = document.getElementById('twitch-irc-svg-upload');
    const blurSlider = document.getElementById('twitch-irc-blur-slider');
    const blurInput = document.getElementById('twitch-irc-blur-input');
    const darknessSlider = document.getElementById('twitch-irc-darkness-slider');
    const darknessInput = document.getElementById('twitch-irc-darkness-input');
    const svgFileInput = document.getElementById('twitch-irc-svg-input');
    const svgPreview = document.getElementById('twitch-irc-svg-preview');
    const svgBlurSlider = document.getElementById('twitch-irc-svg-blur-slider');
    const svgBlurInput = document.getElementById('twitch-irc-svg-blur-input');

    // Set values from config
    if (bgNoneRadio && bgSvgRadio) {
      bgNoneRadio.checked = ircConfig.bgStyle === 'none';
      bgSvgRadio.checked = ircConfig.bgStyle === 'svg';
    }

    // Show/hide appropriate options
    if (noneOptions && svgOptions) {
      noneOptions.style.display = ircConfig.bgStyle === 'none' ? 'flex' : 'none';
      svgOptions.style.display = ircConfig.bgStyle === 'svg' ? 'flex' : 'none';
    }

    // Set blur and darkness values
    if (blurSlider) blurSlider.value = ircConfig.blur;
    if (blurInput) blurInput.value = ircConfig.blur;
    if (darknessSlider) darknessSlider.value = ircConfig.darkness;
    if (darknessInput) darknessInput.value = ircConfig.darkness;

    // Set SVG values
    if (svgBlurSlider) svgBlurSlider.value = ircConfig.svgBlur;
    if (svgBlurInput) svgBlurInput.value = ircConfig.svgBlur;
    if (svgPreview && ircConfig.svgFile) {
      svgPreview.style.backgroundImage = `url("${ircConfig.svgFile}")`;
      svgPreview.classList.add('has-image');
    } else if (svgPreview) {
      svgPreview.style.backgroundImage = '';
      svgPreview.classList.remove('has-image');
    }

    // Clear any pending SVG from previous session
    if (svgFileInput) {
      svgFileInput.value = '';
      svgFileInput.dataset.pendingSvg = '';
    }
  }

  // Public API
  return {
    initialize,
    refresh: fetchEmails,
    switchView
  };
})();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => InboxWidget.initialize());
} else {
  InboxWidget.initialize();
}
