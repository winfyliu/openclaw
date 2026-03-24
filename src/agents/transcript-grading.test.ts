import { describe, expect, it } from "vitest";
import { gradeTranscript, parseTranscriptJsonl } from "./transcript-grading.js";

describe("transcript grading", () => {
  it("scores strong transcripts with planning, verification, and clear completion", () => {
    const entries = [
      {
        role: "assistant",
        text: "Plan: 1) inspect state 2) apply changes 3) verify results",
      },
      {
        role: "assistant",
        text: "Validated with targeted tests and verified output behavior.",
      },
      {
        role: "assistant",
        text: "Completed the task and documented the next steps clearly.",
      },
    ];

    const grade = gradeTranscript(entries);
    expect(grade.score).toBe(100);
    expect(grade.metrics.planSignal).toBe(true);
    expect(grade.metrics.verificationSignal).toBe(true);
    expect(grade.metrics.completionClaritySignal).toBe(true);
  });

  it("captures blocked/recovery signals when blocked appears", () => {
    const entries = [
      { role: "assistant", text: "Task is blocked until credentials are provided." },
      { role: "assistant", text: "Received input and resume flow is now active." },
    ];

    const grade = gradeTranscript(entries);
    expect(grade.metrics.blockedRecoverySignal).toBe(true);
    expect(grade.evidence.blockedMentions).toBeGreaterThan(0);
    expect(grade.evidence.resumeMentions).toBeGreaterThan(0);
  });

  it("parses JSONL transcript lines safely", () => {
    const parsed = parseTranscriptJsonl(
      [
        JSON.stringify({ role: "assistant", text: "hello" }),
        "{bad json}",
        JSON.stringify({ role: "assistant", text: "world" }),
      ].join("\n"),
    );
    expect(parsed).toHaveLength(2);
  });
});
