/**
 * Backend Polling Bridge
 *
 * Bridges the background-task-executor with OpenClaw's existing task orchestration
 * system (task-registry, task-orchestrator, task-events).
 *
 * This module implements the DeerFlow-style optimization where:
 * 1. A subagent task is submitted to the background executor
 * 2. The backend polls the task status in-memory (zero API cost)
 * 3. Progress events are forwarded to the task-registry for UI updates
 * 4. The final result is returned without additional LLM API calls
 *
 * Integration points:
 * - task-registry: Updates task status and progress
 * - task-orchestrator: Receives completion notifications
 * - task-events: Emits standard task events
 * - subagent-announce: Triggers announce flow on completion
 */

import { randomUUID } from "node:crypto";
import {
  submitBackgroundTask,
  pollUntilComplete,
  getBackgroundTaskResult,
  cleanupBackgroundTask,
  cancelBackgroundTask,
  type BackgroundTaskResult,
  type BackgroundTaskStatus,
  type ExecuteTaskFn,
} from "./background-task-executor.js";
import {
  updateTaskFromRunEvent,
  type TaskRecord,
} from "./task-registry.js";
import {
  type TaskStatus,
} from "./task-events.js";
import {
  markSubagentTaskOutcome,
} from "./task-orchestrator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackendPollingTaskParams = {
  /** The session key of the requester (parent agent). */
  requesterSessionKey: string;
  /** The child session key for the subagent. */
  childSessionKey: string;
  /** The run ID for the subagent execution. */
  runId: string;
  /** Short description of the task. */
  label?: string;
  /** Full task description. */
  task: string;
  /** The actual execution function to run in the background. */
  execute: ExecuteTaskFn;
  /** Optional: callback when the task completes. */
  onComplete?: (result: BackgroundTaskResult) => void | Promise<void>;
  /** Optional: callback for progress updates. */
  onProgress?: (message: string, progress: number) => void;
};

export type BackendPollingResult = {
  taskId: string;
  status: "submitted" | "error";
  error?: string;
};

// ---------------------------------------------------------------------------
// Status Mapping
// ---------------------------------------------------------------------------

function mapBackgroundStatusToTaskStatus(
  bgStatus: BackgroundTaskStatus,
): TaskStatus {
  switch (bgStatus) {
    case "pending":
      return "accepted";
    case "running":
      return "executing";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "timed_out":
      return "timeout";
    case "blocked":
      return "blocked";
    case "cancelled":
      return "cancelled";
    default:
      return "executing";
  }
}

function mapBackgroundStatusToOutcome(
  bgStatus: BackgroundTaskStatus,
): "ok" | "timeout" | "error" | "unknown" {
  switch (bgStatus) {
    case "completed":
      return "ok";
    case "timed_out":
      return "timeout";
    case "failed":
    case "cancelled":
      return "error";
    default:
      return "unknown";
  }
}

