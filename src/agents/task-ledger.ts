import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import {
  canTransitionTaskNodeStatus,
  canTransitionTaskStatus,
  isTaskNodeFailureStatus,
  isTaskNodePendingStatus,
  isTaskNodeTerminalStatus,
  isTaskTerminalStatus,
} from "./task-events.js";
import { loadTaskLedgerFromDisk, saveTaskLedgerToDisk } from "./task-ledger.store.js";
import {
  TASK_NODE_KIND_ROOT_RUN,
  TASK_NODE_STATUS_CANCELLED,
  TASK_NODE_STATUS_COMPLETED,
  TASK_NODE_STATUS_CREATED,
  TASK_NODE_STATUS_FAILED,
  TASK_NODE_STATUS_RUNNING,
  TASK_NODE_STATUS_TIMEOUT,
  TASK_STATUS_ACCEPTED,
  TASK_STATUS_COMPLETED,
  TASK_STATUS_CREATED,
  TASK_STATUS_FAILED,
  TASK_STATUS_RUNNING,
  TASK_STATUS_WAITING_CHILDREN,
  type AttachRootRunParams,
  type CreateRootTaskParams,
  type MarkTaskNodeCancelledParams,
  type MarkTaskNodeCompletedParams,
  type MarkTaskNodeFailedParams,
  type MarkTaskNodeRunningParams,
  type MarkTaskNodeTimeoutParams,
  type RegisterTaskNodeParams,
  type TaskNodeRecord,
  type TaskRecord,
  type TaskTokenUsage,
  type UpdateTaskNodeUsageParams,
  type UpdateTaskSummaryParams,
} from "./task-ledger.types.js";

type TaskLedgerState = {
  restored: boolean;
  tasks: Map<string, TaskRecord>;
  runIdToTaskId: Map<string, string>;
  sessionKeyToTaskId: Map<string, string>;
  nodeIdToTaskId: Map<string, string>;
};

const TASK_LEDGER_STATE_KEY = Symbol.for("openclaw.taskLedger.state");

const state = resolveGlobalSingleton<TaskLedgerState>(TASK_LEDGER_STATE_KEY, () => ({
  restored: false,
  tasks: new Map<string, TaskRecord>(),
  runIdToTaskId: new Map<string, string>(),
  sessionKeyToTaskId: new Map<string, string>(),
  nodeIdToTaskId: new Map<string, string>(),
}));

function makeZeroUsage(): TaskTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function normalizeUsage(usage?: Partial<TaskTokenUsage>): TaskTokenUsage {
  const input = Math.max(0, normalizeFiniteNumber(usage?.inputTokens) ?? 0);
  const output = Math.max(0, normalizeFiniteNumber(usage?.outputTokens) ?? 0);
  const totalCandidate = normalizeFiniteNumber(usage?.totalTokens);
  const total = Math.max(0, totalCandidate ?? input + output);
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
  };
}

function cloneUsage(usage: TaskTokenUsage): TaskTokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

function cloneTaskNode(node: TaskNodeRecord): TaskNodeRecord {
  return {
    ...node,
    tokenUsage: cloneUsage(node.tokenUsage),
  };
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    tokenUsage: cloneUsage(task.tokenUsage),
    requesterOrigin: task.requesterOrigin ? { ...task.requesterOrigin } : undefined,
    nodes: task.nodes.map((node) => cloneTaskNode(node)),
  };
}

function persistTaskLedger() {
  try {
    saveTaskLedgerToDisk(state.tasks);
  } catch {
    // ignore persistence failures
  }
}

function rebuildIndexesFromTasks() {
  state.runIdToTaskId.clear();
  state.sessionKeyToTaskId.clear();
  state.nodeIdToTaskId.clear();

  for (const [taskId, task] of state.tasks.entries()) {
    if (task.rootRunId) {
      state.runIdToTaskId.set(task.rootRunId, taskId);
    }
    if (task.rootSessionKey) {
      state.sessionKeyToTaskId.set(task.rootSessionKey, taskId);
    }
    for (const node of task.nodes) {
      state.nodeIdToTaskId.set(node.nodeId, taskId);
      if (node.runId) {
        state.runIdToTaskId.set(node.runId, taskId);
      }
      if (node.sessionKey) {
        state.sessionKeyToTaskId.set(node.sessionKey, taskId);
      }
    }
  }
}

