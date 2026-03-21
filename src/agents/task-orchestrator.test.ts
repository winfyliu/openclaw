import { describe, expect, it } from "vitest";

describe("task-orchestrator panel", () => {
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
    expect(lines[0]).toContain("Current task progress");
    expect(lines[1]).toContain(taskB.taskId);
    expect(lines[2]).toContain(taskA.taskId);
  });
});
