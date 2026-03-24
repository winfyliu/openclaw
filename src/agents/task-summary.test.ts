import { describe, expect, it } from "vitest";
import {
  createRootTask,
  getTask,
  resetTaskLedgerForTests,
} from "./task-ledger.js";
import { generateTaskSummary } from "./task-summary.js";
import {
  TASK_NODE_STATUS_COMPLETED,
  TASK_NODE_STATUS_FAILED,
  TASK_STATUS_COMPLETED,
  TASK_STATUS_FAILED,
} from "./task-ledger.types.js";

describe("task-summary", () => {
  it("should generate a summary for a completed task", () => {
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

    // Simulate completion
    task!.status = TASK_STATUS_COMPLETED;
    task!.nodes[0].status = TASK_NODE_STATUS_COMPLETED;
    task!.nodes[0].resultPreview = "Task completed successfully.";

    const summary = generateTaskSummary(taskId);
    expect(summary).toBeDefined();
    expect(summary?.status).toBe(TASK_STATUS_COMPLETED);
    expect(summary?.summary).toContain("Task completed successfully.");
  });

  it("should generate an error summary for a failed task", () => {
    resetTaskLedgerForTests({ persist: false });

    const taskId = "task-2";
    const runId = "run-2";

    createRootTask({
      taskId,
      title: "Test Task 2",
      showTokenUsage: true,
    });

    const task = getTask(taskId);
    expect(task).toBeDefined();

    // Simulate failure
    task!.status = TASK_STATUS_FAILED;
    task!.nodes[0].status = TASK_NODE_STATUS_FAILED;
    task!.nodes[0].error = "Something went wrong";

    const summary = generateTaskSummary(taskId);
    expect(summary).toBeDefined();
    expect(summary?.status).toBe(TASK_STATUS_FAILED);
    expect(summary?.error).toContain("Something went wrong");
  });

  it("should append token footer when showTokenUsage is true", () => {
    resetTaskLedgerForTests({ persist: false });

    const taskId = "task-3";
    const runId = "run-3";

    createRootTask({
      taskId,
      title: "Test Task 3",
      showTokenUsage: true,
    });

    const task = getTask(taskId);
    expect(task).toBeDefined();

    // Simulate completion and token usage
    task!.status = TASK_STATUS_COMPLETED;
    task!.nodes[0].status = TASK_NODE_STATUS_COMPLETED;
    task!.nodes[0].resultPreview = "Task completed successfully.";
    task!.nodes[0].tokenUsage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    };
    task!.tokenUsage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    };

    const summary = generateTaskSummary(taskId);
    expect(summary).toBeDefined();
    expect(summary?.summary).toContain("Task Token Usage (Total: 30)");
  });

  it("should not append token footer when showTokenUsage is false", () => {
    resetTaskLedgerForTests({ persist: false });

    const taskId = "task-4";
    const runId = "run-4";

    createRootTask({
      taskId,
      title: "Test Task 4",
      showTokenUsage: false,
    });

    const task = getTask(taskId);
    expect(task).toBeDefined();

    // Simulate completion and token usage
    task!.status = TASK_STATUS_COMPLETED;
    task!.nodes[0].status = TASK_NODE_STATUS_COMPLETED;
    task!.nodes[0].resultPreview = "Task completed successfully.";
    task!.nodes[0].tokenUsage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    };
    task!.tokenUsage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    };

    const summary = generateTaskSummary(taskId);
    expect(summary).toBeDefined();
    expect(summary?.summary).not.toContain("Task Token Usage");
  });
});