function ensureTaskLedgerRestored() {
  if (state.restored) {
    return;
  }
  state.restored = true;
  try {
    const restored = loadTaskLedgerFromDisk();
    if (restored.size > 0) {
      state.tasks.clear();
      for (const [taskId, task] of restored.entries()) {
        state.tasks.set(taskId, task);
      }
    }
  } catch {
    // ignore restore failures
  }
  rebuildIndexesFromTasks();
}

function indexTask(task: TaskRecord) {
  if (task.rootRunId) {
    state.runIdToTaskId.set(task.rootRunId, task.taskId);
  }
  if (task.rootSessionKey) {
    state.sessionKeyToTaskId.set(task.rootSessionKey, task.taskId);
  }
  for (const node of task.nodes) {
    state.nodeIdToTaskId.set(node.nodeId, task.taskId);
    if (node.runId) {
      state.runIdToTaskId.set(node.runId, task.taskId);
    }
    if (node.sessionKey) {
      state.sessionKeyToTaskId.set(node.sessionKey, task.taskId);
    }
  }
}

function upsertNodeIndex(taskId: string, node: TaskNodeRecord) {
  state.nodeIdToTaskId.set(node.nodeId, taskId);
  if (node.runId) {
    state.runIdToTaskId.set(node.runId, taskId);
  }
  if (node.sessionKey) {
    state.sessionKeyToTaskId.set(node.sessionKey, taskId);
  }
}

function ensureRootNode(task: TaskRecord): TaskNodeRecord {
  let node = task.nodes.find((entry) => entry.kind === TASK_NODE_KIND_ROOT_RUN);
  if (node) {
    return node;
  }
  node = {
    nodeId: `root:${task.taskId}`,
    taskId: task.taskId,
    kind: TASK_NODE_KIND_ROOT_RUN,
    label: task.title,
    status: TASK_NODE_STATUS_CREATED,
    runId: task.rootRunId,
    sessionKey: task.rootSessionKey,
    createdAt: task.createdAt,
    tokenUsage: makeZeroUsage(),
  };
  task.nodes.push(node);
  upsertNodeIndex(task.taskId, node);
  return node;
}

function recomputeTaskTokenUsage(task: TaskRecord) {
  const nextUsage = makeZeroUsage();
  for (const node of task.nodes) {
    nextUsage.inputTokens += Math.max(0, node.tokenUsage.inputTokens);
    nextUsage.outputTokens += Math.max(0, node.tokenUsage.outputTokens);
    nextUsage.totalTokens += Math.max(0, node.tokenUsage.totalTokens);
  }
  task.tokenUsage = nextUsage;
}

function inferTaskStatus(task: TaskRecord): TaskRecord["status"] {
  if (isTaskTerminalStatus(task.status)) {
    return task.status;
  }

  const rootNode = task.nodes.find((entry) => entry.kind === TASK_NODE_KIND_ROOT_RUN);
  const hasFailureNode = task.nodes.some((entry) => isTaskNodeFailureStatus(entry.status));
  const hasPendingNode = task.nodes.some((entry) => isTaskNodePendingStatus(entry.status));

  if (hasFailureNode) {
    return TASK_STATUS_FAILED;
  }

  if (!rootNode) {
    return task.rootRunId ? TASK_STATUS_ACCEPTED : TASK_STATUS_CREATED;
  }

  if (
    rootNode.status === TASK_NODE_STATUS_FAILED ||
    rootNode.status === TASK_NODE_STATUS_TIMEOUT ||
    rootNode.status === TASK_NODE_STATUS_CANCELLED
  ) {
    return TASK_STATUS_FAILED;
  }

  if (rootNode.status === TASK_NODE_STATUS_COMPLETED) {
    return hasPendingNode ? TASK_STATUS_WAITING_CHILDREN : TASK_STATUS_COMPLETED;
  }

  if (rootNode.status === TASK_NODE_STATUS_RUNNING) {
    return hasPendingNode ? TASK_STATUS_RUNNING : TASK_STATUS_WAITING_CHILDREN;
  }

  return TASK_STATUS_ACCEPTED;
}

