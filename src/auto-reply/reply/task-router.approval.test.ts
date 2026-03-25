import { describe, expect, it } from "vitest";
import { decideTaskRoute } from "./task-router.js";

describe("task router approval gating", () => {
  it("requires approval for costly operations when policy enabled", () => {
    const decision = decideTaskRoute({
      body: "帮我跑全量测试并生成覆盖率",
      policies: { costlyOpsApproval: true },
    });
    expect(decision.path).toBe("task_path");
    expect(decision.requiresExecutionApproval).toBe(true);
  });

  it("requires approval for review_first medium tasks", () => {
    const decision = decideTaskRoute({
      body: "帮我安装 skillhub 并验证",
      policies: { planApprovalMode: "review_first" },
    });
    expect(decision.path).toBe("task_path");
    expect(decision.requiresExecutionApproval).toBe(true);
  });
});
