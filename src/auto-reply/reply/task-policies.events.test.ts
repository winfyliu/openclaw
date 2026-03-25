import { describe, expect, it } from "vitest";
import { summarizeTaskApprovalEvents } from "./task-policies.js";

describe("task approval event summary", () => {
  it("summarizes action counts", () => {
    const text = summarizeTaskApprovalEvents([
      { ts: "2026-01-01T00:00:00Z", action: "requested" },
      { ts: "2026-01-01T00:00:01Z", action: "requested" },
      { ts: "2026-01-01T00:00:02Z", action: "confirmed" },
      { ts: "2026-01-01T00:00:03Z", action: "replanned" },
    ]);

    expect(text).toContain("Task Approval Stats");
    expect(text).toContain("requested: 2");
    expect(text).toContain("confirmed: 1");
    expect(text).toContain("replanned: 1");
  });
});
