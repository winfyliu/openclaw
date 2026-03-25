import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { OpenClawConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "../memory/embeddings.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { resolveMemorySearchConfig } from "../agents/memory-search.js";
import { delegateCompactionToRuntime } from "./delegate.js";
import { registerContextEngineForOwner } from "./registry.js";
import type {
  AssembleResult,
  CompactResult,
  ContextEngine,
  ContextEngineInfo,
  ContextEngineRuntimeContext,
  IngestResult,
} from "./types.js";

const log = createSubsystemLogger("context-engine/topic");

type TopicEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
};

type TopicBucket = {
  id: string;
  keywords: Map<string, number>;
  exemplar: string;
  entries: TopicEntry[];
  lastUpdatedAt: number;
  centroid?: number[];
  summary?: string;
};

type StableFact = {
  key: string;
  text: string;
  count: number;
  lastSeenAt: number;
};

type SessionTopicState = {
  sessionKey: string;
  topics: TopicBucket[];
  cfg?: OpenClawConfig;
  embeddingProvider?: EmbeddingProvider;
  embeddingProviderId?: string;
  nextTopicId: number;
  nextEntryId: number;
  factCandidates: Map<string, StableFact>;
  stableFacts: StableFact[];
};

type TopicStateStore = {
  sessions: Map<string, SessionTopicState>;
  embeddingStats: {
    calls: number;
    slowCalls: number;
    totalMs: number;
    maxMs: number;
  };
};

const TOPIC_CONTEXT_STATE = Symbol.for("openclaw.contextEngine.topicState");
const MAX_TOPICS = 12;
const MAX_ENTRIES_PER_TOPIC = 40;
const MAX_KEYWORDS = 18;
const EMBEDDING_SLOW_MS = 180;
const MAX_STABLE_FACTS = 10;

function getTopicStateStore(): TopicStateStore {
  return resolveGlobalSingleton<TopicStateStore>(TOPIC_CONTEXT_STATE, () => ({
    sessions: new Map(),
    embeddingStats: {
      calls: 0,
      slowCalls: 0,
      totalMs: 0,
      maxMs: 0,
    },
  }));
}

function extractMessageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const segments: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") {
      const text = typed.text.trim();
      if (text) {
        segments.push(text);
      }
    }
  }
  return segments.join("\n");
}

function tokenize(text: string): string[] {
  const asciiWords = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  const hanChars = text.match(/[\p{Script=Han}]/gu) ?? [];
  const all = [...asciiWords, ...hanChars].filter((value) => value.length > 0);
  return Array.from(new Set(all));
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const sa = new Set(a);
  const sb = new Set(b);
  let overlap = 0;
  for (const token of sa) {
    if (sb.has(token)) {
      overlap += 1;
    }
  }
  const denom = Math.max(sa.size, sb.size, 1);
  return overlap / denom;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na <= 0 || nb <= 0) {
    return 0;
  }
  return dot / Math.sqrt(na * nb);
}

function estimateTokens(messages: AgentMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += extractMessageText(message).length;
  }
  return Math.max(0, Math.floor(chars / 4));
}

function resolveSessionKey(sessionId: string, sessionKey?: string): string {
  const normalized = sessionKey?.trim();
  return normalized && normalized.length > 0 ? normalized : sessionId;
}

function resolveAgentIdFromSessionKey(sessionKey: string): string {
  const parts = sessionKey.split(":").filter(Boolean);
  if (parts.length >= 2 && parts[0] === "agent") {
    return parts[1] || "main";
  }
  return "main";
}

function getOrCreateSessionState(sessionKey: string): SessionTopicState {
  const store = getTopicStateStore();
  const existing = store.sessions.get(sessionKey);
  if (existing) {
    return existing;
  }
  const state: SessionTopicState = {
    sessionKey,
    topics: [],
    nextTopicId: 1,
    nextEntryId: 1,
    factCandidates: new Map(),
    stableFacts: [],
  };
  store.sessions.set(sessionKey, state);
  return state;
}

function topicKeywordText(topic: TopicBucket): string {
  const sorted = [...topic.keywords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([token]) => token);
  return sorted.join(" ");
}

