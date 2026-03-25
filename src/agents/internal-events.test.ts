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

  it("formats task plan events", () => {
    const text = formatAgentInternalEventsForPrompt([
      {
        type: "task_plan",
        taskId: "T-CCCC3333",
        childSessionKey: "agent:main:subagent:child-1",
        taskLabel: "install skillhub",
        plan: "1) read docs\n2) install\n3) verify",
        complexity: "high",
        confidence: 0.88,
      },
    ]);

    expect(text).toContain("[Internal task plan event]");
    expect(text).toContain("task_id: T-CCCC3333");
    expect(text).toContain("task: install skillhub");
    expect(text).toContain("complexity: high");
    expect(text).toContain("confidence: 88%");
    expect(text).toContain("BEGIN_UNTRUSTED_PLAN");
  });

  it("formats task plan event without task id", () => {
    const text = formatAgentInternalEventsForPrompt([
      {
        type: "task_plan",
        childSessionKey: "agent:main:subagent:child-2",
        taskLabel: "verify release",
        plan: "- check tag\n- publish",
      },
    ]);

    expect(text).toContain("[Internal task plan event]");
    expect(text).toContain("task: verify release");
    expect(text).toContain("session_key: agent:main:subagent:child-2");
  });
});
