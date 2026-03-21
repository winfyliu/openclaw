import { randomUUID } from "node:crypto";
import {
  loadSessionStore,
  mergeSessionEntry,
  resolveStorePath,
  updateSessionStore,
  type SessionTaskRuntimeEntry,
  type SessionTaskRuntimeState,
} from "../config/sessions.js";
import { loadConfig } from "../config/config.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { resolveSessionAgentId } from "./agent-scope.js";
import {
  isTerminalTaskStatus,
  normalizeTaskProgress,
  type TaskBlockedReason,
  type TaskEvent,
  type TaskStatus,
} from "./task-events.js";

const TASK_REGISTRY_KEY = Symbol.for("openclaw.taskRegistry");

export type TaskRecord = {
  taskId: string;
  sessionKey: string;
  runId?: string;
  childSessionKey?: string;
  title: string;
  status: TaskStatus;
  progress?: number;
  lastMessage?: string;
  blockedReason?: TaskBlockedReason;
  blockedRequest?: string;
  blockedAt?: number;
  lastVersion: number;
  lastEventId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

type SessionTaskState = {
  byId: Map<string, TaskRecord>;
  byRunId: Map<string, string>;
};

type TaskRegistryState = {
  sessions: Map<string, SessionTaskState>;
  hydratedSessions: Set<string>;
};

const state = resolveGlobalSingleton<TaskRegistryState>(TASK_REGISTRY_KEY, () => ({
  sessions: new Map(),
  hydratedSessions: new Set(),
}));

const TASK_RUNTIME_SCHEMA_VERSION = 1;
const MAX_PERSISTED_TASKS_PER_SESSION = 40;

function toStoreTaskEntry(record: TaskRecord): SessionTaskRuntimeEntry {
  return {
    taskId: record.taskId,
    runId: record.runId,
    childSessionKey: record.childSessionKey,
    title: record.title,
    status: record.status,
    progress: record.progress,
    lastMessage: record.lastMessage,
    blockedReason: record.blockedReason,
    blockedRequest: record.blockedRequest,
    blockedAt: record.blockedAt,
    lastVersion: record.lastVersion,
    lastEventId: record.lastEventId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
  };
}

function fromStoreTaskEntry(sessionKey: string, entry: SessionTaskRuntimeEntry): TaskRecord | undefined {
  const taskId = entry.taskId?.trim().toUpperCase();
  if (!taskId) {
    return undefined;
  }
  return {
    taskId,
    sessionKey,
    runId: entry.runId?.trim() || undefined,
    childSessionKey: entry.childSessionKey?.trim() || undefined,
    title: entry.title?.trim() || "Untitled task",
    status: entry.status,
    progress: normalizeTaskProgress(entry.progress),
    lastMessage: entry.lastMessage?.trim() || undefined,
    blockedReason: entry.blockedReason,
    blockedRequest: entry.blockedRequest?.trim() || undefined,
    blockedAt: entry.blockedAt,
    lastVersion: Math.max(0, Math.floor(entry.lastVersion || 0)),
    lastEventId: entry.lastEventId?.trim() || undefined,
    createdAt: Math.max(0, Math.floor(entry.createdAt || Date.now())),
    updatedAt: Math.max(0, Math.floor(entry.updatedAt || Date.now())),
    completedAt:
      typeof entry.completedAt === "number" && Number.isFinite(entry.completedAt)
        ? entry.completedAt
        : undefined,
  };
}

function resolveSessionStorePath(sessionKey: string): string {
  const cfg = loadConfig();
  const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
  return resolveStorePath(cfg.session?.store, { agentId });
}

function persistSessionTasks(sessionKey: string): void {
  const cleanSessionKey = sessionKey.trim();
  if (!cleanSessionKey) {
    return;
  }
  const sessionState = state.sessions.get(cleanSessionKey);
  if (!sessionState) {
    return;
  }
  const persistedTasks = [...sessionState.byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PERSISTED_TASKS_PER_SESSION)
    .map(toStoreTaskEntry);
  const storePath = resolveSessionStorePath(cleanSessionKey);
  void updateSessionStore(storePath, (store) => {
    const existing = store[cleanSessionKey];
    const taskOrchestrator: SessionTaskRuntimeState = {
      schemaVersion: TASK_RUNTIME_SCHEMA_VERSION,
      tasks: persistedTasks,
    };
    store[cleanSessionKey] = mergeSessionEntry(existing, {
      taskOrchestrator,
    });
  }).catch(() => {
    // Best-effort persistence.
  });
}

function hydrateSessionTasks(sessionKey: string): void {
  const cleanSessionKey = sessionKey.trim() || "global";
  if (state.hydratedSessions.has(cleanSessionKey)) {
    return;
  }
  state.hydratedSessions.add(cleanSessionKey);
  if (cleanSessionKey === "global") {
    return;
  }
  const sessionState = getSessionState(cleanSessionKey);
  const storePath = resolveSessionStorePath(cleanSessionKey);
  try {
    const store = loadSessionStore(storePath);
    const entry = store[cleanSessionKey];
    const runtimeState = entry?.taskOrchestrator;
    if (!runtimeState || !Array.isArray(runtimeState.tasks)) {
      return;
    }
    for (const rawTask of runtimeState.tasks) {
      const parsed = fromStoreTaskEntry(cleanSessionKey, rawTask);
      if (!parsed) {
        continue;
      }
      sessionState.byId.set(parsed.taskId, parsed);
      if (parsed.runId) {
        sessionState.byRunId.set(parsed.runId, parsed.taskId);
      }
    }
  } catch {
    // Best-effort hydration.
  }
}

function getSessionState(sessionKey: string): SessionTaskState {
  const key = sessionKey.trim() || "global";
  hydrateSessionTasks(key);
  const existing = state.sessions.get(key);
  if (existing) {
    return existing;
  }
  const created: SessionTaskState = {
    byId: new Map(),
    byRunId: new Map(),
  };
  state.sessions.set(key, created);
  return created;
}

function findSessionStateByRunId(runId: string): SessionTaskState | undefined {
  const key = runId.trim();
  if (!key) {
    return undefined;
  }
  for (const sessionState of state.sessions.values()) {
    if (sessionState.byRunId.has(key)) {
      return sessionState;
    }
  }
  return undefined;
}

function cloneTask(record: TaskRecord): TaskRecord {
  return { ...record };
}

function updateTaskFromEvent(record: TaskRecord, event: TaskEvent): boolean {
  if (record.lastEventId && record.lastEventId === event.eventId) {
    return false;
  }
  if (event.version <= record.lastVersion) {
    return false;
  }

  record.lastEventId = event.eventId;
  record.lastVersion = event.version;
  record.updatedAt = event.timestamp;

  if (event.type === "task_progress") {
    record.status = event.status;
    record.progress = normalizeTaskProgress(event.progress);
    record.lastMessage = event.message?.trim() || record.lastMessage;
    if (isTerminalTaskStatus(event.status)) {
      record.completedAt = event.timestamp;
    }
    if (event.status !== "blocked") {
      record.blockedReason = undefined;
      record.blockedRequest = undefined;
      record.blockedAt = undefined;
    }
    return true;
  }

  record.status = "blocked";
  record.blockedReason = event.reason;
  record.blockedRequest = event.request.trim();
  record.blockedAt = event.timestamp;
  record.lastMessage = event.request.trim();
  return true;
}

export function createTrackedTask(params: {
  sessionKey: string;
  title: string;
  runId?: string;
  childSessionKey?: string;
  taskId?: string;
}): TaskRecord {
  const sessionState = getSessionState(params.sessionKey);
  const now = Date.now();
  const taskId = (params.taskId?.trim() || `T-${randomUUID().slice(0, 8)}`).toUpperCase();
  const record: TaskRecord = {
    taskId,
    sessionKey: params.sessionKey,
    runId: params.runId?.trim() || undefined,
    childSessionKey: params.childSessionKey?.trim() || undefined,
    title: params.title.trim() || "Untitled task",
    status: "accepted",
    progress: 0,
    lastVersion: 0,
    createdAt: now,
    updatedAt: now,
  };
  sessionState.byId.set(record.taskId, record);
  if (record.runId) {
    sessionState.byRunId.set(record.runId, record.taskId);
  }
  persistSessionTasks(params.sessionKey);
  return cloneTask(record);
}

export function linkTaskRunId(params: {
  sessionKey: string;
  taskId: string;
  runId: string;
}): boolean {
  const sessionState = getSessionState(params.sessionKey);
  const record = sessionState.byId.get(params.taskId.trim().toUpperCase());
  const runId = params.runId.trim();
  if (!record || !runId) {
    return false;
  }
  if (record.runId && record.runId !== runId) {
    sessionState.byRunId.delete(record.runId);
  }
  record.runId = runId;
  record.updatedAt = Date.now();
  sessionState.byRunId.set(runId, record.taskId);
  persistSessionTasks(params.sessionKey);
  return true;
}

export function updateTaskFromRunEvent(params: {
  runId: string;
  event: TaskEvent;
}): TaskRecord | undefined {
  const runId = params.runId.trim();
  if (!runId) {
    return undefined;
  }
  const sessionState = findSessionStateByRunId(runId);
  if (!sessionState) {
    return undefined;
  }
  const taskId = sessionState.byRunId.get(runId);
  if (!taskId) {
    return undefined;
  }
  const record = sessionState.byId.get(taskId);
  if (!record) {
    return undefined;
  }
  if (!updateTaskFromEvent(record, params.event)) {
    return undefined;
  }
  persistSessionTasks(record.sessionKey);
  return cloneTask(record);
}

export function listTasksForSession(sessionKey: string): TaskRecord[] {
  const sessionState = state.sessions.get(sessionKey.trim() || "global");
  if (!sessionState) {
    return [];
  }
  return [...sessionState.byId.values()]
    .map(cloneTask)
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

export function getBlockedTasksForSession(sessionKey: string): TaskRecord[] {
  return listTasksForSession(sessionKey).filter((task) => task.status === "blocked");
}

export function resolveTaskByIdOrRun(params: {
  sessionKey: string;
  taskId?: string;
  runId?: string;
}): TaskRecord | undefined {
  const sessionState = state.sessions.get(params.sessionKey.trim() || "global");
  if (!sessionState) {
    return undefined;
  }
  const taskId = params.taskId?.trim().toUpperCase();
  if (taskId) {
    const byId = sessionState.byId.get(taskId);
    return byId ? cloneTask(byId) : undefined;
  }
  const runId = params.runId?.trim();
  if (!runId) {
    return undefined;
  }
  const mappedTaskId = sessionState.byRunId.get(runId);
  if (!mappedTaskId) {
    return undefined;
  }
  const byRun = sessionState.byId.get(mappedTaskId);
  return byRun ? cloneTask(byRun) : undefined;
}

export function resolveTaskByRunId(runId: string): TaskRecord | undefined {
  const cleaned = runId.trim();
  if (!cleaned) {
    return undefined;
  }
  const sessionState = findSessionStateByRunId(cleaned);
  if (!sessionState) {
    return undefined;
  }
  const taskId = sessionState.byRunId.get(cleaned);
  if (!taskId) {
    return undefined;
  }
  const record = sessionState.byId.get(taskId);
  return record ? cloneTask(record) : undefined;
}
