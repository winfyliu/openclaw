import { onAgentEvent, type AgentEventPayload } from "../infra/agent-events.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import {
  findTaskIdByRunId,
  markTaskNodeCancelled,
  markTaskNodeCompleted,
  markTaskNodeFailed,
  markTaskNodeRunning,
  markTaskNodeTimeout,
  updateTaskNodeUsage,
} from "./task-ledger.js";
import { normalizeUsage } from "./usage.js";

type TaskLifecycleBridgeState = {
  listening: boolean;
  dispose?: () => void;
};

const TASK_LIFECYCLE_BRIDGE_KEY = Symbol.for("openclaw.taskLifecycleBridge.state");

const state = resolveGlobalSingleton<TaskLifecycleBridgeState>(TASK_LIFECYCLE_BRIDGE_KEY, () => ({
  listening: false,
}));

function handleLifecycleEvent(payload: AgentEventPayload) {
  const { runId, data, ts } = payload;
  const phase = data.phase as string;

  const taskId = findTaskIdByRunId(runId);
  if (!taskId) {
    return;
  }

  switch (phase) {
    case "start":
      markTaskNodeRunning({
        taskId,
        runId,
        startedAt: ts,
      });
      break;
    case "end":
      if (data.aborted) {
        markTaskNodeCancelled({
          taskId,
          runId,
          endedAt: ts,
          error: "Operation cancelled",
        });
      } else {
        markTaskNodeCompleted({
          taskId,
          runId,
          endedAt: ts,
          resultPreview: typeof data.result === "string" ? data.result : undefined,
        });
      }
      break;
    case "error":
      markTaskNodeFailed({
        taskId,
        runId,
        endedAt: ts,
        error: typeof data.error === "string" ? data.error : "Unknown error",
      });
      break;
  }
}

function handleUsageEvent(payload: AgentEventPayload) {
  const { runId, data } = payload;
  const taskId = findTaskIdByRunId(runId);
  if (!taskId) {
    return;
  }

  const usage = normalizeUsage(data.usage as any);
  if (!usage) {
    return;
  }

  updateTaskNodeUsage({
    taskId,
    runId,
    usage: {
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.total,
    },
  });
}

function handleAgentEvent(payload: AgentEventPayload) {
  if (payload.stream === "lifecycle") {
    handleLifecycleEvent(payload);
  } else if (payload.stream === "usage") {
    handleUsageEvent(payload);
  }
}

export function initTaskLifecycleBridge() {
  if (state.listening) {
    return;
  }
  state.listening = true;
  state.dispose = onAgentEvent(handleAgentEvent);
}

export function disposeTaskLifecycleBridge() {
  if (state.dispose) {
    state.dispose();
    state.dispose = undefined;
  }
  state.listening = false;
}
