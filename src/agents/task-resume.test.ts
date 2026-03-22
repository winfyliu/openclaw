import { describe, expect, it, vi } from "vitest";

vi.mock("./task-registry.js", () => ({
  getBlockedTasksForSession: vi.fn((sessionKey: string) => {
    if (sessionKey === "one") {
      return [
        {
          taskId: "T-AAAA1111",
          sessionKey,
          title: "Task A",
          status: "blocked",
          lastVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ];
    }
    if (sessionKey === "multi") {
      return [
        {
          taskId: "T-AAAA1111",
          sessionKey,
          title: "Task A",
          status: "blocked",
          lastVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          taskId: "T-BBBB2222",
          sessionKey,
          title: "Task B",
          status: "blocked",
          lastVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ];
    }
    return [];
  }),
  listTasksForSession: vi.fn(() => []),
  resolveTaskByIdOrRun: vi.fn(({ taskId }: { taskId?: string }) =>
    taskId === "T-BBBB2222"
      ? {
          taskId,
          sessionKey: "multi",
          title: "Task B",
          status: "blocked",
          lastVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        }
      : undefined,
  ),
}));

describe("task-resume routing", () => {
  it("routes to the only blocked task when credentials are detected", async () => {
    const { resolveCredentialResumeRouting } = await import("./task-resume.js");
    const decision = resolveCredentialResumeRouting({
      sessionKey: "one",
      body: "username=alice password=secret",
    });
    expect(decision.kind).toBe("resume_task");
  });

  it("asks for task selection when multiple blocked tasks exist", async () => {
    const { resolveCredentialResumeRouting } = await import("./task-resume.js");
    const decision = resolveCredentialResumeRouting({
      sessionKey: "multi",
      body: "password=secret",
    });
    expect(decision.kind).toBe("needs_task_selection");
  });

  it("supports explicit task id targeting", async () => {
    const { resolveCredentialResumeRouting } = await import("./task-resume.js");
    const decision = resolveCredentialResumeRouting({
      sessionKey: "multi",
      body: "for T-BBBB2222: token=abc",
    });
    expect(decision.kind).toBe("resume_task");
    if (decision.kind === "resume_task") {
      expect(decision.task.taskId).toBe("T-BBBB2222");
    }
  });

  it("routes permission grant messages for a single blocked task", async () => {
    const { resolveCredentialResumeRouting } = await import("./task-resume.js");
    const decision = resolveCredentialResumeRouting({
      sessionKey: "one",
      body: "permission granted, you can continue now",
    });
    expect(decision.kind).toBe("resume_task");
  });

  it("asks for task selection when permission grant is ambiguous across multiple tasks", async () => {
    const { resolveCredentialResumeRouting } = await import("./task-resume.js");
    const decision = resolveCredentialResumeRouting({
      sessionKey: "multi",
      body: "I have authorized this, proceed",
    });
    expect(decision.kind).toBe("needs_task_selection");
  });
});
