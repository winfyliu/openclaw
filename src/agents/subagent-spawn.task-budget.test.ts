import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";
import { spawnSubagentDirect } from "./subagent-spawn.js";

const callGatewayMock = vi.fn();
const countActiveTasksForSessionMock = vi.fn(() => 0);

vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        defaults: {
          workspace: os.tmpdir(),
          subagents: {
            maxActiveTasksPerSession: 2,
          },
        },
      },
    }),
  };
});

vi.mock("./task-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-registry.js")>();
  return {
    ...actual,
    countActiveTasksForSession: () => countActiveTasksForSessionMock(),
  };
});

vi.mock("./subagent-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./subagent-registry.js")>();
  return {
    ...actual,
    countActiveRunsForSession: () => 0,
    registerSubagentRun: () => {},
  };
});

vi.mock("./subagent-announce.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./subagent-announce.js")>();
  return {
    ...actual,
    buildSubagentSystemPrompt: () => "system-prompt",
  };
});

vi.mock("./subagent-depth.js", () => ({
  getSubagentDepthFromSessionStore: () => 0,
}));

vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({ hasHooks: () => false }),
}));

describe("spawnSubagentDirect task budget", () => {
  beforeEach(() => {
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
    countActiveTasksForSessionMock.mockReset();
    countActiveTasksForSessionMock.mockReturnValue(0);
    callGatewayMock.mockImplementation(async (opts: { method?: string }) => {
      if (opts.method === "sessions.patch") {
        return { ok: true };
      }
      if (opts.method === "agent") {
        return { runId: "run-1", status: "accepted", acceptedAt: 1000 };
      }
      if (opts.method === "sessions.delete") {
        return { ok: true };
      }
      return {};
    });
  });

  it("rejects spawn when active task budget is exhausted", async () => {
    countActiveTasksForSessionMock.mockReturnValue(2);

    const result = await spawnSubagentDirect(
      {
        task: "test budget",
      },
      {
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      },
    );

    expect(result.status).toBe("forbidden");
    expect(result.error).toContain("max active tasks for this session");
    expect(callGatewayMock).not.toHaveBeenCalled();
  });
});