function reconcileTask(task: TaskRecord) {
  recomputeTaskTokenUsage(task);
  const inferred = inferTaskStatus(task);
  if (task.status === inferred) {
    return;
  }
  if (canTransitionTaskStatus(task.status, inferred)) {
    task.status = inferred;
  } else if (!isTaskTerminalStatus(task.status)) {
    task.status = inferred;
  }
  if (task.status === TASK_STATUS_RUNNING && !task.startedAt) {
    task.startedAt = Date.now();
  }
  if (task.status === TASK_STATUS_COMPLETED || task.status === TASK_STATUS_FAILED) {
    task.endedAt ??= Date.now();
  }
}

function resolveTask(taskId: string): TaskRecord | null {
  ensureTaskLedgerRestored();
  return state.tasks.get(taskId) ?? null;
}

function findNodeForMutation(
  task: TaskRecord,
  selector: {
    nodeId?: string;
    runId?: string;
  },
): TaskNodeRecord | null {
  if (selector.nodeId) {
    return task.nodes.find((entry) => entry.nodeId === selector.nodeId) ?? null;
  }
  if (selector.runId) {
    const byRun = task.nodes.find((entry) => entry.runId === selector.runId);
    if (byRun) {
      return byRun;
    }
  }
  return null;
}

function applyTaskNodeStatus(params: {
  task: TaskRecord;
  node: TaskNodeRecord;
  nextStatus: TaskNodeRecord["status"];
  startedAt?: number;
  endedAt?: number;
  error?: string;
  resultPreview?: string;
}): boolean {
  const { task, node, nextStatus } = params;
  if (!canTransitionTaskNodeStatus(node.status, nextStatus)) {
    if (node.status !== nextStatus) {
      return false;
    }
  }

  node.status = nextStatus;

  if (nextStatus === TASK_NODE_STATUS_RUNNING) {
    const startedAt = params.startedAt ?? Date.now();
    node.startedAt ??= startedAt;
    task.startedAt ??= startedAt;
    task.acceptedAt ??= startedAt;
  }

  if (isTaskNodeTerminalStatus(nextStatus)) {
    node.endedAt = params.endedAt ?? node.endedAt ?? Date.now();
  }

  if (typeof params.error === "string") {
    const trimmed = params.error.trim();
    node.error = trimmed || undefined;
    task.latestError = trimmed || task.latestError;
  }
  if (typeof params.resultPreview === "string") {
    const trimmed = params.resultPreview.trim();
    node.resultPreview = trimmed || undefined;
  }

  reconcileTask(task);
  return true;
}

export function initTaskLedger() {
  ensureTaskLedgerRestored();
}

export function createRootTask(params: CreateRootTaskParams): TaskRecord {
  ensureTaskLedgerRestored();
  const existing = state.tasks.get(params.taskId);
  if (existing) {
    return cloneTask(existing);
  }

  const createdAt = params.createdAt ?? Date.now();
  const record: TaskRecord = {
    taskId: params.taskId,
    rootSessionKey: params.rootSessionKey,
    rootRunId: undefined,
    requesterAgentId: params.requesterAgentId,
    requesterChannel: params.requesterChannel,
    requesterAccountId: params.requesterAccountId,
    requesterTo: params.requesterTo,
    requesterThreadId: params.requesterThreadId,
    requesterOrigin: params.requesterOrigin,
    title: params.title,
    originalMessage: params.originalMessage,
    status: TASK_STATUS_CREATED,
    createdAt,
    tokenUsage: makeZeroUsage(),
    nodes: [],
    showTokenUsage: params.showTokenUsage,
  };

  state.tasks.set(record.taskId, record);
  indexTask(record);
  persistTaskLedger();
  return cloneTask(record);
}

export function attachRootRun(params: AttachRootRunParams): TaskRecord | null {
  const task = resolveTask(params.taskId);
  if (!task) {
    return null;
  }

  const acceptedAt = params.startedAt ?? Date.now();
  task.rootRunId = params.runId;
  task.acceptedAt ??= acceptedAt;
  if (params.startedAt) {
    task.startedAt ??= params.startedAt;
  }

  const rootNode = ensureRootNode(task);
  rootNode.runId = params.runId;
  rootNode.sessionKey = params.sessionKey ?? rootNode.sessionKey ?? task.rootSessionKey;
  if (params.startedAt && !rootNode.startedAt) {
    rootNode.startedAt = params.startedAt;
  }

  upsertNodeIndex(task.taskId, rootNode);
  state.runIdToTaskId.set(params.runId, task.taskId);
  if (rootNode.sessionKey) {
    state.sessionKeyToTaskId.set(rootNode.sessionKey, task.taskId);
  }

  reconcileTask(task);
  persistTaskLedger();
  return cloneTask(task);
}

