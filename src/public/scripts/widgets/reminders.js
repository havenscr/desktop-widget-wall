/* ================================================================
   REMINDERS WIDGET MODULE
   Microsoft To-Do integration via Graph API
   Falls back to static tasks when not authenticated
   ================================================================ */

const RemindersWidget = (function() {
  let taskListElement = null;
  let isInitialized = false;

  // Color mapping for task lists
  const LIST_COLORS = {
    'Tasks': '#5ac8fa',
    'Work': '#ff9500',
    'Personal': '#30d158',
    'Priority': '#ff2d85',
    'Shopping': '#bf5af2',
    'default': '#5ac8fa'
  };

  /**
   * Initialize the reminders widget
   */
  function init() {
    taskListElement = document.getElementById('task-list');
    if (!taskListElement) return;

    isInitialized = true;

    // Listen for auth changes
    window.addEventListener('microsoft-auth-change', handleAuthChange);

    // Check if already authenticated
    if (typeof MicrosoftAuth !== 'undefined' && MicrosoftAuth.isAuthenticated()) {
      fetchTasks();
    } else {
      renderStaticTasks();
    }

    // Refresh tasks periodically (every 5 minutes)
    setInterval(() => {
      if (typeof MicrosoftAuth !== 'undefined' && MicrosoftAuth.isAuthenticated()) {
        fetchTasks();
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Handle authentication state changes
   */
  function handleAuthChange(event) {
    const { isAuthenticated } = event.detail;
    if (isAuthenticated) {
      fetchTasks();
    } else {
      renderStaticTasks();
    }
  }

  /**
   * Fetch tasks from Microsoft To-Do via Graph API
   */
  async function fetchTasks() {
    if (!taskListElement) return;

    try {
      // Show loading state
      taskListElement.innerHTML = `
        <div class="task-item task-loading">
          <div class="task-content">
            <div class="task-title">Loading tasks...</div>
          </div>
        </div>
      `;

      // Get all task lists
      const listsResponse = await MicrosoftAuth.graphRequest('/me/todo/lists');
      const lists = listsResponse.value || [];

      // Fetch tasks from each list (limit to first 5 lists)
      const allTasks = [];
      for (const list of lists.slice(0, 5)) {
        try {
          const tasksResponse = await MicrosoftAuth.graphRequest(
            `/me/todo/lists/${list.id}/tasks?$filter=status ne 'completed'&$top=10&$orderby=importance desc,dueDateTime/dateTime asc`
          );
          const tasks = tasksResponse.value || [];
          tasks.forEach(task => {
            task._listName = list.displayName;
            task._listColor = LIST_COLORS[list.displayName] || LIST_COLORS.default;
          });
          allTasks.push(...tasks);
        } catch (e) {
          console.warn(`RemindersWidget: Failed to fetch tasks from list "${list.displayName}":`, e);
        }
      }

      // Sort by due date and importance
      allTasks.sort((a, b) => {
        // High importance first
        if (a.importance === 'high' && b.importance !== 'high') return -1;
        if (b.importance === 'high' && a.importance !== 'high') return 1;

        // Then by due date
        const dateA = a.dueDateTime?.dateTime ? new Date(a.dueDateTime.dateTime) : new Date('9999-12-31');
        const dateB = b.dueDateTime?.dateTime ? new Date(b.dueDateTime.dateTime) : new Date('9999-12-31');
        return dateA - dateB;
      });

      // Render tasks (limit to 4 for widget space)
      renderTasks(allTasks.slice(0, 4));

    } catch (error) {
      console.error('RemindersWidget: Failed to fetch tasks:', error);
      renderStaticTasks();
    }
  }

  /**
   * Render tasks from Microsoft To-Do
   */
  function renderTasks(tasks) {
    if (!taskListElement) return;

    if (tasks.length === 0) {
      taskListElement.innerHTML = `
        <div class="task-item" style="--task-color: #30d158;">
          <div class="task-checkbox checked"></div>
          <div class="task-content">
            <div class="task-main">
              <div class="task-title">All caught up!</div>
              <span class="task-list-tag">To-Do</span>
            </div>
            <div class="task-time">
              <span class="task-time-label">No tasks</span>
            </div>
          </div>
        </div>
      `;
      return;
    }

    taskListElement.innerHTML = tasks.map(task => {
      const dueInfo = formatDueDate(task.dueDateTime);
      const isCompleted = task.status === 'completed';

      return `
        <div class="task-item ${isCompleted ? 'completed' : ''}" style="--task-color: ${task._listColor};" data-task-id="${task.id}" data-list-id="${task._listId || ''}">
          <div class="task-checkbox ${isCompleted ? 'checked' : ''}"></div>
          <div class="task-content">
            <div class="task-main">
              <div class="task-title">${escapeHtml(task.title)}</div>
              <span class="task-list-tag">${escapeHtml(task._listName || 'Tasks')}</span>
            </div>
            <div class="task-time">
              <span class="task-time-label">${dueInfo.label}</span>
              ${dueInfo.time}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Add click handlers for visual feedback (read-only for now)
    taskListElement.querySelectorAll('.task-checkbox').forEach(checkbox => {
      checkbox.addEventListener('click', function() {
        this.classList.toggle('checked');
        this.parentElement.classList.toggle('completed');
      });
    });
  }

  /**
   * Format due date for display
   */
  function formatDueDate(dueDateTime) {
    if (!dueDateTime || !dueDateTime.dateTime) {
      return { label: 'No date', time: '' };
    }

    const due = new Date(dueDateTime.dateTime);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDate = new Date(due.getFullYear(), due.getMonth(), due.getDate());

    let label = '';
    if (dueDate.getTime() < today.getTime()) {
      label = 'Overdue';
    } else if (dueDate.getTime() === today.getTime()) {
      label = 'Today';
    } else if (dueDate.getTime() === tomorrow.getTime()) {
      label = 'Tomorrow';
    } else {
      label = due.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    // Format time if available
    const time = due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const hasTime = time !== '12:00 AM' && time !== '0:00'; // Check if time was actually set

    return { label, time: hasTime ? time : '' };
  }

  /**
   * Render static placeholder tasks (when not authenticated)
   */
  function renderStaticTasks() {
    if (!taskListElement) return;

    taskListElement.innerHTML = `
      <div class="task-item" style="--task-color: #5ac8fa;">
        <div class="task-checkbox"></div>
        <div class="task-content">
          <div class="task-main">
            <div class="task-title">Connect Microsoft account</div>
            <span class="task-list-tag">Setup</span>
          </div>
          <div class="task-time">
            <span class="task-time-label">Settings</span>
            to sync
          </div>
        </div>
      </div>
      <div class="task-item" style="--task-color: #ff9500;">
        <div class="task-checkbox"></div>
        <div class="task-content">
          <div class="task-main">
            <div class="task-title">Your To-Do tasks appear here</div>
            <span class="task-list-tag">Info</span>
          </div>
          <div class="task-time">
            <span class="task-time-label">Microsoft</span>
            To-Do
          </div>
        </div>
      </div>
    `;

    // Add click handlers for visual feedback
    taskListElement.querySelectorAll('.task-checkbox').forEach(checkbox => {
      checkbox.addEventListener('click', function() {
        this.classList.toggle('checked');
        this.parentElement.classList.toggle('completed');
      });
    });
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Manual refresh
   */
  function refresh() {
    if (typeof MicrosoftAuth !== 'undefined' && MicrosoftAuth.isAuthenticated()) {
      fetchTasks();
    }
  }

  return {
    init,
    refresh
  };
})();

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => RemindersWidget.init());
} else {
  RemindersWidget.init();
}
