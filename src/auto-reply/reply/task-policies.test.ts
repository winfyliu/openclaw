import { describe, expect, it } from "vitest";
import { maybeApplyPoliciesFromUserText } from "./task-policies.js";

describe("task policies updates from user text", () => {
  it("sets review_first preference", () => {
    const updated = maybeApplyPoliciesFromUserText("以后先给我看规划，确认后再执行");
    expect(updated?.planApprovalMode).toBe("review_first");
  });

  it("sets auto_execute preference", () => {
    const updated = maybeApplyPoliciesFromUserText("可以直接执行，不用先审核");
    expect(updated?.planApprovalMode).toBe("auto_execute");
  });
});
