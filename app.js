/**
 * app.js — Task Tracker UI Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all DOM rendering and user interaction. Depends on core.js
 * being loaded first (all core symbols must already be in scope).
 *
 * Structure:
 *   1. Renderer     – builds and updates every part of the UI
 *   2. EventHandlers – wires up DOM events using event delegation
 *   3. init()        – bootstrap called on DOMContentLoaded
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: RENDERER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renderer
 * ─────────────────────────────────────────────────────────────────────────────
 * Stateless rendering layer. Every method reads from core state (DateNavigator,
 * TaskStore, TimerManager) and writes to the DOM. Call `renderAll()` to
 * synchronise the entire UI with the current application state.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const Renderer = {

  /**
   * Synchronise the full UI with current app state.
   * Safe to call at any time; re-renders without flicker.
   */
  renderAll() {
    this.renderDateHeader();
    this.renderTaskList();
    this.renderSummary();
  },

  /**
   * Update the date heading and "Today" badge in the main content area.
   */
  renderDateHeader() {
    const isToday      = DateNavigator.isToday();
    const badge        = document.getElementById('date-today-badge');
    const label        = document.getElementById('current-date-label');
    const btnToday     = document.getElementById('btn-today');

    label.textContent  = DateNavigator.getDisplayDate();

    // Show "Today" badge only when viewing today
    if (isToday) {
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    // Disable the "Today" nav button when already on today
    btnToday.disabled = isToday;
  },

  /**
   * Re-render the task list for the currently selected day.
   * Shows an empty state illustration when no tasks exist.
   */
  renderTaskList() {
    const dateKey   = DateNavigator.getDateKey();
    const tasks     = TaskStore.getTasksForDate(dateKey);
    const container = document.getElementById('task-list');

    container.innerHTML = '';

    if (tasks.length === 0) {
      // Empty state placeholder
      container.innerHTML = `
        <div class="empty-state" role="status" aria-label="No tasks for this day">
          <div class="empty-icon">📋</div>
          <p>No tasks yet for this day.</p>
          <span>Click "+ Add Task" to get started!</span>
        </div>`;
      return;
    }

    // Sort: running first, then by creation order
    const sorted = [...tasks].sort((a, b) => {
      const aRunning = TimerManager.isRunning(a.id) ? -1 : 0;
      const bRunning = TimerManager.isRunning(b.id) ? -1 : 0;
      return aRunning - bRunning || a.createdAt - b.createdAt;
    });

    sorted.forEach(task => {
      container.appendChild(this.createTaskElement(task));
    });
  },

  /**
   * Re-render the time summary panel in the sidebar.
   */
  renderSummary() {
    const dateKey      = DateNavigator.getDateKey();
    const tasks        = TaskStore.getTasksForDate(dateKey);
    const summaryList  = document.getElementById('summary-list');
    const totalEl      = document.getElementById('summary-total');

    // Grand total time for the day
    totalEl.textContent = formatTime(getTotalTimeForDay(tasks));

    summaryList.innerHTML = '';

    if (tasks.length === 0) {
      summaryList.innerHTML = '<li class="summary-empty">No tasks yet</li>';
      return;
    }

    // One row per task
    tasks.forEach(task => {
      const elapsed  = getElapsedSeconds(task);
      const running  = TimerManager.isRunning(task.id);
      const li       = document.createElement('li');
      li.className   = 'summary-item';
      li.innerHTML   = `
        <span class="summary-task-name" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
        <span class="summary-task-time ${running ? 'is-running' : ''}">${formatTime(elapsed)}</span>`;
      summaryList.appendChild(li);
    });
  },

  /**
   * Build a fully interactive task card DOM element.
   *
   * @param {Object} task - Task data object from TaskStore.
   * @returns {HTMLElement} The rendered task card `<div>`.
   */
  createTaskElement(task) {
    const isRunning = TimerManager.isRunning(task.id);
    const elapsed   = getElapsedSeconds(task);

    /** Human-readable labels for each status value */
    const statusLabel = {
      'todo'       : 'To Do',
      'in-progress': 'In Progress',
      'done'       : 'Done',
    };

    const card       = document.createElement('div');
    card.className   = `task-card status-${task.status}${isRunning ? ' timer-running' : ''}`;
    card.dataset.taskId = task.id;

    // Timer button markup — shows play or stop icon depending on state
    const timerBtnHtml = isRunning
      ? `<button class="btn-timer btn-stop" data-action="toggle-timer" aria-label="Stop timer" title="Stop timer">
           <!-- Stop icon: two vertical bars -->
           <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
             <rect x="6" y="4" width="4" height="16" rx="1"/>
             <rect x="14" y="4" width="4" height="16" rx="1"/>
           </svg>
           Stop
         </button>`
      : `<button class="btn-timer btn-start" data-action="toggle-timer" aria-label="Start timer" title="Start timer">
           <!-- Play icon: right-pointing triangle -->
           <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
             <polygon points="5,3 19,12 5,21"/>
           </svg>
           Start
         </button>`;

    card.innerHTML = `
      <!-- Row 1: status pill + delete button -->
      <div class="task-card-header">
        <button class="status-pill status-${task.status}"
                data-action="toggle-status"
                aria-label="Status: ${statusLabel[task.status]}. Click to advance."
                title="Click to advance status">
          ${statusLabel[task.status]}
        </button>
        <button class="btn-delete" data-action="delete"
                aria-label="Delete task" title="Delete task">
          <!-- Trash icon -->
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
               xmlns="http://www.w3.org/2000/svg">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>

      <!-- Row 2: task title -->
      <div class="task-title">${escapeHtml(task.title)}</div>

      <!-- Row 3: live timer display + start/stop button -->
      <div class="task-footer">
        <span class="timer-display ${isRunning ? 'is-running' : ''}"
              aria-label="Time spent: ${formatTime(elapsed)}">
          ${formatTime(elapsed)}
        </span>
        ${timerBtnHtml}
      </div>`;

    return card;
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: EVENT HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wire up all DOM event listeners.
 * Uses event delegation on the task list container to handle card actions,
 * avoiding the need to re-attach listeners whenever tasks are re-rendered.
 */
function initEventHandlers() {

  /* ── Day Navigation ──────────────────────────────────────────────────────── */

  document.getElementById('btn-prev').addEventListener('click', () => {
    DateNavigator.goPrev();
    Renderer.renderAll();
  });

  document.getElementById('btn-next').addEventListener('click', () => {
    DateNavigator.goNext();
    Renderer.renderAll();
  });

  document.getElementById('btn-today').addEventListener('click', () => {
    DateNavigator.goToday();
    Renderer.renderAll();
  });

  /* ── Add Task Form ───────────────────────────────────────────────────────── */

  const addTaskForm  = document.getElementById('add-task-form');
  const taskInput    = document.getElementById('task-input');
  const btnAddTask   = document.getElementById('btn-add-task');
  const btnConfirm   = document.getElementById('btn-confirm-add');
  const btnCancelAdd = document.getElementById('btn-cancel-add');

  /** Open the inline add-task form */
  function showAddForm() {
    addTaskForm.classList.remove('hidden');
    taskInput.value = '';
    taskInput.focus();
  }

  /** Close the inline add-task form */
  function hideAddForm() {
    addTaskForm.classList.add('hidden');
    taskInput.value = '';
  }

  /** Validate and submit the new task */
  function submitNewTask() {
    const title = taskInput.value.trim();
    if (!title) {
      // Provide visual feedback for empty input without a blocking alert
      taskInput.style.outline = '2px solid var(--danger)';
      setTimeout(() => { taskInput.style.outline = ''; }, 1200);
      return;
    }
    TaskStore.addTask(DateNavigator.getDateKey(), title);
    hideAddForm();
    Renderer.renderAll();
  }

  btnAddTask.addEventListener('click',   showAddForm);
  btnConfirm.addEventListener('click',   submitNewTask);
  btnCancelAdd.addEventListener('click', hideAddForm);

  // Allow submitting with Enter key inside the input
  taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitNewTask();
    if (e.key === 'Escape') hideAddForm();
  });

  /* ── Task List — Event Delegation ───────────────────────────────────────── */

  /**
   * A single click listener on the task list container handles all
   * three card actions: toggle-status, delete, and toggle-timer.
   * We walk up from the clicked element to find the action button,
   * then read the task ID from the nearest .task-card ancestor.
   */
  document.getElementById('task-list').addEventListener('click', (e) => {
    // Find the closest element with a data-action attribute
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    // Find the task card that contains this button
    const card   = actionEl.closest('.task-card');
    if (!card) return;

    const taskId  = card.dataset.taskId;
    const dateKey = DateNavigator.getDateKey();
    const action  = actionEl.dataset.action;

    if (action === 'toggle-status') {
      // Stop timer if this task's timer is running before marking done
      if (TimerManager.isRunning(taskId)) TimerManager.stop();
      TaskStore.cycleStatus(dateKey, taskId);
      Renderer.renderAll();

    } else if (action === 'delete') {
      // Stop the timer first if this task is being timed
      if (TimerManager.isRunning(taskId)) TimerManager.stop();
      TaskStore.deleteTask(dateKey, taskId);
      Renderer.renderAll();

    } else if (action === 'toggle-timer') {
      if (TimerManager.isRunning(taskId)) {
        // Stop the running timer
        TimerManager.stop();
      } else {
        // Start this task's timer (stops any other running timer automatically)
        TimerManager.start(dateKey, taskId);
      }
      Renderer.renderAll();
    }
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: INIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bootstrap the application once the DOM is fully loaded.
 * Order: recover orphaned timers → wire events → initial render
 */
function init() {
  // 1. Recover any timers that were running when the page was last closed
  TimerManager.recoverOrphanedTimers();

  // 2. Wire the live-tick callback so the UI updates every second while timing
  TimerManager.onTick = () => Renderer.renderAll();

  // 3. Attach all event listeners
  initEventHandlers();

  // 4. Render the initial UI
  Renderer.renderAll();
}

// Start the app when the HTML document is ready
document.addEventListener('DOMContentLoaded', init);
