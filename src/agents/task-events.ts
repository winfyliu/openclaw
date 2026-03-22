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

const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  accepted: ["planning", "blocked", "cancelled"],
  planning: ["executing", "blocked", "cancelled"],
  executing: ["evaluating", "blocked", "failed", "timeout", "cancelled"],
  evaluating: ["completed", "failed", "blocked", "cancelled"],
  blocked: ["planning", "executing", "blocked", "cancelled"],
  completed: [],
  failed: [],
  timeout: [],
  cancelled: [],
};

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) {
    return true;
  }
  return TASK_TRANSITIONS[from].includes(to);
}

export function allowedTaskTransitions(from: TaskStatus): readonly TaskStatus[] {
  return TASK_TRANSITIONS[from];
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "timeout" || status === "cancelled"
  );
}

export function normalizeTaskProgress(progress?: number): number | undefined {
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(progress)));
}
