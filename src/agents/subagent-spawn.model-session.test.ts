import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
const updateSessionStoreMock = vi.fn();
const pruneLegacyStoreKeysMock = vi.fn();

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
            maxActiveTasksPerSession: 50,
          },
        },
      },
    }),
  };
});

vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions.js")>();
  return {
    ...actual,
    updateSessionStore: (...args: unknown[]) => updateSessionStoreMock(...args),
  };
});

vi.mock("../gateway/session-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gateway/session-utils.js")>();
  return {
    ...actual,
    resolveGatewaySessionStoreTarget: (params: { key: string }) => ({
      agentId: "main",
      storePath: "/tmp/subagent-spawn-model-session.json",
      canonicalKey: params.key,
      storeKeys: [params.key],
    }),
    pruneLegacyStoreKeys: (...args: unknown[]) => pruneLegacyStoreKeysMock(...args),
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

describe("spawnSubagentDirect runtime model persistence", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetSubagentRegistryForTests } = await import("./subagent-registry.js");
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
    updateSessionStoreMock.mockReset();
    pruneLegacyStoreKeysMock.mockReset();

    callGatewayMock.mockImplementation(async (opts: { method?: string }) => {
      if (opts.method === "sessions.patch") {
        return { ok: true };
      }
      if (opts.method === "sessions.delete") {
        return { ok: true };
      }
      if (opts.method === "agent") {
        return { runId: "run-1", status: "accepted", acceptedAt: 1000 };
      }
      return {};
    });

    updateSessionStoreMock.mockImplementation(
      async (
        _storePath: string,
        mutator: (store: Record<string, Record<string, unknown>>) => unknown,
      ) => {
        const store: Record<string, Record<string, unknown>> = {};
        await mutator(store);
        return store;
      },
    );
  });

  it("persists runtime model fields on the child session before starting the run", async () => {
    const { spawnSubagentDirect } = await import("./subagent-spawn.js");
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

    const result = await spawnSubagentDirect(
      {
        task: "test",
        model: "openai-codex/gpt-5.4",
      },
      {
        agentSessionKey: "agent:main:model-session-persist",
        agentChannel: "discord",
      },
    );

    expect(result).toMatchObject({
      status: "accepted",
      modelApplied: true,
    });
    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "agent",
        params: expect.objectContaining({
          sessionKey: expect.stringMatching(/^agent:main:subagent:/),
        }),
      }),
    );
  });
});
