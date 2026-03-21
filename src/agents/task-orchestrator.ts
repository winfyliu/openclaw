import { randomUUID } from "node:crypto";
import { callGateway } from "../gateway/call.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
import {
  createTrackedTask,
  linkTaskRunId,
  listTasksForSession,
  resolveTaskByIdOrRun,
  updateTaskFromRunEvent,
  type TaskRecord,
} from "./task-registry.js";
import type { ResumeRoutingDecision } from "./task-resume.js";

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

export function registerSpawnedSubagentTask(params: {
  requesterSessionKey: string;
  childSessionKey: string;
  runId: string;
  task: string;
  label?: string;
}): TaskRecord {
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

function detectCredentialBlockedReason(text: string):
  | { request: string; reason: "credentials" | "permission" }
  | undefined {
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
    lowered.includes("\u767b\u5f55") ||
    lowered.includes("\u8d26\u53f7") ||
    lowered.includes("\u5bc6\u7801")
  ) {
    return {
      reason: "credentials",
      request: "Please provide the required account credentials (task-specific, minimum scope).",
    };
  }
  if (lowered.includes("permission") || lowered.includes("forbidden") || lowered.includes("unauthorized")) {
    return {
      reason: "permission",
      request: "Please grant the missing permission or provide an authorized account for this task.",
    };
  }
  return undefined;
}

export function markSubagentTaskOutcome(params: {
  runId: string;
  status: "ok" | "timeout" | "error" | "unknown";
  error?: string;
}): void {
  const cleanedRunId = params.runId.trim();
  if (!cleanedRunId) {
    return;
  }
  if (params.status === "ok") {
    void updateTaskFromRunEvent({
      runId: cleanedRunId,
      event: {
        type: "task_progress",
        eventId: randomUUID(),
        taskId: "",
        version: nowVersion(),
        status: "evaluating",
        progress: 85,
        message: "Subagent is evaluating completion quality.",
        timestamp: Date.now(),
      },
    });
    void updateTaskFromRunEvent({
      runId: cleanedRunId,
      event: {
        type: "task_progress",
        eventId: randomUUID(),
        taskId: "",
        version: nowVersion() + 1,
        status: "completed",
        progress: 100,
        message: "Task completed.",
        timestamp: Date.now(),
      },
    });
    return;
  }

  if (params.status === "timeout") {
    void updateTaskFromRunEvent({
      runId: cleanedRunId,
      event: {
        type: "task_progress",
        eventId: randomUUID(),
        taskId: "",
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
        taskId: "",
        version: nowVersion(),
        reason: blocked.reason,
        request: blocked.request,
        timestamp: Date.now(),
      },
    });
    return;
  }

  void updateTaskFromRunEvent({
    runId: cleanedRunId,
    event: {
      type: "task_progress",
      eventId: randomUUID(),
      taskId: "",
      version: nowVersion(),
      status: "failed",
      progress: 100,
      message: params.error?.trim() || "Task failed.",
      timestamp: Date.now(),
    },
  });
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
  const tasks = listTasksForSession(sessionKey)
    .sort((a, b) => {
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
  const lines = ["Current task progress:"];
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

export function buildCredentialSelectionPrompt(params: {
  blockedTasks: TaskRecord[];
}): string {
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
  return [
    `Received input for ${task.taskId}.`,
    `I am resuming \"${task.title}\" now.`,
  ].join(" ");
}

export function buildCredentialResumeStatusLine(task: TaskRecord): string {
  return `[${task.taskId}] Credentials received. Resuming \"${task.title}\" now.`;
}

export async function forwardCredentialInputToTask(params: {
  decision: ResumeRoutingDecision;
  requesterSessionKey: string;
}): Promise<{ forwarded: boolean; task?: TaskRecord; error?: string }> {
  if (params.decision.kind !== "resume_task") {
    return { forwarded: false };
  }
  const task = resolveTaskByIdOrRun({
    sessionKey: params.requesterSessionKey,
    taskId: params.decision.task.taskId,
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
    params.decision.credentials.raw,
    "<<<END_UNTRUSTED_USER_INPUT>>>",
    "Re-plan briefly if needed, execute, then evaluate completion.",
  ].join("\n");

  try {
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
    });
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
}
