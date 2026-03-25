import { describe, expect, it } from "vitest";
import {
  __markAndCheckTaskPlanPromptedForTests,
  __resetPlanPromptStateForTests,
} from "./subagent-announce.js";

describe("subagent plan prompt throttling", () => {
  it("prompts plan only once per task id", async () => {
    __resetPlanPromptStateForTests();
    expect(__markAndCheckTaskPlanPromptedForTests("T-ONCE")).toBe(false);
    expect(__markAndCheckTaskPlanPromptedForTests("T-ONCE")).toBe(true);
    expect(__markAndCheckTaskPlanPromptedForTests("T-OTHER")).toBe(false);
  });

  it("does not mark blank task ids", async () => {
    __resetPlanPromptStateForTests();
    expect(__markAndCheckTaskPlanPromptedForTests("")).toBe(false);
    expect(__markAndCheckTaskPlanPromptedForTests("   ")).toBe(false);
  });
});