export function registerTaskNode(params: RegisterTaskNodeParams): TaskNodeRecord | null {
  const task = resolveTask(params.taskId);
  if (!task) {
    return null;
  }

  const existing = task.nodes.find((entry) => entry.nodeId === params.nodeId);
  if (existing) {
    if (params.runId && !existing.runId) {
      existing.runId = params.runId;
    }
    if (params.sessionKey && !existing.sessionKey) {
      existing.sessionKey = params.sessionKey;
    }
    if (params.controllerSessionKey && !existing.controllerSessionKey) {
      existing.controllerSessionKey = params.controllerSessionKey;
    }
    upsertNodeIndex(task.taskId, existing);
    reconcileTask(task);
    persistTaskLedger();
    return cloneTaskNode(existing);
  }

  const node: TaskNodeRecord = {
    nodeId: params.nodeId,
    taskId: params.taskId,
    parentNodeId: params.parentNodeId,
    kind: params.kind,
    label: params.label,
    status: TASK_NODE_STATUS_CREATED,
    runId: params.runId,
    sessionKey: params.sessionKey,
    controllerSessionKey: params.controllerSessionKey,
    createdAt: params.createdAt ?? Date.now(),
    tokenUsage: makeZeroUsage(),
  };

  task.nodes.push(node);
  upsertNodeIndex(task.taskId, node);
  reconcileTask(task);
  persistTaskLedger();
  return cloneTaskNode(node);
}

export function markTaskNodeRunning(params: MarkTaskNodeRunningParams): TaskNodeRecord | null {
  const task = resolveTask(params.taskId);
  if (!task) {
    return null;
  }
  const node = findNodeForMutation(task, {
    nodeId: params.nodeId,
    runId: params.runId,
  });
  if (!node) {
    return null;
  }
  const changed = applyTaskNodeStatus({
    task,
    node,
    nextStatus: TASK_NODE_STATUS_RUNNING,
    startedAt: params.startedAt,
  });
  if (!changed) {
    return cloneTaskNode(node);
  }
  persistTaskLedger();
  return cloneTaskNode(node);
}

export function markTaskNodeCompleted(params: MarkTaskNodeCompletedParams): TaskNodeRecord | null {
  const task = resolveTask(params.taskId);
  if (!task) {
    return null;
  }
  const node = findNodeForMutation(task, {
    nodeId: params.nodeId,
    runId: params.runId,
  });
  if (!node) {
    return null;
  }
  const changed = applyTaskNodeStatus({
    task,
    node,
    nextStatus: TASK_NODE_STATUS_COMPLETED,
    endedAt: params.endedAt,
    resultPreview: params.resultPreview,
  });
  if (!changed) {
    return cloneTaskNode(node);
  }
  persistTaskLedger();
  return cloneTaskNode(node);
}

export function markTaskNodeFailed(params: MarkTaskNodeFailedParams): TaskNodeRecord | null {
  const task = resolveTask(params.taskId);
  if (!task) {
    return null;
  }
  const node = findNodeForMutation(task, {
    nodeId: params.nodeId,
    runId: params.runId,
  });
  if (!node) {
    return null;
  }
  const changed = applyTaskNodeStatus({
    task,
    node,
    nextStatus: TASK_NODE_STATUS_FAILED,
    endedAt: params.endedAt,
    error: params.error,
    resultPreview: params.resultPreview,
  });
  if (!changed) {
    return cloneTaskNode(node);
  }
  persistTaskLedger();
  return cloneTaskNode(node);
}

export function markTaskNodeTimeout(params: MarkTaskNodeTimeoutParams): TaskNodeRecord | null {
  const task = resolveTask(params.taskId);
  if (!task) {
    return null;
  }
  const node = findNodeForMutation(task, {
    nodeId: params.nodeId,
    runId: params.runId,
  });
  if (!node) {
    return null;
  }
  const changed = applyTaskNodeStatus({
    task,
    node,
    nextStatus: TASK_NODE_STATUS_TIMEOUT,
    endedAt: params.endedAt,
    error: params.error,
  });
  if (!changed) {
    return cloneTaskNode(node);
  }
  persistTaskLedger();
  return cloneTaskNode(node);
}

