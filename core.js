/**
 * core.js — Task Tracker Core Logic
 * ─────────────────────────────────────────────────────────────────────────────
 * Contains all pure business logic with zero DOM dependencies.
 * All functions and objects are exposed as globals so they can be
 * imported by both index.html (the app) and tests.html (unit tests).
 *
 * Structure:
 *   1. Utilities        – pure helper functions
 *   2. TaskStore        – CRUD operations backed by a swappable storage layer
 *   3. DateNavigator    – manages the currently-viewed day
 *   4. TimerManager     – one-at-a-time task timer with live-tick support
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically unique ID for a task.
 * Falls back to a Math.random-based ID in environments without crypto.
 *
 * @returns {string} A unique identifier string.
 */
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older environments or test runners
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Format a raw number of seconds into an HH:MM:SS display string.
 * Always pads each segment to two digits.
 *
 * @param {number} totalSeconds - Total seconds (may be fractional; will be floored).
 * @returns {string} e.g. "01:23:45"
 */
function formatTime(totalSeconds) {
  const s = Math.floor(totalSeconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [hh, mm, ss].map(n => String(n).padStart(2, '0')).join(':');
}

/**
 * Convert a JavaScript Date to a YYYY-MM-DD storage key string.
 * Uses the *local* calendar date (not UTC) to match user intent.
 *
 * @param {Date} date - The date to convert.
 * @returns {string} e.g. "2026-06-14"
 */
function dateToKey(date) {
  const y  = date.getFullYear();
  const m  = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Format a Date object into a long human-readable string.
 *
 * @param {Date} date - The date to format.
 * @returns {string} e.g. "Sunday, June 14, 2026"
 */
function formatDisplayDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday : 'long',
    year    : 'numeric',
    month   : 'long',
    day     : 'numeric',
  });
}

/**
 * Get the storage key for today's local calendar date.
 *
 * @returns {string} Today in YYYY-MM-DD format.
 */
function getTodayKey() {
  return dateToKey(new Date());
}

/**
 * Compute total elapsed seconds for a single task, including any live
 * timer session that has not yet been committed to timeSpentSeconds.
 *
 * @param {Object} task       - A task object (see TaskStore data model).
 * @param {number} [now]      - Current timestamp in ms. Defaults to Date.now().
 *                              Inject a fixed value in tests for determinism.
 * @returns {number} Total elapsed seconds (may have fractional part).
 */
function getElapsedSeconds(task, now) {
  const currentMs   = (now !== undefined) ? now : Date.now();
  let   total       = task.timeSpentSeconds || 0;

  // Add live session time if the timer is currently running
  if (task.timerStartedAt !== null && task.timerStartedAt !== undefined) {
    total += (currentMs - task.timerStartedAt) / 1000;
  }
  return total;
}

/**
 * Sum elapsed seconds across all tasks for a day.
 *
 * @param {Object[]} tasks - Array of task objects for a single day.
 * @param {number}  [now]  - Current timestamp in ms (for live timers).
 * @returns {number} Total seconds across all tasks.
 */
function getTotalTimeForDay(tasks, now) {
  return tasks.reduce((acc, task) => acc + getElapsedSeconds(task, now), 0);
}

