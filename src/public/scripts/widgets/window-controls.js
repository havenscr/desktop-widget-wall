/* ================================================================
   WINDOW CONTROLS MODULE
   Handles fullscreen toggle and window management via Tauri API
   ================================================================ */

let isFullscreen = false;

async function toggleFullscreen() {
  try {
    // Check if we're running in Tauri
    if (window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.()) {
      const appWindow = window.__TAURI__.webviewWindow.getCurrentWebviewWindow();
      isFullscreen = await appWindow.isFullscreen();

      // Toggle fullscreen state
      await appWindow.setFullscreen(!isFullscreen);
      await appWindow.setDecorations(isFullscreen); // Show decorations when exiting fullscreen

      // Hide from taskbar when fullscreen, show only in system tray
      // When entering fullscreen (!isFullscreen was false, now true), skip taskbar
      // When exiting fullscreen (!isFullscreen was true, now false), show in taskbar
      await appWindow.setSkipTaskbar(!isFullscreen);

      isFullscreen = !isFullscreen;
      updateFullscreenButton();

      // Force layout recalculation after fullscreen toggle (multi-monitor fix)
      // Small delay to let Tauri finish window resize
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        // Force reflow by reading offsetHeight
        document.body.offsetHeight;
      }, 100);

      return;
    }
  } catch (e) {
    console.log('Tauri fullscreen error, trying browser fallback:', e.message);
  }

  // Fallback for browser testing - use native fullscreen API
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      isFullscreen = true;
    } else {
      await document.exitFullscreen();
      isFullscreen = false;
    }
    updateFullscreenButton();
  } catch (e) {
    console.log('Browser fullscreen error:', e.message);
  }
}

function updateFullscreenButton() {
  const expandIcon = document.querySelector('.fullscreen-expand');
  const compressIcon = document.querySelector('.fullscreen-compress');
  const button = document.getElementById('fullscreen-toggle');

  if (expandIcon && compressIcon) {
    expandIcon.style.display = isFullscreen ? 'none' : 'block';
    compressIcon.style.display = isFullscreen ? 'block' : 'none';
  }

  if (button) {
    button.title = isFullscreen ? 'Exit Fullscreen (F11 or Esc)' : 'Toggle Fullscreen (F11)';
  }
}

async function checkFullscreenState() {
  try {
    if (window.__TAURI__) {
      const appWindow = window.__TAURI__.webviewWindow.getCurrentWebviewWindow();
      isFullscreen = await appWindow.isFullscreen();
      updateFullscreenButton();
    }
  } catch (e) {
    console.log('Error checking fullscreen state:', e.message);
  }
}

function initWindowControls() {
  const fullscreenBtn = document.getElementById('fullscreen-toggle');

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
  }

  // F11 keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      toggleFullscreen();
    }
    // Esc to exit fullscreen (only when in fullscreen)
    if (e.key === 'Escape' && isFullscreen) {
      toggleFullscreen();
    }
  });

  // Listen for fullscreen changes from browser API
  document.addEventListener('fullscreenchange', () => {
    isFullscreen = !!document.fullscreenElement;
    updateFullscreenButton();
  });

  // Check initial state after a short delay (for Tauri to be ready)
  setTimeout(checkFullscreenState, 500);
}

// Export for external use
window.toggleFullscreen = toggleFullscreen;

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWindowControls);
} else {
  initWindowControls();
}
