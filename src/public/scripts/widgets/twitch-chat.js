/* ================================================================
   TWITCH CHAT - IRC WebSocket Implementation
   Connects directly to Twitch IRC to bypass iframe restrictions
   Copyright (c) 2024-2025 Havens Consulting Inc. All Rights Reserved.
   Fingerprint: AE-WWD-8B4F2C1E-2025
   ================================================================ */

const TwitchChat = (function() {
  const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
  const RECENT_MESSAGES_API = 'https://recent-messages.robotty.de/api/v2/recent-messages';
  // Reconnect backoff: a fixed short delay hammered the IRC endpoint forever
  // during network blips. Delay grows per consecutive failure, capped at 60s;
  // reset on successful welcome (001).
  const RECONNECT_DELAYS = [3000, 10000, 30000, 60000];
  let reconnectAttempts = 0;
  const MAX_MESSAGES = 100;
  const MAX_RECENT_MESSAGES = 50; // Limit history to avoid overwhelming the UI

  // Fallback badge URLs (used if API fetch fails)
  const FALLBACK_BADGE_URLS = {
    broadcaster: 'https://static-cdn.jtvnw.net/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/3',
    moderator: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3',
    vip: 'https://static-cdn.jtvnw.net/badges/v1/b817aba4-fad8-49e2-b88a-7cc744f5d4bc/3',
    partner: 'https://static-cdn.jtvnw.net/badges/v1/d12a2e27-16f6-41d0-ab77-b780518f00a3/3',
    turbo: 'https://static-cdn.jtvnw.net/badges/v1/bd444ec6-8f34-4bf9-91f4-af1e3428d80f/3',
    prime: 'https://static-cdn.jtvnw.net/badges/v1/bbbe0db0-a598-423e-86d0-f9fb98ca1933/3',
  };

  // Dynamic badge cache: { badgeName: { version: url } }
  let globalBadges = {};
  let channelBadges = {};
  let badgesLoaded = false;
  let currentBadgeChannel = null;

  let ws = null;
  let channel = null;
  let username = null;
  let displayName = null; // Properly cased display name for rendering sent messages
  let oauthToken = null;
  let isConnected = false;
  let reconnectTimeout = null;
  let connectionId = 0; // Unique ID for each connection attempt
  let messages = [];
  let container = null;
  let onMessageCallback = null;

  // Third-party emote cache: { code: { url, provider } }
  let thirdPartyEmotes = {};
  let emotesLoaded = false;
  let currentEmoteChannel = null;

  // Chat participants tracking for @mention autocomplete
  // Maps lowercase username to display name for proper casing
  let chatParticipants = new Map();

  /**
   * Fetch FFZ global and channel emotes
   */
  async function fetchFFZEmotes(channelName) {
    const emotes = {};
    try {
      // Global emotes
      const globalRes = await fetch('https://api.frankerfacez.com/v1/set/global');
      if (globalRes.ok) {
        const data = await globalRes.json();
        for (const setId of data.default_sets || []) {
          const set = data.sets[setId];
          if (set?.emoticons) {
            for (const emote of set.emoticons) {
              const url = emote.urls['1'] || emote.urls['2'] || Object.values(emote.urls)[0];
              if (url) {
                emotes[emote.name] = { url: url.startsWith('//') ? 'https:' + url : url, provider: 'ffz' };
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('FFZ global emotes failed:', e);
    }

    try {
      // Channel emotes
      const channelRes = await fetch(`https://api.frankerfacez.com/v1/room/${channelName}`);
      if (channelRes.ok) {
        const data = await channelRes.json();
        for (const setId in data.sets || {}) {
          const set = data.sets[setId];
          if (set?.emoticons) {
            for (const emote of set.emoticons) {
              const url = emote.urls['1'] || emote.urls['2'] || Object.values(emote.urls)[0];
              if (url) {
                emotes[emote.name] = { url: url.startsWith('//') ? 'https:' + url : url, provider: 'ffz' };
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('FFZ channel emotes failed:', e);
    }

    return emotes;
  }

  /**
   * Resolve Twitch username to user ID using IVR API
   * 7TV API often requires user ID instead of username
   */
  async function getTwitchUserId(channelName) {
    try {
      const res = await fetch(`https://api.ivr.fi/v2/twitch/user?login=${channelName}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0 && data[0].id) {
          return data[0].id;
        }
      }
    } catch (e) {
      console.warn('IVR API lookup failed:', e);
    }
    return null;
  }

  /**
   * Fetch 7TV global and channel emotes
   */
  async function fetch7TVEmotes(channelName) {
    const emotes = {};
    try {
      // Global emotes
      const globalRes = await fetch('https://7tv.io/v3/emote-sets/global');
      if (globalRes.ok) {
        const data = await globalRes.json();
        for (const emote of data.emotes || []) {
          const files = emote.data?.host?.files || [];
          const isAnimated = emote.data?.animated;
          // Prefer animated format for animated emotes, static for others
          const file = isAnimated
            ? files.find(f => f.name === '1x.avif') || files.find(f => f.name === '1x.webp') || files[0]
            : files.find(f => f.name === '1x.webp') || files[0];
          if (file && emote.data?.host?.url) {
            emotes[emote.name] = { url: `https:${emote.data.host.url}/${file.name}`, provider: '7tv', animated: isAnimated };
          }
        }
      }
    } catch (e) {
      console.warn('7TV global emotes failed:', e);
    }

    try {
      // Channel emotes - try username first, then fall back to user ID lookup
      let userRes = await fetch(`https://7tv.io/v3/users/twitch/${channelName}`);

      // If username lookup fails, try with Twitch user ID
      if (!userRes.ok) {
        console.log('7TV username lookup failed, trying user ID lookup...');
        const twitchUserId = await getTwitchUserId(channelName);
        if (twitchUserId) {
          userRes = await fetch(`https://7tv.io/v3/users/twitch/${twitchUserId}`);
        }
      }

      if (userRes.ok) {
        const userData = await userRes.json();
        const emoteSet = userData.emote_set;
        if (emoteSet?.emotes) {
          for (const emote of emoteSet.emotes) {
            const files = emote.data?.host?.files || [];
            const isAnimated = emote.data?.animated;
            // Prefer animated format for animated emotes, static for others
            const file = isAnimated
              ? files.find(f => f.name === '1x.avif') || files.find(f => f.name === '1x.webp') || files[0]
              : files.find(f => f.name === '1x.webp') || files[0];
            if (file && emote.data?.host?.url) {
              emotes[emote.name] = { url: `https:${emote.data.host.url}/${file.name}`, provider: '7tv', animated: isAnimated };
            }
          }
        }
      }
    } catch (e) {
      console.warn('7TV channel emotes failed:', e);
    }

    return emotes;
  }

  /**
   * Fetch BTTV global and channel emotes
   */
  async function fetchBTTVEmotes(channelName) {
    const emotes = {};
    try {
      // Global emotes
      const globalRes = await fetch('https://api.betterttv.net/3/cached/emotes/global');
      if (globalRes.ok) {
        const data = await globalRes.json();
        for (const emote of data) {
          emotes[emote.code] = { url: `https://cdn.betterttv.net/emote/${emote.id}/1x`, provider: 'bttv' };
        }
      }
    } catch (e) {
      console.warn('BTTV global emotes failed:', e);
    }

    try {
      // Channel emotes - need broadcaster ID, try by username
      const channelRes = await fetch(`https://api.betterttv.net/3/cached/users/twitch/${channelName}`);
      if (channelRes.ok) {
        const data = await channelRes.json();
        // Channel emotes
        for (const emote of data.channelEmotes || []) {
          emotes[emote.code] = { url: `https://cdn.betterttv.net/emote/${emote.id}/1x`, provider: 'bttv' };
        }
        // Shared emotes
        for (const emote of data.sharedEmotes || []) {
          emotes[emote.code] = { url: `https://cdn.betterttv.net/emote/${emote.id}/1x`, provider: 'bttv' };
        }
      }
    } catch (e) {
      console.warn('BTTV channel emotes failed:', e);
    }

    return emotes;
  }

  /**
   * Resolve a channel's broadcaster id via Helix (cached per channel).
   * Shared by the badge and emote fetchers; requires the user's token.
   */
  let cachedBroadcaster = { name: null, id: null };
  async function resolveBroadcasterId(channelName) {
    if (!oauthToken) return null;
    if (cachedBroadcaster.name === channelName) return cachedBroadcaster.id;

    try {
      const res = await fetch(
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(channelName)}`,
        { headers: helixHeaders() }
      );
      const id = res.ok ? (await res.json()).data?.[0]?.id || null : null;
      cachedBroadcaster = { name: channelName, id };
      return id;
    } catch (e) {
      return null;
    }
  }

  /** Map a Helix emote response ({data:[{name, images:{url_1x,...}}]}) into
   *  the {code: {url, provider}} shape the renderer uses. */
  function mapHelixEmotes(data, emotes) {
    for (const emote of data.data || []) {
      const url = emote.images?.url_1x || emote.images?.url_2x;
      if (emote.name && url) {
        emotes[emote.name] = { url, provider: 'twitch' };
      }
    }
  }

  /**
   * Fetch Twitch global emotes.
   * The old emotes.adamcy.pl aggregator stopped sending CORS headers, so
   * these come from Helix now (needs the user's token; anonymous chat skips).
   */
  async function fetchTwitchGlobalEmotes() {
    const emotes = {};
    if (!oauthToken) return emotes;
    try {
      const res = await fetch('https://api.twitch.tv/helix/chat/emotes/global', {
        headers: helixHeaders()
      });
      if (res.ok) {
        mapHelixEmotes(await res.json(), emotes);
      }
    } catch (e) {
      console.warn('Twitch global emotes failed:', e);
    }
    return emotes;
  }

  /**
   * Fetch Twitch channel subscriber emotes (Helix, see fetchTwitchGlobalEmotes)
   */
  async function fetchTwitchChannelEmotes(channelName) {
    const emotes = {};
    if (!oauthToken) return emotes;
    try {
      const channelId = await resolveBroadcasterId(channelName);
      if (!channelId) return emotes;

      const res = await fetch(
        `https://api.twitch.tv/helix/chat/emotes?broadcaster_id=${channelId}`,
        { headers: helixHeaders() }
      );
      if (res.ok) {
        mapHelixEmotes(await res.json(), emotes);
      }
    } catch (e) {
      console.warn('Twitch channel emotes failed:', e);
    }
    return emotes;
  }

  /**
   * Load emotes for a channel
   *
   * IMPORTANT: 7TV/BTTV/FFZ emotes only work in the channel where they're enabled.
   * So we only load those from the CURRENT channel.
   *
   * Twitch native emotes (global, channel subs, user subs) work everywhere,
   * so those can be loaded from the user's subscriptions.
   */
  async function loadThirdPartyEmotes(channelName) {
    if (currentEmoteChannel === channelName && emotesLoaded) {
      return; // Already loaded for this channel
    }

    console.log('TwitchChat: Loading emotes for', channelName);
    currentEmoteChannel = channelName;
    emotesLoaded = false;

    // Fetch emotes in parallel:
    // - Global Twitch emotes (work everywhere)
    // - Current channel's third-party emotes (7TV/BTTV/FFZ only work in this channel)
    // - Current channel's Twitch emotes
    // - User's subscribed Twitch emotes (work everywhere)
    const fetchPromises = [
      fetchTwitchGlobalEmotes(),
      fetchFFZEmotes(channelName),
      fetch7TVEmotes(channelName),
      fetchBTTVEmotes(channelName),
      fetchTwitchChannelEmotes(channelName),
    ];

    // Also fetch user's subscribed/follower emotes via Helix API (these work everywhere)
    let userEmotesPromise = Promise.resolve({});
    if (typeof window.fetchUserTwitchEmotes === 'function') {
      userEmotesPromise = window.fetchUserTwitchEmotes().catch(e => {
        console.warn('TwitchChat: User emotes fetch failed:', e);
        return {};
      });
    }

    const [results, userEmotes] = await Promise.all([
      Promise.all(fetchPromises),
      userEmotesPromise
    ]).catch(e => {
      console.error('TwitchChat: Emote loading failed:', e);
      return [[], {}];
    });

    // Merge emotes (later sources override earlier for duplicates)
    const [twitchGlobal, ffz, sevenTV, bttv, twitchChannel] = results.map(r => r || {});

    thirdPartyEmotes = {
      ...twitchGlobal,
      ...twitchChannel,
      ...ffz,
      ...bttv,
      ...sevenTV,
      ...(userEmotes || {}),
    };

    emotesLoaded = true;

    const twitchGlobalCount = Object.keys(twitchGlobal).length;
    const twitchChannelCount = Object.keys(twitchChannel).length;
    const userEmoteCount = Object.keys(userEmotes || {}).length;
    const ffzCount = Object.keys(ffz).length;
    const sevenTVCount = Object.keys(sevenTV).length;
    const bttvCount = Object.keys(bttv).length;
    const total = Object.keys(thirdPartyEmotes).length;

    console.log(`TwitchChat: Loaded ${total} emotes for #${channelName} (Twitch Global: ${twitchGlobalCount}, Channel: ${twitchChannelCount}, User Subs: ${userEmoteCount}, FFZ: ${ffzCount}, 7TV: ${sevenTVCount}, BTTV: ${bttvCount})`);
  }

  /**
   * Get all loaded emotes for the emote picker
   */
  function getEmotes() {
    return thirdPartyEmotes;
  }

  /**
   * Get emotes filtered by provider
   */
  function getEmotesByProvider(provider) {
    if (provider === 'all') return thirdPartyEmotes;

    const filtered = {};
    for (const [code, data] of Object.entries(thirdPartyEmotes)) {
      if (data.provider === provider || (provider === 'twitch' && data.provider.startsWith('twitch'))) {
        filtered[code] = data;
      }
    }
    return filtered;
  }

  /**
   * Collapse consecutive duplicate characters for fuzzy matching
   * "peepo" -> "pepo", "pepe" -> "pepe", "KEKW" -> "KEKW"
   */
  function collapseChars(str) {
    return str.replace(/(.)\1+/g, '$1');
  }

  /**
   * Fuzzy match with scoring - checks if emote matches search term
   * Returns score: 4 = prefix, 3 = contains, 2 = collapsed contains, 1 = collapsed prefix match, 0 = no match
   */
  function fuzzyMatchScore(query, target) {
    if (!query) return 4;
    const queryLower = query.toLowerCase();
    const targetLower = target.toLowerCase();

    // Exact prefix match gets highest priority
    if (targetLower.startsWith(queryLower)) return 4;

    // Direct substring match
    if (targetLower.includes(queryLower)) return 3;

    // Collapsed form match (peepo -> pepo, so "pep" from "pepe" matches)
    const targetCollapsed = collapseChars(targetLower);
    const queryCollapsed = collapseChars(queryLower);
    if (targetCollapsed.includes(queryCollapsed)) return 2;

    // Prefix match on collapsed form (first 3+ chars)
    if (queryCollapsed.length >= 3) {
      const prefix = queryCollapsed.substring(0, 3);
      if (targetCollapsed.includes(prefix)) return 1;
    }

    return 0;
  }

  /**
   * Search emotes by name with fuzzy matching (local cache only, synchronous)
   */
  function searchEmotesLocal(query, provider = 'all') {
    const emotes = getEmotesByProvider(provider);
    if (!query) return emotes;

    const matches = [];

    for (const [code, data] of Object.entries(emotes)) {
      const score = fuzzyMatchScore(query, code);
      if (score > 0) {
        matches.push({ code, data, score });
      }
    }

    // Sort by score (highest first), then alphabetically
    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.code.localeCompare(b.code);
    });

    const results = {};
    for (const match of matches) {
      results[match.code] = match.data;
    }

    return results;
  }

  /**
   * Search emotes - only returns emotes actually available on the channel
   * (Does NOT search global APIs to avoid showing unavailable emotes)
   */
  async function searchEmotes(query, provider = 'all') {
    // Only search local cache - these are emotes actually loaded for the channel
    // Global API search was removed because it showed emotes not available on the channel
    return searchEmotesLocal(query, provider);
  }

  /**
   * Fetch global Twitch badges
   */
  // badges.twitch.tv was decommissioned by Twitch (the domain no longer
  // resolves), so badges come from Helix now - which requires the user's
  // OAuth token. Anonymous (justinfan) chat skips the fetch and relies on
  // FALLBACK_BADGE_URLS for the common badges.
  const HELIX_CLIENT_ID = '6og5fv8xx0tq8xw67itgl8whmoa5ru';

  function helixHeaders() {
    return {
      'Client-ID': HELIX_CLIENT_ID,
      'Authorization': `Bearer ${oauthToken}`
    };
  }

  /** Map a Helix badge response ({data:[{set_id, versions:[{id, image_url_2x}]}]})
   *  into the {badgeName: {version: url}} shape the renderer uses. */
  function mapHelixBadgeSets(data, target) {
    for (const set of data.data || []) {
      target[set.set_id] = {};
      for (const version of set.versions || []) {
        target[set.set_id][version.id] = version.image_url_2x || version.image_url_1x;
      }
    }
  }

  async function fetchGlobalBadges() {
    if (Object.keys(globalBadges).length > 0) {
      return; // Already loaded
    }
    if (!oauthToken) {
      return; // Helix needs auth; anonymous chat uses the fallback URLs
    }

    try {
      const res = await fetch('https://api.twitch.tv/helix/chat/badges/global', {
        headers: helixHeaders()
      });
      if (res.ok) {
        mapHelixBadgeSets(await res.json(), globalBadges);
        console.log(`TwitchChat: Loaded ${Object.keys(globalBadges).length} global badge types`);
      }
    } catch (e) {
      console.warn('TwitchChat: Failed to fetch global badges:', e);
    }
  }

  /**
   * Fetch channel-specific badges (subscriber badges, bits badges, etc.)
   */
  async function fetchChannelBadges(channelName) {
    if (currentBadgeChannel === channelName && Object.keys(channelBadges).length > 0) {
      return; // Already loaded for this channel
    }

    currentBadgeChannel = channelName;
    channelBadges = {};

    if (!oauthToken) {
      badgesLoaded = true;
      return;
    }

    try {
      const channelId = await resolveBroadcasterId(channelName);
      if (!channelId) {
        console.warn('TwitchChat: Could not resolve channel id for badge fetch');
        badgesLoaded = true;
        return;
      }

      const res = await fetch(
        `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${channelId}`,
        { headers: helixHeaders() }
      );
      if (res.ok) {
        mapHelixBadgeSets(await res.json(), channelBadges);
        console.log(`TwitchChat: Loaded ${Object.keys(channelBadges).length} channel badge types for ${channelName}`);
      }
    } catch (e) {
      console.warn('TwitchChat: Failed to fetch channel badges:', e);
    }

    badgesLoaded = true;
  }

  /**
   * Load all badges (global + channel)
   */
  async function loadBadges(channelName) {
    await Promise.all([
      fetchGlobalBadges(),
      fetchChannelBadges(channelName)
    ]);
  }

  /**
   * Fetch recent chat messages from third-party API
   * This loads chat history when connecting to a channel
   */
  async function fetchRecentMessages(channelName) {
    try {
      const response = await fetch(`${RECENT_MESSAGES_API}/${channelName}?limit=${MAX_RECENT_MESSAGES}`);
      if (!response.ok) {
        console.warn('TwitchChat: Recent messages API returned', response.status);
        return [];
      }
      const data = await response.json();
      // Return messages if available, even if there's a non-critical error
      // (e.g., "channel_not_joined" still returns cached messages)
      if (data.messages && data.messages.length > 0) {
        return data.messages;
      }
      if (data.error) {
        console.warn('TwitchChat: Recent messages error:', data.error);
      }
      return [];
    } catch (e) {
      console.warn('TwitchChat: Failed to fetch recent messages:', e);
      return [];
    }
  }

  /**
   * Load and render recent messages for a channel
   * Called when first connecting to show chat history
   */
  async function loadRecentMessages(channelName) {
    renderSystemMessage('Loading chat history...');

    const recentMessages = await fetchRecentMessages(channelName);
    if (recentMessages.length === 0) {
      clearSystemMessages();
      return;
    }

    console.log(`TwitchChat: Loading ${recentMessages.length} recent messages`);

    // Parse and render each message (oldest first)
    for (const rawMessage of recentMessages) {
      const parsed = parseIRCMessage(rawMessage);
      if (!parsed) continue;

      if (parsed.command === 'PRIVMSG') {
        handleChatMessage(parsed, true); // true = isHistorical
      } else if (parsed.command === 'USERNOTICE') {
        handleUserNotice(parsed);
      }
    }
  }

  /**
   * Get badge URL for a specific badge name and version
   */
  function getBadgeUrl(badgeName, version) {
    // Check channel badges first (they override global, e.g., subscriber)
    if (channelBadges[badgeName]?.[version]) {
      return channelBadges[badgeName][version];
    }
    // Check global badges
    if (globalBadges[badgeName]?.[version]) {
      return globalBadges[badgeName][version];
    }
    // Fallback for common badges
    if (FALLBACK_BADGE_URLS[badgeName]) {
      return FALLBACK_BADGE_URLS[badgeName];
    }
    return null;
  }

  /**
   * Initialize chat for a channel
   */
  function connect(channelName, options = {}) {
    // Clear any pending reconnect
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    // Increment connection ID to invalidate any pending close handlers
    connectionId++;
    const thisConnectionId = connectionId;

    channel = channelName.toLowerCase().replace('#', '');
    username = options.username || `justinfan${Math.floor(Math.random() * 99999)}`;
    displayName = options.displayName || options.username || username; // Use displayName if provided, else fallback to username
    oauthToken = options.oauthToken || null;
    container = options.container || document.getElementById('twitch-irc-chat');
    onMessageCallback = options.onMessage || null;

    // Set up emote click-to-copy handler (delegated, only once per container)
    if (container && !container.dataset.emoteClickHandler) {
      container.dataset.emoteClickHandler = 'true';
      container.addEventListener('click', (e) => {
        const emote = e.target.closest('.twitch-irc-emote');
        if (emote) {
          const emoteCode = emote.alt;
          if (emoteCode) {
            navigator.clipboard.writeText(emoteCode).then(() => {
              // Show brief "copied" feedback
              emote.classList.add('copied');
              setTimeout(() => emote.classList.remove('copied'), 800);
            }).catch(err => console.warn('Failed to copy emote:', err));
          }
        }
      });
    }

    // Close existing connection (new connectionId means old close handlers won't reconnect)
    if (ws) {
      ws.close();
    }

    ws = new WebSocket(IRC_URL);

    ws.onopen = handleOpen;
    ws.onmessage = handleMessage;
    ws.onclose = (event) => handleClose(event, thisConnectionId);
    ws.onerror = handleError;

    // Load third-party emotes and badges for this channel
    loadThirdPartyEmotes(channel);
    loadBadges(channel);

    // Add streamer to participants list for @mention autocomplete
    // (so they appear even if they haven't chatted yet)
    const streamerDisplayName = channel.charAt(0).toUpperCase() + channel.slice(1);
    chatParticipants.set(channel.toLowerCase(), streamerDisplayName);

    console.log('TwitchChat: Connecting to', channel);
  }

  /**
   * Disconnect from chat
   */
  function disconnect() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    // Increment connectionId to invalidate any pending close handlers
    connectionId++;
    channel = null; // Clear channel to prevent reconnect
    container = null; // Clear container reference
    if (ws) {
      ws.close();
      ws = null;
    }
    isConnected = false;
    messages = []; // Clear message history
    chatParticipants.clear(); // Clear participant list
    // Clear channel-specific caches (global badges persist)
    channelBadges = {};
    currentBadgeChannel = null;
    badgesLoaded = false;
  }

  /**
   * Send a chat message (requires OAuth)
   */
  function sendMessage(text) {
    if (!isConnected || !ws || !oauthToken) {
      console.warn('TwitchChat: Cannot send - not authenticated', { isConnected, hasWs: !!ws, hasToken: !!oauthToken });
      return false;
    }
    ws.send(`PRIVMSG #${channel} :${text}`);

    // Twitch IRC doesn't echo your own messages back, so render locally
    const renderName = displayName || username || 'You';
    addMessage({
      id: `sent-${Date.now()}`,
      type: 'chat',
      displayName: renderName,
      color: '#bf94ff', // Twitch purple for sent messages
      badges: [],
      message: text,
      emotes: [],
      timestamp: new Date(),
      isAction: false,
      isSelf: true
    });

    return true;
  }

  /**
   * Handle WebSocket open
   */
  function handleOpen() {
    console.log('TwitchChat: WebSocket connected');

    // Request capabilities for tags, commands, membership
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');

    // Authenticate
    if (oauthToken) {
      // Debug: Log auth attempt (mask token for security)
      const maskedToken = oauthToken.length > 10 ? oauthToken.slice(0, 6) + '...' + oauthToken.slice(-4) : '[short]';
      console.log(`TwitchChat: Authenticating as '${username}' with token ${maskedToken}`);
      ws.send(`PASS oauth:${oauthToken}`);
      ws.send(`NICK ${username}`);
    } else {
      // Anonymous connection
      console.log(`TwitchChat: Connecting anonymously as '${username}'`);
      ws.send('PASS SCHMOOPIIE');
      ws.send(`NICK ${username}`);
    }

    // Join channel
    ws.send(`JOIN #${channel}`);
  }

  /**
   * Handle incoming IRC messages
   */
  function handleMessage(event) {
    const lines = event.data.split('\r\n');

    for (const line of lines) {
      if (!line) continue;

      // Respond to PING
      if (line.startsWith('PING')) {
        ws.send('PONG :tmi.twitch.tv');
        continue;
      }

      // Parse IRC message
      const parsed = parseIRCMessage(line);
      if (!parsed) continue;

      // Handle different message types
      switch (parsed.command) {
        case '001': // Welcome
        case '002':
        case '003':
        case '004':
        case '353': // NAMES list
        case '366': // End of NAMES
        case '372': // MOTD
        case '375': // MOTD start
        case '376': // MOTD end
          // Connection established
          if (parsed.command === '001') {
            isConnected = true;
            reconnectAttempts = 0; // healthy connection - reset the backoff
            console.log('TwitchChat: Connected to', channel);
            // Load chat history then show connected message
            loadRecentMessages(channel).then(() => {
              renderSystemMessage(`Connected to #${channel}`);
            });
          }
          break;

        case 'JOIN':
          // User joined
          break;

        case 'PART':
          // User left
          break;

        case 'PRIVMSG':
          // Chat message
          handleChatMessage(parsed);
          break;

        case 'USERNOTICE':
          // Sub, resub, gift sub, raid, etc.
          handleUserNotice(parsed);
          break;

        case 'CLEARCHAT':
          // Timeout/ban
          break;

        case 'CLEARMSG':
          // Single message deleted
          break;

        case 'NOTICE':
          // Server notice
          renderSystemMessage(parsed.params[1] || 'Notice from server');
          break;
      }
    }
  }

  /**
   * Parse IRC message with tags
   */
  function parseIRCMessage(raw) {
    let tags = {};
    let prefix = null;
    let command = null;
    let params = [];

    let idx = 0;

    // Parse tags
    if (raw[0] === '@') {
      const spaceIdx = raw.indexOf(' ');
      const tagStr = raw.substring(1, spaceIdx);
      idx = spaceIdx + 1;

      tagStr.split(';').forEach(tag => {
        const [key, value] = tag.split('=');
        tags[key] = value || true;
      });
    }

    // Parse prefix
    if (raw[idx] === ':') {
      const spaceIdx = raw.indexOf(' ', idx);
      prefix = raw.substring(idx + 1, spaceIdx);
      idx = spaceIdx + 1;
    }

    // Parse command
    const nextSpace = raw.indexOf(' ', idx);
    if (nextSpace === -1) {
      command = raw.substring(idx);
    } else {
      command = raw.substring(idx, nextSpace);
      idx = nextSpace + 1;

      // Parse params
      while (idx < raw.length) {
        if (raw[idx] === ':') {
          params.push(raw.substring(idx + 1));
          break;
        }
        const spaceIdx = raw.indexOf(' ', idx);
        if (spaceIdx === -1) {
          params.push(raw.substring(idx));
          break;
        }
        params.push(raw.substring(idx, spaceIdx));
        idx = spaceIdx + 1;
      }
    }

    return { tags, prefix, command, params };
  }

  /**
   * Handle PRIVMSG (chat message)
   * @param {object} parsed - Parsed IRC message
   * @param {boolean} isHistorical - True if this is from chat history (don't play sounds)
   */
  function handleChatMessage(parsed, isHistorical = false) {
    const tags = parsed.tags;
    const displayName = tags['display-name'] || parsed.prefix?.split('!')[0] || 'Anonymous';
    const color = tags.color || getDefaultColor(displayName);
    const message = parsed.params[1] || '';
    const badges = parseBadges(tags.badges);
    const emotes = parseEmotes(tags.emotes, message);
    const timestamp = new Date(parseInt(tags['tmi-sent-ts']) || Date.now());

    // Track chat participant for @mention autocomplete
    if (displayName && displayName !== 'Anonymous') {
      chatParticipants.set(displayName.toLowerCase(), displayName);
    }

    // Check if this message mentions the current user
    const isMention = checkForMention(message);

    const msgData = {
      id: tags.id || Date.now().toString(),
      type: 'chat',
      displayName,
      color,
      badges,
      message,
      emotes,
      timestamp,
      isAction: message.startsWith('\u0001ACTION') && message.endsWith('\u0001'),
      isMention,
      isHistorical,
    };

    // Clean up ACTION formatting
    if (msgData.isAction) {
      msgData.message = message.slice(8, -1);
    }

    // Play appropriate sound (but not for historical messages)
    if (!isHistorical) {
      // Check for !kok bot response first (highest priority meme sound)
      if (checkForKokResponse(message)) {
        playKokSound();
      } else if (isMention) {
        // Check if it's a hug action - play awww sound instead of zelda
        if (checkForHugAction(message)) {
          playHugSound();
        } else {
          playMentionSound();
        }
      }
    }

    addMessage(msgData);
  }

  /**
   * Handle USERNOTICE (subs, raids, etc.)
   */
  function handleUserNotice(parsed) {
    const tags = parsed.tags;
    const msgId = tags['msg-id'];
    const systemMsg = tags['system-msg']?.replace(/\\s/g, ' ') || '';

    const msgData = {
      id: tags.id || Date.now().toString(),
      type: 'notice',
      noticeType: msgId,
      systemMessage: systemMsg,
      displayName: tags['display-name'] || '',
      color: tags.color || '#9147ff',
      message: parsed.params[1] || '',
      timestamp: new Date(parseInt(tags['tmi-sent-ts']) || Date.now()),
    };

    addMessage(msgData);
  }

  /**
   * Parse badges from tags
   */
  function parseBadges(badgeStr) {
    // badgeStr can be boolean 'true' if tag exists but has no value
    if (!badgeStr || typeof badgeStr !== 'string') return [];

    return badgeStr.split(',').map(badge => {
      const [name, version] = badge.split('/');
      const url = getBadgeUrl(name, version);
      return { name, version, url };
    }).filter(b => b.url);
  }

  /**
   * Parse emotes from tags
   */
  function parseEmotes(emoteStr, message) {
    // emoteStr can be boolean 'true' if tag exists but has no value
    if (!emoteStr || typeof emoteStr !== 'string') return [];

    const emotes = [];
    emoteStr.split('/').forEach(emote => {
      const [id, positions] = emote.split(':');
      if (!positions) return;

      positions.split(',').forEach(pos => {
        const [start, end] = pos.split('-').map(Number);
        emotes.push({
          id,
          start,
          end,
          text: message.substring(start, end + 1),
          url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0`,
        });
      });
    });

    return emotes.sort((a, b) => b.start - a.start);
  }

  /**
   * Get default color for username
   */
  function getDefaultColor(name) {
    const colors = [
      '#FF0000', '#0000FF', '#00FF00', '#B22222', '#FF7F50',
      '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E',
      '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  /**
   * Check if a message mentions the current user
   * Checks for:
   * - @username patterns (case-insensitive)
   * - Username appearing anywhere in the message (e.g., bot responses)
   */
  function checkForMention(message) {
    // Get the username to check for
    let targetUsername = username;
    if (!targetUsername || targetUsername.startsWith('justinfan')) {
      // Anonymous users can't be mentioned - but check config for Twitch username
      const config = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
      targetUsername = config.twitch?.username;
      if (!targetUsername) return false;
    }

    // Check for direct @mention
    const mentionPattern = new RegExp(`@${targetUsername}\\b`, 'i');
    if (mentionPattern.test(message)) return true;

    // Check for username appearing anywhere in the message (as a whole word)
    // This catches bot responses like "FappyMealTime gives X a hug"
    const usernamePattern = new RegExp(`\\b${targetUsername}\\b`, 'i');
    if (usernamePattern.test(message)) return true;

    return false;
  }

  /**
   * Check if a message is a hug/cuddle action
   * Returns true for messages like "X gives Y a hug" or "X hugs Y"
   */
  function checkForHugAction(message) {
    // Patterns for hug-related bot responses
    const hugPatterns = [
      /gives\s+\S+\s+a\s+hug/i,
      /\bhugs?\s+\S+/i,
      /\bcuddles?\s+\S+/i,
      /\bglomps?\s+\S+/i,
      /\bsnuggles?\s+\S+/i,
    ];
    return hugPatterns.some(pattern => pattern.test(message));
  }

  /**
   * Check if a message is a !kok bot response
   * Pattern: "[username]'s kok is XXX [mm/inches] long today!"
   */
  function checkForKokResponse(message) {
    // Match pattern like "FappyMealTime's kok is 11.05 inches long today!"
    // Supports both mm and inches, and decimal numbers
    return /\S+'s .+ is [\d.]+ (mm|inches) long today!/i.test(message);
  }

  // Sound effects
  let mentionAudio = null;
  let hugAudio = null;
  let kokAudio = null;
  let lastSoundTime = 0;
  const SOUND_COOLDOWN = 500; // Don't spam sounds

  /**
   * Play mention notification sound (Zelda door unlock chime)
   */
  function playMentionSound() {
    const now = Date.now();
    if (now - lastSoundTime < SOUND_COOLDOWN) return;
    lastSoundTime = now;

    try {
      // Check if mentions are muted
      const config = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
      if (config.twitch?.muteMentions) return;

      // Create audio element if not exists
      if (!mentionAudio) {
        mentionAudio = new Audio('assets/Sounds/ringtones-zelda-1.mp3');
        mentionAudio.volume = 0.5;
      }

      // Reset and play
      mentionAudio.currentTime = 0;
      mentionAudio.play().catch(e => {
        console.warn('Could not play mention sound:', e);
      });
    } catch (e) {
      console.warn('Could not play mention sound:', e);
    }
  }

  /**
   * Play hug notification sound (audience awww)
   */
  function playHugSound() {
    const now = Date.now();
    if (now - lastSoundTime < SOUND_COOLDOWN) return;
    lastSoundTime = now;

    try {
      // Check if mentions are muted
      const config = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
      if (config.twitch?.muteMentions) return;

      // Create audio element if not exists
      if (!hugAudio) {
        hugAudio = new Audio('assets/Sounds/studio-audience-awwww-sound-fx.mp3');
        hugAudio.volume = 0.5;
      }

      // Reset and play
      hugAudio.currentTime = 0;
      hugAudio.play().catch(e => {
        console.warn('Could not play hug sound:', e);
      });
    } catch (e) {
      console.warn('Could not play hug sound:', e);
    }
  }

  /**
   * Play !kok bot response sound (yamate kudesai)
   */
  function playKokSound() {
    const now = Date.now();
    if (now - lastSoundTime < SOUND_COOLDOWN) return;
    lastSoundTime = now;

    try {
      // Check if mentions are muted (reuse same setting)
      const config = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
      if (config.twitch?.muteMentions) return;

      // Create audio element if not exists
      if (!kokAudio) {
        kokAudio = new Audio('assets/Sounds/yamate-kudesai.mp3');
        kokAudio.volume = 0.5;
      }

      // Reset and play
      kokAudio.currentTime = 0;
      kokAudio.play().catch(e => {
        console.warn('Could not play kok sound:', e);
      });
    } catch (e) {
      console.warn('Could not play kok sound:', e);
    }
  }

  /**
   * Add message to list and render
   */
  function addMessage(msgData) {
    messages.push(msgData);
    if (messages.length > MAX_MESSAGES) {
      messages.shift();
    }

    if (onMessageCallback) {
      onMessageCallback(msgData);
    }

    renderMessage(msgData);
  }

  /**
   * Render system message
   */
  function renderSystemMessage(text) {
    if (!container) return;

    const chatMessages = container.querySelector('.twitch-irc-messages');
    if (!chatMessages) return;

    const div = document.createElement('div');
    div.className = 'twitch-irc-system';
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  /**
   * Clear all system messages from the chat
   */
  function clearSystemMessages() {
    if (!container) return;
    const chatMessages = container.querySelector('.twitch-irc-messages');
    if (!chatMessages) return;
    chatMessages.querySelectorAll('.twitch-irc-system').forEach(el => el.remove());
  }

  /**
   * Render a chat message
   */
  function renderMessage(msg) {
    if (!container) return;

    const chatMessages = container.querySelector('.twitch-irc-messages');
    if (!chatMessages) return;

    const div = document.createElement('div');
    // Build class list based on message properties
    const classes = ['twitch-irc-msg'];
    if (msg.type === 'notice') classes.push('twitch-irc-notice');
    if (msg.isSelf) classes.push('twitch-irc-self');
    if (msg.isMention) classes.push('twitch-irc-mention');
    if (msg.isHistorical) classes.push('twitch-irc-historical');
    div.className = classes.join(' ');
    div.dataset.msgId = msg.id;

    if (msg.type === 'notice') {
      // Subscription/raid notice
      div.innerHTML = `
        <span class="twitch-irc-notice-text">${escapeHtml(msg.systemMessage)}</span>
        ${msg.message ? `<span class="twitch-irc-notice-msg">${escapeHtml(msg.message)}</span>` : ''}
      `;
    } else {
      // Regular chat message
      const time = msg.timestamp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?(AM|PM)/i, '');
      const messageHtml = formatMessageWithEmotes(msg.message, msg.emotes);

      // Store displayName for reply handler
      div.dataset.username = msg.displayName;

      div.innerHTML = `
        <span class="twitch-irc-time">${time}</span>
        <span class="twitch-irc-name" style="color: ${msg.color}">${escapeHtml(msg.displayName)}</span><span class="twitch-irc-colon">${msg.isAction ? '' : ':'}</span>
        <span class="twitch-irc-text ${msg.isAction ? 'twitch-irc-action' : ''}" ${msg.isAction ? `style="color: ${msg.color}"` : ''}>${messageHtml}</span>
        <button class="twitch-irc-reply-btn" title="Reply to ${escapeHtml(msg.displayName)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 10h10a5 5 0 0 1 5 5v6M3 10l6-6M3 10l6 6"/>
          </svg>
        </button>
      `;
    }

    // Check if near bottom BEFORE appending (so tall messages don't break the check)
    const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;

    chatMessages.appendChild(div);

    // Auto-scroll if we were near bottom before the new message
    if (isNearBottom) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Remove old messages from DOM
    while (chatMessages.children.length > MAX_MESSAGES) {
      chatMessages.removeChild(chatMessages.firstChild);
    }
  }

  /**
   * Format message with emotes (Twitch native + third-party)
   */
  function formatMessageWithEmotes(message, twitchEmotes) {
    // First, collect all emote matches with their positions
    const emoteMatches = []; // { start, end, html }

    // Add Twitch native emotes (they have exact position data from IRC tags)
    if (twitchEmotes && twitchEmotes.length > 0) {
      for (const emote of twitchEmotes) {
        const emoteHtml = `<img class="twitch-irc-emote" src="${emote.url}" alt="${emote.text}" title="${emote.text}">`;
        emoteMatches.push({ start: emote.start, end: emote.end, html: emoteHtml });
      }
    }

    // Find third-party emotes by scanning the message
    if (emotesLoaded && Object.keys(thirdPartyEmotes).length > 0) {
      // Sort emote codes by length descending to match longer codes first
      const emoteCodes = Object.keys(thirdPartyEmotes).sort((a, b) => b.length - a.length);

      // Helper to check if character is a word boundary (non-alphanumeric)
      // Special cases: apostrophe and hyphen are NOT boundaries if part of a word
      // e.g., "you're" - apostrophe between letters is not a boundary
      // e.g., "re-watched" - hyphen between letters is not a boundary
      const isWordBoundary = (char, prevChar = null) => {
        if (!char) return true; // Start/end of string
        if (/[a-zA-Z0-9_]/.test(char)) return false; // Alphanumeric is not a boundary

        // Special case: apostrophe in a contraction (you're, they're, we're, etc.)
        // If the char is an apostrophe AND there's a letter before it, it's part of a word
        if ((char === "'" || char === "'") && prevChar && /[a-zA-Z]/.test(prevChar)) {
          return false; // Part of a contraction, not a boundary
        }

        // Special case: hyphen in a compound word (re-watched, self-aware, etc.)
        // If the char is a hyphen AND there's a letter before it, it's part of a word
        if (char === '-' && prevChar && /[a-zA-Z]/.test(prevChar)) {
          return false; // Part of a hyphenated word, not a boundary
        }

        return true; // Everything else is a boundary
      };

      // Scan through the message looking for emotes
      let pos = 0;
      while (pos < message.length) {
        // Check if any emote starts at this position
        let foundEmote = null;
        let repeatCount = 0;

        for (const code of emoteCodes) {
          if (message.substring(pos, pos + code.length) === code) {
            // Check this position isn't already covered by a Twitch emote
            const overlaps = emoteMatches.some(m =>
              (pos >= m.start && pos <= m.end) || (pos + code.length - 1 >= m.start && pos + code.length - 1 <= m.end)
            );
            if (overlaps) continue;

            // Count consecutive repetitions of this emote (e.g., "nutnutnut")
            repeatCount = 1;
            let checkPos = pos + code.length;
            while (message.substring(checkPos, checkPos + code.length) === code) {
              repeatCount++;
              checkPos += code.length;
            }

            // Check for word boundaries around the ENTIRE emote sequence
            const charBefore = pos > 0 ? message[pos - 1] : null;
            const charBeforeThat = pos > 1 ? message[pos - 2] : null; // For contraction detection
            const totalEmoteLength = code.length * repeatCount;
            const charAfter = message[pos + totalEmoteLength] || null;
            // Pass charBeforeThat to detect contractions like "you're" where ' is not a boundary
            const atWordBoundary = isWordBoundary(charBefore, charBeforeThat) && isWordBoundary(charAfter);

            // Must be at word boundary - repeated emotes just get all rendered
            if (atWordBoundary) {
              foundEmote = code;
              break;
            }
          }
        }

        if (foundEmote) {
          const emoteData = thirdPartyEmotes[foundEmote];
          // If repeated 2+ times, render all repetitions as emotes
          const totalLength = foundEmote.length * repeatCount;
          for (let i = 0; i < repeatCount; i++) {
            const emotePos = pos + (i * foundEmote.length);
            const emoteHtml = `<img class="twitch-irc-emote twitch-irc-emote-${emoteData.provider}" src="${emoteData.url}" alt="${foundEmote}" title="${foundEmote} (${emoteData.provider})">`;
            emoteMatches.push({ start: emotePos, end: emotePos + foundEmote.length - 1, html: emoteHtml });
          }
          pos += totalLength;
        } else {
          pos++;
        }
      }
    }

    // Sort matches by start position
    emoteMatches.sort((a, b) => a.start - b.start);

    // Build the result by combining text segments and emotes
    let result = '';
    let lastEnd = 0;

    for (const match of emoteMatches) {
      // Add escaped text before this emote
      if (match.start > lastEnd) {
        result += escapeHtml(message.substring(lastEnd, match.start));
      }
      // Add the emote
      result += match.html;
      lastEnd = match.end + 1;
    }

    // Add any remaining text after the last emote
    if (lastEnd < message.length) {
      result += escapeHtml(message.substring(lastEnd));
    }

    // Handle case where no emotes were found
    if (emoteMatches.length === 0) {
      result = escapeHtml(message);
    }

    return result;
  }

  /**
   * Escape HTML
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Handle WebSocket close
   */
  function handleClose(event, closedConnectionId) {
    const isStale = closedConnectionId !== connectionId;
    console.log('TwitchChat: WebSocket closed', event.code, isStale ? '(stale connection, ignoring)' : '');

    // Ignore close events from old/stale connections
    if (isStale) {
      return;
    }

    isConnected = false;

    // Only reconnect if we still have a channel
    if (channel) {
      const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)];
      reconnectAttempts++;
      renderSystemMessage(`Disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`);
      reconnectTimeout = setTimeout(() => {
        // Double-check connectionId hasn't changed during the timeout
        if (channel && closedConnectionId === connectionId) {
          connect(channel, { container, onMessage: onMessageCallback, oauthToken, username });
        }
      }, delay);
    }
  }

  /**
   * Handle WebSocket error
   */
  function handleError(error) {
    console.error('TwitchChat: WebSocket error', error);
  }

  /**
   * Clear chat messages
   */
  function clear() {
    messages = [];
    if (container) {
      const chatMessages = container.querySelector('.twitch-irc-messages');
      if (chatMessages) {
        chatMessages.innerHTML = '';
      }
    }
  }

  /**
   * Check if connected
   */
  function getIsConnected() {
    return isConnected;
  }

  /**
   * Get current channel
   */
  function getChannel() {
    return channel;
  }

  /**
   * Get chat participants (users who have sent messages)
   * Returns array of display names sorted alphabetically
   * Excludes the current logged-in user (no point @mentioning yourself)
   */
  function getParticipants() {
    const currentUserLower = displayName?.toLowerCase();
    return Array.from(chatParticipants.values())
      .filter(name => name.toLowerCase() !== currentUserLower)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  // Public API
  return {
    connect,
    disconnect,
    sendMessage,
    clear,
    isConnected: getIsConnected,
    getChannel,
    getEmotes,
    getEmotesByProvider,
    searchEmotes,         // Returns only channel-available emotes
    searchEmotesLocal,    // Sync version - local cache only
    getParticipants,
    loadEmotes: loadThirdPartyEmotes,
  };
})();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TwitchChat;
}
