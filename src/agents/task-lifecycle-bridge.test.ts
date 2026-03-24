import { describe, expect, it, vi } from "vitest";
import { emitAgentEvent, resetAgentEventsForTest } from "../infra/agent-events.js";
import {
  disposeTaskLifecycleBridge,
  initTaskLifecycleBridge,
} from "./task-lifecycle-bridge.js";
import {
  createRootTask,
  getTask,
  resetTaskLedgerForTests,
} from "./task-ledger.js";
import {
  TASK_NODE_STATUS_CANCELLED,
  TASK_NODE_STATUS_COMPLETED,
  TASK_NODE_STATUS_FAILED,
  TASK_NODE_STATUS_RUNNING,
} from "./task-ledger.types.js";

describe("task-lifecycle-bridge", () => {
  it("should update task node status on lifecycle events", () => {
    resetTaskLedgerForTests({ persist: false });
    resetAgentEventsForTest();
    initTaskLifecycleBridge();

    const taskId = "task-1";
    const runId = "run-1";

    createRootTask({
      taskId,
      title: "Test Task",
      showTokenUsage: true,
    });

    // Simulate start event
    emitAgentEvent({
      runId,
      stream: "lifecycle",
      data: { phase: "start" },
    });

    let task = getTask(taskId);
    expect(task?.nodes[0]?.status).toBe(TASK_NODE_STATUS_RUNNING);

    // Simulate end event (success)
    emitAgentEvent({
      runId,
      stream: "lifecycle",
      data: { phase: "end", result: "Success" },
    });

    task = getTask(taskId);
    expect(task?.nodes[0]?.status).toBe(TASK_NODE_STATUS_COMPLETED);
    expect(task?.nodes[0]?.resultPreview).toBe("Success");

    disposeTaskLifecycleBridge();
  });

  it("should update task node status on error events", () => {
    resetTaskLedgerForTests({ persist: false });
    resetAgentEventsForTest();
    initTaskLifecycleBridge();

    const taskId = "task-2";
    const runId = "run-2";

    createRootTask({
      taskId,
      title: "Test Task 2",
      showTokenUsage: true,
    });

    // Simulate start event
    emitAgentEvent({
      runId,
      stream: "lifecycle",
      data: { phase: "start" },
    });

    // Simulate error event
    emitAgentEvent({
      runId,
      stream: "lifecycle",
      data: { phase: "error", error: "Something went wrong" },
    });

    const task = getTask(taskId);
    expect(task?.nodes[0]?.status).toBe(TASK_NODE_STATUS_FAILED);
    expect(task?.nodes[0]?.error).toBe("Something went wrong");

    disposeTaskLifecycleBridge();
  });

  it("should update task node status on abort events", () => {
    resetTaskLedgerForTests({ persist: false });
    resetAgentEventsForTest();
    initTaskLifecycleBridge();

    const taskId = "task-3";
    const runId = "run-3";

    createRootTask({
      taskId,
      title: "Test Task 3",
      showTokenUsage: true,
    });

    // Simulate start event
    emitAgentEvent({
      runId,
      stream: "lifecycle",
      data: { phase: "start" },
    });

    // Simulate end event (aborted)
    emitAgentEvent({
      runId,
      stream: "lifecycle",
      data: { phase: "end", aborted: true },
    });

    const task = getTask(taskId);
    expect(task?.nodes[0]?.status).toBe(TASK_NODE_STATUS_CANCELLED);
    expect(task?.nodes[0]?.error).toBe("Operation cancelled");

    disposeTaskLifecycleBridge();
  });

  it("should update task node usage on usage events", () => {
    resetTaskLedgerForTests({ persist: false });
    resetAgentEventsForTest();
    initTaskLifecycleBridge();

    const taskId = "task-4";
    const runId = "run-4";

    createRootTask({
      taskId,
      title: "Test Task 4",
      showTokenUsage: true,
    });

    // Simulate usage event
    emitAgentEvent({
      runId,
      stream: "usage",
      data: {
        usage: {
          input: 10,
          output: 20,
          total: 30,
        },
      },
    });

    const task = getTask(taskId);
    expect(task?.nodes[0]?.tokenUsage.inputTokens).toBe(10);
    expect(task?.nodes[0]?.tokenUsage.outputTokens).toBe(20);
    expect(task?.nodes[0]?.tokenUsage.totalTokens).toBe(30);

    disposeTaskLifecycleBridge();
  });
});