async function timedEmbedQuery(
  state: SessionTopicState,
  text: string,
): Promise<number[] | null> {
  if (!state.embeddingProvider) {
    return null;
  }
  const started = Date.now();
  try {
    const vector = await state.embeddingProvider.embedQuery(text);
    const elapsed = Date.now() - started;
    const stats = getTopicStateStore().embeddingStats;
    stats.calls += 1;
    stats.totalMs += elapsed;
    stats.maxMs = Math.max(stats.maxMs, elapsed);
    if (elapsed >= EMBEDDING_SLOW_MS) {
      stats.slowCalls += 1;
    }
    if (stats.calls % 20 === 0 || elapsed >= EMBEDDING_SLOW_MS) {
      const avg = stats.calls > 0 ? Math.round(stats.totalMs / stats.calls) : 0;
      const slowPct = stats.calls > 0 ? (stats.slowCalls / stats.calls) * 100 : 0;
      const shouldConsiderCloud = avg > 120 || slowPct > 20;
      log.info(
        `topic embedding perf: provider=${state.embeddingProviderId ?? "unknown"} callMs=${elapsed} avgMs=${avg} maxMs=${stats.maxMs} calls=${stats.calls} slowCalls=${stats.slowCalls} slowPct=${slowPct.toFixed(1)} cloudCandidate=${shouldConsiderCloud ? "yes" : "no"}`,
      );
    }
    return vector;
  } catch (err) {
    log.warn(`topic embedding query failed: ${String(err)}`);
    return null;
  }
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...`;
}

function rebuildTopicSummary(topic: TopicBucket): void {
  const user = [...topic.entries].reverse().find((entry) => entry.role === "user");
  const assistant = [...topic.entries].reverse().find((entry) => entry.role === "assistant");
  const userPart = user ? truncateText(user.text, 80) : "";
  const assistantPart = assistant ? truncateText(assistant.text, 80) : "";
  topic.summary = [userPart, assistantPart].filter(Boolean).join(" => ");
}

function extractFactCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const patterns = [
    /^(我叫[^，。！？!?.]{1,30})/,
    /^(我是[^，。！？!?.]{1,30})/,
    /^(我喜欢[^，。！？!?.]{1,40})/,
    /^(我的[^，。！？!?.]{1,40})/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function updateStableFacts(state: SessionTopicState, userText: string): void {
  const candidate = extractFactCandidate(userText);
  if (!candidate) {
    return;
  }
  const key = candidate.toLowerCase();
  const now = Date.now();
  const existing = state.factCandidates.get(key);
  const nextCount = (existing?.count ?? 0) + 1;
  const fact: StableFact = {
    key,
    text: candidate,
    count: nextCount,
    lastSeenAt: now,
  };
  state.factCandidates.set(key, fact);
  if (nextCount < 2) {
    return;
  }
  const idx = state.stableFacts.findIndex((entry) => entry.key === key);
  if (idx >= 0) {
    state.stableFacts[idx] = fact;
  } else {
    state.stableFacts.push(fact);
  }
  state.stableFacts.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  if (state.stableFacts.length > MAX_STABLE_FACTS) {
    state.stableFacts.splice(MAX_STABLE_FACTS);
  }
}

function buildSystemPromptAddition(params: {
  state: SessionTopicState;
  selectedMessages: AgentMessage[];
  startIndex: number;
}): string | undefined {
  const lines: string[] = [];
  if (params.state.stableFacts.length > 0) {
    lines.push("## Stable User Facts");
    for (const fact of params.state.stableFacts.slice(0, 5)) {
      lines.push(`- ${fact.text}`);
    }
  }

  const selectedUserTexts = params.selectedMessages
    .filter((entry) => entry.role === "user")
    .map((entry) => extractMessageText(entry))
    .filter((entry) => entry.length > 0);
  if (selectedUserTexts.length > 0) {
    const topTopics = params.state.topics
      .map((topic) => {
        const text = topic.summary ?? topic.exemplar;
        const score = overlapScore(tokenize(selectedUserTexts.join(" ")), tokenize(text));
        return { topic, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .filter((entry) => entry.score > 0.2);
    if (topTopics.length > 0) {
      lines.push("## Topic Summaries");
      for (const { topic, score } of topTopics) {
        const evidence = topic.entries.slice(-2).map((entry) => entry.id).join(",");
        lines.push(
          `- ${truncateText(topic.summary ?? topic.exemplar, 140)} (score=${score.toFixed(2)} evidence=${evidence || "n/a"})`,
        );
      }
    }
  }

  if (lines.length === 0) {
    return undefined;
  }
  lines.push(`\n[topic-window-start-index=${params.startIndex}]`);
  return lines.join("\n");
}

async function ensureEmbeddingProvider(state: SessionTopicState): Promise<void> {
  if (state.embeddingProvider || !state.cfg) {
    return;
  }
  const agentId = resolveAgentIdFromSessionKey(state.sessionKey);
  const memoryCfg = resolveMemorySearchConfig(state.cfg, agentId);
  if (!memoryCfg) {
    return;
  }
  try {
    const result = await createEmbeddingProvider({
      config: state.cfg,
      agentDir: undefined,
      provider: memoryCfg.provider,
      remote: memoryCfg.remote,
      model: memoryCfg.model,
      fallback: memoryCfg.fallback,
      local: memoryCfg.local,
      outputDimensionality: memoryCfg.outputDimensionality,
    });
    if (!result.provider) {
      if (result.providerUnavailableReason) {
        log.warn(
          `topic embedding unavailable (provider=${memoryCfg.provider}): ${result.providerUnavailableReason}`,
        );
      }
      return;
    }
    state.embeddingProvider = result.provider;
    state.embeddingProviderId = result.provider.id;
    log.info(`topic embedding enabled: provider=${result.provider.id} model=${result.provider.model}`);
  } catch (err) {
    log.warn(`topic embedding provider init failed: ${String(err)}`);
  }
}

function chooseRelevantStartIndex(params: {
  messages: AgentMessage[];
  prompt: string;
  state: SessionTopicState;
  promptVector: number[] | null;
}): { startIndex: number; bestScore: number } {
  const userCandidates: Array<{ idx: number; text: string; tokens: string[] }> = [];
  for (let idx = 0; idx < params.messages.length; idx += 1) {
    const message = params.messages[idx];
    if (message.role !== "user") {
      continue;
    }
    const text = extractMessageText(message);
    if (!text) {
      continue;
    }
    userCandidates.push({ idx, text, tokens: tokenize(text) });
  }

  if (userCandidates.length <= 1) {
    return { startIndex: 0, bestScore: 1 };
  }

  const current = userCandidates[userCandidates.length - 1];
  const promptTokens = tokenize(params.prompt || current.text);
  const promptVector = params.promptVector;

  const promptText = params.prompt || current.text;
  let best = { idx: Math.max(0, current.idx - 1), score: 0 };
  for (let i = 0; i < userCandidates.length - 1; i += 1) {
    const candidate = userCandidates[i];
    const lexical = overlapScore(promptTokens, candidate.tokens);
    const recency = 1 - (userCandidates.length - 1 - i) / Math.max(1, userCandidates.length - 1);
    let semantic = 0;
    if (promptVector) {
      for (const topic of params.state.topics) {
        const combinedTopicText = `${topic.exemplar}\n${topic.summary ?? ""}`;
        const lexicalTie = overlapScore(tokenize(promptText), tokenize(combinedTopicText));
        if (lexicalTie < 0.2) {
          continue;
        }
        if (!topic.centroid) {
          continue;
        }
        semantic = Math.max(semantic, cosineSimilarity(promptVector, topic.centroid));
      }
    }
    const score = promptVector ? 0.65 * semantic + 0.25 * lexical + 0.1 * recency : 0.85 * lexical + 0.15 * recency;
    if (score > best.score) {
      best = { idx: candidate.idx, score };
    }
  }

  const newTopicThreshold = 0.55;
  const startIndex =
    best.score >= newTopicThreshold
      ? Math.max(0, best.idx - 1)
      : Math.max(0, current.idx - 1);
  // Keep at least a short recent tail for continuity.
  const maxStartForTail = Math.max(0, params.messages.length - 6);
  return {
    startIndex: Math.min(startIndex, maxStartForTail),
    bestScore: best.score,
  };
}

function trimTopic(topic: TopicBucket): void {
  if (topic.entries.length > MAX_ENTRIES_PER_TOPIC) {
    topic.entries.splice(0, topic.entries.length - MAX_ENTRIES_PER_TOPIC);
  }
  if (topic.keywords.size > MAX_KEYWORDS) {
    const sorted = [...topic.keywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_KEYWORDS);
    topic.keywords = new Map(sorted);
  }
}

function updateTopicKeywords(topic: TopicBucket, text: string): void {
  for (const token of tokenize(text)) {
    topic.keywords.set(token, (topic.keywords.get(token) ?? 0) + 1);
  }
}

function pickTopicByRules(state: SessionTopicState, userText: string): TopicBucket | null {
  const userTokens = tokenize(userText);
  let best: { topic: TopicBucket; score: number } | null = null;
  for (const topic of state.topics) {
    const score = overlapScore(userTokens, tokenize(topicKeywordText(topic)));
    if (!best || score > best.score) {
      best = { topic, score };
    }
  }
  return best && best.score >= 0.58 ? best.topic : null;
}

async function maybeUpdateTopicCentroid(topic: TopicBucket, state: SessionTopicState): Promise<void> {
  if (!state.embeddingProvider) {
    return;
  }
  const vector = await timedEmbedQuery(state, topic.exemplar);
  if (vector) {
    topic.centroid = vector;
  }
}

export class TopicContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: "topic-lite",
    name: "Topic-Aware Context Engine",
    version: "0.1.0",
    ownsCompaction: false,
  };

  async ingest(_params: {
    sessionId: string;
    sessionKey?: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  }): Promise<IngestResult> {
    return { ingested: false };
  }

  async assemble(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    tokenBudget?: number;
    model?: string;
    prompt?: string;
  }): Promise<AssembleResult> {
    const sessionKey = resolveSessionKey(params.sessionId, params.sessionKey);
    const state = getOrCreateSessionState(sessionKey);
    await ensureEmbeddingProvider(state);
    const prompt = (params.prompt ?? "").trim();

    if (params.messages.length <= 6) {
      return {
        messages: params.messages,
        estimatedTokens: estimateTokens(params.messages),
      };
    }

    const started = Date.now();
    const promptVector = prompt ? await timedEmbedQuery(state, prompt) : null;
    const { startIndex, bestScore } = chooseRelevantStartIndex({
      messages: params.messages,
      prompt,
      state,
      promptVector,
    });
    const assembledMessages = params.messages.slice(startIndex);
    const systemPromptAddition = buildSystemPromptAddition({
      state,
      selectedMessages: assembledMessages,
      startIndex,
    });
    const elapsed = Date.now() - started;
    log.info(
      `topic assemble: session=${sessionKey} provider=${state.embeddingProviderId ?? "rules-only"} promptLen=${prompt.length} start=${startIndex}/${params.messages.length} kept=${assembledMessages.length} bestScore=${bestScore.toFixed(3)} ms=${elapsed}`,
    );

    return {
      messages: assembledMessages,
      estimatedTokens: estimateTokens(assembledMessages),
      systemPromptAddition,
    };
  }

  async afterTurn(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
    runtimeContext?: ContextEngineRuntimeContext;
  }): Promise<void> {
    const sessionKey = resolveSessionKey(params.sessionId, params.sessionKey);
    const state = getOrCreateSessionState(sessionKey);
    const cfg = params.runtimeContext?.config;
    if (cfg && typeof cfg === "object") {
      state.cfg = cfg as OpenClawConfig;
    }
    await ensureEmbeddingProvider(state);

    const newMessages = params.messages.slice(Math.max(0, params.prePromptMessageCount));
    let activeTopic: TopicBucket | null = null;

    for (const message of newMessages) {
      if (message.role !== "user" && message.role !== "assistant") {
        continue;
      }
      const text = extractMessageText(message);
      if (!text) {
        continue;
      }
      if (message.role === "user") {
        activeTopic = pickTopicByRules(state, text);
        if (!activeTopic) {
          activeTopic = {
            id: `t${state.nextTopicId++}`,
            keywords: new Map(),
            exemplar: text,
            entries: [],
            lastUpdatedAt: Date.now(),
          };
          state.topics.push(activeTopic);
          if (state.topics.length > MAX_TOPICS) {
            state.topics.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
            state.topics.splice(MAX_TOPICS);
          }
        }
        updateTopicKeywords(activeTopic, text);
        updateStableFacts(state, text);
        activeTopic.exemplar = text;
        activeTopic.lastUpdatedAt = Date.now();
        await maybeUpdateTopicCentroid(activeTopic, state);
      }
      if (!activeTopic) {
        continue;
      }
      activeTopic.entries.push({
        id: `${activeTopic.id}#e${state.nextEntryId++}`,
        role: message.role,
        text,
        ts: Date.now(),
      });
      trimTopic(activeTopic);
      rebuildTopicSummary(activeTopic);
    }
  }

  async compact(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    runtimeContext?: ContextEngineRuntimeContext;
  }): Promise<CompactResult> {
    return await delegateCompactionToRuntime(params);
  }

  async dispose(): Promise<void> {}
}

export function registerTopicContextEngine(): void {
  registerContextEngineForOwner("topic-lite", () => new TopicContextEngine(), "core", {
    allowSameOwnerRefresh: true,
  });
}
