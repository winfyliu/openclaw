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

// ============================================================================
// Phase 1 Task Status (for task-ledger compatibility)
// ============================================================================

export const TASK_LEDGER_STATUSES = [
  "created",
  "accepted",
  "running",
  "waiting_children",
  "completed",
  "failed",
  "cancelled",
] as const;

export type TaskLedgerStatus = (typeof TASK_LEDGER_STATUSES)[number];

const TASK_LEDGER_TRANSITIONS: Record<TaskLedgerStatus, readonly TaskLedgerStatus[]> = {
  created: ["accepted", "cancelled"],
  accepted: ["running", "cancelled"],
  running: ["waiting_children", "completed", "failed", "cancelled"],
  waiting_children: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionTaskLedgerStatus(
  from: TaskLedgerStatus,
  to: TaskLedgerStatus,
): boolean {
  if (from === to) {
    return true;
  }
  return TASK_LEDGER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTaskLedgerTerminalStatus(status: TaskLedgerStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function isTaskLedgerPendingStatus(status: TaskLedgerStatus): boolean {
  return status === "created" || status === "accepted" || status === "running" || status === "waiting_children";
}

export function isTaskLedgerFailureStatus(status: TaskLedgerStatus): boolean {
  return status === "failed" || status === "cancelled";
}

// Note: task-ledger.ts should use canTransitionTaskLedgerStatus for Phase 1 status types

// ============================================================================
// Task Node Status Helpers (for task-ledger / Phase 1 control plane)
// ============================================================================

export const TASK_NODE_STATUSES = [
  "created",
  "running",
  "completed",
  "failed",
  "timeout",
  "cancelled",
] as const;

export type TaskNodeStatus = (typeof TASK_NODE_STATUSES)[number];

const TASK_NODE_TRANSITIONS: Record<TaskNodeStatus, readonly TaskNodeStatus[]> = {
  created: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "timeout", "cancelled"],
  completed: [],
  failed: [],
  timeout: [],
  cancelled: [],
};

export function canTransitionTaskNodeStatus(from: TaskNodeStatus, to: TaskNodeStatus): boolean {
  if (from === to) {
    return true;
  }
  return TASK_NODE_TRANSITIONS[from].includes(to);
}

export function isTaskNodeTerminalStatus(status: TaskNodeStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "timeout" ||
    status === "cancelled"
  );
}

export function isTaskNodeFailureStatus(status: TaskNodeStatus): boolean {
  return status === "failed" || status === "timeout" || status === "cancelled";
}

export function isTaskNodePendingStatus(status: TaskNodeStatus): boolean {
  return status === "created" || status === "running";
}

// Re-export for task-ledger compatibility
export function isTaskTerminalStatus(status: TaskStatus): boolean {
  return isTerminalTaskStatus(status);
}

// ============================================================================
// Additional Task Status Helpers (for task-ledger compatibility)
// ============================================================================

export function isTaskPendingStatus(status: TaskStatus): boolean {
  return (
    status === "accepted" ||
    status === "planning" ||
    status === "executing" ||
    status === "evaluating" ||
    status === "blocked"
  );
}

export function isTaskFailureStatus(status: TaskStatus): boolean {
  return status === "failed" || status === "timeout" || status === "cancelled";
}
