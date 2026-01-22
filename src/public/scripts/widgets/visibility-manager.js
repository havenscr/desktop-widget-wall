/**
 * Visibility Manager
 * Centralized module for tracking app visibility state.
 * Widgets can subscribe to visibility changes to pause/resume expensive operations.
 *
 * AE-WWD-20260121-A1B2C3
 */
(function() {
  'use strict';

  let isVisible = !document.hidden;
  const listeners = new Set();

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
  document.addEventListener('visibilitychange', () => {
    isVisible = !document.hidden;
    notifyListeners();
  });

  // Listen for Tauri window events if available
  if (window.__TAURI__?.event) {
    window.__TAURI__.event.listen('tauri://blur', () => {
      // Window lost focus - could still be visible but not focused
      // We'll treat this as still visible since the user might be looking at it
      // Only document.hidden truly means minimized/occluded
    });

    window.__TAURI__.event.listen('tauri://focus', () => {
      // Window gained focus
      if (!isVisible) {
        isVisible = true;
        notifyListeners();
      }
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
     * Manually trigger a visibility check (useful after app init)
     */
    check: () => {
      const newVisible = !document.hidden;
      if (newVisible !== isVisible) {
        isVisible = newVisible;
        notifyListeners();
      }
    }
  };

  console.log('VisibilityManager: Initialized, visible =', isVisible);
})();
