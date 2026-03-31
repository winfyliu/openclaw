import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  submitBackgroundTask,
  getBackgroundTaskResult,
  listBackgroundTasks,
  cancelBackgroundTask,
  cleanupBackgroundTask,
  countActiveBackgroundTasks,
  pollUntilComplete,
  configureBackgroundTaskExecutor,
  __testing,
  type ExecuteTaskFn,
} from "./background-task-executor.js";

beforeEach(() => {
  __testing.resetState();
  configureBackgroundTaskExecutor({
    pollIntervalMs: 50,
    maxPollDurationMs: 5_000,
    retentionMs: 1_000,
    maxConcurrentTasks: 3,
  });
});

function createSimpleTask(
  result: string,
  delayMs = 100,
): ExecuteTaskFn {
  return async ({ onProgress }) => {
    onProgress("Starting...", 10);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    onProgress("Done.", 100);
    return { result };
  };
}

function createFailingTask(error: string, delayMs = 50): ExecuteTaskFn {
  return async ({ onProgress }) => {
    onProgress("Starting...", 10);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    throw new Error(error);
  };
}

function createBlockingTask(): {
  execute: ExecuteTaskFn;
  resolve: (result: string) => void;
  reject: (error: string) => void;
} {
  let resolveTask: ((value: { result?: string; error?: string }) => void) | undefined;
  const execute: ExecuteTaskFn = async ({ onProgress, signal }) => {
    onProgress("Waiting for external input...", 20);
    return new Promise<{ result?: string; error?: string }>((resolve) => {
      resolveTask = resolve;
      signal.addEventListener("abort", () => {
        resolve({ error: "Cancelled" });
      });
    });
  };
  return {
    execute,
    resolve: (result: string) => resolveTask?.({ result }),
    reject: (error: string) => resolveTask?.({ error }),
  };
}

