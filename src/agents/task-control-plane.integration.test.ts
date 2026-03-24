import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agentCommand } from "./agent-command.js";
import { getTask, resetTaskLedgerForTests } from "./task-ledger.js";
import { TASK_STATUS_COMPLETED, TASK_STATUS_FAILED, TASK_STATUS_RUNNING, TASK_NODE_KIND_SUBAGENT_RUN } from "./task-ledger.types.js";
import { initializeTaskLifecycleBridge } from "./task-lifecycle-bridge.js";
import { getTaskTokenAccounting } from "./task-token-accounting.js";
import type { OpenClawConfig } from "../config/config.js";
import { emitAgentEvent } from "../infra/agent-events.js";
import { spawnSubagentDirect } from "./subagent-spawn.js";

// Mock runEmbeddedPiAgent to avoid actual LLM calls
vi.mock("./pi-embedded.js", () => ({
  runEmbeddedPiAgent: vi.fn().mockImplementation(async (params) => {
    // Simulate some token usage via agent events
    emitAgentEvent({
      runId: params.runId,
      stream: "usage",
      data: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
    });

    return {
      payloads: [{ type: "text", text: "Mock response" }],
      meta: {
        durationMs: 100,
        aborted: false,
        stopReason: "stop",
      },
    };
  }),
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn().mockImplementation(async (params) => {
    if (params.method === "agent") {
      return { runId: params.params.idempotencyKey };
    }
    return {};
  }),
}));

describe("Task Control Plane Integration", () => {
  let disposeBridge: () => void;

  beforeAll(() => {
    disposeBridge = initializeTaskLifecycleBridge();
    return () => disposeBridge();
  });

  afterEach(() => {
    resetTaskLedgerForTests({ persist: false });
    vi.clearAllMocks();
  });

  it("creates a root task and reconciles lifecycle on successful command", async () => {
    const runId = "run-integration-1";
    const sessionId = "session-integration-1";
    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "mock/model" },
        },
      },
    };

    await agentCommand({
      message: "Hello world",
      runId,
      sessionId,
      agentId: "main",
      senderIsOwner: true,
      allowModelOverride: true,
    }, undefined as any, undefined as any);

    // The task ID is resolved as task:{runId} by default
    const taskId = `task:${runId}`;
    const task = getTask(taskId);

    expect(task).toBeDefined();
    expect(task?.rootRunId).toBe(runId);
    expect(task?.status).toBe(TASK_STATUS_COMPLETED);
    expect(task?.nodes[0].status).toBe(TASK_STATUS_COMPLETED);

    // Verify token accounting
    const accounting = getTaskTokenAccounting(taskId);
    expect(accounting).toBeDefined();
    expect(accounting?.totalUsage.totalTokens).toBe(30);
  });

  it("records failure state when command throws", async () => {
    const runId = "run-integration-2";
    const sessionId = "session-integration-2";
    
    // Override mock to throw
    const { runEmbeddedPiAgent } = await import("./pi-embedded.js");
    vi.mocked(runEmbeddedPiAgent).mockRejectedValueOnce(new Error("Mock failure"));

    await expect(
      agentCommand({
        message: "Fail me",
        runId,
        sessionId,
        agentId: "main",
        senderIsOwner: true,
        allowModelOverride: true,
      }, undefined as any, undefined as any)
    ).rejects.toThrow("Mock failure");

    const taskId = `task:${runId}`;
    const task = getTask(taskId);

    expect(task).toBeDefined();
    expect(task?.status).toBe(TASK_STATUS_FAILED);
    expect(task?.nodes[0].status).toBe(TASK_STATUS_FAILED);
    expect(task?.nodes[0].error).toContain("Mock failure");
  });

  it("inherits root task lineage when spawning a subagent", async () => {
    const runId = "run-integration-3";
    const sessionId = "session-integration-3";
    const taskId = `task:${runId}`;
    const parentTaskNodeId = `root:${taskId}`;

    // Create the root task first
    await agentCommand({
      message: "Spawn a child",
      runId,
      sessionId,
      agentId: "main",
      senderIsOwner: true,
      allowModelOverride: true,
    }, undefined as any, undefined as any);

    // Now spawn a subagent
    const spawnResult = await spawnSubagentDirect({
      task: "Do some work",
      agentId: "research",
    }, {
      agentSessionKey: "agent:main:session:123",
      taskId,
      parentTaskNodeId,
    });

    expect(spawnResult.status).toBe("accepted");

    const task = getTask(taskId);
    expect(task).toBeDefined();
    
    // The root task should now have a second node for the subagent
    expect(task?.nodes.length).toBeGreaterThan(1);
    
    const subagentNode = task?.nodes.find(n => n.kind === TASK_NODE_KIND_SUBAGENT_RUN);
    expect(subagentNode).toBeDefined();
    expect(subagentNode?.parentNodeId).toBe(parentTaskNodeId);
    expect(subagentNode?.runId).toBe(spawnResult.runId);
  });
});
