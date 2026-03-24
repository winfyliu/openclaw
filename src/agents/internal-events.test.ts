import { describe, expect, it } from "vitest";
import { formatAgentInternalEventsForPrompt } from "./internal-events.js";

describe("internal events formatting", () => {
  it("formats progress and blocked events", () => {
    const text = formatAgentInternalEventsForPrompt([
      {
        type: "task_progress",
        taskId: "T-AAAA1111",
        status: "executing",
        progress: 55,
        message: "Working",
      },
      {
        type: "task_blocked_user_input",
        taskId: "T-BBBB2222",
        reason: "credentials",
        request: "Need account credentials",
      },
    ]);

    expect(text).toContain("OpenClaw runtime context (internal)");
    expect(text).toContain("[Internal task progress event]");
    expect(text).toContain("task_id: T-AAAA1111");
    expect(text).toContain("status: executing");
    expect(text).toContain("progress: 55%");
    expect(text).toContain("[Internal task blocked event]");
    expect(text).toContain("task_id: T-BBBB2222");
    expect(text).toContain("reason: credentials");
  });
});
