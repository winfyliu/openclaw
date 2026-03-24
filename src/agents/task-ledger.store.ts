import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";
import {
  TASK_NODE_STATUS_CREATED,
  TASK_STATUS_CREATED,
  type PersistedTaskLedger,
  type TaskNodeRecord,
  type TaskRecord,
  type TaskTokenUsage,
} from "./task-ledger.types.js";

const TASK_LEDGER_VERSION = 1 as const;

function resolveTaskStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OPENCLAW_STATE_DIR?.trim();
  if (explicit) {
    return resolveStateDir(env);
  }
  if (env.VITEST || env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "openclaw-test-state", String(process.pid));
  }
  return resolveStateDir(env);
}

export function resolveTaskLedgerPath(): string {
  return path.join(resolveTaskStateDir(process.env), "tasks", "ledger.json");
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeUsage(value: unknown): TaskTokenUsage {
  const src = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const inputTokens = normalizeFiniteNumber(src?.inputTokens) ?? 0;
  const outputTokens = normalizeFiniteNumber(src?.outputTokens) ?? 0;
  const totalCandidate = normalizeFiniteNumber(src?.totalTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalCandidate ?? inputTokens + outputTokens,
  };
}

function normalizeNode(value: unknown, taskId: string): TaskNodeRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const nodeId = normalizeOptionalText(raw.nodeId);
  if (!nodeId) {
    return null;
  }
  const label = normalizeOptionalText(raw.label) ?? nodeId;
  const createdAt = normalizeFiniteNumber(raw.createdAt) ?? Date.now();
  const status = normalizeOptionalText(raw.status) ?? TASK_NODE_STATUS_CREATED;
  const runId = normalizeOptionalText(raw.runId);
  const sessionKey = normalizeOptionalText(raw.sessionKey);
  const controllerSessionKey = normalizeOptionalText(raw.controllerSessionKey);
  const parentNodeId = normalizeOptionalText(raw.parentNodeId);
  const kind = normalizeOptionalText(raw.kind) ?? "subagent_run";
  const startedAt = normalizeFiniteNumber(raw.startedAt);
  const endedAt = normalizeFiniteNumber(raw.endedAt);

  return {
    nodeId,
    taskId,
    parentNodeId,
    kind: kind === "root_run" ? "root_run" : "subagent_run",
    label,
    status:
      status === "running" ||
      status === "completed" ||
      status === "failed" ||
      status === "timeout" ||
      status === "cancelled"
        ? status
        : TASK_NODE_STATUS_CREATED,
    runId,
    sessionKey,
    controllerSessionKey,
    createdAt,
    startedAt,
    endedAt,
    tokenUsage: normalizeUsage(raw.tokenUsage),
    error: normalizeOptionalText(raw.error),
    resultPreview: normalizeOptionalText(raw.resultPreview),
  };
}

function normalizeTaskRecord(value: unknown): TaskRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const taskId = normalizeOptionalText(raw.taskId);
  const rootSessionKey = normalizeOptionalText(raw.rootSessionKey);
  if (!taskId || !rootSessionKey) {
    return null;
  }

  const nodesRaw = Array.isArray(raw.nodes) ? raw.nodes : [];
  const nodes: TaskNodeRecord[] = [];
  for (const nodeValue of nodesRaw) {
    const node = normalizeNode(nodeValue, taskId);
    if (node) {
      nodes.push(node);
    }
  }

  const status = normalizeOptionalText(raw.status) ?? TASK_STATUS_CREATED;

  return {
    taskId,
    rootSessionKey,
    rootRunId: normalizeOptionalText(raw.rootRunId),
    requesterAgentId: normalizeOptionalText(raw.requesterAgentId),
    requesterChannel: normalizeOptionalText(raw.requesterChannel),
    requesterAccountId: normalizeOptionalText(raw.requesterAccountId),
    requesterTo: normalizeOptionalText(raw.requesterTo),
    requesterThreadId: normalizeOptionalText(raw.requesterThreadId),
    requesterOrigin:
      raw.requesterOrigin && typeof raw.requesterOrigin === "object"
        ? (raw.requesterOrigin as TaskRecord["requesterOrigin"])
        : undefined,
    title: normalizeOptionalText(raw.title) ?? taskId,
    originalMessage: normalizeOptionalText(raw.originalMessage) ?? "",
    status:
      status === "accepted" ||
      status === "running" ||
      status === "waiting_children" ||
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
        ? status
        : TASK_STATUS_CREATED,
    createdAt: normalizeFiniteNumber(raw.createdAt) ?? Date.now(),
    acceptedAt: normalizeFiniteNumber(raw.acceptedAt),
    startedAt: normalizeFiniteNumber(raw.startedAt),
    endedAt: normalizeFiniteNumber(raw.endedAt),
    tokenUsage: normalizeUsage(raw.tokenUsage),
    nodes,
    latestSummary: normalizeOptionalText(raw.latestSummary),
    latestError: normalizeOptionalText(raw.latestError),
    showTokenUsage: raw.showTokenUsage !== false,
  };
}

export function loadTaskLedgerFromDisk(): Map<string, TaskRecord> {
  const pathname = resolveTaskLedgerPath();
  const raw = loadJsonFile(pathname);
  if (!raw || typeof raw !== "object") {
    return new Map();
  }
  const record = raw as Partial<PersistedTaskLedger>;
  if (record.version !== TASK_LEDGER_VERSION) {
    return new Map();
  }
  const tasksRaw = record.tasks;
  if (!tasksRaw || typeof tasksRaw !== "object") {
    return new Map();
  }
  const out = new Map<string, TaskRecord>();
  for (const [taskId, value] of Object.entries(tasksRaw)) {
    const normalized = normalizeTaskRecord(value);
    if (!normalized) {
      continue;
    }
    out.set(taskId, normalized);
  }
  return out;
}

export function saveTaskLedgerToDisk(tasks: Map<string, TaskRecord>) {
  const pathname = resolveTaskLedgerPath();
  const serialized: Record<string, TaskRecord> = {};
  for (const [taskId, entry] of tasks.entries()) {
    serialized[taskId] = entry;
  }
  const out: PersistedTaskLedger = {
    version: TASK_LEDGER_VERSION,
    tasks: serialized,
  };
  saveJsonFile(pathname, out);
}
