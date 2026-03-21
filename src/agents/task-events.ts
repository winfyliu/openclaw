export const TASK_STATUSES = [
  "accepted",
  "planning",
  "executing",
  "evaluating",
  "completed",
  "failed",
  "timeout",
  "blocked",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type TaskProgressEvent = {
  type: "task_progress";
  eventId: string;
  taskId: string;
  version: number;
  status: TaskStatus;
  progress?: number;
  message?: string;
  timestamp: number;
};

export type TaskBlockedReason =
  | "credentials"
  | "permission"
  | "missing_input"
  | "external_dependency"
  | "unknown";

export type TaskBlockedUserInputEvent = {
  type: "task_blocked_user_input";
  eventId: string;
  taskId: string;
  version: number;
  reason: TaskBlockedReason;
  request: string;
  timestamp: number;
};

export type TaskEvent = TaskProgressEvent | TaskBlockedUserInputEvent;

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "timeout" ||
    status === "cancelled"
  );
}

export function normalizeTaskProgress(progress?: number): number | undefined {
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(progress)));
}
