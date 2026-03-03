/* ================================================================
   RECENT FILES MODULE
   Native Tauri integration for file list with system icons
   ================================================================ */

(function() {
  // Background config
  let recentFilesConfig = {
    background: 'none',
    customSvg: null,
    svgBlur: 0
  };

  // Load config from localStorage
  function loadRecentFilesConfig() {
    try {
      const saved = localStorage.getItem('recentFilesConfig');
      if (saved) {
        const parsed = JSON.parse(saved);
        recentFilesConfig = { ...recentFilesConfig, ...parsed };
      }
    } catch (e) {
      console.warn('Failed to load recent files config:', e);
    }
  }

  // Save config to localStorage
  function saveRecentFilesConfig() {
    try {
      localStorage.setItem('recentFilesConfig', JSON.stringify(recentFilesConfig));
    } catch (e) {
      console.warn('Failed to save recent files config:', e);
    }
  }

  // Apply background to widget
  function applyRecentFilesBackground(bgType) {
    const widget = document.querySelector('.widget-recentfiles');
    if (widget) {
      if (bgType && bgType !== 'none') {
        widget.setAttribute('data-bg', bgType);
        if (bgType === 'svg') {
          if (recentFilesConfig.customSvg) {
            widget.style.setProperty('--recentfiles-custom-svg', `url("${recentFilesConfig.customSvg}")`);
          }
          const blurVal = recentFilesConfig.svgBlur ?? 0;
          widget.style.setProperty('--recentfiles-svg-blur', `${blurVal}px`);
          widget.style.setProperty('--recentfiles-svg-blur-scale', blurVal * 0.007);
        }
      } else {
        widget.removeAttribute('data-bg');
        widget.style.removeProperty('--recentfiles-custom-svg');
        widget.style.removeProperty('--recentfiles-svg-blur');
        widget.style.removeProperty('--recentfiles-svg-blur-scale');
      }
    }
  }

  // Initialize background config modal handlers
  function initRecentFilesBackground() {
    loadRecentFilesConfig();
    applyRecentFilesBackground(recentFilesConfig.background);

    // Use event delegation for async-loaded modal elements
    document.addEventListener('click', (e) => {
      // Config button click
      if (e.target.closest('#recent-config-btn')) {
        const modal = document.getElementById('recentfiles-modal');
        if (modal) {
          // Set current values in modal
          const currentBg = recentFilesConfig.background || 'none';
          const radio = modal.querySelector(`input[name="recentfiles-bg"][value="${currentBg}"]`);
          if (radio) radio.checked = true;

          // Show/hide SVG upload section
          const svgUpload = document.getElementById('recentfiles-svg-upload');
          if (svgUpload) {
            svgUpload.style.display = currentBg === 'svg' ? 'block' : 'none';
          }

          // Initialize blur controls
          const blurSlider = document.getElementById('recentfiles-blur-slider');
          const blurInput = document.getElementById('recentfiles-blur-input');
          if (blurSlider && blurInput) {
            const blurVal = recentFilesConfig.svgBlur ?? 0;
            blurSlider.value = blurVal;
            blurInput.value = blurVal;
          }

          // Show SVG preview if exists
          const preview = document.getElementById('recentfiles-svg-preview');
          if (preview && recentFilesConfig.customSvg) {
            preview.innerHTML = `<img src="${recentFilesConfig.customSvg}" alt="SVG Preview" style="max-width: 100%; max-height: 60px; border-radius: 4px;">`;
          } else if (preview) {
            preview.innerHTML = '';
          }

          modal.classList.add('active');
        }
      }

      // Cancel button
      if (e.target.closest('#recentfiles-cancel-btn')) {
        const modal = document.getElementById('recentfiles-modal');
        if (modal) modal.classList.remove('active');
      }

      // Save button
      if (e.target.closest('#recentfiles-save-btn')) {
        const modal = document.getElementById('recentfiles-modal');
        if (modal) {
          const selectedBg = modal.querySelector('input[name="recentfiles-bg"]:checked')?.value || 'none';
          const blurSlider = document.getElementById('recentfiles-blur-slider');
          recentFilesConfig.background = selectedBg;
          recentFilesConfig.svgBlur = parseInt(blurSlider?.value) || 0;
          saveRecentFilesConfig();
          applyRecentFilesBackground(selectedBg);
          modal.classList.remove('active');
        }
      }

      // Clear SVG button
      if (e.target.closest('#recentfiles-svg-clear')) {
        recentFilesConfig.customSvg = null;
        const preview = document.getElementById('recentfiles-svg-preview');
        if (preview) preview.innerHTML = '';
        const fileInput = document.getElementById('recentfiles-svg-input');
        if (fileInput) fileInput.value = '';
      }
    });

    // Background option change
    document.addEventListener('change', (e) => {
      if (e.target.name === 'recentfiles-bg') {
        const svgUpload = document.getElementById('recentfiles-svg-upload');
        if (svgUpload) {
          svgUpload.style.display = e.target.value === 'svg' ? 'block' : 'none';
        }
      }

      // SVG file input change
      if (e.target.id === 'recentfiles-svg-input') {
        const file = e.target.files?.[0];
        if (file && file.type === 'image/svg+xml') {
          if (file.size > 500 * 1024) {
            alert('SVG file too large. Please use a file under 500KB.');
            e.target.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = (ev) => {
            recentFilesConfig.customSvg = ev.target.result;
            const preview = document.getElementById('recentfiles-svg-preview');
            if (preview) {
              preview.innerHTML = `<img src="${ev.target.result}" alt="SVG Preview" style="max-width: 100%; max-height: 60px; border-radius: 4px;">`;
            }
          };
          reader.readAsDataURL(file);
        }
      }
    });

    // Blur slider/input sync
    document.addEventListener('input', (e) => {
      const target = e.target;
      if (target.id === 'recentfiles-blur-slider') {
        const blurInput = document.getElementById('recentfiles-blur-input');
        if (blurInput) blurInput.value = target.value;
      }
      if (target.id === 'recentfiles-blur-input') {
        let val = parseInt(target.value) || 0;
        val = Math.max(0, Math.min(30, val));
        target.value = val;
        const blurSlider = document.getElementById('recentfiles-blur-slider');
        if (blurSlider) blurSlider.value = val;
      }
    });

    // Close modal on backdrop click
    document.addEventListener('mousedown', (e) => {
      if (e.target.id === 'recentfiles-modal') {
        e.target.classList.remove('active');
      }
    });
  }

  // Initialize background config (works even without Tauri)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRecentFilesBackground);
  } else {
    initRecentFilesBackground();
  }

  // Check if Tauri is available
  if (!window.__TAURI__?.core?.invoke) {
    console.warn('Recent Files: Tauri not available, skipping initialization');
    return;
  }
  const { invoke } = window.__TAURI__.core;

  // Cache for file icons (keyed by file extension)
  const iconCache = new Map();

  // Fallback text labels for when icon extraction fails
  const fileTypeMap = {
    pdf: { icon: 'PDF', class: 'pdf' },
    doc: { icon: 'DOC', class: 'word' },
    docx: { icon: 'DOC', class: 'word' },
    xls: { icon: 'XLS', class: 'excel' },
    xlsx: { icon: 'XLS', class: 'excel' },
    ppt: { icon: 'PPT', class: 'powerpoint' },
    pptx: { icon: 'PPT', class: 'powerpoint' },
    pbix: { icon: 'PBI', class: 'powerpoint' },
    png: { icon: 'IMG', class: 'image' },
    jpg: { icon: 'IMG', class: 'image' },
    jpeg: { icon: 'IMG', class: 'image' },
    gif: { icon: 'IMG', class: 'image' },
    svg: { icon: 'SVG', class: 'image' },
    js: { icon: 'JS', class: 'code' },
    ts: { icon: 'TS', class: 'code' },
    py: { icon: 'PY', class: 'code' },
    html: { icon: 'HTML', class: 'code' },
    css: { icon: 'CSS', class: 'code' },
    json: { icon: 'JSON', class: 'code' },
    mp3: { icon: 'MP3', class: 'audio' },
    wav: { icon: 'WAV', class: 'audio' },
    mp4: { icon: 'MP4', class: 'video' },
    avi: { icon: 'AVI', class: 'video' },
    mkv: { icon: 'MKV', class: 'video' },
    zip: { icon: 'ZIP', class: 'archive' },
    rar: { icon: 'RAR', class: 'archive' },
    '7z': { icon: '7Z', class: 'archive' },
    txt: { icon: 'TXT', class: 'text' },
    md: { icon: 'MD', class: 'text' },
    csv: { icon: 'CSV', class: 'excel' }
  };

  function getFileTypeInfo(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return fileTypeMap[ext] || { icon: 'FILE', class: 'default' };
  }

  // Fetch system icon for a file (with caching by extension)
  async function getFileIconBase64(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();

    // Check cache first
    if (iconCache.has(ext)) {
      return iconCache.get(ext);
    }

    try {
      const base64 = await invoke('get_file_icon', { path: filePath });
      iconCache.set(ext, base64);
      return base64;
    } catch (e) {
      console.warn('Failed to get icon for', filePath, e);
      iconCache.set(ext, null); // Cache the failure to avoid retries
      return null;
    }
  }

function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function setRecentFilesConnected(connected) {
  const statusText = document.getElementById('recent-status-text');
  const placeholder = document.getElementById('recent-placeholder');
  const filesList = document.getElementById('recent-files-list');

  if (statusText) statusText.textContent = connected ? 'Connected' : 'Offline';
  if (placeholder) placeholder.style.display = connected ? 'none' : 'flex';
  if (filesList) filesList.style.display = connected ? 'flex' : 'none';
}

async function fetchRecentFiles() {
  try {
    const files = await invoke('get_recent_files', { limit: 15 });
    setRecentFilesConnected(true);
    renderRecentFiles(files || []);
    return true;
  } catch (e) {
    console.warn('Failed to fetch recent files:', e);
    setRecentFilesConnected(false);
    return false;
  }
}

async function renderRecentFiles(files) {
  const filesList = document.getElementById('recent-files-list');
  if (!filesList) return;

  filesList.innerHTML = '';

  if (files.length === 0) {
    filesList.innerHTML = '<div class="recent-placeholder-text" style="padding: 20px; text-align: center;">No recent files found</div>';
    return;
  }

  // Create all items first (with placeholder icons), then load real icons async
  const itemPromises = files.map(async file => {
    const typeInfo = getFileTypeInfo(file.name);
    const ext = file.name.split('.').pop().toUpperCase();
    const timeAgo = formatTimeAgo(file.modified);

    const item = document.createElement('div');
    item.className = 'recent-file-item';
    item.dataset.path = file.path;

    // Start with fallback text icon
    item.innerHTML = `
      <div class="recent-file-icon ${typeInfo.class}" data-fallback="${typeInfo.icon}">${typeInfo.icon}</div>
      <div class="recent-file-info">
        <div class="recent-file-name" title="${file.name}">${file.name}</div>
        <div class="recent-file-meta">
          <span class="recent-file-ext">.${ext}</span>
          <span class="recent-file-time">${timeAgo}</span>
        </div>
      </div>
      <button class="recent-file-copy-btn" title="Copy file">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
        </svg>
      </button>
      <button class="recent-file-folder-btn" title="Open folder location">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    `;

    // Open file when clicking the row (but not the action buttons)
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.recent-file-folder-btn') && !e.target.closest('.recent-file-copy-btn')) {
        openFile(file.path);
      }
    });

    // Copy file when clicking copy button
    const copyBtn = item.querySelector('.recent-file-copy-btn');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyFileToClipboard(file.path, copyBtn);
    });

    // Open folder when clicking folder button
    const folderBtn = item.querySelector('.recent-file-folder-btn');
    folderBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFolderInExplorer(file.path);
    });
    filesList.appendChild(item);

    // Load system icon asynchronously
    const iconEl = item.querySelector('.recent-file-icon');
    try {
      const base64Icon = await getFileIconBase64(file.path);
      if (base64Icon && iconEl) {
        // Replace text with actual icon image
        iconEl.innerHTML = `<img src="data:image/png;base64,${base64Icon}" alt="${ext}" class="system-icon" />`;
        iconEl.classList.add('has-system-icon');
      }
    } catch (e) {
      // Keep fallback text icon
    }

    return item;
  });

  await Promise.all(itemPromises);
}

async function openFile(filePath) {
  try {
    await invoke('open_file', { path: filePath });
  } catch (e) {
    console.log('Failed to open file:', e);
  }
}

async function openFolderInExplorer(filePath) {
  try {
    await invoke('open_folder_in_explorer', { path: filePath });
  } catch (e) {
    console.log('Failed to open folder:', e);
  }
}

async function copyFileToClipboard(filePath, btn) {
  try {
    await invoke('copy_file_to_clipboard', { path: filePath });
    // Brief visual feedback
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1000);
  } catch (e) {
    console.log('Failed to copy file:', e);
  }
}

function initRecentFiles() {
  // Show connected state immediately (native integration)
  setRecentFilesConnected(true);

  // Refresh button
  const refreshBtn = document.getElementById('recent-refresh-btn');
  refreshBtn?.addEventListener('click', async () => {
    refreshBtn.classList.add('spinning');
    await fetchRecentFiles();
    setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
  });

  // Initial fetch and periodic refresh
  fetchRecentFiles();
  setInterval(fetchRecentFiles, 30000); // Refresh every 30 seconds
}

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRecentFiles);
  } else {
    initRecentFiles();
  }
})();
