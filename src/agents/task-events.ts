import {
  TASK_NODE_STATUS_CANCELLED,
  TASK_NODE_STATUS_COMPLETED,
  TASK_NODE_STATUS_CREATED,
  TASK_NODE_STATUS_FAILED,
  TASK_NODE_STATUS_RUNNING,
  TASK_NODE_STATUS_TIMEOUT,
  TASK_STATUS_ACCEPTED,
  TASK_STATUS_CANCELLED,
  TASK_STATUS_COMPLETED,
  TASK_STATUS_CREATED,
  TASK_STATUS_FAILED,
  TASK_STATUS_RUNNING,
  TASK_STATUS_WAITING_CHILDREN,
  type TaskNodeStatus,
  type TaskStatus,
} from "./task-ledger.types.js";

const TASK_TERMINAL_STATUSES = new Set<TaskStatus>([
  TASK_STATUS_COMPLETED,
  TASK_STATUS_FAILED,
  TASK_STATUS_CANCELLED,
]);

const TASK_PENDING_STATUSES = new Set<TaskStatus>([
  TASK_STATUS_CREATED,
  TASK_STATUS_ACCEPTED,
  TASK_STATUS_RUNNING,
  TASK_STATUS_WAITING_CHILDREN,
]);

const TASK_FAILURE_STATUSES = new Set<TaskStatus>([TASK_STATUS_FAILED, TASK_STATUS_CANCELLED]);

const TASK_NODE_TERMINAL_STATUSES = new Set<TaskNodeStatus>([
  TASK_NODE_STATUS_COMPLETED,
  TASK_NODE_STATUS_FAILED,
  TASK_NODE_STATUS_TIMEOUT,
  TASK_NODE_STATUS_CANCELLED,
]);

const TASK_NODE_PENDING_STATUSES = new Set<TaskNodeStatus>([
  TASK_NODE_STATUS_CREATED,
  TASK_NODE_STATUS_RUNNING,
]);

const TASK_NODE_FAILURE_STATUSES = new Set<TaskNodeStatus>([
  TASK_NODE_STATUS_FAILED,
  TASK_NODE_STATUS_TIMEOUT,
  TASK_NODE_STATUS_CANCELLED,
]);

const TASK_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  [TASK_STATUS_CREATED]: [TASK_STATUS_ACCEPTED, TASK_STATUS_FAILED, TASK_STATUS_CANCELLED],
  [TASK_STATUS_ACCEPTED]: [
    TASK_STATUS_RUNNING,
    TASK_STATUS_WAITING_CHILDREN,
    TASK_STATUS_FAILED,
    TASK_STATUS_CANCELLED,
  ],
  [TASK_STATUS_RUNNING]: [
    TASK_STATUS_WAITING_CHILDREN,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_CANCELLED,
  ],
  [TASK_STATUS_WAITING_CHILDREN]: [
    TASK_STATUS_RUNNING,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_CANCELLED,
  ],
  [TASK_STATUS_COMPLETED]: [],
  [TASK_STATUS_FAILED]: [],
  [TASK_STATUS_CANCELLED]: [],
};

const TASK_NODE_STATUS_TRANSITIONS: Readonly<Record<TaskNodeStatus, readonly TaskNodeStatus[]>> = {
  [TASK_NODE_STATUS_CREATED]: [
    TASK_NODE_STATUS_RUNNING,
    TASK_NODE_STATUS_COMPLETED,
    TASK_NODE_STATUS_FAILED,
    TASK_NODE_STATUS_TIMEOUT,
    TASK_NODE_STATUS_CANCELLED,
  ],
  [TASK_NODE_STATUS_RUNNING]: [
    TASK_NODE_STATUS_COMPLETED,
    TASK_NODE_STATUS_FAILED,
    TASK_NODE_STATUS_TIMEOUT,
    TASK_NODE_STATUS_CANCELLED,
  ],
  [TASK_NODE_STATUS_COMPLETED]: [],
  [TASK_NODE_STATUS_FAILED]: [],
  [TASK_NODE_STATUS_TIMEOUT]: [],
  [TASK_NODE_STATUS_CANCELLED]: [],
};

export function isTaskTerminalStatus(status: TaskStatus): boolean {
  return TASK_TERMINAL_STATUSES.has(status);
}

export function isTaskPendingStatus(status: TaskStatus): boolean {
  return TASK_PENDING_STATUSES.has(status);
}

export function isTaskFailureStatus(status: TaskStatus): boolean {
  return TASK_FAILURE_STATUSES.has(status);
}

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) {
    return true;
  }
  return TASK_STATUS_TRANSITIONS[from].includes(to);
}

export function isTaskNodeTerminalStatus(status: TaskNodeStatus): boolean {
  return TASK_NODE_TERMINAL_STATUSES.has(status);
}

export function isTaskNodePendingStatus(status: TaskNodeStatus): boolean {
  return TASK_NODE_PENDING_STATUSES.has(status);
}

export function isTaskNodeFailureStatus(status: TaskNodeStatus): boolean {
  return TASK_NODE_FAILURE_STATUSES.has(status);
}

export function canTransitionTaskNodeStatus(from: TaskNodeStatus, to: TaskNodeStatus): boolean {
  if (from === to) {
    return true;
  }
  return TASK_NODE_STATUS_TRANSITIONS[from].includes(to);
}
