import { describe, expect, it } from "vitest";
import {
  attachRootRun,
  createRootTask,
  findTaskByRunId,
  findTaskIdByRunId,
  getTask,
  markTaskNodeCompleted,
  markTaskNodeFailed,
  markTaskNodeRunning,
  registerTaskNode,
  resetTaskLedgerForTests,
  updateTaskNodeUsage,
  updateTaskSummary,
} from "./task-ledger.js";

describe("task-ledger", () => {
  it("creates root task and avoids duplicate root creation", () => {
    resetTaskLedgerForTests({ persist: false });

    const first = createRootTask({
      taskId: "task-1",
      rootSessionKey: "agent:main:main",
      title: "Root task",
      originalMessage: "do work",
      showTokenUsage: true,
    });

    const second = createRootTask({
      taskId: "task-1",
      rootSessionKey: "agent:main:main",
      title: "Root task changed",
      originalMessage: "do different work",
      showTokenUsage: false,
    });

    expect(first.taskId).toBe("task-1");
    expect(second.taskId).toBe("task-1");
    expect(second.title).toBe("Root task");
    expect(second.originalMessage).toBe("do work");
    expect(second.showTokenUsage).toBe(true);
  });

  it("attaches root run and resolves run lookup", () => {
    resetTaskLedgerForTests({ persist: false });

    createRootTask({
      taskId: "task-2",
      rootSessionKey: "agent:main:main",
      title: "Attach root",
      originalMessage: "attach",
      showTokenUsage: true,
    });

    const updated = attachRootRun({
      taskId: "task-2",
      runId: "run-root-2",
      sessionKey: "agent:main:main",
      startedAt: 100,
    });

    expect(updated?.rootRunId).toBe("run-root-2");
    expect(findTaskIdByRunId("run-root-2")).toBe("task-2");
    expect(findTaskByRunId("run-root-2")?.taskId).toBe("task-2");
    expect(updated?.nodes.some((node) => node.kind === "root_run")).toBe(true);
  });

  it("tracks child node lifecycle and marks task completed when root and children settle", () => {
    resetTaskLedgerForTests({ persist: false });

    createRootTask({
      taskId: "task-3",
      rootSessionKey: "agent:main:main",
      title: "Lifecycle",
      originalMessage: "lifecycle",
      showTokenUsage: true,
    });

    attachRootRun({
      taskId: "task-3",
      runId: "run-root-3",
      sessionKey: "agent:main:main",
      startedAt: 10,
    });

    markTaskNodeRunning({
      taskId: "task-3",
      runId: "run-root-3",
      startedAt: 11,
    });

    registerTaskNode({
      nodeId: "node-child-3",
      taskId: "task-3",
      parentNodeId: "root:task-3",
      kind: "subagent_run",
      label: "child",
      runId: "run-child-3",
      sessionKey: "agent:main:subagent:child",
      createdAt: 12,
    });

    markTaskNodeRunning({
      taskId: "task-3",
      runId: "run-child-3",
      startedAt: 13,
    });

    markTaskNodeCompleted({
      taskId: "task-3",
      runId: "run-root-3",
      endedAt: 20,
    });

    const waitingTask = getTask("task-3");
    expect(waitingTask?.status).toBe("waiting_children");

    markTaskNodeCompleted({
      taskId: "task-3",
      runId: "run-child-3",
      endedAt: 22,
    });

    const completedTask = getTask("task-3");
    expect(completedTask?.status).toBe("completed");
    expect(completedTask?.endedAt).toBeDefined();
  });

  it("marks task failed when any node fails", () => {
    resetTaskLedgerForTests({ persist: false });

    createRootTask({
      taskId: "task-4",
      rootSessionKey: "agent:main:main",
      title: "Failure",
      originalMessage: "failure",
      showTokenUsage: false,
    });

    attachRootRun({
      taskId: "task-4",
      runId: "run-root-4",
      sessionKey: "agent:main:main",
    });

    markTaskNodeRunning({
      taskId: "task-4",
      runId: "run-root-4",
    });

    markTaskNodeFailed({
      taskId: "task-4",
      runId: "run-root-4",
      error: "boom",
      endedAt: 50,
    });

    const task = getTask("task-4");
    expect(task?.status).toBe("failed");
    expect(task?.latestError).toBe("boom");
  });

  it("rolls up task token usage from node usage", () => {
    resetTaskLedgerForTests({ persist: false });

    createRootTask({
      taskId: "task-5",
      rootSessionKey: "agent:main:main",
      title: "Usage",
      originalMessage: "usage",
      showTokenUsage: true,
    });

    attachRootRun({
      taskId: "task-5",
      runId: "run-root-5",
      sessionKey: "agent:main:main",
    });

    registerTaskNode({
      nodeId: "node-child-5",
      taskId: "task-5",
      kind: "subagent_run",
      label: "child",
      runId: "run-child-5",
      createdAt: 100,
    });

    updateTaskNodeUsage({
      taskId: "task-5",
      runId: "run-root-5",
      usage: {
        inputTokens: 10,
        outputTokens: 4,
      },
    });

    updateTaskNodeUsage({
      taskId: "task-5",
      runId: "run-child-5",
      usage: {
        inputTokens: 20,
        outputTokens: 6,
        totalTokens: 26,
      },
    });

    const task = getTask("task-5");
    expect(task?.tokenUsage.inputTokens).toBe(30);
    expect(task?.tokenUsage.outputTokens).toBe(10);
    expect(task?.tokenUsage.totalTokens).toBe(40);
  });

  it("updates task summary fields", () => {
    resetTaskLedgerForTests({ persist: false });

    createRootTask({
      taskId: "task-6",
      rootSessionKey: "agent:main:main",
      title: "Summary",
      originalMessage: "summary",
      showTokenUsage: true,
    });

    const updated = updateTaskSummary({
      taskId: "task-6",
      latestSummary: "all done",
      latestError: "",
    });

    expect(updated?.latestSummary).toBe("all done");
    expect(updated?.latestError).toBeUndefined();
  });
});
