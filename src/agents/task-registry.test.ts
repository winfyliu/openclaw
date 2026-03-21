import { describe, expect, it, vi } from "vitest";

const updateSessionStoreMock = vi.fn(async (_storePath: string, updater: (store: Record<string, unknown>) => unknown) => {
  const store: Record<string, unknown> = {};
  updater(store);
  return store;
});

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({}),
}));

vi.mock("../config/sessions.js", () => ({
  resolveStorePath: () => "session-store.json",
  loadSessionStore: () => ({}),
  mergeSessionEntry: (existing: Record<string, unknown> | undefined, patch: Record<string, unknown>) => ({
    ...(existing ?? {}),
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
        status: "executing",
        progress: 42,
        message: "Working",
        timestamp: Date.now(),
      },
    });
    expect(updated?.status).toBe("executing");
    expect(updated?.progress).toBe(42);

    const blocked = mod.updateTaskFromRunEvent({
      runId: "run-1",
      event: {
        type: "task_blocked_user_input",
        eventId: "evt-2",
        taskId: created.taskId,
        version: 2,
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
});
