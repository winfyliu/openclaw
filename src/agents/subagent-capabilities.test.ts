import { describe, expect, it } from "vitest";
import {
  resolveStoredSubagentCapabilities,
  resolveSubagentCapabilities,
  resolveSubagentControlScopeForRole,
  resolveSubagentRoleForDepth,
} from "./subagent-capabilities.js";

describe("subagent-capabilities", () => {
  it("resolves planner/executor baseline roles from depth", () => {
    expect(resolveSubagentRoleForDepth({ depth: 0, maxSpawnDepth: 2 })).toBe("main");
    expect(resolveSubagentRoleForDepth({ depth: 1, maxSpawnDepth: 2 })).toBe("orchestrator");
    expect(resolveSubagentRoleForDepth({ depth: 2, maxSpawnDepth: 2 })).toBe("leaf");
  });

  it("maps role to control scope", () => {
    expect(resolveSubagentControlScopeForRole("main")).toBe("children");
    expect(resolveSubagentControlScopeForRole("orchestrator")).toBe("children");
    expect(resolveSubagentControlScopeForRole("leaf")).toBe("none");
  });

  it("computes canSpawn/canControl flags for planner/executor baseline", () => {
    const orchestrator = resolveSubagentCapabilities({ depth: 1, maxSpawnDepth: 3 });
    expect(orchestrator.role).toBe("orchestrator");
    expect(orchestrator.canSpawn).toBe(true);
    expect(orchestrator.canControlChildren).toBe(true);

    const leaf = resolveSubagentCapabilities({ depth: 3, maxSpawnDepth: 3 });
    expect(leaf.role).toBe("leaf");
    expect(leaf.canSpawn).toBe(false);
    expect(leaf.canControlChildren).toBe(false);
  });

  it("respects stored role/control overrides when present", () => {
    const resolved = resolveStoredSubagentCapabilities("agent:main:subagent:override", {
      cfg: {
        agents: {
          defaults: {
            subagents: {
              maxSpawnDepth: 2,
            },
          },
        },
      },
      store: {
        "agent:main:subagent:override": {
          sessionId: "sess-override",
          spawnDepth: 1,
          subagentRole: "leaf",
          subagentControlScope: "none",
        },
      },
    });

    expect(resolved.role).toBe("leaf");
    expect(resolved.controlScope).toBe("none");
    expect(resolved.canSpawn).toBe(false);
    expect(resolved.canControlChildren).toBe(false);
  });
});