/**
 * Escape a string so it is safe to inject into innerHTML.
 * Prevents XSS when displaying user-entered task titles.
 *
 * @param {string} str - Raw user input.
 * @returns {string} HTML-escaped string.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: TASK STORE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TaskStore
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages task persistence through a swappable storage backend.
 *
 * Data model (stored as JSON in a single key):
 * {
 *   "2026-06-14": [
 *     {
 *       id              : string,   // unique identifier
 *       title           : string,   // user-entered task name
 *       status          : string,   // "todo" | "in-progress" | "done"
 *       timeSpentSeconds: number,   // committed timer seconds
 *       timerStartedAt  : number|null, // ms timestamp when timer started; null = stopped
 *       createdAt       : number,   // ms timestamp of creation
 *     }
 *   ],
 *   ...
 * }
 *
 * To use with a mock storage in tests, set: TaskStore._storage = mockStorageObject
 * The storage object must implement: getItem(key), setItem(key, value).
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TaskStore = {
  /** Storage key used in localStorage (or the mock). */
  STORAGE_KEY: 'tasktracker_v1',

  /**
   * Swappable storage backend. Defaults to window.localStorage.
   * Override this property in unit tests with a mock object.
   * @type {{ getItem: Function, setItem: Function }}
   */
  _storage: (typeof localStorage !== 'undefined') ? localStorage : null,

  /**
   * Load the entire tasks map from storage.
   * Returns an empty object on any parse error.
   *
   * @private
   * @returns {Object} Map of dateKey → task[].
   */
  _load() {
    try {
      const raw = this._storage && this._storage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  },

  /**
   * Persist the entire tasks map to storage.
   *
   * @private
   * @param {Object} data - Full tasks map to save.
   */
  _save(data) {
    if (this._storage) {
      this._storage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    }
  },

  /**
   * Retrieve all tasks for a specific date.
   *
   * @param {string} dateKey - Date in YYYY-MM-DD format.
   * @returns {Object[]} Array of task objects (empty array if none).
   */
  getTasksForDate(dateKey) {
    const data = this._load();
    return data[dateKey] || [];
  },

  /**
   * Find a single task by its ID within a given date.
   *
   * @param {string} dateKey - Date in YYYY-MM-DD format.
   * @param {string} taskId  - Task's unique ID.
   * @returns {Object|null} The task object, or null if not found.
   */
  getTask(dateKey, taskId) {
    return this.getTasksForDate(dateKey).find(t => t.id === taskId) || null;
  },

  /**
   * Create and persist a new task for a specific date.
   *
   * @param {string} dateKey - Date in YYYY-MM-DD format.
   * @param {string} title   - Task title (will be trimmed).
   * @returns {Object} The newly created task object.
   * @throws {Error} If title is empty after trimming.
   */
  addTask(dateKey, title) {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('Task title cannot be empty.');

    const data = this._load();
    if (!data[dateKey]) data[dateKey] = [];

    /** @type {Object} Newly created task */
    const task = {
      id              : generateId(),
      title           : trimmed,
      status          : 'todo',     // Initial status
      timeSpentSeconds: 0,          // No time logged yet
      timerStartedAt  : null,       // Timer not running
      createdAt       : Date.now(),
    };

    data[dateKey].push(task);
    this._save(data);
    return task;
  },

  /**
   * Merge updates into an existing task and persist.
   *
   * @param {string} dateKey  - Date in YYYY-MM-DD format.
   * @param {string} taskId   - Task's unique ID.
   * @param {Object} updates  - Key-value pairs to merge into the task.
   * @returns {Object|null} The updated task, or null if not found.
   */
  updateTask(dateKey, taskId, updates) {
    const data  = this._load();
    const tasks = data[dateKey] || [];
    const idx   = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return null;

    tasks[idx]    = { ...tasks[idx], ...updates };
    data[dateKey] = tasks;
    this._save(data);
    return tasks[idx];
  },

  /**
   * Remove a task from a given date and persist.
   *
   * @param {string} dateKey - Date in YYYY-MM-DD format.
   * @param {string} taskId  - Task's unique ID.
   * @returns {boolean} True if deleted, false if not found.
   */
  deleteTask(dateKey, taskId) {
    const data     = this._load();
    const tasks    = data[dateKey] || [];
    const filtered = tasks.filter(t => t.id !== taskId);
    if (filtered.length === tasks.length) return false;   // Not found

    data[dateKey] = filtered;
    this._save(data);
    return true;
  },

  /**
   * Advance the status of a task through the cycle:
   * "todo" → "in-progress" → "done" → "todo"
   *
   * @param {string} dateKey - Date in YYYY-MM-DD format.
   * @param {string} taskId  - Task's unique ID.
   * @returns {Object|null} The updated task, or null if not found.
   */
  cycleStatus(dateKey, taskId) {
    const task = this.getTask(dateKey, taskId);
    if (!task) return null;

    /** Status cycle order */
    const cycle  = { 'todo': 'in-progress', 'in-progress': 'done', 'done': 'todo' };
    const next   = cycle[task.status] || 'todo';
    return this.updateTask(dateKey, taskId, { status: next });
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: DATE NAVIGATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DateNavigator
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages which calendar day the user is currently viewing.
 * Navigation mutates `currentDate` in place so the rest of the app
 * can always read `DateNavigator.getDateKey()` for the active day.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const DateNavigator = {
  /** @type {Date} The currently selected calendar day. */
  currentDate: new Date(),

  /**
   * Get the localStorage key for the currently selected date.
   *
   * @returns {string} e.g. "2026-06-14"
   */
  getDateKey() {
    return dateToKey(this.currentDate);
  },

  /**
   * Get a human-readable label for the currently selected date.
   *
   * @returns {string} e.g. "Sunday, June 14, 2026"
   */
  getDisplayDate() {
    return formatDisplayDate(this.currentDate);
  },

  /**
   * Check whether the currently selected date is today's local date.
   *
   * @returns {boolean}
   */
  isToday() {
    return dateToKey(this.currentDate) === getTodayKey();
  },

  /**
   * Advance the selected date by one calendar day.
   */
  goNext() {
    const d = new Date(this.currentDate);
    d.setDate(d.getDate() + 1);
    this.currentDate = d;
  },

  /**
   * Move the selected date back by one calendar day.
   */
  goPrev() {
    const d = new Date(this.currentDate);
    d.setDate(d.getDate() - 1);
    this.currentDate = d;
  },

  /**
   * Jump the selected date back to today.
   */
  goToday() {
    this.currentDate = new Date();
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: TIMER MANAGER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TimerManager
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages a single active task timer.
 * Only one timer can run at a time; starting a new one auto-stops the current.
 *
 * The live tick callback (`onTick`) is called every second while a timer runs.
 * The app wires `Renderer.renderAll` into `onTick` so the UI stays in sync.
 *
 * Swappable interval functions (_setInterval / _clearInterval) allow unit
 * tests to replace them with fakes that don't require real time passing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TimerManager = {
  /** @type {string|null} ID of the task whose timer is currently running. */
  activeTaskId  : null,

  /** @type {string|null} Date key of the active task. */
  activeDateKey : null,

  /** @type {number|null} Handle returned by setInterval. */
  _intervalId   : null,

  /**
   * Callback invoked once per second while a timer is running.
   * Assign `Renderer.renderAll.bind(Renderer)` after app initialisation.
   * @type {Function|null}
   */
  onTick: null,

  /**
   * Swappable setInterval — override in tests with a no-op or fake.
   * @type {Function}
   */
  _setInterval  : (fn, ms) => setInterval(fn, ms),

  /**
   * Swappable clearInterval — override in tests.
   * @type {Function}
   */
  _clearInterval: (id) => clearInterval(id),

  /**
   * Start the timer for a given task.
   * If another timer is already running, it is stopped first.
   *
   * @param {string} dateKey - Date in YYYY-MM-DD format.
   * @param {string} taskId  - Task's unique ID.
   */
  start(dateKey, taskId) {
    // Stop any currently running timer before starting the new one
    if (this.activeTaskId !== null) {
      this.stop();
    }

    // Persist the start timestamp on the task
    TaskStore.updateTask(dateKey, taskId, { timerStartedAt: Date.now() });

    this.activeTaskId  = taskId;
    this.activeDateKey = dateKey;

    // Tick every second to drive the UI update
    this._intervalId = this._setInterval(() => {
      if (typeof this.onTick === 'function') this.onTick();
    }, 1000);
  },

  /**
   * Stop the currently active timer, committing elapsed seconds to the task.
   * Safe to call when no timer is running (no-op).
   */
  stop() {
    if (this.activeTaskId === null) return;

    // Retrieve the live task to get the start timestamp
    const task = TaskStore.getTask(this.activeDateKey, this.activeTaskId);
    if (task && task.timerStartedAt !== null) {
      const sessionSeconds = (Date.now() - task.timerStartedAt) / 1000;
      TaskStore.updateTask(this.activeDateKey, this.activeTaskId, {
        timeSpentSeconds: (task.timeSpentSeconds || 0) + sessionSeconds,
        timerStartedAt  : null,
      });
    }

    // Clean up interval and state
    this._clearInterval(this._intervalId);
    this._intervalId   = null;
    this.activeTaskId  = null;
    this.activeDateKey = null;
  },

  /**
   * Check whether a specific task's timer is currently running.
   *
   * @param {string} taskId - Task's unique ID.
   * @returns {boolean} True if this task is the active timer.
   */
  isRunning(taskId) {
    return this.activeTaskId === taskId;
  },

  /**
   * On page load, recover any timer sessions that were interrupted by
   * a page refresh or tab close. For each task with a non-null
   * timerStartedAt, accumulate the elapsed time and reset the flag.
   * This ensures no time is silently lost across page loads.
   */
  recoverOrphanedTimers() {
    // Scan all dates stored in TaskStore for running timers
    try {
      const raw = TaskStore._storage && TaskStore._storage.getItem(TaskStore.STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const now  = Date.now();

      Object.keys(data).forEach(dateKey => {
        data[dateKey] = data[dateKey].map(task => {
          if (task.timerStartedAt !== null && task.timerStartedAt !== undefined) {
            // Commit time up to now and stop the timer
            const elapsed = (now - task.timerStartedAt) / 1000;
            return {
              ...task,
              timeSpentSeconds: (task.timeSpentSeconds || 0) + elapsed,
              timerStartedAt  : null,
            };
          }
          return task;
        });
      });

      TaskStore._storage.setItem(TaskStore.STORAGE_KEY, JSON.stringify(data));
    } catch (_) {
      // Non-fatal: if recovery fails, timers simply won't be recovered
    }
  },
};
