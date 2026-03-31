/**
 * Background Task Executor
 *
 * Inspired by DeerFlow's dual-pool backend polling architecture.
 * Provides in-memory task state management with zero-cost status queries,
 * eliminating the need for LLM to poll task status via API calls.
 *
 * Key design decisions:
 * - Uses in-memory Map + Mutex for thread-safe state management
 * - Configurable polling interval (default 5s, matching DeerFlow)
 * - Automatic cleanup of completed tasks after retention period
 * - Integrates with OpenClaw's existing task-registry and task-events systems
 */

import { randomUUID } from "node:crypto";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackgroundTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "blocked"
  | "cancelled";

export type BackgroundTaskProgressMessage = {
  index: number;
  content: string;
  timestamp: number;
};

export type BackgroundTaskResult = {
  taskId: string;
  traceId: string;
  status: BackgroundTaskStatus;
  result?: string;
  error?: string;
  progress: number;
  messages: BackgroundTaskProgressMessage[];
  startedAt?: number;
  completedAt?: number;
  lastPolledAt?: number;
  pollCount: number;
};

export type BackgroundTaskConfig = {
  /** Polling interval in milliseconds (default: 5000) */
  pollIntervalMs: number;
  /** Maximum polling duration in milliseconds (default: 900000 = 15 min) */
  maxPollDurationMs: number;
  /** Task retention period after completion in milliseconds (default: 3600000 = 1 hour) */
  retentionMs: number;
  /** Maximum concurrent background tasks (default: 5) */
  maxConcurrentTasks: number;
};

export type ExecuteTaskFn = (params: {
  taskId: string;
  traceId: string;
  onProgress: (message: string, progress?: number) => void;
  onStatusChange: (status: BackgroundTaskStatus) => void;
  signal: AbortSignal;
}) => Promise<{ result?: string; error?: string }>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKGROUND_TASK_EXECUTOR_KEY = Symbol.for("openclaw.backgroundTaskExecutor");

