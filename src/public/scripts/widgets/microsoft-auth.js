/* ================================================================
   MICROSOFT GRAPH API AUTHENTICATION MODULE
   Handles OAuth 2.0 flow using MSAL.js for calendar and email access
   Uses external browser for Tauri compatibility
   Supports multiple accounts (HC = Havens Consulting, AE = Analytic Endeavors)
   Copyright (c) 2024-2025 Havens Consulting Inc. All Rights Reserved.
   Fingerprint: AE-WWD-8B4F2C1E-2025
   ================================================================ */

const MicrosoftAuth = (function() {
  // Azure AD App Configuration
  const HC_CLIENT_ID = 'd0a49c82-433a-4df1-92b5-b25fdfab767d'; // Havens Consulting
  const AUTHORITY = 'https://login.microsoftonline.com/common';
  // Use HTTP for OAuth callback server (allowed for localhost per RFC 8252)
  // Production builds use HTTP callback server; dev mode uses HTTPS dev server
  const REDIRECT_URI = 'http://localhost:8420';
  const REDIRECT_URI_CALLBACK = 'http://localhost:8420/auth-callback.html';

  // Scopes needed for calendar, email, and category colors
  // offline_access is required for refresh tokens to persist sessions across reboots
  const SCOPES = ['User.Read', 'Calendars.Read', 'Mail.Read', 'MailboxSettings.Read', 'offline_access'];

  // Account types
  const ACCOUNT_TYPES = {
    HC: 'hc',
    AE: 'ae'
  };

  // Multi-account state
  let accounts = {
    hc: { msalInstance: null, account: null, tokenData: null },
    ae: { msalInstance: null, account: null, tokenData: null }
  };

  let isInitialized = false;
  let initPromise = null;
  let pendingPKCE = null; // Store PKCE for Tauri flow
  let pendingAccountType = null; // Track which account is being authenticated
  let tokenRefreshTimers = {}; // Proactive refresh timers per account

  // Errors that indicate the refresh token is permanently invalid (don't retry)
  const PERMANENT_REFRESH_ERRORS = ['invalid_grant', 'interaction_required', 'consent_required', 'invalid_client'];

  // Max retries for transient refresh failures (network errors, 5xx, etc.)
  const MAX_REFRESH_RETRIES = 3;
  const REFRESH_RETRY_DELAYS = [2000, 5000, 15000]; // ms between retries
  // Refresh access token 5 minutes before expiry
  const PROACTIVE_REFRESH_BUFFER = 5 * 60 * 1000;

  // Legacy compatibility - points to HC account by default
  let currentAccount = null;
  let msalInstance = null;

  // ---- Persistent token storage via Tauri filesystem ----
  // WebView2 localStorage can be wiped across reboots. These helpers
  // mirror token data to %APPDATA%/Widget Wall/config/ via Tauri commands.
  // All existing code keeps using sync localStorage reads; we just:
  //  1) Rehydrate localStorage from file on startup (before any reads)
  //  2) Fire-and-forget file writes alongside localStorage writes

  /**
   * On startup, load tokens from Tauri file storage into localStorage
   * so all existing sync reads work immediately.
   */
  async function rehydrateTokensFromFile() {
    if (!isTauri()) return;
    const { invoke } = window.__TAURI__.core;
    for (const type of [ACCOUNT_TYPES.HC, ACCOUNT_TYPES.AE]) {
      try {
        const value = await invoke('load_widget_config', { key: `msal_token_${type}` });
        if (value && value !== '{}') {
          const storageKey = getTokenStorageKey(type);
          if (!localStorage.getItem(storageKey)) {
            localStorage.setItem(storageKey, value);
            console.log(`MicrosoftAuth: Rehydrated ${type.toUpperCase()} token from file storage`);
          }
        }
      } catch (e) {
        console.warn(`MicrosoftAuth: Failed to rehydrate token for ${type}:`, e);
      }
    }
  }

  /**
   * Fire-and-forget: mirror current localStorage token data to file.
   * Call after every localStorage.setItem for token data.
   */
  function persistTokenToFile(accountType) {
    if (!isTauri()) return;
    const data = localStorage.getItem(getTokenStorageKey(accountType));
    if (!data) return;
    window.__TAURI__.core.invoke('save_widget_config', {
      key: `msal_token_${accountType}`, value: data
    }).catch(e => console.warn(`MicrosoftAuth: File persist failed for ${accountType}:`, e));
  }

  /**
   * Fire-and-forget: clear the file-based token.
   * Call after every localStorage.removeItem for token data.
   */
  function clearTokenFile(accountType) {
    if (!isTauri()) return;
    window.__TAURI__.core.invoke('save_widget_config', {
      key: `msal_token_${accountType}`, value: '{}'
    }).catch(e => console.warn(`MicrosoftAuth: File clear failed for ${accountType}:`, e));
  }

  /**
   * Get Client ID for account type
   */
  function getClientId(accountType = ACCOUNT_TYPES.HC) {
    const config = JSON.parse(localStorage.getItem('dashboard-config') || '{}');
    if (accountType === ACCOUNT_TYPES.AE) {
      // AE client ID is stored in dashboard config
      return config.aeClientId || null;
    }
    // HC client ID - use config value if set, otherwise fall back to default
    return config.hcClientId || HC_CLIENT_ID;
  }

  /**
   * Get token storage key for account type
   */
  function getTokenStorageKey(accountType = ACCOUNT_TYPES.HC) {
    return `msal_token_data_${accountType}`;
  }

  /**
   * Check if running in Tauri
   */
  function isTauri() {
    return typeof window.__TAURI__ !== 'undefined';
  }

  /**
   * Initialize MSAL instance
   */
  async function initialize() {
    if (initPromise) {
      return initPromise;
    }
    initPromise = _doInitialize();
    return initPromise;
  }

  async function _doInitialize() {
    if (typeof msal === 'undefined') {
      console.error('MicrosoftAuth: MSAL library not loaded');
      return false;
    }

    console.log('MicrosoftAuth: Initializing...', isTauri() ? '(Tauri detected)' : '(Browser)');

    // Rehydrate tokens from file storage into localStorage before any reads
    await rehydrateTokensFromFile();

    // Initialize HC account (always available)
    await initializeAccount(ACCOUNT_TYPES.HC);

    // Initialize AE account if client ID is configured
    const aeClientId = getClientId(ACCOUNT_TYPES.AE);
    if (aeClientId) {
      await initializeAccount(ACCOUNT_TYPES.AE);
    }

    // Legacy compatibility - use HC as default
    msalInstance = accounts.hc.msalInstance;
    currentAccount = accounts.hc.account;

    isInitialized = true;

    // On wake from sleep / tab refocus: re-arm refresh timers and eagerly
    // refresh any token that's expired or within the 5-min buffer.
    // setTimeout doesn't run while the machine is asleep, so the previously
    // scheduled refresh can be well past due after a long sleep.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      for (const accountType of Object.values(ACCOUNT_TYPES)) {
        if (!accounts[accountType]?.account) continue;
        refreshIfStale(accountType);
        scheduleTokenRefresh(accountType);
      }
    });

    return true;
  }

  /**
   * Refresh the access token immediately if it's expired or within the
   * proactive refresh buffer. No-op otherwise.
   */
  async function refreshIfStale(accountType) {
    const storageKey = getTokenStorageKey(accountType);
    const stored = localStorage.getItem(storageKey);
    if (!stored) return;
    try {
      const tokenData = JSON.parse(stored);
      if (!tokenData.refreshToken) return;
      if (tokenData.expiresOn > Date.now() + PROACTIVE_REFRESH_BUFFER) return;
      await refreshAccessTokenWithRetry(tokenData.refreshToken, accountType);
    } catch (e) {
      console.warn(`MicrosoftAuth: refreshIfStale failed for ${accountType}:`, e);
    }
  }

  /**
   * Initialize a specific account type
   */
  async function initializeAccount(accountType) {
    const clientId = getClientId(accountType);
    if (!clientId) {
      console.log(`MicrosoftAuth: No client ID for ${accountType}, skipping`);
      return false;
    }

    console.log(`MicrosoftAuth: Initializing ${accountType.toUpperCase()} account...`);

    const msalConfig = {
      auth: {
        clientId: clientId,
        authority: AUTHORITY,
        redirectUri: REDIRECT_URI,
        postLogoutRedirectUri: REDIRECT_URI,
        navigateToLoginRequestUrl: true
      },
      cache: {
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: false
      },
      system: {
        loggerOptions: {
          logLevel: msal.LogLevel.Warning,
          loggerCallback: (level, message, containsPii) => {
            if (!containsPii) {
              console.log(`MSAL[${accountType}]:`, message);
            }
          }
        }
      }
    };

    try {
      const instance = new msal.PublicClientApplication(msalConfig);
      await instance.initialize();
      accounts[accountType].msalInstance = instance;
      console.log(`MicrosoftAuth: MSAL initialized for ${accountType.toUpperCase()}`);

      // Handle redirect response (if returning from login via browser)
      try {
        const response = await instance.handleRedirectPromise();
        if (response) {
          handleResponse(response, accountType);
        }
      } catch (error) {
        console.error(`MicrosoftAuth: Redirect handling error for ${accountType}:`, error);
      }

      // Restore account from stored token
      await restoreAccountFromToken(accountType);

      // Fall back to check MSAL cached accounts (for browser flow)
      if (!accounts[accountType].account) {
        const cachedAccounts = instance.getAllAccounts();
        console.log(`MicrosoftAuth: Found ${cachedAccounts.length} MSAL cached accounts for ${accountType.toUpperCase()}`);

        if (cachedAccounts.length > 0) {
          accounts[accountType].account = cachedAccounts[0];
          console.log(`MicrosoftAuth: Using MSAL account for ${accountType}:`, accounts[accountType].account.username);
          dispatchAuthEvent(true, accountType);
        }
      }

      return true;
    } catch (error) {
      console.error(`MicrosoftAuth: Initialization failed for ${accountType}:`, error);
      return false;
    }
  }

  /**
   * Restore account from stored token data
   * Designed to be resilient: never clears refresh tokens on transient failures
   */
  async function restoreAccountFromToken(accountType) {
    const storageKey = getTokenStorageKey(accountType);
    const storedTokenData = localStorage.getItem(storageKey);

    if (!storedTokenData) return false;

    try {
      const tokenData = JSON.parse(storedTokenData);
      let activeAccessToken = tokenData.accessToken;
      let tokenWasRefreshed = false;

      // Check if token is expired - if so, try to refresh it first
      if (!tokenData.accessToken || tokenData.expiresOn <= Date.now()) {
        console.log(`MicrosoftAuth: Stored access token expired for ${accountType}, attempting refresh...`);

        // Try to refresh using stored refresh token
        if (tokenData.refreshToken) {
          const newAccessToken = await refreshAccessTokenWithRetry(tokenData.refreshToken, accountType);
          if (newAccessToken) {
            console.log(`MicrosoftAuth: Successfully refreshed token for ${accountType}`);
            activeAccessToken = newAccessToken;
            tokenWasRefreshed = true;
            // Re-read the updated token data after refresh
            const refreshedData = localStorage.getItem(storageKey);
            if (refreshedData) {
              const updatedTokenData = JSON.parse(refreshedData);
              accounts[accountType].tokenData = updatedTokenData;
            }
          } else {
            // Refresh failed - check if refresh token was permanently revoked
            // If localStorage was cleared by refreshAccessToken (permanent error), we're done
            const stillStored = localStorage.getItem(storageKey);
            if (!stillStored) {
              console.log(`MicrosoftAuth: Refresh token permanently revoked for ${accountType}`);
              return false;
            }
            // Transient failure - still restore account from stored data so UI shows logged in
            // The next getAccessToken() call will retry the refresh
            console.log(`MicrosoftAuth: Transient refresh failure for ${accountType}, restoring account from cache`);
            activeAccessToken = null; // Mark as needing refresh but keep account alive
          }
        } else {
          console.log(`MicrosoftAuth: No refresh token available for ${accountType}, clearing...`);
          localStorage.removeItem(storageKey);
          clearTokenFile(accountType);
          return false;
        }
      }

      // Restore account info from stored ID token (works even without a valid access token)
      let username = null;
      let name = null;
      let localAccountId = null;
      let tenantId = null;
      let idTokenClaims = null;

      // Try to decode ID token (use fresh data if we refreshed)
      const currentTokenData = tokenWasRefreshed
        ? JSON.parse(localStorage.getItem(storageKey) || '{}')
        : tokenData;

      if (currentTokenData.idToken) {
        try {
          const payload = JSON.parse(atob(currentTokenData.idToken.split('.')[1]));
          username = payload.preferred_username || payload.email || payload.name || payload.upn;
          name = payload.name;
          localAccountId = payload.oid || payload.sub;
          tenantId = payload.tid;
          idTokenClaims = payload;
        } catch (e) {
          console.log(`MicrosoftAuth: Could not decode stored ID token for ${accountType}`);
        }
      }

      // If no username from ID token, try /me endpoint only if we have a valid access token
      if (!username && activeAccessToken) {
        try {
          const meResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: {
              'Authorization': `Bearer ${activeAccessToken}`,
              'Content-Type': 'application/json'
            }
          });
          if (meResponse.ok) {
            const meData = await meResponse.json();
            username = meData.userPrincipalName || meData.mail || meData.displayName;
            name = meData.displayName || name;
            localAccountId = meData.id || localAccountId;
          }
        } catch (e) {
          console.log(`MicrosoftAuth: Could not fetch /me during restore for ${accountType}`);
        }
      }

      // Set account with fallback
      accounts[accountType].account = {
        username: username || 'Microsoft User',
        name: name || username || 'Microsoft User',
        localAccountId: localAccountId,
        tenantId: tenantId,
        idTokenClaims: idTokenClaims
      };
      if (!tokenWasRefreshed) {
        accounts[accountType].tokenData = tokenData;
      }

      // Schedule proactive token refresh
      scheduleTokenRefresh(accountType);

      console.log(`MicrosoftAuth: Restored ${accountType.toUpperCase()} account from stored token:`, accounts[accountType].account.username);
      dispatchAuthEvent(true, accountType);
      return true;
    } catch (e) {
      console.error(`MicrosoftAuth: Error restoring from stored token for ${accountType}:`, e);
      // Don't clear tokens on parse/unexpected errors - leave them for next attempt
    }
    return false;
  }

  /**
   * Handle auth code from URL (for external browser flow)
   */
  async function handleAuthCodeFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code && msalInstance) {
      console.log('MicrosoftAuth: Found auth code in URL, exchanging for token...');
      try {
        // Get the cached code verifier for PKCE
        const codeVerifier = sessionStorage.getItem('msal_code_verifier');

        if (codeVerifier) {
          const tokenResponse = await msalInstance.acquireTokenByCode({
            code: code,
            scopes: SCOPES,
            redirectUri: REDIRECT_URI,
            codeVerifier: codeVerifier
          });

          if (tokenResponse) {
            handleResponse(tokenResponse);
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
            sessionStorage.removeItem('msal_code_verifier');
          }
        }
      } catch (error) {
        console.error('MicrosoftAuth: Token exchange failed:', error);
      }
    }
  }

  function handleResponse(response, accountType = ACCOUNT_TYPES.HC) {
    if (response) {
      accounts[accountType].account = response.account;
      console.log(`MicrosoftAuth: Login successful for ${accountType.toUpperCase()}:`, response.account.username);

      // Legacy compatibility
      if (accountType === ACCOUNT_TYPES.HC) {
        currentAccount = response.account;
      }

      dispatchAuthEvent(true, accountType);
    }
  }

  function dispatchAuthEvent(isAuthenticated, accountType = ACCOUNT_TYPES.HC) {
    const account = accounts[accountType]?.account;

    // Dispatch account-specific event
    window.dispatchEvent(new CustomEvent('microsoft-auth-change', {
      detail: {
        isAuthenticated,
        account: account,
        accountType: accountType
      }
    }));

    // Legacy compatibility - also update currentAccount for HC
    if (accountType === ACCOUNT_TYPES.HC) {
      currentAccount = isAuthenticated ? account : null;
    }
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  function generatePKCE() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const verifier = btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      .then(hash => {
        const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');
        return { verifier, challenge };
      });
  }

  /**
   * Sign in - opens external browser for Tauri, uses redirect for browser
   * @param {string} accountType - 'hc' or 'ae'
   */
  async function signIn(accountType = ACCOUNT_TYPES.HC) {
    if (!isInitialized) {
      await initialize();
    }

    const clientId = getClientId(accountType);
    if (!clientId) {
      throw new Error(`No client ID configured for ${accountType.toUpperCase()}. Please add it in Settings.`);
    }

    // Ensure MSAL instance exists for this account
    if (!accounts[accountType].msalInstance) {
      await initializeAccount(accountType);
    }

    const instance = accounts[accountType].msalInstance;
    if (!instance) {
      throw new Error(`MSAL not initialized for ${accountType.toUpperCase()}`);
    }

    console.log(`MicrosoftAuth: Starting sign-in for ${accountType.toUpperCase()}...`);

    if (isTauri()) {
      // For Tauri: Start OAuth callback server, then open login URL in system browser
      try {
        console.log('MicrosoftAuth: Tauri detected, checking shell API...');

        // Verify shell API is available
        if (!window.__TAURI__?.opener?.openUrl) {
          throw new Error('Tauri opener.openUrl API not available. Check tauri.conf.json permissions.');
        }

        // Start the OAuth callback server to catch the redirect
        console.log('MicrosoftAuth: Starting OAuth callback server...');
        try {
          const { invoke } = window.__TAURI__.core;
          const serverResult = await invoke('start_oauth_server');
          console.log('MicrosoftAuth: OAuth server:', serverResult);
        } catch (serverError) {
          console.warn('MicrosoftAuth: Could not start OAuth server:', serverError);
          // Continue anyway - user can still manually copy the code
        }

        // Generate PKCE and store it
        const pkce = await generatePKCE();
        pendingPKCE = pkce;
        pendingAccountType = accountType;
        localStorage.setItem('msal_pkce_verifier', pkce.verifier);
        localStorage.setItem('msal_pending_account_type', accountType);

        // Build auth URL manually - redirect to callback page
        const authUrl = new URL(`${AUTHORITY}/oauth2/v2.0/authorize`);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', REDIRECT_URI_CALLBACK);
        authUrl.searchParams.set('scope', SCOPES.join(' '));
        authUrl.searchParams.set('response_mode', 'query');
        authUrl.searchParams.set('prompt', 'select_account');
        authUrl.searchParams.set('code_challenge', pkce.challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        // Generate and store state for security
        const state = crypto.randomUUID();
        localStorage.setItem('msal_state', state);
        authUrl.searchParams.set('state', state);

        const finalUrl = authUrl.toString();
        console.log(`MicrosoftAuth: Opening browser for ${accountType.toUpperCase()} login...`);
        console.log(`MicrosoftAuth: Auth request params:`, {
          client_id: clientId,
          redirect_uri: REDIRECT_URI_CALLBACK,
          challenge_length: pkce.challenge.length,
          verifier_length: pkce.verifier.length
        });

        // Call the Tauri shell open API
        await window.__TAURI__.opener.openUrl(finalUrl);
        console.log('MicrosoftAuth: Browser open command sent');

        // Return a flag indicating we're waiting for manual code entry
        return { pendingCode: true, accountType };

      } catch (error) {
        console.error('MicrosoftAuth: Failed to open browser:', error);
        // Stop OAuth server if it was started
        try {
          const { invoke } = window.__TAURI__.core;
          await invoke('stop_oauth_server');
        } catch (e) { /* ignore */ }
        throw error;
      }
    } else {
      // For browser: use redirect flow
      try {
        await instance.loginRedirect({
          scopes: SCOPES,
          prompt: 'select_account'
        });
      } catch (error) {
        console.error('MicrosoftAuth: Login redirect failed:', error);
        throw error;
      }
    }
  }

  /**
   * Complete sign-in with authorization code (for Tauri flow)
   * Uses direct POST to token endpoint instead of MSAL (MSAL doesn't handle manual code entry well)
   * @param {string} code - The authorization code from the browser callback
   * @param {string} accountType - Optional account type override (defaults to pending type)
   */
  async function completeSignIn(code, accountType = null) {
    if (!isInitialized) {
      await initialize();
    }

    // Get account type from parameter, memory, or localStorage
    const targetAccountType = accountType || pendingAccountType || localStorage.getItem('msal_pending_account_type') || ACCOUNT_TYPES.HC;
    const clientId = getClientId(targetAccountType);

    if (!clientId) {
      throw new Error(`No client ID configured for ${targetAccountType.toUpperCase()}`);
    }

    console.log(`MicrosoftAuth: Completing sign-in for ${targetAccountType.toUpperCase()} with auth code...`);

    // Get the stored PKCE verifier
    const codeVerifier = pendingPKCE?.verifier || localStorage.getItem('msal_pkce_verifier');

    if (!codeVerifier) {
      throw new Error('No PKCE verifier found. Please start sign-in again.');
    }

    try {
      // Exchange the code for tokens via direct POST to token endpoint
      const tokenEndpoint = `${AUTHORITY}/oauth2/v2.0/token`;

      const params = new URLSearchParams();
      params.append('client_id', clientId);
      params.append('grant_type', 'authorization_code');
      params.append('code', code.trim());
      params.append('redirect_uri', REDIRECT_URI_CALLBACK);
      params.append('code_verifier', codeVerifier);
      params.append('scope', SCOPES.join(' '));

      console.log(`MicrosoftAuth: Exchanging code for ${targetAccountType.toUpperCase()} at token endpoint`);
      console.log(`MicrosoftAuth: Token request params:`, {
        client_id: clientId,
        redirect_uri: REDIRECT_URI_CALLBACK,
        code_length: code.trim().length,
        verifier_length: codeVerifier?.length
      });

      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('MicrosoftAuth: Token endpoint error:', data);
        throw new Error(data.error_description || data.error || 'Token exchange failed');
      }

      console.log(`MicrosoftAuth: Token received for ${targetAccountType.toUpperCase()}`);

      // Store tokens in localStorage
      const tokenData = {
        accessToken: data.access_token,
        idToken: data.id_token,
        refreshToken: data.refresh_token,
        expiresOn: Date.now() + (data.expires_in * 1000),
        refreshTokenIssuedAt: Date.now(),
        scopes: SCOPES
      };
      const storageKey = getTokenStorageKey(targetAccountType);
      localStorage.setItem(storageKey, JSON.stringify(tokenData));
      persistTokenToFile(targetAccountType);

      // Try to decode the ID token to get user info
      let username = null;
      let name = null;
      let localAccountId = null;
      let tenantId = null;
      let idTokenClaims = null;

      const idToken = data.id_token;
      if (idToken) {
        try {
          const payload = JSON.parse(atob(idToken.split('.')[1]));
          username = payload.preferred_username || payload.email || payload.name || payload.upn;
          name = payload.name;
          localAccountId = payload.oid || payload.sub;
          tenantId = payload.tid;
          idTokenClaims = payload;
        } catch (e) {
          console.error('MicrosoftAuth: Failed to decode ID token:', e);
        }
      }

      // If we couldn't get username from ID token, fetch from Graph API /me endpoint
      if (!username && data.access_token) {
        try {
          const meResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: {
              'Authorization': `Bearer ${data.access_token}`,
              'Content-Type': 'application/json'
            }
          });
          if (meResponse.ok) {
            const meData = await meResponse.json();
            username = meData.userPrincipalName || meData.mail || meData.displayName;
            name = meData.displayName || name;
            localAccountId = meData.id || localAccountId;
          }
        } catch (e) {
          console.error('MicrosoftAuth: Failed to fetch /me:', e);
        }
      }

      // Set account for this type
      const accountObj = {
        username: username || 'Microsoft User',
        name: name || username || 'Microsoft User',
        localAccountId: localAccountId,
        tenantId: tenantId,
        idTokenClaims: idTokenClaims
      };

      accounts[targetAccountType].account = accountObj;
      accounts[targetAccountType].tokenData = tokenData;

      // Legacy compatibility
      if (targetAccountType === ACCOUNT_TYPES.HC) {
        currentAccount = accountObj;
      }

      // Clean up PKCE state
      localStorage.removeItem('msal_pkce_verifier');
      localStorage.removeItem('msal_state');
      localStorage.removeItem('msal_pending_account_type');
      pendingPKCE = null;
      pendingAccountType = null;

      // Stop OAuth callback server if running
      if (isTauri()) {
        try {
          const { invoke } = window.__TAURI__.core;
          await invoke('stop_oauth_server');
        } catch (e) { /* ignore */ }
      }

      // Schedule proactive token refresh
      scheduleTokenRefresh(targetAccountType);

      console.log(`MicrosoftAuth: Sign-in completed for ${targetAccountType.toUpperCase()}!`, accountObj.username);
      dispatchAuthEvent(true, targetAccountType);
      return true;

    } catch (error) {
      console.error('MicrosoftAuth: Token exchange failed:', error);
      // Clean up on error too
      localStorage.removeItem('msal_pkce_verifier');
      localStorage.removeItem('msal_state');
      localStorage.removeItem('msal_pending_account_type');
      pendingPKCE = null;
      pendingAccountType = null;
      // Stop OAuth callback server if running
      if (isTauri()) {
        try {
          const { invoke } = window.__TAURI__.core;
          await invoke('stop_oauth_server');
        } catch (e) { /* ignore */ }
      }
      throw error;
    }
  }

  /**
   * Check if there's a pending sign-in waiting for code entry
   */
  function hasPendingSignIn() {
    return !!(pendingPKCE || localStorage.getItem('msal_pkce_verifier'));
  }

  /**
   * Cancel a pending sign-in (clear PKCE state and stop OAuth server)
   */
  async function cancelPendingSignIn() {
    console.log('MicrosoftAuth: Cancelling pending sign-in...');

    // Clear PKCE state
    localStorage.removeItem('msal_pkce_verifier');
    localStorage.removeItem('msal_state');
    localStorage.removeItem('msal_pending_account_type');
    pendingPKCE = null;
    pendingAccountType = null;

    // Stop OAuth callback server if running
    if (isTauri()) {
      try {
        const { invoke } = window.__TAURI__.core;
        await invoke('stop_oauth_server');
      } catch (e) { /* ignore */ }
    }

    console.log('MicrosoftAuth: Pending sign-in cancelled');
  }

  /**
   * Sign out
   * @param {string} accountType - 'hc' or 'ae' (defaults to HC)
   */
  async function signOut(accountType = ACCOUNT_TYPES.HC) {
    console.log(`MicrosoftAuth: Signing out ${accountType.toUpperCase()}...`);

    const accountToLogout = accounts[accountType]?.account;
    const instance = accounts[accountType]?.msalInstance;

    // Clear account state
    if (accounts[accountType]) {
      accounts[accountType].account = null;
      accounts[accountType].tokenData = null;
    }

    // Clear custom token storage for this account
    const storageKey = getTokenStorageKey(accountType);
    localStorage.removeItem(storageKey);
    clearTokenFile(accountType);

    // Legacy compatibility
    if (accountType === ACCOUNT_TYPES.HC) {
      currentAccount = null;
      localStorage.removeItem('msal_pkce_verifier');
      localStorage.removeItem('msal_state');
      localStorage.removeItem('msal_pending_account_type');
      pendingPKCE = null;
      pendingAccountType = null;
    }

    dispatchAuthEvent(false, accountType);

    // Clear MSAL cache if available
    if (instance) {
      try {
        await instance.clearCache();
      } catch (e) {
        // Ignore errors during cache clear
      }

      // For Tauri, just clear local state (don't redirect)
      if (!isTauri() && accountToLogout) {
        try {
          await instance.logoutRedirect({
            account: accountToLogout,
            postLogoutRedirectUri: REDIRECT_URI
          });
        } catch (error) {
          console.error('MicrosoftAuth: Logout redirect failed:', error);
        }
      }
    }
  }

  /**
   * Get access token silently
   * @param {string} accountType - 'hc' or 'ae' (defaults to HC)
   */
  async function getAccessToken(accountType = ACCOUNT_TYPES.HC) {
    if (!isInitialized) {
      await initialize();
    }

    const account = accounts[accountType]?.account;
    if (!account) {
      return null;
    }

    // First, check our manually stored token data (from Tauri flow)
    const storageKey = getTokenStorageKey(accountType);
    const storedTokenData = localStorage.getItem(storageKey);
    if (storedTokenData) {
      try {
        const tokenData = JSON.parse(storedTokenData);
        // Check if token is still valid (with 5 min buffer)
        if (tokenData.accessToken && tokenData.expiresOn > Date.now() + 300000) {
          return tokenData.accessToken;
        }
        // Token expired or expiring soon - try to refresh with retry
        if (tokenData.refreshToken) {
          const newToken = await refreshAccessTokenWithRetry(tokenData.refreshToken, accountType);
          if (newToken) {
            return newToken;
          }
          // If refresh failed but token hasn't fully expired yet, use it anyway
          // (better to try with a slightly stale token than fail entirely)
          if (tokenData.accessToken && tokenData.expiresOn > Date.now()) {
            console.log(`MicrosoftAuth: Using not-yet-expired token despite refresh failure for ${accountType}`);
            return tokenData.accessToken;
          }
        }
      } catch (e) {
        console.error(`MicrosoftAuth: Error reading stored token for ${accountType}:`, e);
      }
    }

    // Fall back to MSAL for browser flow
    const instance = accounts[accountType]?.msalInstance;
    if (instance && account) {
      const tokenRequest = {
        scopes: SCOPES,
        account: account
      };

      try {
        const response = await instance.acquireTokenSilent(tokenRequest);
        return response.accessToken;
      } catch (error) {
        if (error instanceof msal.InteractionRequiredAuthError) {
          console.log(`MicrosoftAuth: Token expired for ${accountType}, please sign in again`);
          accounts[accountType].account = null;
          if (accountType === ACCOUNT_TYPES.HC) {
            currentAccount = null;
          }
          dispatchAuthEvent(false, accountType);
        }
        console.error(`MicrosoftAuth: Token acquisition failed for ${accountType}:`, error);
        return null;
      }
    }

    return null;
  }

  /**
   * Refresh access token using refresh token (single attempt)
   * Only clears stored tokens on PERMANENT errors (invalid_grant, etc.)
   * Returns null on failure but preserves refresh token for transient errors
   * @param {string} refreshToken - The refresh token
   * @param {string} accountType - 'hc' or 'ae' (defaults to HC)
   */
  async function refreshAccessToken(refreshToken, accountType = ACCOUNT_TYPES.HC) {
    try {
      const clientId = getClientId(accountType);
      if (!clientId) {
        console.error(`MicrosoftAuth: No client ID for ${accountType}`);
        return null;
      }

      const tokenEndpoint = `${AUTHORITY}/oauth2/v2.0/token`;

      const params = new URLSearchParams();
      params.append('client_id', clientId);
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', refreshToken);
      params.append('scope', SCOPES.join(' '));

      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      const data = await response.json();

      if (!response.ok) {
        const errorCode = data.error || '';
        const isPermanent = PERMANENT_REFRESH_ERRORS.includes(errorCode);

        if (isPermanent) {
          // Permanent failure - refresh token is revoked/expired, must re-login
          console.error(`MicrosoftAuth: Refresh token permanently invalid for ${accountType} (${errorCode}):`, data.error_description);
          const storageKey = getTokenStorageKey(accountType);
          localStorage.removeItem(storageKey);
          clearTokenFile(accountType);
          accounts[accountType].account = null;
          accounts[accountType].tokenData = null;
          if (accountType === ACCOUNT_TYPES.HC) {
            currentAccount = null;
          }
          dispatchAuthEvent(false, accountType);
        } else {
          // Transient failure (server error, rate limit, etc.) - keep refresh token
          console.warn(`MicrosoftAuth: Transient refresh failure for ${accountType} (${errorCode}):`, data.error_description || response.status);
        }
        return null;
      }

      // Update stored tokens (preserve refreshTokenIssuedAt unless we got a new refresh token)
      const existingData = JSON.parse(localStorage.getItem(getTokenStorageKey(accountType)) || '{}');
      const tokenData = {
        accessToken: data.access_token,
        idToken: data.id_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresOn: Date.now() + (data.expires_in * 1000),
        refreshTokenIssuedAt: data.refresh_token ? Date.now() : (existingData.refreshTokenIssuedAt || Date.now()),
        scopes: SCOPES
      };
      const storageKey = getTokenStorageKey(accountType);
      localStorage.setItem(storageKey, JSON.stringify(tokenData));
      persistTokenToFile(accountType);
      accounts[accountType].tokenData = tokenData;

      // Schedule next proactive refresh
      scheduleTokenRefresh(accountType);

      console.log(`MicrosoftAuth: Token refreshed successfully for ${accountType.toUpperCase()}`);
      return data.access_token;

    } catch (error) {
      // Network error, DNS not ready, etc. - keep refresh token for retry
      console.warn(`MicrosoftAuth: Network error during refresh for ${accountType}:`, error.message);
      return null;
    }
  }

  /**
   * Refresh access token with retry logic for transient failures
   * Retries up to MAX_REFRESH_RETRIES times with increasing delays
   * @param {string} refreshToken - The refresh token
   * @param {string} accountType - 'hc' or 'ae' (defaults to HC)
   */
  async function refreshAccessTokenWithRetry(refreshToken, accountType = ACCOUNT_TYPES.HC) {
    for (let attempt = 0; attempt <= MAX_REFRESH_RETRIES; attempt++) {
      const result = await refreshAccessToken(refreshToken, accountType);
      if (result) return result;

      // Check if tokens were cleared (permanent failure) - don't retry
      const storageKey = getTokenStorageKey(accountType);
      if (!localStorage.getItem(storageKey)) {
        console.log(`MicrosoftAuth: Permanent failure, not retrying for ${accountType}`);
        return null;
      }

      // Transient failure - wait before retry
      if (attempt < MAX_REFRESH_RETRIES) {
        const delay = REFRESH_RETRY_DELAYS[attempt] || 15000;
        console.log(`MicrosoftAuth: Retry ${attempt + 1}/${MAX_REFRESH_RETRIES} for ${accountType} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    console.warn(`MicrosoftAuth: All refresh retries exhausted for ${accountType}, will retry on next token request`);
    return null;
  }

  /**
   * Schedule proactive token refresh before expiry
   * Runs in the background to keep auth alive during long sessions
   * @param {string} accountType - 'hc' or 'ae'
   */
  function scheduleTokenRefresh(accountType) {
    // Clear any existing timer for this account
    if (tokenRefreshTimers[accountType]) {
      clearTimeout(tokenRefreshTimers[accountType]);
      tokenRefreshTimers[accountType] = null;
    }

    const storageKey = getTokenStorageKey(accountType);
    const storedData = localStorage.getItem(storageKey);
    if (!storedData) return;

    try {
      const tokenData = JSON.parse(storedData);
      if (!tokenData.refreshToken || !tokenData.expiresOn) return;

      // Schedule refresh 5 minutes before expiry
      const refreshAt = tokenData.expiresOn - PROACTIVE_REFRESH_BUFFER;
      const delay = Math.max(refreshAt - Date.now(), 10000); // At least 10 seconds from now

      console.log(`MicrosoftAuth: Scheduling proactive refresh for ${accountType.toUpperCase()} in ${Math.round(delay / 1000)}s`);

      tokenRefreshTimers[accountType] = setTimeout(async () => {
        console.log(`MicrosoftAuth: Proactive refresh triggered for ${accountType.toUpperCase()}`);
        const currentData = localStorage.getItem(storageKey);
        if (!currentData) return;

        const current = JSON.parse(currentData);
        if (current.refreshToken) {
          await refreshAccessTokenWithRetry(current.refreshToken, accountType);
        }
      }, delay);
    } catch (e) {
      console.warn(`MicrosoftAuth: Could not schedule refresh for ${accountType}:`, e);
    }
  }

  /**
   * Make authenticated request to Microsoft Graph API
   * @param {string} endpoint - API endpoint
   * @param {object} options - Fetch options
   * @param {string} accountType - 'hc' or 'ae' (defaults to HC)
   */
  async function graphRequest(endpoint, options = {}, accountType = ACCOUNT_TYPES.HC) {
    const token = await getAccessToken(accountType);
    if (!token) {
      throw new Error(`No access token available for ${accountType.toUpperCase()}`);
    }

    const url = endpoint.startsWith('https://')
      ? endpoint
      : `https://graph.microsoft.com/v1.0${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`Graph API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Check if account is authenticated
   * @param {string} accountType - 'hc' or 'ae' (defaults to HC)
   */
  function isAuthenticated(accountType = ACCOUNT_TYPES.HC) {
    return accounts[accountType]?.account !== null;
  }

  /**
   * Get account info
   * @param {string} accountType - 'hc' or 'ae' (defaults to HC)
   */
  function getAccount(accountType = ACCOUNT_TYPES.HC) {
    return accounts[accountType]?.account || null;
  }

  /**
   * Get all authenticated accounts
   */
  function getAuthenticatedAccounts() {
    const result = {};
    if (accounts.hc?.account) {
      result.hc = accounts.hc.account;
    }
    if (accounts.ae?.account) {
      result.ae = accounts.ae.account;
    }
    return result;
  }

  /**
   * Check if AE client ID is configured
   */
  function isAeConfigured() {
    return !!getClientId(ACCOUNT_TYPES.AE);
  }

  // Expose account type constants
  const AccountTypes = ACCOUNT_TYPES;

  return {
    initialize,
    signIn,
    signOut,
    completeSignIn,
    hasPendingSignIn,
    cancelPendingSignIn,
    getAccessToken,
    graphRequest,
    isAuthenticated,
    getAccount,
    getAuthenticatedAccounts,
    isAeConfigured,
    AccountTypes
  };
})();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => MicrosoftAuth.initialize());
} else {
  MicrosoftAuth.initialize();
}
