/**
 * Test: subagent_spawning, subagent_delivery_target, subagent_spawned & subagent_ended hook wiring
 */
import { describe, expect, it, vi } from "vitest";
import { createHookRunner } from "./hooks.js";
import { createMockPluginRegistry } from "./hooks.test-helpers.js";

describe("subagent hook runner methods", () => {
  const baseRequester = {
    channel: "discord",
    accountId: "work",
    to: "channel:123",
    threadId: "456",
  };

  const baseSubagentCtx = {
    runId: "run-1",
    childSessionKey: "agent:main:subagent:child",
    requesterSessionKey: "agent:main:main",
  };

  it("runSubagentSpawning invokes registered subagent_spawning hooks", async () => {
    const handler = vi.fn(async () => ({ status: "ok", threadBindingReady: true as const }));
    const registry = createMockPluginRegistry([{ hookName: "subagent_spawning", handler }]);
    const runner = createHookRunner(registry);
    const event = {
      childSessionKey: "agent:main:subagent:child",
      agentId: "main",
      label: "research",
      mode: "session" as const,
      requester: baseRequester,
      threadRequested: true,
    };
    const ctx = {
      childSessionKey: "agent:main:subagent:child",
      requesterSessionKey: "agent:main:main",
    };

    const result = await runner.runSubagentSpawning(event, ctx);

    expect(handler).toHaveBeenCalledWith(event, ctx);
    expect(result).toMatchObject({ status: "ok", threadBindingReady: true });
  });

  it("runSubagentSpawned invokes registered subagent_spawned hooks", async () => {
    const handler = vi.fn();
    const registry = createMockPluginRegistry([{ hookName: "subagent_spawned", handler }]);
    const runner = createHookRunner(registry);
    const event = {
      runId: "run-1",
      childSessionKey: "agent:main:subagent:child",
      agentId: "main",
      label: "research",
      mode: "run" as const,
      requester: baseRequester,
      threadRequested: true,
    };

    await runner.runSubagentSpawned(event, baseSubagentCtx);

    expect(handler).toHaveBeenCalledWith(event, baseSubagentCtx);
  });

  it("runSubagentDeliveryTarget invokes registered subagent_delivery_target hooks", async () => {
    const handler = vi.fn(async () => ({
      origin: {
        channel: "discord" as const,
        accountId: "work",
        to: "channel:777",
        threadId: "777",
      },
    }));
    const registry = createMockPluginRegistry([{ hookName: "subagent_delivery_target", handler }]);
    const runner = createHookRunner(registry);
    const event = {
      childSessionKey: "agent:main:subagent:child",
      requesterSessionKey: "agent:main:main",
      requesterOrigin: baseRequester,
      childRunId: "run-1",
      spawnMode: "session" as const,
      expectsCompletionMessage: true,
    };

    const result = await runner.runSubagentDeliveryTarget(event, baseSubagentCtx);

    expect(handler).toHaveBeenCalledWith(event, baseSubagentCtx);
    expect(result).toEqual({
      origin: {
        channel: "discord",
        accountId: "work",
        to: "channel:777",
        threadId: "777",
      },
    });
  });

  it("runSubagentDeliveryTarget returns undefined when no matching hooks are registered", async () => {
    const registry = createMockPluginRegistry([]);
    const runner = createHookRunner(registry);
    const result = await runner.runSubagentDeliveryTarget(
      {
        childSessionKey: "agent:main:subagent:child",
        requesterSessionKey: "agent:main:main",
        requesterOrigin: baseRequester,
        childRunId: "run-1",
        spawnMode: "session",
        expectsCompletionMessage: true,
      },
      baseSubagentCtx,
    );
    expect(result).toBeUndefined();
  });

  it("runSubagentCompletionVerification invokes registered verification hooks", async () => {
    const handler = vi.fn(async () => ({ decision: "allow" as const }));
    const registry = createMockPluginRegistry([
      { hookName: "subagent_completion_verification", handler },
    ]);
    const runner = createHookRunner(registry);
    const event = {
      runId: "run-1",
      taskId: "T-123",
      title: "Verify completion",
      childSessionKey: "agent:main:subagent:child",
      requesterSessionKey: "agent:main:main",
      outcome: "ok" as const,
    };

    const result = await runner.runSubagentCompletionVerification(event, baseSubagentCtx);

    expect(handler).toHaveBeenCalledWith(event, baseSubagentCtx);
    expect(result).toEqual({ decision: "allow" });
  });

  it("runSubagentEnded invokes registered subagent_ended hooks", async () => {
    const handler = vi.fn();
    const registry = createMockPluginRegistry([{ hookName: "subagent_ended", handler }]);
    const runner = createHookRunner(registry);
    const event = {
      targetSessionKey: "agent:main:subagent:child",
      targetKind: "subagent" as const,
      reason: "subagent-complete",
      sendFarewell: true,
      accountId: "work",
      runId: "run-1",
      outcome: "ok" as const,
    };

    await runner.runSubagentEnded(event, baseSubagentCtx);

    expect(handler).toHaveBeenCalledWith(event, baseSubagentCtx);
  });

  it("hasHooks returns true for registered subagent hooks", () => {
    const registry = createMockPluginRegistry([
      { hookName: "subagent_spawning", handler: vi.fn() },
      { hookName: "subagent_delivery_target", handler: vi.fn() },
    ]);
    const runner = createHookRunner(registry);

    expect(runner.hasHooks("subagent_spawning")).toBe(true);
    expect(runner.hasHooks("subagent_delivery_target")).toBe(true);
    expect(runner.hasHooks("subagent_completion_verification")).toBe(false);
    expect(runner.hasHooks("subagent_spawned")).toBe(false);
    expect(runner.hasHooks("subagent_ended")).toBe(false);
  });

  it("runSubagentCompletionVerification merges reject over allow decisions", async () => {
    const allowHandler = vi.fn(async () => ({ decision: "allow" as const }));
    const rejectHandler = vi.fn(async () => ({
      decision: "reject" as const,
      reason: "checks failed",
    }));
    const registry = createMockPluginRegistry([
      { hookName: "subagent_completion_verification", handler: allowHandler },
      { hookName: "subagent_completion_verification", handler: rejectHandler },
    ]);
    const runner = createHookRunner(registry);

    const result = await runner.runSubagentCompletionVerification(
      {
        runId: "run-verify",
        outcome: "ok",
      },
      baseSubagentCtx,
    );

    expect(allowHandler).toHaveBeenCalledTimes(1);
    expect(rejectHandler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ decision: "reject", reason: "checks failed" });
  });
});
