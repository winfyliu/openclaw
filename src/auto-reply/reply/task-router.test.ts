import { describe, expect, it } from "vitest";
import { decideTaskRoute } from "./task-router.js";

describe("decideTaskRoute", () => {
  it("routes short QA to fast path", () => {
    const decision = decideTaskRoute({ body: "苹果英文是什么" });
    expect(decision.path).toBe("fast_qa");
    expect(decision.reasonShort).toBe("short_qa");
  });

  it("routes task-like prompt to task path", () => {
    const decision = decideTaskRoute({ body: "帮我安装 skillhub 并验证" });
    expect(decision.path).toBe("task_path");
    expect(decision.complexity).toBe("medium");
    expect(decision.ackText.length).toBeGreaterThan(0);
  });

  it("enables plan approval mode when user asks review-first", () => {
    const decision = decideTaskRoute({ body: "先给我看规划，确认后再执行" });
    expect(decision.path).toBe("task_path");
    expect(decision.needsPlanApproval).toBe(true);
  });

  it("requires execution approval for external-side-effect tasks when policy is enabled", () => {
    const decision = decideTaskRoute({
      body: "帮我发送一条通知到群里",
      policies: { externalSideEffectsApproval: true },
    });
    expect(decision.path).toBe("task_path");
    expect(decision.requiresExecutionApproval).toBe(true);
  });
});
