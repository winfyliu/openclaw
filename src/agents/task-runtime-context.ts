import { getAgentRunContext } from "../infra/agent-events.js";
import { findTaskByRunId, findTaskBySessionKey } from "./task-ledger.js";
import type { TaskRecord } from "./task-ledger.types.js";

export type TaskRuntimeContext = {
  taskId: string;
  rootRunId?: string;
  rootSessionKey?: string;
  title: string;
  status: TaskRecord["status"];
  startedAt?: number;
  endedAt?: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

export function resolveTaskRuntimeContext(params: {
  runId?: string;
  sessionKey?: string;
}): TaskRuntimeContext | null {
  const { runId, sessionKey } = params;

  let task: TaskRecord | null = null;

  if (runId) {
    task = findTaskByRunId(runId);
  }

  if (!task && sessionKey) {
    task = findTaskBySessionKey(sessionKey);
  }

  if (!task && runId) {
    const runContext = getAgentRunContext(runId);
    if (runContext?.sessionKey) {
      task = findTaskBySessionKey(runContext.sessionKey);
    }
  }

  if (!task) {
    return null;
  }

  return {
    taskId: task.taskId,
    rootRunId: task.rootRunId,
    rootSessionKey: task.rootSessionKey,
    title: task.title,
    status: task.status,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    tokenUsage: {
      inputTokens: task.tokenUsage.inputTokens,
      outputTokens: task.tokenUsage.outputTokens,
      totalTokens: task.tokenUsage.totalTokens,
    },
  };
}
