/* ================================================================
   CLAUDE STATS MODULE
   Native Tauri integration for local Claude analytics
   ================================================================ */

(function() {
  // Check if Tauri is available
  if (!window.__TAURI__?.core?.invoke) {
    console.warn('Claude Stats: Tauri not available, skipping initialization');
    return;
  }
  const { invoke } = window.__TAURI__.core;

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function generateSparkline(data, width = 120, height = 30) {
  if (!data || data.length === 0) return '';

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return `M ${points.replace(/, /g, ' L ').replace(/,/g, ' ')}`;
}

async function fetchClaudeStats() {
  // The widget is currently display:none in base.css ("hidden for now") -
  // don't open and query the analytics SQLite DB for an invisible widget.
  // offsetParent is null whenever the element or an ancestor is display:none.
  const widget = document.querySelector('.widget-claudestats');
  if (widget && widget.offsetParent === null) return;

  try {
    const data = await invoke('get_claude_stats');

    document.getElementById('claude-placeholder').style.display = 'none';
    document.getElementById('claude-stats-display').style.display = 'flex';

    const lifetimeEl = document.getElementById('claude-lifetime-value');
    if (lifetimeEl && data.lifetime_cost !== undefined) {
      lifetimeEl.textContent = formatCurrency(data.lifetime_cost);
    }

    const todayEl = document.getElementById('claude-today-value');
    if (todayEl && data.today_cost !== undefined) {
      todayEl.textContent = formatCurrency(data.today_cost);
    }

    const inputEl = document.getElementById('claude-input-tokens');
    if (inputEl && data.today_input_tokens !== undefined) {
      inputEl.textContent = formatNumber(data.today_input_tokens);
    }

    const outputEl = document.getElementById('claude-output-tokens');
    if (outputEl && data.today_output_tokens !== undefined) {
      outputEl.textContent = formatNumber(data.today_output_tokens);
    }

    const requestsEl = document.getElementById('claude-requests');
    if (requestsEl && data.today_messages !== undefined) {
      requestsEl.textContent = formatNumber(data.today_messages);
    }

    if (data.daily_costs && data.daily_costs.length > 0) {
      const sparkPath = document.getElementById('claude-spark-path');
      if (sparkPath) {
        sparkPath.setAttribute('d', generateSparkline(data.daily_costs, 120, 30));
      }
    }

    const modelsContainer = document.getElementById('claude-models');
    if (modelsContainer && data.models) {
      modelsContainer.innerHTML = '';
      // Sort by cost descending
      const sortedModels = Object.entries(data.models).sort((a, b) => b[1] - a[1]);
      for (const [model, cost] of sortedModels) {
        const modelDiv = document.createElement('div');
        modelDiv.className = 'claude-model';
        modelDiv.innerHTML = `
          <span class="claude-model-name">${model}</span>
          <span class="claude-model-cost">${formatCurrency(cost)}</span>
        `;
        modelsContainer.appendChild(modelDiv);
      }
    }

  } catch (error) {
    console.warn('Failed to fetch Claude stats:', error);
    // Show placeholder with error message
    const placeholder = document.getElementById('claude-placeholder');
    const display = document.getElementById('claude-stats-display');
    if (placeholder) {
      placeholder.style.display = 'flex';
      placeholder.innerHTML = `
        <div class="placeholder-icon">!</div>
        <div class="placeholder-text">Could not read Claude analytics</div>
        <div class="placeholder-subtext">Ensure ~/.claude/ exists</div>
      `;
    }
    if (display) display.style.display = 'none';
  }
}

function initClaudeStats() {
  // Initial fetch and periodic refresh (paused while the dashboard is hidden)
  fetchClaudeStats();
  if (window.VisibilityManager) {
    window.VisibilityManager.managedInterval(fetchClaudeStats, 60 * 1000);
  } else {
    setInterval(fetchClaudeStats, 60 * 1000);
  }
}

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initClaudeStats);
  } else {
    initClaudeStats();
  }
})();
