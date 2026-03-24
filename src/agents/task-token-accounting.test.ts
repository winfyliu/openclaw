import { describe, expect, it } from "vitest";
import {
  createRootTask,
  getTask,
  resetTaskLedgerForTests,
} from "./task-ledger.js";
import {
  getTaskTokenAccounting,
  formatTaskTokenAccounting,
} from "./task-token-accounting.js";

describe("task-token-accounting", () => {
  it("should aggregate token usage across task nodes", () => {
    resetTaskLedgerForTests({ persist: false });

    const taskId = "task-1";
    const runId = "run-1";

    createRootTask({
      taskId,
      title: "Test Task",
      showTokenUsage: true,
    });

    const task = getTask(taskId);
    expect(task).toBeDefined();

    // Simulate usage update
    task!.nodes[0].tokenUsage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    };

    const accounting = getTaskTokenAccounting(taskId);
    expect(accounting).toBeDefined();
    expect(accounting?.totalUsage.inputTokens).toBe(10);
    expect(accounting?.totalUsage.outputTokens).toBe(20);
    expect(accounting?.totalUsage.totalTokens).toBe(30);

    const formatted = formatTaskTokenAccounting(accounting!);
    expect(formatted).toContain("Task Token Usage (Total: 30)");
    expect(formatted).toContain("Input: 10");
    expect(formatted).toContain("Output: 20");
  });
});
