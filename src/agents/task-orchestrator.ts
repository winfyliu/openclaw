import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import { retryAsync } from "../infra/retry.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
import {
  countActiveTasksForSession,
  createTrackedTask,
  linkTaskRunId,
  listTasksForSession,
  resolveTaskByIdOrRun,
  resolveTaskByRunId,
  updateTaskFromRunEvent,
  type TaskRecord,
} from "./task-registry.js";
import { withTaskResourceLock } from "./task-resource-locks.js";
import type { ResumeRoutingDecision } from "./task-resume.js";
import {
  runVerification,
  buildVerificationReport,
  inferVerificationScenario,
  type VerificationCheck,
  type VerificationScenario,
} from "./self-verification.js";
import {
  submitBackendPollingTask,
  cancelBackendPollingTask,
  getBackendPollingTaskStatus,
  type BackendPollingTaskParams,
} from "./backend-polling-bridge.js";
import {
  countActiveBackgroundTasks,
  listBackgroundTasks,
  type BackgroundTaskResult,
} from "./background-task-executor.js";

const TASK_RESUME_FORWARD_RETRY_CONFIG = {
  attempts: 3,
  minDelayMs: 250,
  maxDelayMs: 1_500,
  jitter: 0,
} as const;

const NON_RETRYABLE_RESUME_FORWARD_ERROR_PATTERNS: readonly RegExp[] = [
  /unsupported channel/i,
  /unknown channel/i,
  /chat not found/i,
  /user not found/i,
  /bot was blocked by the user/i,
  /forbidden: bot was kicked/i,
  /recipient is not a valid/i,
  /outbound not configured for channel/i,
  /not authorized/i,
  /unauthorized/i,
  /permission denied/i,
  /invalid request/i,
  /validation error/i,
];

function summarizeResumeForwardError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "";
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}