function nowVersion(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Core: Submit and Poll
// ---------------------------------------------------------------------------

/**
 * Submit a task for backend polling execution.
 *
 * This is the main integration point. It:
 * 1. Submits the task to the background executor
 * 2. Starts a backend polling loop
 * 3. Forwards progress to the task-registry
 * 4. Triggers completion notifications
 *
 * The caller gets an immediate response with the task ID,
 * and the task runs asynchronously in the background.
 */
export function submitBackendPollingTask(
  params: BackendPollingTaskParams,
): BackendPollingResult {
  try {
    const taskId = submitBackgroundTask({
      taskId: params.runId,
      execute: params.execute,
    });

    // Start the polling loop in the background
    void runBackendPollingLoop({
      taskId,
      runId: params.runId,
      requesterSessionKey: params.requesterSessionKey,
      childSessionKey: params.childSessionKey,
      label: params.label,
      task: params.task,
      onComplete: params.onComplete,
      onProgress: params.onProgress,
    });

    return { taskId, status: "submitted" };
  } catch (err) {
    return {
      taskId: params.runId,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Cancel a backend polling task.
 */
export function cancelBackendPollingTask(taskId: string): boolean {
  return cancelBackgroundTask(taskId);
}

/**
 * Get the current status of a backend polling task.
 * Zero-cost in-memory lookup.
 */
export function getBackendPollingTaskStatus(
  taskId: string,
): BackgroundTaskResult | undefined {
  return getBackgroundTaskResult(taskId);
}

// ---------------------------------------------------------------------------
// Internal: Polling Loop
// ---------------------------------------------------------------------------

async function runBackendPollingLoop(params: {
  taskId: string;
  runId: string;
  requesterSessionKey: string;
  childSessionKey: string;
  label?: string;
  task: string;
  onComplete?: (result: BackgroundTaskResult) => void | Promise<void>;
  onProgress?: (message: string, progress: number) => void;
}): Promise<void> {
  try {
    const result = await pollUntilComplete({
      taskId: params.taskId,
      onProgress: (message) => {
        // Forward progress to task-registry
        void updateTaskFromRunEvent({
          runId: params.runId,
          event: {
            type: "task_progress",
            eventId: randomUUID(),
            taskId: "",
            version: nowVersion(),
            status: "executing",
            progress: message.index > 0 ? Math.min(80, 20 + message.index * 10) : 20,
            message: message.content,
            timestamp: message.timestamp,
          },
        });

        // Notify caller
        const currentResult = getBackgroundTaskResult(params.taskId);
        params.onProgress?.(
          message.content,
          currentResult?.progress ?? 0,
        );
      },
      onStatusChange: (status, taskId) => {
        const taskStatus = mapBackgroundStatusToTaskStatus(status);

        // Forward status change to task-registry
        void updateTaskFromRunEvent({
          runId: params.runId,
          event: {
            type: "task_progress",
            eventId: randomUUID(),
            taskId: "",
            version: nowVersion(),
            status: taskStatus,
            progress: status === "running" ? 10 : status === "completed" ? 100 : undefined,
            message: `Task status: ${status}`,
            timestamp: Date.now(),
          },
        });
      },
    });

    // Task completed - notify the orchestrator
    const outcomeStatus = mapBackgroundStatusToOutcome(result.status);
    markSubagentTaskOutcome({
      runId: params.runId,
      status: outcomeStatus,
      error: result.error,
    });

    // Notify caller
    await params.onComplete?.(result);

    // Clean up after a short delay to allow final reads
    setTimeout(() => {
      cleanupBackgroundTask(params.taskId);
    }, 30_000);
  } catch (err) {
    // If polling fails, mark the task as failed
    markSubagentTaskOutcome({
      runId: params.runId,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Utility: Wrap Gateway Call as Background Task
// ---------------------------------------------------------------------------

/**
 * Create an ExecuteTaskFn that wraps a gateway agent call.
 *
 * This is a convenience helper for the most common use case:
 * running a subagent via the gateway and polling for completion.
 */
export function createGatewayTaskExecutor(params: {
  callGateway: <T>(opts: {
    method: string;
    params: unknown;
    timeoutMs?: number;
    expectFinal?: boolean;
  }) => Promise<T>;
  childSessionKey: string;
  message: string;
  gatewayParams: Record<string, unknown>;
  waitTimeoutMs?: number;
}): ExecuteTaskFn {
  return async ({ taskId, traceId, onProgress, onStatusChange, signal }) => {
    try {
      onStatusChange("running");
      onProgress("Sending task to subagent...", 10);

      // Start the agent run
      const response = await params.callGateway<{ runId?: string }>({
        method: "agent",
        params: {
          message: params.message,
          sessionKey: params.childSessionKey,
          ...params.gatewayParams,
        },
        timeoutMs: 10_000,
      });

      const runId =
        typeof response?.runId === "string" ? response.runId : undefined;

      if (!runId) {
        return { error: "Gateway did not return a run ID." };
      }

      onProgress("Subagent accepted task, waiting for completion...", 20);

      // Wait for the agent run to complete
      const waitResult = await params.callGateway<{
        status?: string;
        error?: string;
        startedAt?: number;
        endedAt?: number;
      }>({
        method: "agent.wait",
        params: {
          runId,
          timeoutMs: params.waitTimeoutMs ?? 120_000,
        },
        timeoutMs: (params.waitTimeoutMs ?? 120_000) + 5_000,
      });

      if (signal.aborted) {
        return { error: "Task was cancelled." };
      }

      if (waitResult?.status === "timeout") {
        return { error: "Subagent execution timed out." };
      }

      if (waitResult?.status === "error") {
        return {
          error: waitResult.error ?? "Subagent execution failed.",
        };
      }

      onProgress("Subagent completed, reading results...", 90);

      // Read the subagent output
      const history = await params.callGateway<{
        messages?: Array<{ role?: string; content?: unknown }>;
      }>({
        method: "chat.history",
        params: { sessionKey: params.childSessionKey, limit: 50 },
        timeoutMs: 10_000,
      });

      const messages = Array.isArray(history?.messages)
        ? history.messages
        : [];
      const lastAssistant = messages
        .filter((m) => m.role === "assistant")
        .pop();
      const resultText =
        typeof lastAssistant?.content === "string"
          ? lastAssistant.content
          : "(no output)";

      onProgress("Task completed successfully.", 100);
      return { result: resultText };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
