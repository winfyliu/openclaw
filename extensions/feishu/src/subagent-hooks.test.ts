import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRequiredHookHandler,
  registerHookHandlersForTest,
} from "../../../test/helpers/extensions/subagent-hooks.js";
import type { OpenClawPluginApi } from "../runtime-api.js";
import { registerFeishuSubagentHooks } from "./subagent-hooks.js";
import {
  __testing as threadBindingTesting,
  createFeishuThreadBindingManager,
} from "./thread-bindings.js";

const hoisted = vi.hoisted(() => ({
  sendMessageFeishuMock: vi.fn<(params: unknown) => Promise<{ messageId: string }>>(
    async () => ({ messageId: "m-1" }),
  ),
}));

vi.mock("./send.js", () => ({
  sendMessageFeishu: (params: unknown) => hoisted.sendMessageFeishuMock(params),
}));

const baseConfig = {
  session: { mainKey: "main", scope: "per-sender" },
  channels: { feishu: {} },
};

function registerHandlersForTest(config: Record<string, unknown> = baseConfig) {
  return registerHookHandlersForTest<OpenClawPluginApi>({
    config,
    register: registerFeishuSubagentHooks,
  });
}

describe("feishu subagent hook handlers", () => {
  beforeEach(() => {
    threadBindingTesting.resetFeishuThreadBindingsForTests();
    hoisted.sendMessageFeishuMock.mockClear();
  });

  it("registers Feishu subagent hooks", () => {
    const handlers = registerHandlersForTest();
    expect(handlers.has("subagent_spawning")).toBe(true);
    expect(handlers.has("subagent_delivery_target")).toBe(true);
    expect(handlers.has("subagent_ended")).toBe(true);
    expect(handlers.has("subagent_spawned")).toBe(true);
  });

  it("sends spawned and ended status updates with sensitive text redaction", async () => {
    const handlers = registerHandlersForTest();
    const spawnHandler = getRequiredHookHandler(handlers, "subagent_spawning");
    const spawnedHandler = getRequiredHookHandler(handlers, "subagent_spawned");
    const endedHandler = getRequiredHookHandler(handlers, "subagent_ended");

    createFeishuThreadBindingManager({ cfg: baseConfig as any, accountId: "work" });

    await spawnHandler(
      {
        childSessionKey: "agent:main:subagent:child",
        agentId: "codex",
        label: "stock lookup",
        mode: "session",
        requester: {
          channel: "feishu",
          accountId: "work",
          to: "user:ou_sender_1",
        },
        threadRequested: true,
      },
      {
        requesterSessionKey: "agent:main:main",
      },
    );

    await spawnedHandler(
      {
        childSessionKey: "agent:main:subagent:child",
        runId: "run-1",
        taskId: "T-ABCD1234",
        agentId: "codex",
        label: "stock lookup",
        mode: "session",
        requester: {
          channel: "feishu",
          accountId: "work",
          to: "user:ou_sender_1",
        },
        threadRequested: true,
      },
      {
        requesterSessionKey: "agent:main:main",
      },
    );

    endedHandler(
      {
        targetSessionKey: "agent:main:subagent:child",
        targetKind: "subagent",
        reason: "failed: password=abc123 token=XYZ",
        accountId: "work",
        outcome: "error",
        error: "missing credential password=hunter2",
      },
      {},
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hoisted.sendMessageFeishuMock).toHaveBeenCalled();
    const sentTexts = (hoisted.sendMessageFeishuMock.mock.calls as unknown[][])
      .map((call) => ((call[0] as { text?: string } | undefined)?.text ?? ""))
      .join("\n");
    expect(sentTexts).toContain("Current status:");
    expect(sentTexts).toContain("Completed:");
    expect(sentTexts).toContain("Need type:");
    expect(sentTexts).toContain("Need from you:");
    expect(sentTexts).toContain("[T-ABCD1234]");
    expect(sentTexts).toContain("Blocked/failed");
    expect(sentTexts).toContain("Reply example: for");
    expect(sentTexts).toContain("password=[REDACTED]");
    expect(sentTexts).not.toContain("hunter2");
  });

  it("binds a Feishu DM conversation on subagent_spawning", async () => {
    const handlers = registerHandlersForTest();
    const handler = getRequiredHookHandler(handlers, "subagent_spawning");
    createFeishuThreadBindingManager({ cfg: baseConfig as any, accountId: "work" });

    const result = await handler(
      {
        childSessionKey: "agent:main:subagent:child",
        agentId: "codex",
        label: "banana",
        mode: "session",
        requester: {
          channel: "feishu",
          accountId: "work",
          to: "user:ou_sender_1",
        },
        threadRequested: true,
      },
      {},
    );

    expect(result).toEqual({ status: "ok", threadBindingReady: true });

    const deliveryTargetHandler = getRequiredHookHandler(handlers, "subagent_delivery_target");
    expect(
      deliveryTargetHandler(
        {
          childSessionKey: "agent:main:subagent:child",
          requesterSessionKey: "agent:main:main",
          requesterOrigin: {
            channel: "feishu",
            accountId: "work",
            to: "user:ou_sender_1",
          },
          expectsCompletionMessage: true,
        },
        {},
      ),
    ).toEqual({
      origin: {
        channel: "feishu",
        accountId: "work",
        to: "user:ou_sender_1",
      },
    });
  });

  it("preserves the original Feishu DM delivery target", async () => {
    const handlers = registerHandlersForTest();
    const deliveryHandler = getRequiredHookHandler(handlers, "subagent_delivery_target");
    const manager = createFeishuThreadBindingManager({ cfg: baseConfig as any, accountId: "work" });

    manager.bindConversation({
      conversationId: "ou_sender_1",
      targetKind: "subagent",
      targetSessionKey: "agent:main:subagent:chat-dm-child",
      metadata: {
        deliveryTo: "chat:oc_dm_chat_1",
        boundBy: "system",
      },
    });

    expect(
      deliveryHandler(
        {
          childSessionKey: "agent:main:subagent:chat-dm-child",
          requesterSessionKey: "agent:main:main",
          requesterOrigin: {
            channel: "feishu",
            accountId: "work",
            to: "chat:oc_dm_chat_1",
          },
          expectsCompletionMessage: true,
        },
        {},
      ),
    ).toEqual({
      origin: {
        channel: "feishu",
        accountId: "work",
        to: "chat:oc_dm_chat_1",
      },
    });
  });

  it("binds a Feishu topic conversation and preserves parent context", async () => {
    const handlers = registerHandlersForTest();
    const spawnHandler = getRequiredHookHandler(handlers, "subagent_spawning");
    const deliveryHandler = getRequiredHookHandler(handlers, "subagent_delivery_target");
    createFeishuThreadBindingManager({ cfg: baseConfig as any, accountId: "work" });

    const result = await spawnHandler(
      {
        childSessionKey: "agent:main:subagent:topic-child",
        agentId: "codex",
        label: "topic-child",
        mode: "session",
        requester: {
          channel: "feishu",
          accountId: "work",
          to: "chat:oc_group_chat",
          threadId: "om_topic_root",
        },
        threadRequested: true,
      },
      {},
    );

    expect(result).toEqual({ status: "ok", threadBindingReady: true });
    expect(
      deliveryHandler(
        {
          childSessionKey: "agent:main:subagent:topic-child",
          requesterSessionKey: "agent:main:main",
          requesterOrigin: {
            channel: "feishu",
            accountId: "work",
            to: "chat:oc_group_chat",
            threadId: "om_topic_root",
          },
          expectsCompletionMessage: true,
        },
        {},
      ),
    ).toEqual({
      origin: {
        channel: "feishu",
        accountId: "work",
        to: "chat:oc_group_chat",
        threadId: "om_topic_root",
      },
    });
  });

  it("uses the requester session binding to preserve sender-scoped topic conversations", async () => {
    const handlers = registerHandlersForTest();
    const spawnHandler = getRequiredHookHandler(handlers, "subagent_spawning");
    const deliveryHandler = getRequiredHookHandler(handlers, "subagent_delivery_target");
    const manager = createFeishuThreadBindingManager({ cfg: baseConfig as any, accountId: "work" });

    manager.bindConversation({
      conversationId: "oc_group_chat:topic:om_topic_root:sender:ou_sender_1",
      parentConversationId: "oc_group_chat",
      targetKind: "subagent",
      targetSessionKey: "agent:main:parent",
      metadata: {
        agentId: "codex",
        label: "parent",
        boundBy: "system",
      },
    });

    const reboundResult = await spawnHandler(
      {
        childSessionKey: "agent:main:subagent:sender-child",
        agentId: "codex",
        label: "sender-child",
        mode: "session",
        requester: {
          channel: "feishu",
          accountId: "work",
          to: "chat:oc_group_chat",
          threadId: "om_topic_root",
        },
        threadRequested: true,
      },
      {
        requesterSessionKey: "agent:main:parent",
      },
    );

    expect(reboundResult).toEqual({ status: "ok", threadBindingReady: true });
    expect(manager.listBySessionKey("agent:main:subagent:sender-child")).toMatchObject([
      {
        conversationId: "oc_group_chat:topic:om_topic_root:sender:ou_sender_1",
        parentConversationId: "oc_group_chat",
      },
    ]);
    expect(
      deliveryHandler(
        {
          childSessionKey: "agent:main:subagent:sender-child",
          requesterSessionKey: "agent:main:parent",
          requesterOrigin: {
            channel: "feishu",
            accountId: "work",
            to: "chat:oc_group_chat",
            threadId: "om_topic_root",
          },
          expectsCompletionMessage: true,
        },
        {},
      ),
    ).toEqual({
      origin: {
        channel: "feishu",
        accountId: "work",
        to: "chat:oc_group_chat",
        threadId: "om_topic_root",
      },
    });
  });

  it("prefers requester-matching bindings when multiple child bindings exist", async () => {
    const handlers = registerHandlersForTest();
    const spawnHandler = getRequiredHookHandler(handlers, "subagent_spawning");
    const deliveryHandler = getRequiredHookHandler(handlers, "subagent_delivery_target");
    createFeishuThreadBindingManager({ cfg: baseConfig as any, accountId: "work" });

    await spawnHandler(
      {
        childSessionKey: "agent:main:subagent:shared",
        agentId: "codex",
        label: "shared",
        mode: "session",
        requester: {
          channel: "feishu",
          accountId: "work",
          to: "user:ou_sender_1",
        },
        threadRequested: true,
      },
      {},
    );
    await spawnHandler(
      {
        childSessionKey: "agent:main:subagent:shared",
        agentId: "codex",
        label: "shared",
        mode: "session",
        requester: {
          channel: "feishu",
          accountId: "work",
          to: "user:ou_sender_2",
        },
        threadRequested: true,
      },
      {},
    );

    expect(
      deliveryHandler(
        {
          childSessionKey: "agent:main:subagent:shared",
          requesterSessionKey: "agent:main:main",
          requesterOrigin: {
            channel: "feishu",
            accountId: "work",
            to: "user:ou_sender_2",
          },
          expectsCompletionMessage: true,
        },
        {},
      ),
    ).toEqual({
      origin: {
        channel: "feishu",
        accountId: "work",
        to: "user:ou_sender_2",
      },
    });
  });

  it("fails closed when requester-session bindings remain ambiguous for the same topic", async () => {
    const handlers = registerHandlersForTest();
    const spawnHandler = getRequiredHookHandler(handlers, "subagent_spawning");
    const deliveryHandler = getRequiredHookHandler(handlers, "subagent_delivery_target");
    const manager = createFeishuThreadBindingManager({ cfg: baseConfig as any, accountId: "work" });

    manager.bindConversation({
      conversationId: "oc_group_chat:topic:om_topic_root:sender:ou_sender_1",
      parentConversationId: "oc_group_chat",
      targetKind: "subagent",
      targetSessionKey: "agent:main:parent",
      metadata: { boundBy: "system" },
    });
    manager.bindConversation({
      conversationId: "oc_group_chat:topic:om_topic_root:sender:ou_sender_2",
      parentConversationId: "oc_group_chat",
      targetKind: "subagent",
      targetSessionKey: "agent:main:parent",
      metadata: { boundBy: "system" },
    });

    await expect(
      spawnHandler(
        {
          childSessionKey: "agent:main:subagent:ambiguous-child",
          agentId: "codex",
          label: "ambiguous-child",
          mode: "session",
          requester: {
            channel: "feishu",
            accountId: "work",
            to: "chat:oc_group_chat",
            threadId: "om_topic_root",
          },
          threadRequested: true,
        },
        {
          requesterSessionKey: "agent:main:parent",
        },
      ),
    ).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("direct messages or topic conversations"),
    });

    expect(
      deliveryHandler(
        {
          childSessionKey: "agent:main:subagent:ambiguous-child",
          requesterSessionKey: "agent:main:parent",
          requesterOrigin: {
            channel: "feishu",
            accountId: "work",
            to: "chat:oc_group_chat",
            threadId: "om_topic_root",
          },
          expectsCompletionMessage: true,
        },
        {},
      ),
    ).toBeUndefined();
  });

  it("fails closed when both topic-level and sender-scoped requester bindings exist", async () => {
    const handlers = registerHandlersForTest();
    const spawnHandler = getRequiredHookHandler(handlers, "subagent_spawning");
    const deliveryHandler = getRequiredHookHandler(handlers, "subagent_delivery_target");
    const manager = createFeishuThreadBindingManager({ cfg: baseConfig as any, accountId: "work" });

    manager.bindConversation({
      conversationId: "oc_group_chat:topic:om_topic_root",
      parentConversationId: "oc_group_chat",
      targetKind: "subagent",
      targetSessionKey: "agent:main:parent",
      metadata: { boundBy: "system" },
    });
    manager.bindConversation({
      conversationId: "oc_group_chat:topic:om_topic_root:sender:ou_sender_1",
      parentConversationId: "oc_group_chat",
      targetKind: "subagent",
      targetSessionKey: "agent:main:parent",
      metadata: { boundBy: "system" },
    });

    await expect(
      spawnHandler(
        {
          childSessionKey: "agent:main:subagent:mixed-topic-child",
          agentId: "codex",
          label: "mixed-topic-child",
          mode: "session",
          requester: {
            channel: "feishu",
            accountId: "work",
            to: "chat:oc_group_chat",
            threadId: "om_topic_root",
          },
          threadRequested: true,
        },
        {
          requesterSessionKey: "agent:main:parent",
        },
      ),
    ).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("direct messages or topic conversations"),
    });

    expect(
      deliveryHandler(
        {
          childSessionKey: "agent:main:subagent:mixed-topic-child",
          requesterSessionKey: "agent:main:parent",
          requesterOrigin: {
            channel: "feishu",
            accountId: "work",
            to: "chat:oc_group_chat",
            threadId: "om_topic_root",
          },
          expectsCompletionMessage: true,
        },
        {},
      ),
    ).toBeUndefined();
  });

  it("no-ops for non-Feishu channels and non-threaded spawns", async () => {
    const handlers = registerHandlersForTest();
    const spawnHandler = getRequiredHookHandler(handlers, "subagent_spawning");
    const deliveryHandler = getRequiredHookHandler(handlers, "subagent_delivery_target");
    const endedHandler = getRequiredHookHandler(handlers, "subagent_ended");

    await expect(
      spawnHandler(
        {
          childSessionKey: "agent:main:subagent:child",
          agentId: "codex",
          mode: "run",
          requester: {
            channel: "discord",
            accountId: "work",
            to: "channel:123",
          },
          threadRequested: true,
        },
        {},
      ),
    ).resolves.toBeUndefined();

    await expect(
      spawnHandler(
        {
          childSessionKey: "agent:main:subagent:child",
          agentId: "codex",
          mode: "run",
          requester: {
            channel: "feishu",
            accountId: "work",
            to: "user:ou_sender_1",
          },
          threadRequested: false,
        },
        {},
      ),
    ).resolves.toBeUndefined();

    expect(
      deliveryHandler(
        {
          childSessionKey: "agent:main:subagent:child",
          requesterSessionKey: "agent:main:main",
          requesterOrigin: {
            channel: "discord",
            accountId: "work",
            to: "channel:123",
          },
          expectsCompletionMessage: true,
        },
        {},
      ),
    ).toBeUndefined();

    expect(
      endedHandler(
        {
          targetSessionKey: "agent:main:subagent:child",
          targetKind: "subagent",
          reason: "done",
          accountId: "work",
        },
        {},
      ),
    ).toBeUndefined();
  });

  it("returns an error for unsupported non-topic Feishu group conversations", async () => {
    const handler = getRequiredHookHandler(registerHandlersForTest(), "subagent_spawning");
    createFeishuThreadBindingManager({ cfg: baseConfig as any, accountId: "work" });

    await expect(
      handler(
        {
          childSessionKey: "agent:main:subagent:child",
          agentId: "codex",
          mode: "session",
          requester: {
            channel: "feishu",
            accountId: "work",
            to: "chat:oc_group_chat",
          },
          threadRequested: true,
        },
        {},
      ),
    ).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("direct messages or topic conversations"),
    });
  });

  it("unbinds Feishu bindings on subagent_ended", async () => {
    const handlers = registerHandlersForTest();
    const spawnHandler = getRequiredHookHandler(handlers, "subagent_spawning");
    const deliveryHandler = getRequiredHookHandler(handlers, "subagent_delivery_target");
    const endedHandler = getRequiredHookHandler(handlers, "subagent_ended");
    createFeishuThreadBindingManager({ cfg: baseConfig as any, accountId: "work" });

    await spawnHandler(
      {
        childSessionKey: "agent:main:subagent:child",
        agentId: "codex",
        mode: "session",
        requester: {
          channel: "feishu",
          accountId: "work",
          to: "user:ou_sender_1",
        },
        threadRequested: true,
      },
      {},
    );

    endedHandler(
      {
        targetSessionKey: "agent:main:subagent:child",
        targetKind: "subagent",
        reason: "done",
        accountId: "work",
      },
      {},
    );

    expect(
      deliveryHandler(
        {
          childSessionKey: "agent:main:subagent:child",
          requesterSessionKey: "agent:main:main",
          requesterOrigin: {
            channel: "feishu",
            accountId: "work",
            to: "user:ou_sender_1",
          },
          expectsCompletionMessage: true,
        },
        {},
      ),
    ).toBeUndefined();
  });

  it("fails closed when the Feishu monitor-owned binding manager is unavailable", async () => {
    const handlers = registerHandlersForTest();
    const spawnHandler = getRequiredHookHandler(handlers, "subagent_spawning");
    const deliveryHandler = getRequiredHookHandler(handlers, "subagent_delivery_target");

    await expect(
      spawnHandler(
        {
          childSessionKey: "agent:main:subagent:no-manager",
          agentId: "codex",
          mode: "session",
          requester: {
            channel: "feishu",
            accountId: "work",
            to: "user:ou_sender_1",
          },
          threadRequested: true,
        },
        {},
      ),
    ).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("monitor is not active"),
    });

    expect(
      deliveryHandler(
        {
          childSessionKey: "agent:main:subagent:no-manager",
          requesterSessionKey: "agent:main:main",
          requesterOrigin: {
            channel: "feishu",
            accountId: "work",
            to: "user:ou_sender_1",
          },
          expectsCompletionMessage: true,
        },
        {},
      ),
    ).toBeUndefined();
  });
});