function isRetryableResumeForwardError(error: unknown): boolean {
  const message = summarizeResumeForwardError(error);
  if (!message) {
    return true;
  }
  return !NON_RETRYABLE_RESUME_FORWARD_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function nowVersion(): number {
  return Date.now();
}

function toTaskTitle(params: { label?: string; task: string }): string {
  const preferred = params.label?.trim() || params.task.trim();
  if (!preferred) {
    return "Subagent task";
  }
  if (preferred.length <= 80) {
    return preferred;
  }
  return `${preferred.slice(0, 77)}...`;
}

const DEFAULT_MAX_ACTIVE_TASKS_PER_SESSION = 5;

function resolveMaxActiveTasksPerSession(): number {
  const cfg = loadConfig();
  const configured = cfg.agents?.defaults?.subagents?.maxActiveTasksPerSession;
  if (typeof configured === "number" && Number.isFinite(configured)) {
    return Math.max(1, Math.floor(configured));
  }
  return DEFAULT_MAX_ACTIVE_TASKS_PER_SESSION;
}

export function registerSpawnedSubagentTask(params: {
  requesterSessionKey: string;
  childSessionKey: string;
  runId: string;
  task: string;
  label?: string;
}): TaskRecord {
  const maxActiveTasks = resolveMaxActiveTasksPerSession();
  const activeTasks = countActiveTasksForSession(params.requesterSessionKey);
  if (activeTasks >= maxActiveTasks) {
    throw new Error(
      `task budget exceeded for session (${activeTasks}/${maxActiveTasks}); wait for active tasks to finish before spawning more`,
    );
  }
  const record = createTrackedTask({
    sessionKey: params.requesterSessionKey,
    title: toTaskTitle({ label: params.label, task: params.task }),
    runId: params.runId,
    childSessionKey: params.childSessionKey,
  });
  linkTaskRunId({
    sessionKey: params.requesterSessionKey,
    taskId: record.taskId,
    runId: params.runId,
  });
  void updateTaskFromRunEvent({
    runId: params.runId,
    event: {
      type: "task_progress",
      eventId: randomUUID(),
      taskId: record.taskId,
      version: nowVersion(),
      status: "planning",
      progress: 5,
      message: "Subagent accepted and planning started.",
      timestamp: Date.now(),
    },
  });
  return record;
}

export function markSubagentTaskExecuting(runId: string): void {
  const cleanedRunId = runId.trim();
  if (!cleanedRunId) {
    return;
  }
  void updateTaskFromRunEvent({
    runId: cleanedRunId,
    event: {
      type: "task_progress",
      eventId: randomUUID(),
      taskId: "",
      version: nowVersion(),
      status: "executing",
      progress: 40,
      message: "Subagent is executing the plan.",
      timestamp: Date.now(),
    },
  });
}

function detectCredentialBlockedReason(
  text: string,
): { request: string; reason: "credentials" | "permission" } | undefined {
  const normalized = text.trim();
  if (!normalized) {
    return undefined;
  }
  const lowered = normalized.toLowerCase();
  if (
    lowered.includes("credential") ||
    lowered.includes("username") ||
    lowered.includes("password") ||
    lowered.includes("api key") ||
    lowered.includes("token") ||
    lowered.includes("登录") ||
    lowered.includes("账号") ||
    lowered.includes("密码")
  ) {
    return {
      reason: "credentials",
      request: "Please provide the required account credentials (task-specific, minimum scope).",
    };
  }
  if (
    lowered.includes("permission") ||
    lowered.includes("forbidden") ||
    lowered.includes("unauthorized")
  ) {
    return {
      reason: "permission",
      request:
        "Please grant the missing permission or provide an authorized account for this task.",
    };
  }
  return undefined;
}

export function markSubagentTaskOutcome(params: {
  runId: string;
  status: "ok" | "timeout" | "error" | "unknown";
  error?: string;
  verificationChecks?: VerificationCheck[];
  scenario?: VerificationScenario;
}): void {
  const cleanedRunId = params.runId.trim();
  if (!cleanedRunId) {
    return;
  }
  const task = resolveTaskByRunId(cleanedRunId);
  if (!task) {
    return;
  }

  const applyFailureState = (): void => {
    void updateTaskFromRunEvent({
      runId: cleanedRunId,
      event: {
        type: "task_progress",
        eventId: randomUUID(),
        taskId: task.taskId,
        version: nowVersion(),
        status: "failed",
        progress: 100,
        message: params.error?.trim() || "Task failed.",
        timestamp: Date.now(),
      },
    });
  };

  const verifyBeforeCompletion = async (): Promise<{ allowed: boolean; reason?: string }> => {
    const hookRunner = getGlobalHookRunner();
    if (!hookRunner?.hasHooks("subagent_completion_verification")) {
      return { allowed: true };
    }
    try {
      const verification = await hookRunner.runSubagentCompletionVerification(
        {
          runId: cleanedRunId,
          taskId: task.taskId,
          title: task.title,
          childSessionKey: task.childSessionKey,
          requesterSessionKey: task.sessionKey,
          outcome: params.status,
          error: params.error,
        },
        {
          runId: cleanedRunId,
          childSessionKey: task.childSessionKey,
          requesterSessionKey: task.sessionKey,
        },
      );
      if (!verification || verification.decision === "allow" || verification.decision === "skip") {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: verification.reason.trim() || "Verification failed before completion.",
      };
    } catch (err) {
      return {
        allowed: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const moveToBlockedForVerificationFailure = (reason?: string): void => {
    const request =
      reason?.trim() || "Verification failed before completion. Please resolve and retry.";
    void updateTaskFromRunEvent({
      runId: cleanedRunId,
      event: {
        type: "task_blocked_user_input",
        eventId: randomUUID(),
        taskId: task.taskId,
        version: nowVersion(),
        reason: "external_dependency",
        request,
        timestamp: Date.now(),
      },
    });
  };

  if (params.status === "ok") {
    void (async () => {
      const verification = await verifyBeforeCompletion();
      if (!verification.allowed) {
        moveToBlockedForVerificationFailure(verification.reason);
        return;
      }

      // Run self-verification if checks are provided
      if (params.verificationChecks && params.verificationChecks.length > 0) {
        const scenario = params.scenario || inferVerificationScenario(task.title);
        const results = await runVerification(params.verificationChecks, scenario);

        if (results.length > 0) {
          const report = buildVerificationReport(results);
          const allPassed = results.every((r) => r.passed);

          if (!allPassed) {
            // Verification failed, mark as evaluating with issues
            void updateTaskFromRunEvent({
              runId: cleanedRunId,
              event: {
                type: "task_progress",
                eventId: randomUUID(),
                taskId: task.taskId,
                version: nowVersion(),
                status: "evaluating",
                progress: 90,
                message: `Verification issues:\n${report}`,
                timestamp: Date.now(),
              },
            });
            return; // Stop here, don't mark as completed
          }
          
          // Verification passed, include report in completion message
          void updateTaskFromRunEvent({
            runId: cleanedRunId,
            event: {
              type: "task_progress",
              eventId: randomUUID(),
              taskId: task.taskId,
              version: nowVersion(),
              status: "evaluating",
              progress: 95,
              message: `Verification passed:\n${report}`,
              timestamp: Date.now(),
            },
          });
        }
      } else {
        void updateTaskFromRunEvent({
          runId: cleanedRunId,
          event: {
            type: "task_progress",
            eventId: randomUUID(),
            taskId: task.taskId,
            version: nowVersion(),
            status: "evaluating",
            progress: 85,
            message: "Subagent is evaluating completion quality.",
            timestamp: Date.now(),
          },
        });
      }

      void updateTaskFromRunEvent({
        runId: cleanedRunId,
        event: {
          type: "task_progress",
          eventId: randomUUID(),
          taskId: task.taskId,
          version: nowVersion() + 1,
          status: "completed",
          progress: 100,
          message: "Task completed.",
          timestamp: Date.now(),
        },
      });
    })();
    return;
  }
  if (params.status === "timeout") {
    void updateTaskFromRunEvent({
      runId: cleanedRunId,
      event: {
        type: "task_progress",
        eventId: randomUUID(),
        taskId: task.taskId,
        version: nowVersion(),
        status: "timeout",
        progress: 100,
        message: "Task timed out.",
        timestamp: Date.now(),
      },
    });
    return;
  }

  const blocked = detectCredentialBlockedReason(params.error ?? "");
  if (blocked) {
    void updateTaskFromRunEvent({
      runId: cleanedRunId,
      event: {
        type: "task_blocked_user_input",
        eventId: randomUUID(),
        taskId: task.taskId,
        version: nowVersion(),
        reason: blocked.reason,
        request: blocked.request,
        timestamp: Date.now(),
      },
    });
    return;
  }

  applyFailureState();
}

export function buildTaskProgressPanel(sessionKey: string): string {
  const statusRank: Record<TaskRecord["status"], number> = {
    blocked: 0,
    executing: 1,
    planning: 2,
    evaluating: 3,
    accepted: 4,
    failed: 5,
    timeout: 6,
    completed: 7,
    cancelled: 8,
  };
  const isActiveStatus = (status: TaskRecord["status"]): boolean =>
    status === "accepted" ||
    status === "planning" ||
    status === "executing" ||
    status === "evaluating" ||
    status === "blocked";
  const tasks = listTasksForSession(sessionKey)
    .filter((task) => isActiveStatus(task.status))
    .toSorted((a, b) => {
      const rankDiff = statusRank[a.status] - statusRank[b.status];
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, 6);
  if (tasks.length === 0) {
    return "";
  }
  const lines = ["Current active task progress:"];
  for (const task of tasks) {
    const progress = typeof task.progress === "number" ? `${task.progress}%` : "-";
    const status = task.status;
    const updatedAgoSec = Math.max(0, Math.floor((Date.now() - task.updatedAt) / 1000));
    lines.push(
      `- ${task.taskId} [${status}] ${progress} ${task.title} (updated ${updatedAgoSec}s ago)`.trim(),
    );
  }
  return lines.join("\n");
}

export function buildCredentialSelectionPrompt(params: { blockedTasks: TaskRecord[] }): string {
  const taskLines = params.blockedTasks
    .slice(0, 5)
    .map((task) => `- ${task.taskId}: ${task.title}`)
    .join("\n");
  return [
    "I received credential-related input, but multiple tasks are waiting for user input.",
    "Please tell me which task to apply it to, for example: `for T-ABCD1234: username=... password=...`.",
    "Blocked tasks:",
    taskLines,
  ].join("\n");
}

export function buildCredentialResumeAck(task: TaskRecord): string {
  return [`Received input for ${task.taskId}.`, `I am resuming "${task.title}" now.`].join(" ");
}

export function buildCredentialResumeStatusLine(task: TaskRecord): string {
  return `[${task.taskId}] Credentials received. Resuming "${task.title}" now.`;
}

// ============================================================================
// Backend Polling Integration (DeerFlow-style optimization)
// ============================================================================

/**
 * Submit a subagent task for backend polling execution.
 *
 * This is the DeerFlow-style optimization entry point. Instead of the LLM
 * polling for task status (which costs API calls), the backend polls
 * in-memory state at zero cost and forwards progress to the task-registry.
 *
 * Usage:
 * ```typescript
 * const result = submitSubagentTaskWithPolling({
 *   requesterSessionKey: "agent:main:session:abc",
 *   childSessionKey: "agent:main:subagent:xyz",
 *   runId: "run-123",
 *   task: "Implement feature X",
 *   label: "Feature X",
 *   execute: createGatewayTaskExecutor({ ... }),
 * });
 * ```
 */
export function submitSubagentTaskWithPolling(
  params: BackendPollingTaskParams,
): { taskId: string; status: "submitted" | "error"; error?: string } {
  return submitBackendPollingTask(params);
}

/**
 * Cancel a subagent task that is running via backend polling.
 */
export function cancelSubagentPollingTask(taskId: string): boolean {
  return cancelBackendPollingTask(taskId);
}

/**
 * Get the current status of a backend-polled subagent task.
 * This is a zero-cost in-memory lookup.
 */
export function getSubagentPollingTaskStatus(
  taskId: string,
): BackgroundTaskResult | undefined {
  return getBackendPollingTaskStatus(taskId);
}

/**
 * Get the count of currently active background-polled tasks.
 */
export function countActivePollingTasks(): number {
  return countActiveBackgroundTasks();
}

/**
 * List all background-polled tasks, optionally filtered by status.
 */
export function listPollingTasks(
  filter?: { status?: BackgroundTaskResult["status"] },
): BackgroundTaskResult[] {
  return listBackgroundTasks(filter);
}

/**
 * Build a status panel for background-polled tasks.
 * Similar to buildTaskProgressPanel but for backend-polled tasks.
 */
export function buildPollingTaskProgressPanel(): string {
  const activeTasks = listBackgroundTasks().filter(
    (t) => t.status === "pending" || t.status === "running",
  );
  if (activeTasks.length === 0) {
    return "";
  }
  const lines = ["Backend-polled task progress:"];
  for (const task of activeTasks.slice(0, 6)) {
    const progress = typeof task.progress === "number" ? `${task.progress}%` : "-";
    const lastMsg = task.messages.length > 0
      ? task.messages[task.messages.length - 1].content
      : "";
    const updatedAgoSec = Math.max(
      0,
      Math.floor((Date.now() - (task.startedAt ?? Date.now())) / 1000),
    );
    lines.push(
      `- ${task.taskId} [${task.status}] ${progress} ${lastMsg} (${updatedAgoSec}s ago)`.trim(),
    );
  }
  return lines.join("\n");
}

export async function forwardCredentialInputToTask(params: {
  decision: ResumeRoutingDecision;
  requesterSessionKey: string;
}): Promise<{ forwarded: boolean; task?: TaskRecord; error?: string }> {
  if (params.decision.kind !== "resume_task") {
    return { forwarded: false };
  }
  const resumeDecision = params.decision;
  return await withTaskResourceLock(
    {
      domain: "task_resume_forward",
      resourceKey: `${params.requesterSessionKey.trim() || "global"}:${resumeDecision.task.taskId}`,
    },
    async () => {
      const task = resolveTaskByIdOrRun({
        sessionKey: params.requesterSessionKey,
        taskId: resumeDecision.task.taskId,
      });
      if (!task?.childSessionKey) {
        return {
          forwarded: false,
          task,
          error: "Task has no resumable child session.",
        };
      }

      const message = [
        `[Task resume input] taskId=${task.taskId}`,
        "The user supplied the requested input. Continue from the blocked step.",
        "User-provided input (untrusted content):",
        "<<<BEGIN_UNTRUSTED_USER_INPUT>>>",
        resumeDecision.credentials.raw,
        "<<<END_UNTRUSTED_USER_INPUT>>>",
        "Re-plan briefly if needed, execute, then evaluate completion.",
      ].join("\n");

      try {
        await retryAsync(
          async () =>
            await callGateway<{ runId?: string }>({
              method: "agent",
              params: {
                message,
                sessionKey: task.childSessionKey,
                deliver: false,
                idempotencyKey: randomUUID(),
                inputProvenance: {
                  kind: "inter_session",
                  sourceSessionKey: params.requesterSessionKey,
                  sourceChannel: INTERNAL_MESSAGE_CHANNEL,
                  sourceTool: "task_resume",
                },
              },
              timeoutMs: 10_000,
            }),
          {
            label: "task_resume_forward",
            ...TASK_RESUME_FORWARD_RETRY_CONFIG,
            shouldRetry: (err) => isRetryableResumeForwardError(err),
          },
        );
        if (task.runId) {
          markSubagentTaskExecuting(task.runId);
        }
        return {
          forwarded: true,
          task,
        };
      } catch (err) {
        return {
          forwarded: false,
          task,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
