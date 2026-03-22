import { describe, expect, it } from "vitest";
import { __testing, withTaskResourceLock } from "./task-resource-locks.js";

describe("task-resource-locks", () => {
  it("serializes work per domain+resource key", async () => {
    __testing.resetTaskResourceLocks();
    const order: string[] = [];

    const first = withTaskResourceLock(
      {
        domain: "task_resume_forward",
        resourceKey: "agent:main:main:T-LOCKED",
      },
      async () => {
        order.push("first:start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("first:end");
      },
    );

    const second = withTaskResourceLock(
      {
        domain: "task_resume_forward",
        resourceKey: "agent:main:main:T-LOCKED",
      },
      async () => {
        order.push("second:start");
        order.push("second:end");
      },
    );

    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("does not block unrelated domains", async () => {
    __testing.resetTaskResourceLocks();
    const order: string[] = [];

    await Promise.all([
      withTaskResourceLock(
        {
          domain: "task_resume_forward",
          resourceKey: "agent:main:main:T-SHARED",
        },
        async () => {
          order.push("resume:start");
          await new Promise((resolve) => setTimeout(resolve, 10));
          order.push("resume:end");
        },
      ),
      withTaskResourceLock(
        {
          domain: "task_registry_write",
          resourceKey: "agent:main:main:T-SHARED",
        },
        async () => {
          order.push("registry:start");
          order.push("registry:end");
        },
      ),
    ]);

    expect(order).toContain("resume:start");
    expect(order).toContain("registry:start");
  });
});
