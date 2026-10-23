/**
 * Visibility Manager
 * Centralized module for tracking app visibility state.
 * Widgets can subscribe to visibility changes to pause/resume expensive operations.
 *
 * AE-WWD-20260121-A1B2C3
 */
(function() {
  'use strict';

  // Visible means the page is not hidden AND Windows reports the wall can be
  // seen. The Rust side emits 'display-state' on lock/unlock and display
  // off/on; an always-on-top wall is almost never minimized, so
  // document.hidden alone kept everything running overnight.
  let displayVisible = true;
  let isVisible = !document.hidden;
  const listeners = new Set();

  function computeVisible() {
    return !document.hidden && displayVisible;
  }

  /**
   * Recompute visibility and notify only when it actually changed.
   */
  function update() {
    const next = computeVisible();
    if (next === isVisible) return;
    isVisible = next;
    notifyListeners();
  }

  /**
   * Notify all listeners of visibility change
   */
  function notifyListeners() {
    // Dispatch custom event for widgets that prefer event-based listening
    const event = new CustomEvent('dashboard-visibility-change', {
      detail: { visible: isVisible }
    });
    window.dispatchEvent(event);

    // Call registered callbacks
    listeners.forEach(fn => {
      try {
        fn(isVisible);
      } catch (e) {
        console.error('VisibilityManager: Listener error:', e);
      }
    });

    console.log(`VisibilityManager: Visibility changed to ${isVisible ? 'visible' : 'hidden'}`);
  }

  // Listen for browser visibility changes (tab switch, minimize)
  document.addEventListener('visibilitychange', update);

  // Listen for Tauri window events if available
  if (window.__TAURI__?.event) {
    window.__TAURI__.event.listen('tauri://blur', () => {
      // Window lost focus - could still be visible but not focused
      // We'll treat this as still visible since the user might be looking at it
      // Only document.hidden truly means minimized/occluded
    });

    window.__TAURI__.event.listen('tauri://focus', () => {
      // Window gained focus. Focus alone is not visibility: it can arrive
      // while the page is still hidden or the session is still locked.
      update();
    });

    // Lock / disconnect / display-off from Rust: { visible: false, reason:
    // 'lock' | 'disconnected' | 'display-off' } and { visible: true } when
    // Windows can show us again.
    window.__TAURI__.event.listen('display-state', (event) => {
      displayVisible = event?.payload?.visible !== false;
      update();
    });
  }

  // Expose global API
  window.VisibilityManager = {
    /**
     * Check if the app is currently visible
     * @returns {boolean}
     */
    isVisible: () => isVisible,

    /**
     * Register a callback for visibility changes
     * @param {function(boolean)} callback - Called with true when visible, false when hidden
     * @returns {function} Unsubscribe function
     */
    onVisibilityChange: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    /**
     * setInterval that only runs while the dashboard is visible.
     * Clears the timer when hidden; on return to visible runs the callback
     * immediately (so stale widgets refresh right away) and re-arms.
     * @param {function} callback
     * @param {number} intervalMs
     * @param {{runOnResume?: boolean}} [opts]
     * @returns {{stop: function}} Handle - call stop() to end the interval
     */
    managedInterval: (callback, intervalMs, opts = {}) => {
      const runOnResume = opts.runOnResume !== false;
      let timer = null;
      let stopped = false;

      const start = () => {
        if (!timer && !stopped) timer = setInterval(callback, intervalMs);
      };
      const pause = () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      };

      const onChange = (visible) => {
        if (stopped) return;
        if (visible) {
          if (runOnResume) {
            try {
              callback();
            } catch (e) {
              console.error('VisibilityManager: managedInterval callback error:', e);
            }
          }
          start();
        } else {
          pause();
        }
      };
      listeners.add(onChange);

      if (isVisible) start();

      return {
        stop: () => {
          stopped = true;
          pause();
          listeners.delete(onChange);
        }
      };
    },

    /**
     * Manually trigger a visibility check (useful after app init)
     */
    check: update,

    /**
     * Whether Windows reports the displays on and the session unlocked.
     * @returns {boolean}
     */
    isDisplayVisible: () => displayVisible
  };

  console.log('VisibilityManager: Initialized, visible =', isVisible);
})();