describe("background-task-executor", () => {
  describe("submitBackgroundTask", () => {
    it("should submit a task and return a task ID", () => {
      const taskId = submitBackgroundTask({
        execute: createSimpleTask("hello"),
      });
      expect(taskId).toBeTruthy();
      expect(typeof taskId).toBe("string");
    });

    it("should use provided task ID", () => {
      const taskId = submitBackgroundTask({
        taskId: "MY-TASK-001",
        execute: createSimpleTask("hello"),
      });
      expect(taskId).toBe("MY-TASK-001");
    });

    it("should reject when concurrency limit is reached", () => {
      const { execute: e1 } = createBlockingTask();
      const { execute: e2 } = createBlockingTask();
      const { execute: e3 } = createBlockingTask();
      const { execute: e4 } = createBlockingTask();

      submitBackgroundTask({ execute: e1 });
      submitBackgroundTask({ execute: e2 });
      submitBackgroundTask({ execute: e3 });

      expect(() => submitBackgroundTask({ execute: e4 })).toThrow(
        /Background task limit reached/,
      );
    });
  });

  describe("getBackgroundTaskResult", () => {
    it("should return undefined for unknown task", () => {
      expect(getBackgroundTaskResult("nonexistent")).toBeUndefined();
    });

    it("should return task result with initial pending status", () => {
      const { execute } = createBlockingTask();
      const taskId = submitBackgroundTask({ execute });
      const result = getBackgroundTaskResult(taskId);
      expect(result).toBeDefined();
      expect(result!.taskId).toBe(taskId);
      // Status may be pending or running depending on timing
      expect(["pending", "running"]).toContain(result!.status);
    });

    it("should track poll count", () => {
      const { execute } = createBlockingTask();
      const taskId = submitBackgroundTask({ execute });

      getBackgroundTaskResult(taskId);
      getBackgroundTaskResult(taskId);
      const result = getBackgroundTaskResult(taskId);

      expect(result!.pollCount).toBe(3);
    });
  });

  describe("pollUntilComplete", () => {
    it("should poll until task completes successfully", async () => {
      const taskId = submitBackgroundTask({
        execute: createSimpleTask("success result", 100),
      });

      const result = await pollUntilComplete({
        taskId,
        pollIntervalMs: 20,
      });

      expect(result.status).toBe("completed");
      expect(result.result).toBe("success result");
      expect(result.progress).toBe(100);
    });

    it("should poll until task fails", async () => {
      const taskId = submitBackgroundTask({
        execute: createFailingTask("something went wrong"),
      });

      const result = await pollUntilComplete({
        taskId,
        pollIntervalMs: 20,
      });

      expect(result.status).toBe("failed");
      expect(result.error).toContain("something went wrong");
    });

    it("should call onProgress for new messages", async () => {
      const progressMessages: string[] = [];
      const taskId = submitBackgroundTask({
        execute: createSimpleTask("done", 100),
      });

      await pollUntilComplete({
        taskId,
        pollIntervalMs: 20,
        onProgress: (msg) => progressMessages.push(msg.content),
      });

      expect(progressMessages.length).toBeGreaterThan(0);
      expect(progressMessages).toContain("Starting...");
      expect(progressMessages).toContain("Done.");
    });

    it("should call onStatusChange when status changes", async () => {
      const statusChanges: string[] = [];
      const taskId = submitBackgroundTask({
        execute: createSimpleTask("done", 100),
      });

      await pollUntilComplete({
        taskId,
        pollIntervalMs: 20,
        onStatusChange: (status) => statusChanges.push(status),
      });

      expect(statusChanges.length).toBeGreaterThan(0);
      expect(statusChanges).toContain("completed");
    });

    it("should timeout if task takes too long", async () => {
      configureBackgroundTaskExecutor({
        pollIntervalMs: 20,
        maxPollDurationMs: 100,
        maxConcurrentTasks: 3,
        retentionMs: 1_000,
      });

      const { execute } = createBlockingTask();
      const taskId = submitBackgroundTask({ execute });

      const result = await pollUntilComplete({
        taskId,
        pollIntervalMs: 20,
        maxPollDurationMs: 100,
      });

      expect(result.status).toBe("timed_out");
    });

    it("should throw for unknown task", async () => {
      await expect(
        pollUntilComplete({ taskId: "nonexistent", pollIntervalMs: 20 }),
      ).rejects.toThrow(/not found/);
    });
  });

  describe("cancelBackgroundTask", () => {
    it("should cancel a running task", async () => {
      const { execute } = createBlockingTask();
      const taskId = submitBackgroundTask({ execute });

      // Wait a bit for the task to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      const cancelled = cancelBackgroundTask(taskId);
      expect(cancelled).toBe(true);

      const result = getBackgroundTaskResult(taskId);
      expect(result!.status).toBe("cancelled");
    });

    it("should return false for unknown task", () => {
      expect(cancelBackgroundTask("nonexistent")).toBe(false);
    });

    it("should return false for already completed task", async () => {
      const taskId = submitBackgroundTask({
        execute: createSimpleTask("done", 50),
      });

      await pollUntilComplete({ taskId, pollIntervalMs: 20 });

      expect(cancelBackgroundTask(taskId)).toBe(false);
    });
  });

  describe("cleanupBackgroundTask", () => {
    it("should clean up a completed task", async () => {
      const taskId = submitBackgroundTask({
        execute: createSimpleTask("done", 50),
      });

      await pollUntilComplete({ taskId, pollIntervalMs: 20 });

      expect(cleanupBackgroundTask(taskId)).toBe(true);
      expect(getBackgroundTaskResult(taskId)).toBeUndefined();
    });

    it("should not clean up a running task", () => {
      const { execute } = createBlockingTask();
      const taskId = submitBackgroundTask({ execute });

      expect(cleanupBackgroundTask(taskId)).toBe(false);
    });
  });

  describe("listBackgroundTasks", () => {
    it("should list all tasks", () => {
      const { execute: e1 } = createBlockingTask();
      const { execute: e2 } = createBlockingTask();

      submitBackgroundTask({ taskId: "TASK-1", execute: e1 });
      submitBackgroundTask({ taskId: "TASK-2", execute: e2 });

      const tasks = listBackgroundTasks();
      expect(tasks.length).toBe(2);
    });

    it("should filter by status", async () => {
      const { execute: blocking } = createBlockingTask();
      submitBackgroundTask({ taskId: "RUNNING-1", execute: blocking });

      const taskId = submitBackgroundTask({
        taskId: "DONE-1",
        execute: createSimpleTask("done", 50),
      });
      await pollUntilComplete({ taskId, pollIntervalMs: 20 });

      const completed = listBackgroundTasks({ status: "completed" });
      expect(completed.length).toBe(1);
      expect(completed[0].taskId).toBe("DONE-1");
    });
  });

  describe("countActiveBackgroundTasks", () => {
    it("should count active tasks", () => {
      const { execute: e1 } = createBlockingTask();
      const { execute: e2 } = createBlockingTask();

      submitBackgroundTask({ execute: e1 });
      submitBackgroundTask({ execute: e2 });

      expect(countActiveBackgroundTasks()).toBe(2);
    });

    it("should decrease when tasks complete", async () => {
      const taskId = submitBackgroundTask({
        execute: createSimpleTask("done", 50),
      });

      expect(countActiveBackgroundTasks()).toBe(1);

      await pollUntilComplete({ taskId, pollIntervalMs: 20 });

      expect(countActiveBackgroundTasks()).toBe(0);
    });
  });
});
