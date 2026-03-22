import { describe, expect, it, vi } from "vitest";

const updateSessionStoreMock = vi.fn(
  async (_storePath: string, updater: (store: Record<string, unknown>) => unknown) => {
    const store: Record<string, unknown> = {};
    updater(store);
    return store;
  },
);

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({}),
}));

vi.mock("../config/sessions.js", () => ({
  resolveStorePath: () => "session-store.json",
  loadSessionStore: () => ({}),
  mergeSessionEntry: (
    existing: Record<string, unknown> | undefined,
    patch: Record<string, unknown>,
  ) => ({
    ...existing,
    ...patch,
  }),
  updateSessionStore: (storePath: string, updater: (store: Record<string, unknown>) => unknown) =>
    updateSessionStoreMock(storePath, updater),
}));

vi.mock("./agent-scope.js", () => ({
  resolveSessionAgentId: () => "main",
}));

describe("task-registry", () => {
  it("tracks task lifecycle and persists session task state", async () => {
    const mod = await import("./task-registry.js");

    const created = mod.createTrackedTask({
      sessionKey: "agent:main:main",
      title: "Collect stock quote",
      runId: "run-1",
      childSessionKey: "agent:main:subagent:1",
    });
    expect(created.taskId).toMatch(/^T-/);

    const updated = mod.updateTaskFromRunEvent({
      runId: "run-1",
      event: {
        type: "task_progress",
        eventId: "evt-1",
        taskId: created.taskId,
        version: 1,
        status: "planning",
        progress: 10,
        message: "Planning",
        timestamp: Date.now(),
      },
    });
    expect(updated?.status).toBe("planning");

    const executing = mod.updateTaskFromRunEvent({
      runId: "run-1",
      event: {
        type: "task_progress",
        eventId: "evt-1b",
        taskId: created.taskId,
        version: 2,
        status: "executing",
        progress: 42,
        message: "Working",
        timestamp: Date.now(),
      },
    });
    expect(executing?.status).toBe("executing");
    expect(executing?.progress).toBe(42);

    const blocked = mod.updateTaskFromRunEvent({
      runId: "run-1",
      event: {
        type: "task_blocked_user_input",
        eventId: "evt-2",
        taskId: created.taskId,
        version: 3,
        reason: "credentials",
        request: "Need API key",
        timestamp: Date.now(),
      },
    });
    expect(blocked?.status).toBe("blocked");
    expect(blocked?.blockedReason).toBe("credentials");

    const list = mod.listTasksForSession("agent:main:main");
    expect(list.length).toBeGreaterThan(0);
    const byRun = mod.resolveTaskByRunId("run-1");
    expect(byRun?.taskId).toBe(created.taskId);
    expect(updateSessionStoreMock).toHaveBeenCalled();
  });

  it("rejects invalid terminal-to-active transitions", async () => {
    const mod = await import("./task-registry.js");

    const created = mod.createTrackedTask({
      sessionKey: "agent:main:main",
      title: "Terminal lock",
      runId: "run-terminal",
    });

    const completed = mod.updateTaskFromRunEvent({
      runId: "run-terminal",
      event: {
        type: "task_progress",
        eventId: "evt-terminal-1",
        taskId: created.taskId,
        version: 1,
        status: "planning",
        progress: 5,
        timestamp: Date.now(),
      },
    });
    expect(completed?.status).toBe("planning");

    const executing = mod.updateTaskFromRunEvent({
      runId: "run-terminal",
      event: {
        type: "task_progress",
        eventId: "evt-terminal-1b",
        taskId: created.taskId,
        version: 2,
        status: "executing",
        progress: 80,
        timestamp: Date.now(),
      },
    });
    expect(executing?.status).toBe("executing");

    const finished = mod.updateTaskFromRunEvent({
      runId: "run-terminal",
      event: {
        type: "task_progress",
        eventId: "evt-terminal-1c",
        taskId: created.taskId,
        version: 3,
        status: "evaluating",
        progress: 95,
        timestamp: Date.now(),
      },
    });
    expect(finished?.status).toBe("evaluating");

    const terminal = mod.updateTaskFromRunEvent({
      runId: "run-terminal",
      event: {
        type: "task_progress",
        eventId: "evt-terminal-1d",
        taskId: created.taskId,
        version: 4,
        status: "completed",
        progress: 100,
        timestamp: Date.now(),
      },
    });
    expect(terminal?.status).toBe("completed");

    const invalid = mod.updateTaskFromRunEvent({
      runId: "run-terminal",
      event: {
        type: "task_progress",
        eventId: "evt-terminal-2",
        taskId: created.taskId,
        version: 5,
        status: "executing",
        progress: 10,
        timestamp: Date.now(),
      },
    });
    expect(invalid).toBeUndefined();

    const latest = mod.resolveTaskByRunId("run-terminal");
    expect(latest?.status).toBe("completed");
  });

  it("exposes transition validation metadata", async () => {
    const mod = await import("./task-registry.js");
    const valid = mod.validateTaskTransition({
      current: "executing",
      next: "evaluating",
    });
    expect(valid.valid).toBe(true);

    const invalid = mod.validateTaskTransition({
      current: "completed",
      next: "executing",
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.allowed.length).toBe(0);
  });

  it("flags stale blocked tasks after policy window", async () => {
    const mod = await import("./task-registry.js");
    const now = Date.now();

    const created = mod.createTrackedTask({
      sessionKey: "agent:main:stale-blocked",
      title: "Stale blocked",
      runId: "run-stale-blocked",
    });

    mod.updateTaskFromRunEvent({
      runId: "run-stale-blocked",
      event: {
        type: "task_progress",
        eventId: "evt-stale-1",
        taskId: created.taskId,
        version: 1,
        status: "planning",
        progress: 10,
        timestamp: now - 17 * 60 * 1000,
      },
    });
    mod.updateTaskFromRunEvent({
      runId: "run-stale-blocked",
      event: {
        type: "task_progress",
        eventId: "evt-stale-2",
        taskId: created.taskId,
        version: 2,
        status: "executing",
        progress: 40,
        timestamp: now - 16 * 60 * 1000,
      },
    });
    mod.updateTaskFromRunEvent({
      runId: "run-stale-blocked",
      event: {
        type: "task_blocked_user_input",
        eventId: "evt-stale-3",
        taskId: created.taskId,
        version: 3,
        reason: "credentials",
        request: "Need api key",
        timestamp: now - 16 * 60 * 1000,
      },
    });

    const blocked = mod.getBlockedTasksForSession("agent:main:stale-blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.blockedStale).toBe(true);

    const staleBlocked = mod.getStaleBlockedTasksForSession("agent:main:stale-blocked");
    expect(staleBlocked).toHaveLength(1);
    expect(staleBlocked[0]?.taskId).toBe(created.taskId);
  });

  it("garbage-collects old terminal tasks", async () => {
    const mod = await import("./task-registry.js");
    const now = Date.now();

    const created = mod.createTrackedTask({
      sessionKey: "agent:main:gc-terminal",
      title: "Old completed task",
      runId: "run-old-terminal",
    });

    mod.updateTaskFromRunEvent({
      runId: "run-old-terminal",
      event: {
        type: "task_progress",
        eventId: "evt-gc-1",
        taskId: created.taskId,
        version: 1,
        status: "planning",
        progress: 10,
        timestamp: now - 8 * 60 * 60 * 1000,
      },
    });
    mod.updateTaskFromRunEvent({
      runId: "run-old-terminal",
      event: {
        type: "task_progress",
        eventId: "evt-gc-2",
        taskId: created.taskId,
        version: 2,
        status: "executing",
        progress: 80,
        timestamp: now - 7.5 * 60 * 60 * 1000,
      },
    });
    mod.updateTaskFromRunEvent({
      runId: "run-old-terminal",
      event: {
        type: "task_progress",
        eventId: "evt-gc-3",
        taskId: created.taskId,
        version: 3,
        status: "evaluating",
        progress: 95,
        timestamp: now - 7.25 * 60 * 60 * 1000,
      },
    });
    mod.updateTaskFromRunEvent({
      runId: "run-old-terminal",
      event: {
        type: "task_progress",
        eventId: "evt-gc-4",
        taskId: created.taskId,
        version: 4,
        status: "completed",
        progress: 100,
        timestamp: now - 7 * 60 * 60 * 1000,
      },
    });

    const tasks = mod.listTasksForSession("agent:main:gc-terminal");
    expect(tasks).toHaveLength(0);
    const byRun = mod.resolveTaskByRunId("run-old-terminal");
    expect(byRun).toBeUndefined();
  });
});
