import { getTask, updateTaskSummary } from "./task-ledger.js";
import { TASK_STATUS_COMPLETED, TASK_STATUS_FAILED } from "./task-ledger.types.js";
import { getTaskTokenAccounting, formatTaskTokenAccounting } from "./task-token-accounting.js";

export type TaskSummaryResult = {
  taskId: string;
  status: string;
  summary?: string;
  error?: string;
  durationMs?: number;
};

export function generateTaskSummary(taskId: string): TaskSummaryResult | null {
  const task = getTask(taskId);
  if (!task) {
    return null;
  }

  let summary = task.latestSummary;
  let error = task.latestError;

  if (!summary && task.status === TASK_STATUS_COMPLETED) {
    const rootNode = task.nodes.find((n) => n.kind === "root_run");
    if (rootNode?.resultPreview) {
      summary = rootNode.resultPreview;
    } else {
      summary = "Task completed successfully.";
    }
  }

  if (!error && task.status === TASK_STATUS_FAILED) {
    const failedNodes = task.nodes.filter((n) => n.status === "failed");
    if (failedNodes.length > 0) {
      error = failedNodes.map((n) => `${n.label || n.nodeId}: ${n.error || "Unknown error"}`).join("\n");
    } else {
      error = "Task failed.";
    }
  }

  if (summary || error) {
    updateTaskSummary({
      taskId,
      latestSummary: summary,
      latestError: error,
    });
  }

  let durationMs: number | undefined;
  if (task.startedAt && task.endedAt) {
    durationMs = task.endedAt - task.startedAt;
  }

  if (task.showTokenUsage) {
    const accounting = getTaskTokenAccounting(taskId);
    if (accounting && accounting.totalUsage.totalTokens > 0) {
      const tokenFooter = `\n\n---\n${formatTaskTokenAccounting(accounting)}`;
      if (summary) {
        summary += tokenFooter;
      }
      if (error) {
        error += tokenFooter;
      }
    }
  }

  return {
    taskId: task.taskId,
    status: task.status,
    summary,
    error,
    durationMs,
  };
}
