import type { DeliveryContext } from "../utils/delivery-context.js";

export const TASK_STATUS_CREATED = "created" as const;
export const TASK_STATUS_ACCEPTED = "accepted" as const;
export const TASK_STATUS_RUNNING = "running" as const;
export const TASK_STATUS_WAITING_CHILDREN = "waiting_children" as const;
export const TASK_STATUS_COMPLETED = "completed" as const;
export const TASK_STATUS_FAILED = "failed" as const;
export const TASK_STATUS_CANCELLED = "cancelled" as const;

export type TaskStatus =
  | typeof TASK_STATUS_CREATED
  | typeof TASK_STATUS_ACCEPTED
  | typeof TASK_STATUS_RUNNING
  | typeof TASK_STATUS_WAITING_CHILDREN
  | typeof TASK_STATUS_COMPLETED
  | typeof TASK_STATUS_FAILED
  | typeof TASK_STATUS_CANCELLED;

export const TASK_NODE_STATUS_CREATED = "created" as const;
export const TASK_NODE_STATUS_RUNNING = "running" as const;
export const TASK_NODE_STATUS_COMPLETED = "completed" as const;
export const TASK_NODE_STATUS_FAILED = "failed" as const;
export const TASK_NODE_STATUS_TIMEOUT = "timeout" as const;
export const TASK_NODE_STATUS_CANCELLED = "cancelled" as const;

export type TaskNodeStatus =
  | typeof TASK_NODE_STATUS_CREATED
  | typeof TASK_NODE_STATUS_RUNNING
  | typeof TASK_NODE_STATUS_COMPLETED
  | typeof TASK_NODE_STATUS_FAILED
  | typeof TASK_NODE_STATUS_TIMEOUT
  | typeof TASK_NODE_STATUS_CANCELLED;

export const TASK_NODE_KIND_ROOT_RUN = "root_run" as const;
export const TASK_NODE_KIND_SUBAGENT_RUN = "subagent_run" as const;

export type TaskNodeKind = typeof TASK_NODE_KIND_ROOT_RUN | typeof TASK_NODE_KIND_SUBAGENT_RUN;

export type TaskTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type TaskNodeRecord = {
  nodeId: string;
  taskId: string;
  parentNodeId?: string;

  kind: TaskNodeKind;
  label: string;
  status: TaskNodeStatus;

  runId?: string;
  sessionKey?: string;
  controllerSessionKey?: string;

  createdAt: number;
  startedAt?: number;
  endedAt?: number;

  tokenUsage: TaskTokenUsage;

  error?: string;
  resultPreview?: string;
};

export type TaskRecord = {
  taskId: string;
  rootSessionKey: string;
  rootRunId?: string;

  requesterAgentId?: string;
  requesterChannel?: string;
  requesterAccountId?: string;
  requesterTo?: string;
  requesterThreadId?: string;
  requesterOrigin?: DeliveryContext;

  title: string;
  originalMessage: string;
  status: TaskStatus;

  createdAt: number;
  acceptedAt?: number;
  startedAt?: number;
  endedAt?: number;

  tokenUsage: TaskTokenUsage;

  nodes: TaskNodeRecord[];
  latestSummary?: string;
  latestError?: string;

  showTokenUsage: boolean;
};

export type PersistedTaskLedgerVersion = 1;

export type PersistedTaskLedger = {
  version: PersistedTaskLedgerVersion;
  tasks: Record<string, TaskRecord>;
};

export type CreateRootTaskParams = {
  taskId: string;
  rootSessionKey: string;
  title: string;
  originalMessage: string;
  requesterAgentId?: string;
  requesterChannel?: string;
  requesterAccountId?: string;
  requesterTo?: string;
  requesterThreadId?: string;
  requesterOrigin?: DeliveryContext;
  showTokenUsage: boolean;
  createdAt?: number;
};

export type AttachRootRunParams = {
  taskId: string;
  runId: string;
  sessionKey?: string;
  startedAt?: number;
};

export type RegisterTaskNodeParams = {
  nodeId: string;
  taskId: string;
  parentNodeId?: string;
  kind: TaskNodeKind;
  label: string;
  runId?: string;
  sessionKey?: string;
  controllerSessionKey?: string;
  createdAt?: number;
};

export type MarkTaskNodeRunningParams = {
  taskId: string;
  nodeId?: string;
  runId?: string;
  startedAt?: number;
};

export type MarkTaskNodeCompletedParams = {
  taskId: string;
  nodeId?: string;
  runId?: string;
  endedAt?: number;
  resultPreview?: string;
};

export type MarkTaskNodeFailedParams = {
  taskId: string;
  nodeId?: string;
  runId?: string;
  endedAt?: number;
  error?: string;
  resultPreview?: string;
};

export type MarkTaskNodeTimeoutParams = {
  taskId: string;
  nodeId?: string;
  runId?: string;
  endedAt?: number;
  error?: string;
};

export type MarkTaskNodeCancelledParams = {
  taskId: string;
  nodeId?: string;
  runId?: string;
  endedAt?: number;
  error?: string;
};

export type UpdateTaskNodeUsageParams = {
  taskId: string;
  nodeId?: string;
  runId?: string;
  usage: Partial<TaskTokenUsage>;
};

export type UpdateTaskSummaryParams = {
  taskId: string;
  latestSummary?: string;
  latestError?: string;
};
