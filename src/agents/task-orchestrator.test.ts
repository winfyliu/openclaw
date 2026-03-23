import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing as lockTesting } from "./task-resource-locks.js";

const gatewayMocks = vi.hoisted(() => ({
  callGateway: vi.fn(async () => ({ runId: "resume-run" })),
}));

const hookRunnerMocks = vi.hoisted(() => ({
  hasHooks: vi.fn(() => false),
  runSubagentCompletionVerification: vi.fn(),
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: gatewayMocks.callGateway,
}));

vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({
    hasHooks: hookRunnerMocks.hasHooks,
    runSubagentCompletionVerification: hookRunnerMocks.runSubagentCompletionVerification,
  }),
}));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      agents: {
        defaults: {
          subagents: {
            maxActiveTasksPerSession: 2,
          },
        },
      },
    }),
  };
});

describe("task-orchestrator panel", () => {
  beforeEach(() => {
    gatewayMocks.callGateway.mockClear();
    lockTesting.resetTaskResourceLocks();
    hookRunnerMocks.hasHooks.mockReset();
    hookRunnerMocks.hasHooks.mockReturnValue(false);
    hookRunnerMocks.runSubagentCompletionVerification.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders blocked tasks first with stable ordering", async () => {
    const registry = await import("./task-registry.js");
    const orchestrator = await import("./task-orchestrator.js");

    const taskA = registry.createTrackedTask({
      sessionKey: "panel-session",
      title: "Task A",
      runId: "run-a",
    });
    const taskB = registry.createTrackedTask({
      sessionKey: "panel-session",
      title: "Task B",
      runId: "run-b",
    });

    registry.updateTaskFromRunEvent({
      runId: "run-a",
      event: {
        type: "task_progress",
        eventId: "panel-1",
        taskId: taskA.taskId,
        version: 1,
        status: "executing",
        progress: 30,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-b",
      event: {
        type: "task_blocked_user_input",
        eventId: "panel-2",
        taskId: taskB.taskId,
        version: 1,
        reason: "credentials",
        request: "Need account",
        timestamp: Date.now(),
      },
    });

    const panel = orchestrator.buildTaskProgressPanel("panel-session");
    const lines = panel.split("\n");
    expect(lines[0]).toContain("Current active task progress");
    expect(lines[1]).toContain(taskB.taskId);
    expect(lines[2]).toContain(taskA.taskId);
  });

  it("hides panel when only terminal tasks remain", async () => {
    const registry = await import("./task-registry.js");
    const orchestrator = await import("./task-orchestrator.js");

    const completedTask = registry.createTrackedTask({
      sessionKey: "terminal-only-session",
      title: "Completed only",
      runId: "run-terminal-only",
    });

    registry.updateTaskFromRunEvent({
      runId: "run-terminal-only",
      event: {
        type: "task_progress",
        eventId: "terminal-1",
        taskId: completedTask.taskId,
        version: 1,
        status: "planning",
        progress: 10,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-terminal-only",
      event: {
        type: "task_progress",
        eventId: "terminal-2",
        taskId: completedTask.taskId,
        version: 2,
        status: "executing",
        progress: 70,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-terminal-only",
      event: {
        type: "task_progress",
        eventId: "terminal-3",
        taskId: completedTask.taskId,
        version: 3,
        status: "evaluating",
        progress: 95,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-terminal-only",
      event: {
        type: "task_progress",
        eventId: "terminal-4",
        taskId: completedTask.taskId,
        version: 4,
        status: "completed",
        progress: 100,
        timestamp: Date.now(),
      },
    });

    const panel = orchestrator.buildTaskProgressPanel("terminal-only-session");
    expect(panel).toBe("");
  });

  it("shows only active tasks when session has mixed statuses", async () => {
    const registry = await import("./task-registry.js");
    const orchestrator = await import("./task-orchestrator.js");

    const activeTask = registry.createTrackedTask({
      sessionKey: "mixed-status-session",
      title: "Active Task",
      runId: "run-mixed-active",
    });
    const completedTask = registry.createTrackedTask({
      sessionKey: "mixed-status-session",
      title: "Done Task",
      runId: "run-mixed-done",
    });

    registry.updateTaskFromRunEvent({
      runId: "run-mixed-active",
      event: {
        type: "task_progress",
        eventId: "mixed-1",
        taskId: activeTask.taskId,
        version: 1,
        status: "planning",
        progress: 20,
        timestamp: Date.now(),
      },
    });

    registry.updateTaskFromRunEvent({
      runId: "run-mixed-done",
      event: {
        type: "task_progress",
        eventId: "mixed-2",
        taskId: completedTask.taskId,
        version: 1,
        status: "planning",
        progress: 10,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-mixed-done",
      event: {
        type: "task_progress",
        eventId: "mixed-3",
        taskId: completedTask.taskId,
        version: 2,
        status: "executing",
        progress: 60,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-mixed-done",
      event: {
        type: "task_progress",
        eventId: "mixed-4",
        taskId: completedTask.taskId,
        version: 3,
        status: "evaluating",
        progress: 90,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-mixed-done",
      event: {
        type: "task_progress",
        eventId: "mixed-5",
        taskId: completedTask.taskId,
        version: 4,
        status: "completed",
        progress: 100,
        timestamp: Date.now(),
      },
    });

    const panel = orchestrator.buildTaskProgressPanel("mixed-status-session");
    expect(panel).toContain("Current active task progress");
    expect(panel).toContain(activeTask.taskId);
    expect(panel).not.toContain(completedTask.taskId);
  });

  it("forwards permission-resume input to blocked task child session", async () => {
    const registry = await import("./task-registry.js");
    const orchestrator = await import("./task-orchestrator.js");

    const task = registry.createTrackedTask({
      sessionKey: "resume-session",
      title: "Review deployment access",
      runId: "run-resume",
      childSessionKey: "agent:main:subagent:resume",
    });

    registry.updateTaskFromRunEvent({
      runId: "run-resume",
      event: {
        type: "task_progress",
        eventId: "resume-1",
        taskId: task.taskId,
        version: 1,
        status: "planning",
        progress: 5,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-resume",
      event: {
        type: "task_progress",
        eventId: "resume-2",
        taskId: task.taskId,
        version: 2,
        status: "executing",
        progress: 40,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-resume",
      event: {
        type: "task_blocked_user_input",
        eventId: "resume-3",
        taskId: task.taskId,
        version: 3,
        reason: "permission",
        request: "Grant deployment permission.",
        timestamp: Date.now(),
      },
    });

    const forwardResult = await orchestrator.forwardCredentialInputToTask({
      requesterSessionKey: "resume-session",
      decision: {
        kind: "resume_task",
        task,
        credentials: {
          fields: [],
          raw: "permission granted for deployment",
        },
      },
    });

    expect(forwardResult.forwarded).toBe(true);
    expect(gatewayMocks.callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "agent",
        params: expect.objectContaining({
          sessionKey: "agent:main:subagent:resume",
          deliver: false,
        }),
      }),
    );

    const resumed = registry.resolveTaskByRunId("run-resume");
    expect(resumed?.status).toBe("executing");
    expect(resumed?.blockedReason).toBeUndefined();
    expect(resumed?.blockedRequest).toBeUndefined();
  });

  it("enforces active task budget before registering spawned task", async () => {
    const registry = await import("./task-registry.js");
    const orchestrator = await import("./task-orchestrator.js");

    const done = registry.createTrackedTask({
      sessionKey: "budget-session",
      title: "Done task",
      runId: "run-budget-done",
    });
    registry.updateTaskFromRunEvent({
      runId: "run-budget-done",
      event: {
        type: "task_progress",
        eventId: "budget-done-1",
        taskId: done.taskId,
        version: 1,
        status: "planning",
        progress: 10,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-budget-done",
      event: {
        type: "task_progress",
        eventId: "budget-done-2",
        taskId: done.taskId,
        version: 2,
        status: "executing",
        progress: 70,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-budget-done",
      event: {
        type: "task_progress",
        eventId: "budget-done-3",
        taskId: done.taskId,
        version: 3,
        status: "evaluating",
        progress: 95,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-budget-done",
      event: {
        type: "task_progress",
        eventId: "budget-done-4",
        taskId: done.taskId,
        version: 4,
        status: "completed",
        progress: 100,
        timestamp: Date.now(),
      },
    });

    orchestrator.registerSpawnedSubagentTask({
      requesterSessionKey: "budget-session",
      childSessionKey: "agent:main:subagent:budget-1",
      runId: "run-budget-1",
      task: "Budget task 1",
    });
    orchestrator.registerSpawnedSubagentTask({
      requesterSessionKey: "budget-session",
      childSessionKey: "agent:main:subagent:budget-2",
      runId: "run-budget-2",
      task: "Budget task 2",
    });

    expect(() =>
      orchestrator.registerSpawnedSubagentTask({
        requesterSessionKey: "budget-session",
        childSessionKey: "agent:main:subagent:budget-3",
        runId: "run-budget-3",
        task: "Budget task 3",
      }),
    ).toThrow(/task budget exceeded/);
  });

  it("allows new spawned task once a previous active task reaches terminal state", async () => {
    const registry = await import("./task-registry.js");
    const orchestrator = await import("./task-orchestrator.js");

    const first = orchestrator.registerSpawnedSubagentTask({
      requesterSessionKey: "budget-recovery-session",
      childSessionKey: "agent:main:subagent:budget-r-1",
      runId: "run-budget-r-1",
      task: "Budget recovery task 1",
    });
    orchestrator.registerSpawnedSubagentTask({
      requesterSessionKey: "budget-recovery-session",
      childSessionKey: "agent:main:subagent:budget-r-2",
      runId: "run-budget-r-2",
      task: "Budget recovery task 2",
    });

    const current = registry.resolveTaskByRunId("run-budget-r-1");
    const baseVersion = current?.lastVersion ?? Date.now();
    registry.updateTaskFromRunEvent({
      runId: "run-budget-r-1",
      event: {
        type: "task_progress",
        eventId: "budget-recovery-1",
        taskId: first.taskId,
        version: baseVersion + 1,
        status: "executing",
        progress: 60,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-budget-r-1",
      event: {
        type: "task_progress",
        eventId: "budget-recovery-2",
        taskId: first.taskId,
        version: baseVersion + 2,
        status: "evaluating",
        progress: 95,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-budget-r-1",
      event: {
        type: "task_progress",
        eventId: "budget-recovery-3",
        taskId: first.taskId,
        version: baseVersion + 3,
        status: "completed",
        progress: 100,
        timestamp: Date.now(),
      },
    });

    expect(() =>
      orchestrator.registerSpawnedSubagentTask({
        requesterSessionKey: "budget-recovery-session",
        childSessionKey: "agent:main:subagent:budget-r-3",
        runId: "run-budget-r-3",
        task: "Budget recovery task 3",
      }),
    ).not.toThrow();
  });

  it("retries resume forwarding with bounded backoff and eventually succeeds", async () => {
    vi.useFakeTimers();
    gatewayMocks.callGateway
      .mockRejectedValueOnce(new Error("gateway timeout"))
      .mockRejectedValueOnce(new Error("gateway timeout"))
      .mockResolvedValueOnce({ runId: "resume-run-2" });

    const registry = await import("./task-registry.js");
    const orchestrator = await import("./task-orchestrator.js");

    const task = registry.createTrackedTask({
      sessionKey: "retry-session",
      title: "Retry resume",
      runId: "run-retry",
      childSessionKey: "agent:main:subagent:retry",
    });
    registry.updateTaskFromRunEvent({
      runId: "run-retry",
      event: {
        type: "task_progress",
        eventId: "retry-1",
        taskId: task.taskId,
        version: 1,
        status: "planning",
        progress: 10,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-retry",
      event: {
        type: "task_progress",
        eventId: "retry-2",
        taskId: task.taskId,
        version: 2,
        status: "executing",
        progress: 40,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-retry",
      event: {
        type: "task_blocked_user_input",
        eventId: "retry-3",
        taskId: task.taskId,
        version: 3,
        reason: "credentials",
        request: "Need credential",
        timestamp: Date.now(),
      },
    });

    const forwardPromise = orchestrator.forwardCredentialInputToTask({
      requesterSessionKey: "retry-session",
      decision: {
        kind: "resume_task",
        task,
        credentials: {
          fields: ["password=secret"],
          raw: "password=secret",
        },
      },
    });
    await vi.runAllTimersAsync();
    const forwardResult = await forwardPromise;

    expect(forwardResult.forwarded).toBe(true);
    expect(gatewayMocks.callGateway).toHaveBeenCalledTimes(3);

    const resumed = registry.resolveTaskByRunId("run-retry");
    expect(resumed?.status).toBe("executing");
  });

  it("stops after bounded retry attempts when resume forwarding keeps failing", async () => {
    vi.useFakeTimers();
    gatewayMocks.callGateway.mockRejectedValue(new Error("gateway timeout"));

    const registry = await import("./task-registry.js");
    const orchestrator = await import("./task-orchestrator.js");

    const task = registry.createTrackedTask({
      sessionKey: "retry-fail-session",
      title: "Retry fail resume",
      runId: "run-retry-fail",
      childSessionKey: "agent:main:subagent:retry-fail",
    });
    registry.updateTaskFromRunEvent({
      runId: "run-retry-fail",
      event: {
        type: "task_progress",
        eventId: "retry-fail-1",
        taskId: task.taskId,
        version: 1,
        status: "planning",
        progress: 10,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-retry-fail",
      event: {
        type: "task_progress",
        eventId: "retry-fail-2",
        taskId: task.taskId,
        version: 2,
        status: "executing",
        progress: 40,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-retry-fail",
      event: {
        type: "task_blocked_user_input",
        eventId: "retry-fail-3",
        taskId: task.taskId,
        version: 3,
        reason: "credentials",
        request: "Need credential",
        timestamp: Date.now(),
      },
    });

    const forwardPromise = orchestrator.forwardCredentialInputToTask({
      requesterSessionKey: "retry-fail-session",
      decision: {
        kind: "resume_task",
        task,
        credentials: {
          fields: ["password=secret"],
          raw: "password=secret",
        },
      },
    });
    await vi.runAllTimersAsync();
    const forwardResult = await forwardPromise;

    expect(forwardResult.forwarded).toBe(false);
    expect(forwardResult.error).toContain("gateway timeout");
    expect(gatewayMocks.callGateway).toHaveBeenCalledTimes(3);

    const latest = registry.resolveTaskByRunId("run-retry-fail");
    expect(latest?.status).toBe("blocked");
  });

  it("does not retry non-retryable resume forwarding errors", async () => {
    vi.useFakeTimers();
    gatewayMocks.callGateway.mockRejectedValue(new Error("chat not found"));

    const registry = await import("./task-registry.js");
    const orchestrator = await import("./task-orchestrator.js");

    const task = registry.createTrackedTask({
      sessionKey: "non-retry-session",
      title: "Non retryable resume",
      runId: "run-non-retry",
      childSessionKey: "agent:main:subagent:non-retry",
    });
    registry.updateTaskFromRunEvent({
      runId: "run-non-retry",
      event: {
        type: "task_progress",
        eventId: "non-retry-1",
        taskId: task.taskId,
        version: 1,
        status: "planning",
        progress: 10,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-non-retry",
      event: {
        type: "task_progress",
        eventId: "non-retry-2",
        taskId: task.taskId,
        version: 2,
        status: "executing",
        progress: 40,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-non-retry",
      event: {
        type: "task_blocked_user_input",
        eventId: "non-retry-3",
        taskId: task.taskId,
        version: 3,
        reason: "credentials",
        request: "Need credential",
        timestamp: Date.now(),
      },
    });

    const forwardPromise = orchestrator.forwardCredentialInputToTask({
      requesterSessionKey: "non-retry-session",
      decision: {
        kind: "resume_task",
        task,
        credentials: {
          fields: ["password=secret"],
          raw: "password=secret",
        },
      },
    });
    await vi.runAllTimersAsync();
    const forwardResult = await forwardPromise;

    expect(forwardResult.forwarded).toBe(false);
    expect(forwardResult.error).toContain("chat not found");
    expect(gatewayMocks.callGateway).toHaveBeenCalledTimes(1);

    const latest = registry.resolveTaskByRunId("run-non-retry");
    expect(latest?.status).toBe("blocked");
  });

  it("completes successfully when verification hook allows completion", async () => {
    hookRunnerMocks.hasHooks.mockReturnValue(true);
    hookRunnerMocks.runSubagentCompletionVerification.mockResolvedValue({
      decision: "allow",
    });

    const registry = await import("./task-registry.js");
    const orchestrator = await import("./task-orchestrator.js");

    const task = registry.createTrackedTask({
      sessionKey: "verify-allow-session",
      title: "Verification allow",
      runId: "run-verify-allow",
      childSessionKey: "agent:main:subagent:verify-allow",
    });
    registry.updateTaskFromRunEvent({
      runId: "run-verify-allow",
      event: {
        type: "task_progress",
        eventId: "verify-allow-1",
        taskId: task.taskId,
        version: 1,
        status: "planning",
        progress: 10,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-verify-allow",
      event: {
        type: "task_progress",
        eventId: "verify-allow-2",
        taskId: task.taskId,
        version: 2,
        status: "executing",
        progress: 70,
        timestamp: Date.now(),
      },
    });

    orchestrator.markSubagentTaskOutcome({
      runId: "run-verify-allow",
      status: "ok",
    });

    await vi.waitFor(() => {
      const latest = registry.resolveTaskByRunId("run-verify-allow");
      expect(latest?.status).toBe("completed");
    });
    expect(hookRunnerMocks.runSubagentCompletionVerification).toHaveBeenCalledTimes(1);
  });

  it("moves task to blocked when verification hook rejects completion", async () => {
    hookRunnerMocks.hasHooks.mockReturnValue(true);
    hookRunnerMocks.runSubagentCompletionVerification.mockResolvedValue({
      decision: "reject",
      reason: "Smoke checks failed",
    });

    const registry = await import("./task-registry.js");
    const orchestrator = await import("./task-orchestrator.js");

    const task = registry.createTrackedTask({
      sessionKey: "verify-reject-session",
      title: "Verification reject",
      runId: "run-verify-reject",
      childSessionKey: "agent:main:subagent:verify-reject",
    });
    registry.updateTaskFromRunEvent({
      runId: "run-verify-reject",
      event: {
        type: "task_progress",
        eventId: "verify-reject-1",
        taskId: task.taskId,
        version: 1,
        status: "planning",
        progress: 10,
        timestamp: Date.now(),
      },
    });
    registry.updateTaskFromRunEvent({
      runId: "run-verify-reject",
      event: {
        type: "task_progress",
        eventId: "verify-reject-2",
        taskId: task.taskId,
        version: 2,
        status: "executing",
        progress: 70,
        timestamp: Date.now(),
      },
    });

    orchestrator.markSubagentTaskOutcome({
      runId: "run-verify-reject",
      status: "ok",
    });

    await vi.waitFor(() => {
      const latest = registry.resolveTaskByRunId("run-verify-reject");
      expect(latest?.status).toBe("blocked");
      expect(latest?.blockedReason).toBe("external_dependency");
      expect(latest?.blockedRequest).toContain("Smoke checks failed");
    });
  });
});
