import { getTask } from "./task-ledger.js";
import type { TaskTokenUsage } from "./task-ledger.types.js";

export type TaskTokenAccounting = {
  taskId: string;
  totalUsage: TaskTokenUsage;
  nodeUsage: Record<string, TaskTokenUsage>;
};

export function getTaskTokenAccounting(taskId: string): TaskTokenAccounting | null {
  const task = getTask(taskId);
  if (!task) {
    return null;
  }

  const nodeUsage: Record<string, TaskTokenUsage> = {};
  for (const node of task.nodes) {
    nodeUsage[node.nodeId] = {
      inputTokens: node.tokenUsage.inputTokens,
      outputTokens: node.tokenUsage.outputTokens,
      totalTokens: node.tokenUsage.totalTokens,
    };
  }

  return {
    taskId: task.taskId,
    totalUsage: {
      inputTokens: task.tokenUsage.inputTokens,
      outputTokens: task.tokenUsage.outputTokens,
      totalTokens: task.tokenUsage.totalTokens,
    },
    nodeUsage,
  };
}

export function formatTaskTokenAccounting(accounting: TaskTokenAccounting): string {
  const { totalUsage, nodeUsage } = accounting;
  let output = `Task Token Usage (Total: ${totalUsage.totalTokens})\n`;
  output += `  Input: ${totalUsage.inputTokens}\n`;
  output += `  Output: ${totalUsage.outputTokens}\n\n`;

  output += `Node Breakdown:\n`;
  for (const [nodeId, usage] of Object.entries(nodeUsage)) {
    output += `  - ${nodeId}: ${usage.totalTokens} (In: ${usage.inputTokens}, Out: ${usage.outputTokens})\n`;
  }

  return output;
}