export function markTaskNodeCancelled(params: MarkTaskNodeCancelledParams): TaskNodeRecord | null {
  const task = resolveTask(params.taskId);
  if (!task) {
    return null;
  }
  const node = findNodeForMutation(task, {
    nodeId: params.nodeId,
    runId: params.runId,
  });
  if (!node) {
    return null;
  }
  const changed = applyTaskNodeStatus({
    task,
    node,
    nextStatus: TASK_NODE_STATUS_CANCELLED,
    endedAt: params.endedAt,
    error: params.error,
  });
  if (!changed) {
    return cloneTaskNode(node);
  }
  persistTaskLedger();
  return cloneTaskNode(node);
}

export function updateTaskNodeUsage(params: UpdateTaskNodeUsageParams): TaskNodeRecord | null {
  const task = resolveTask(params.taskId);
  if (!task) {
    return null;
  }
  const node = findNodeForMutation(task, {
    nodeId: params.nodeId,
    runId: params.runId,
  });
  if (!node) {
    return null;
  }

  const mergedUsage = normalizeUsage({
    inputTokens:
      normalizeFiniteNumber(params.usage.inputTokens) ??
      normalizeFiniteNumber(node.tokenUsage.inputTokens),
    outputTokens:
      normalizeFiniteNumber(params.usage.outputTokens) ??
      normalizeFiniteNumber(node.tokenUsage.outputTokens),
    totalTokens:
      normalizeFiniteNumber(params.usage.totalTokens) ??
      normalizeFiniteNumber(node.tokenUsage.totalTokens),
  });

  node.tokenUsage = mergedUsage;
  reconcileTask(task);
  persistTaskLedger();
  return cloneTaskNode(node);
}

export function updateTaskSummary(params: UpdateTaskSummaryParams): TaskRecord | null {
  const task = resolveTask(params.taskId);
  if (!task) {
    return null;
  }
  if (typeof params.latestSummary === "string") {
    task.latestSummary = params.latestSummary.trim() || undefined;
  }
  if (typeof params.latestError === "string") {
    task.latestError = params.latestError.trim() || undefined;
  }
  persistTaskLedger();
  return cloneTask(task);
}

export function setTaskStatus(taskId: string, status: TaskRecord["status"]): TaskRecord | null {
  const task = resolveTask(taskId);
  if (!task) {
    return null;
  }
  if (task.status !== status) {
    if (canTransitionTaskStatus(task.status, status) || !isTaskTerminalStatus(task.status)) {
      task.status = status;
    }
  }
  if ((status === TASK_STATUS_COMPLETED || status === TASK_STATUS_FAILED) && !task.endedAt) {
    task.endedAt = Date.now();
  }
  persistTaskLedger();
  return cloneTask(task);
}

export function getTask(taskId: string): TaskRecord | null {
  const task = resolveTask(taskId);
  return task ? cloneTask(task) : null;
}

export function listTasks(): TaskRecord[] {
  ensureTaskLedgerRestored();
  return [...state.tasks.values()].map((entry) => cloneTask(entry));
}

export function listTaskNodes(taskId: string): TaskNodeRecord[] {
  const task = resolveTask(taskId);
  if (!task) {
    return [];
  }
  return task.nodes.map((entry) => cloneTaskNode(entry));
}

export function findTaskIdByRunId(runId?: string): string | undefined {
  ensureTaskLedgerRestored();
  if (!runId) {
    return undefined;
  }
  return state.runIdToTaskId.get(runId.trim());
}

export function findTaskIdBySessionKey(sessionKey?: string): string | undefined {
  ensureTaskLedgerRestored();
  if (!sessionKey) {
    return undefined;
  }
  return state.sessionKeyToTaskId.get(sessionKey.trim());
}

export function findTaskByRunId(runId?: string): TaskRecord | null {
  const taskId = findTaskIdByRunId(runId);
  return taskId ? getTask(taskId) : null;
}

export function findTaskBySessionKey(sessionKey?: string): TaskRecord | null {
  const taskId = findTaskIdBySessionKey(sessionKey);
  return taskId ? getTask(taskId) : null;
}

export function resetTaskLedgerForTests(opts?: { persist?: boolean }) {
  state.tasks.clear();
  state.runIdToTaskId.clear();
  state.sessionKeyToTaskId.clear();
  state.nodeIdToTaskId.clear();
  state.restored = true;
  if (opts?.persist !== false) {
    persistTaskLedger();
  }
}