const DEFAULT_CONFIG: BackgroundTaskConfig = {
  pollIntervalMs: 5_000,
  maxPollDurationMs: 15 * 60 * 1_000,
  retentionMs: 60 * 60 * 1_000,
  maxConcurrentTasks: 5,
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type BackgroundTaskExecutorState = {
  tasks: Map<string, BackgroundTaskResult>;
  activeTasks: Set<string>;
  abortControllers: Map<string, AbortController>;
  gcTimer?: ReturnType<typeof setInterval>;
};

const state = resolveGlobalSingleton<BackgroundTaskExecutorState>(
  BACKGROUND_TASK_EXECUTOR_KEY,
  () => ({
    tasks: new Map(),
    activeTasks: new Set(),
    abortControllers: new Map(),
  }),
);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let currentConfig: BackgroundTaskConfig = { ...DEFAULT_CONFIG };

export function configureBackgroundTaskExecutor(
  config: Partial<BackgroundTaskConfig>,
): void {
  currentConfig = { ...DEFAULT_CONFIG, ...config };
}

export function getBackgroundTaskConfig(): Readonly<BackgroundTaskConfig> {
  return { ...currentConfig };
}

// ---------------------------------------------------------------------------
// Core: Task Lifecycle
// ---------------------------------------------------------------------------

/**
 * Submit a new background task for execution.
 *
 * This is the main entry point. The task function runs asynchronously,
 * and callers can poll the result via `getBackgroundTaskResult()` at zero cost.
 *
 * @returns The task ID for status polling.
 */
export function submitBackgroundTask(params: {
  taskId?: string;
  traceId?: string;
  execute: ExecuteTaskFn;
}): string {
  const taskId = params.taskId ?? `BG-${randomUUID().slice(0, 8)}`.toUpperCase();
  const traceId = params.traceId ?? randomUUID().slice(0, 8);

  // Check concurrency limit
  if (state.activeTasks.size >= currentConfig.maxConcurrentTasks) {
    throw new Error(
      `Background task limit reached (${state.activeTasks.size}/${currentConfig.maxConcurrentTasks}). ` +
        `Wait for active tasks to finish before submitting more.`,
    );
  }

  // Create initial task result
  const result: BackgroundTaskResult = {
    taskId,
    traceId,
    status: "pending",
    progress: 0,
    messages: [],
    pollCount: 0,
  };

  state.tasks.set(taskId, result);
  state.activeTasks.add(taskId);

  // Create abort controller for cancellation support
  const abortController = new AbortController();
  state.abortControllers.set(taskId, abortController);

  // Start async execution
  void executeTaskInBackground(taskId, traceId, params.execute, abortController);

  // Ensure GC timer is running
  ensureGcTimer();

  return taskId;
}

/**
 * Get the current result of a background task.
 *
 * This is a zero-cost in-memory lookup (no API calls).
 * Returns undefined if the task does not exist.
 */
export function getBackgroundTaskResult(
  taskId: string,
): BackgroundTaskResult | undefined {
  const result = state.tasks.get(taskId);
  if (result) {
    result.lastPolledAt = Date.now();
    result.pollCount += 1;
  }
  return result ? { ...result, messages: [...result.messages] } : undefined;
}

/**
 * List all background tasks, optionally filtered by status.
 */
export function listBackgroundTasks(
  filter?: { status?: BackgroundTaskStatus },
): BackgroundTaskResult[] {
  const results: BackgroundTaskResult[] = [];
  for (const result of state.tasks.values()) {
    if (filter?.status && result.status !== filter.status) {
      continue;
    }
    results.push({ ...result, messages: [...result.messages] });
  }
  return results.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/**
 * Cancel a running background task.
 */
export function cancelBackgroundTask(taskId: string): boolean {
  const result = state.tasks.get(taskId);
  if (!result) {
    return false;
  }

  if (isTerminalStatus(result.status)) {
    return false;
  }

  const abortController = state.abortControllers.get(taskId);
  if (abortController) {
    abortController.abort();
  }

  result.status = "cancelled";
  result.completedAt = Date.now();
  result.error = "Task cancelled by user.";
  state.activeTasks.delete(taskId);
  state.abortControllers.delete(taskId);

  return true;
}

/**
 * Clean up a completed task from memory.
 *
 * Should be called after the caller has consumed the result.
 * Only removes tasks in terminal states.
 */
export function cleanupBackgroundTask(taskId: string): boolean {
  const result = state.tasks.get(taskId);
  if (!result) {
    return false;
  }

  if (!isTerminalStatus(result.status) && result.completedAt == null) {
    return false;
  }

  state.tasks.delete(taskId);
  state.activeTasks.delete(taskId);
  state.abortControllers.delete(taskId);
  return true;
}

/**
 * Get the count of currently active (non-terminal) background tasks.
 */
export function countActiveBackgroundTasks(): number {
  return state.activeTasks.size;
}

// ---------------------------------------------------------------------------
// Core: Backend Polling (DeerFlow-style)
// ---------------------------------------------------------------------------

/**
 * Poll a background task until it reaches a terminal state.
 *
 * This implements DeerFlow's backend polling pattern:
 * - Polls in-memory state every `pollIntervalMs` (default 5s)
 * - Zero API cost (pure memory reads)
 * - Calls `onProgress` for each new message
 * - Returns the final result when the task completes
 *
 * @returns The final BackgroundTaskResult.
 */
export async function pollUntilComplete(params: {
  taskId: string;
  onProgress?: (message: BackgroundTaskProgressMessage) => void;
  onStatusChange?: (status: BackgroundTaskStatus, taskId: string) => void;
  pollIntervalMs?: number;
  maxPollDurationMs?: number;
  signal?: AbortSignal;
}): Promise<BackgroundTaskResult> {
  const pollInterval = params.pollIntervalMs ?? currentConfig.pollIntervalMs;
  const maxDuration = params.maxPollDurationMs ?? currentConfig.maxPollDurationMs;
  const startTime = Date.now();
  let lastMessageCount = 0;
  let lastStatus: BackgroundTaskStatus | undefined;

  while (true) {
    // Check abort signal
    if (params.signal?.aborted) {
      const result = getBackgroundTaskResult(params.taskId);
      if (result) {
        return result;
      }
      throw new Error(`Task ${params.taskId} polling aborted.`);
    }

    const result = getBackgroundTaskResult(params.taskId);

    if (!result) {
      throw new Error(`Task ${params.taskId} not found in background tasks.`);
    }

    // Notify status changes
    if (result.status !== lastStatus) {
      lastStatus = result.status;
      params.onStatusChange?.(result.status, params.taskId);
    }

    // Notify new progress messages
    if (result.messages.length > lastMessageCount) {
      for (let i = lastMessageCount; i < result.messages.length; i++) {
        params.onProgress?.(result.messages[i]);
      }
      lastMessageCount = result.messages.length;
    }

    // Check terminal states
    if (isTerminalStatus(result.status)) {
      return result;
    }

    // Check polling timeout
    if (Date.now() - startTime > maxDuration) {
      return {
        ...result,
        status: "timed_out",
        error: `Polling timed out after ${Math.round(maxDuration / 1000)}s.`,
        completedAt: Date.now(),
      };
    }

    // Wait before next poll
    await sleep(pollInterval, params.signal);
  }
}

// ---------------------------------------------------------------------------
// Internal: Execution
// ---------------------------------------------------------------------------

async function executeTaskInBackground(
  taskId: string,
  traceId: string,
  execute: ExecuteTaskFn,
  abortController: AbortController,
): Promise<void> {
  const result = state.tasks.get(taskId);
  if (!result) {
    return;
  }

  // Transition to running
  result.status = "running";
  result.startedAt = Date.now();

  const onProgress = (message: string, progress?: number): void => {
    const taskResult = state.tasks.get(taskId);
    if (!taskResult) {
      return;
    }
    taskResult.messages.push({
      index: taskResult.messages.length,
      content: message,
      timestamp: Date.now(),
    });
    if (typeof progress === "number") {
      taskResult.progress = Math.max(0, Math.min(100, Math.round(progress)));
    }
  };

  const onStatusChange = (status: BackgroundTaskStatus): void => {
    const taskResult = state.tasks.get(taskId);
    if (!taskResult || isTerminalStatus(taskResult.status)) {
      return;
    }
    taskResult.status = status;
  };

  // Set up timeout
  const timeoutId = setTimeout(() => {
    abortController.abort();
    const taskResult = state.tasks.get(taskId);
    if (taskResult && !isTerminalStatus(taskResult.status)) {
      taskResult.status = "timed_out";
      taskResult.error = `Execution timed out after ${Math.round(currentConfig.maxPollDurationMs / 1000)}s.`;
      taskResult.completedAt = Date.now();
      state.activeTasks.delete(taskId);
      state.abortControllers.delete(taskId);
    }
  }, currentConfig.maxPollDurationMs);

  try {
    const outcome = await execute({
      taskId,
      traceId,
      onProgress,
      onStatusChange,
      signal: abortController.signal,
    });

    // Only update if not already in a terminal state (e.g., timed out or cancelled)
    const taskResult = state.tasks.get(taskId);
    if (taskResult && !isTerminalStatus(taskResult.status)) {
      if (outcome.error) {
        taskResult.status = "failed";
        taskResult.error = outcome.error;
      } else {
        taskResult.status = "completed";
        taskResult.result = outcome.result;
        taskResult.progress = 100;
      }
      taskResult.completedAt = Date.now();
    }
  } catch (err) {
    const taskResult = state.tasks.get(taskId);
    if (taskResult && !isTerminalStatus(taskResult.status)) {
      taskResult.status = "failed";
      taskResult.error = err instanceof Error ? err.message : String(err);
      taskResult.completedAt = Date.now();
    }
  } finally {
    clearTimeout(timeoutId);
    state.activeTasks.delete(taskId);
    state.abortControllers.delete(taskId);
  }
}

// ---------------------------------------------------------------------------
// Internal: Garbage Collection
// ---------------------------------------------------------------------------

function ensureGcTimer(): void {
  if (state.gcTimer) {
    return;
  }
  // Run GC every 5 minutes
  state.gcTimer = setInterval(runGarbageCollection, 5 * 60 * 1_000);
  // Allow the process to exit even if the timer is still running
  if (state.gcTimer && typeof state.gcTimer === "object" && "unref" in state.gcTimer) {
    state.gcTimer.unref();
  }
}

function runGarbageCollection(): void {
  const now = Date.now();
  const deadline = now - currentConfig.retentionMs;

  for (const [taskId, result] of state.tasks.entries()) {
    if (!isTerminalStatus(result.status)) {
      continue;
    }
    const completedAt = result.completedAt ?? result.startedAt ?? 0;
    if (completedAt > deadline) {
      continue;
    }
    state.tasks.delete(taskId);
    state.activeTasks.delete(taskId);
    state.abortControllers.delete(taskId);
  }

  // Stop GC timer if no tasks remain
  if (state.tasks.size === 0 && state.gcTimer) {
    clearInterval(state.gcTimer);
    state.gcTimer = undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTerminalStatus(status: BackgroundTaskStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "cancelled"
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Testing Utilities
// ---------------------------------------------------------------------------

export const __testing = {
  resetState(): void {
    for (const controller of state.abortControllers.values()) {
      controller.abort();
    }
    state.tasks.clear();
    state.activeTasks.clear();
    state.abortControllers.clear();
    if (state.gcTimer) {
      clearInterval(state.gcTimer);
      state.gcTimer = undefined;
    }
    currentConfig = { ...DEFAULT_CONFIG };
  },
  getState(): Readonly<BackgroundTaskExecutorState> {
    return state;
  },
};
