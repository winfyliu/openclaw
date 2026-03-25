import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { TopicContextEngine } from "./topic-context.js";

function msg(role: "user" | "assistant", text: string): AgentMessage {
  return { role, content: text } as AgentMessage;
}

describe("TopicContextEngine", () => {
  it("keeps only recent relevant slice when topic shifts", async () => {
    const engine = new TopicContextEngine();
    const messages: AgentMessage[] = [
      msg("user", "帮我翻译一下苹果的英文"),
      msg("assistant", "apple"),
      msg("user", "再翻译一下梨子"),
      msg("assistant", "pear"),
      msg("user", "北京天气怎么样"),
      msg("assistant", "北京今天晴，10到19度。"),
      msg("user", "那梨子翻译呢"),
    ];

    const assembled = await engine.assemble({
      sessionId: "s1",
      sessionKey: "agent:main:feishu:direct:u1",
      messages,
      prompt: "那梨子翻译呢",
    });

    expect(assembled.messages.length).toBeLessThan(messages.length);
    const joined = assembled.messages
      .map((entry) => (typeof (entry as { content?: unknown }).content === "string" ? (entry as { content: string }).content : ""))
      .join("\n");
    expect(joined.includes("梨子")).toBe(true);
  });

  it("tracks topics during afterTurn", async () => {
    const engine = new TopicContextEngine();
    const messages: AgentMessage[] = [
      msg("user", "翻译苹果"),
      msg("assistant", "apple"),
      msg("user", "查询深圳天气"),
      msg("assistant", "深圳多云"),
    ];

    await engine.afterTurn({
      sessionId: "s2",
      sessionKey: "agent:main:telegram:direct:u2",
      sessionFile: "unused",
      messages,
      prePromptMessageCount: 0,
      runtimeContext: {},
    });

    const assembled = await engine.assemble({
      sessionId: "s2",
      sessionKey: "agent:main:telegram:direct:u2",
      messages,
      prompt: "苹果翻译",
    });

    expect(assembled.messages.length).toBeGreaterThan(0);
  });

  it("adds stable facts and topic summaries to systemPromptAddition", async () => {
    const engine = new TopicContextEngine();
    const sessionId = "s3";
    const sessionKey = "agent:main:discord:direct:u3";
    const first: AgentMessage[] = [
      msg("user", "我喜欢喝茶"),
      msg("assistant", "记住了"),
    ];
    const second: AgentMessage[] = [
      ...first,
      msg("user", "我喜欢喝茶，特别是绿茶"),
      msg("assistant", "好的，我记下来了"),
      msg("user", "那天气呢"),
    ];

    await engine.afterTurn({
      sessionId,
      sessionKey,
      sessionFile: "unused",
      messages: first,
      prePromptMessageCount: 0,
      runtimeContext: {},
    });
    await engine.afterTurn({
      sessionId,
      sessionKey,
      sessionFile: "unused",
      messages: second,
      prePromptMessageCount: first.length,
      runtimeContext: {},
    });

    const assembled = await engine.assemble({
      sessionId,
      sessionKey,
      messages: second,
      prompt: "我喜欢什么？",
    });

    expect(assembled.systemPromptAddition).toContain("Stable User Facts");
    expect(assembled.systemPromptAddition).toContain("我喜欢喝茶");
    expect(assembled.systemPromptAddition).toContain("Topic Summaries");
    expect(assembled.systemPromptAddition).toContain("evidence=");
  });
});
