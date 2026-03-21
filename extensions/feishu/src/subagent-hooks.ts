import type { OpenClawPluginApi } from "../runtime-api.js";
import { buildFeishuConversationId, parseFeishuConversationId } from "./conversation-id.js";
import { resolveTaskByRunId } from "../runtime-api.js";
import { sendMessageFeishu } from "./send.js";
import { normalizeFeishuTarget } from "./targets.js";
import { getFeishuThreadBindingManager } from "./thread-bindings.js";

function summarizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "error";
}

function redactSensitiveStatusText(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  const redacted = trimmed
    .replace(
      /\b(password|passwd|token|api[_-]?key|secret)\b\s*[:=]\s*[^\s,;]+/gi,
      (match, key: string) => `${key}=[REDACTED]`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]")
    .replace(/\r/g, "")
    .replace(/\t+/g, " ");
  return redacted
    .split("\n")
    .map((line) => line.replace(/\s{2,}/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

function truncateStatusText(input: string, maxChars: number): string {
  const text = input.trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function buildTaskStatusTemplate(params: {
  taskId?: string;
  status: string;
  completed: string;
  needType: "none" | "credentials" | "permission" | "scope_decision" | "retry_decision";
  needFromUser: string;
}): string {
  const taskIdPrefix = params.taskId?.trim() ? `[${params.taskId.trim()}]\n` : "";
  const typeLabel =
    params.needType === "none"
      ? "none"
      : params.needType === "credentials"
        ? "credentials"
        : params.needType === "permission"
          ? "permission"
          : params.needType === "scope_decision"
            ? "scope_decision"
            : "retry_decision";
  return [
    `${taskIdPrefix}Current status: ${params.status}`,
    `Completed: ${params.completed}`,
    `Need type: ${typeLabel}`,
    `Need from you: ${params.needFromUser}`,
  ].join("\n");
}

function buildTaskReplyExample(taskId?: string): string {
  const id = taskId?.trim() || "T-XXXX0000";
  return `Reply example: for ${id}: <your input>`;
}

function resolveFailureNeedType(input: string): "credentials" | "permission" | "scope_decision" {
  const lowered = input.toLowerCase();
  if (
    lowered.includes("credential") ||
    lowered.includes("password") ||
    lowered.includes("token") ||
    lowered.includes("api key") ||
    lowered.includes("secret") ||
    lowered.includes("login") ||
    lowered.includes("\u8d26\u53f7") ||
    lowered.includes("\u5bc6\u7801")
  ) {
    return "credentials";
  }
  if (lowered.includes("permission") || lowered.includes("forbidden") || lowered.includes("unauthorized")) {
    return "permission";
  }
  return "scope_decision";
}

async function sendFeishuSubagentStatusUpdate(params: {
  api: OpenClawPluginApi;
  accountId: string;
  to: string;
  text: string;
}) {
  const text = truncateStatusText(redactSensitiveStatusText(params.text), 700);
  if (!text) {
    return;
  }
  await sendMessageFeishu({
    cfg: params.api.config,
    accountId: params.accountId,
    to: params.to,
    text,
  });
}

function buildSpawnStatusText(event: {
  taskId?: string;
  label?: string;
  agentId: string;
  mode: "run" | "session";
}): string {
  const label = event.label?.trim() || "Subagent task";
  const modeText = event.mode === "session" ? "session-bound" : "run-once";
  return buildTaskStatusTemplate({
    taskId: event.taskId,
    status: `Planning started for \"${label}\" (agent: ${event.agentId}, mode: ${modeText}).`,
    completed: "Task accepted and handed off to a subagent.",
    needType: "none",
    needFromUser: "Nothing right now. You can continue chatting while I work.",
  });
}

function buildEndedStatusText(event: {
  taskId?: string;
  reason: string;
  outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted";
  error?: string;
}): string {
  const outcome = event.outcome ?? "ok";
  if (outcome === "ok") {
    return buildTaskStatusTemplate({
      taskId: event.taskId,
      status: "Completed successfully.",
      completed: "Execution and evaluation finished.",
      needType: "none",
      needFromUser: "Nothing right now unless you want follow-up work.",
    });
  }
  if (outcome === "timeout") {
    return buildTaskStatusTemplate({
      taskId: event.taskId,
      status: "Timed out before completion.",
      completed: "Partial work may exist but final verification did not complete.",
      needType: "retry_decision",
      needFromUser:
        `Please tell me whether to retry, extend timeout, or narrow the scope. ${buildTaskReplyExample(event.taskId)}`,
    });
  }
  if (outcome === "killed" || outcome === "reset" || outcome === "deleted") {
    return buildTaskStatusTemplate({
      taskId: event.taskId,
      status: `Ended early (${outcome}).`,
      completed: "Task execution stopped before normal completion.",
      needType: "retry_decision",
      needFromUser: `Tell me if you want me to restart this task. ${buildTaskReplyExample(event.taskId)}`,
    });
  }
  const err = truncateStatusText(redactSensitiveStatusText(event.error ?? event.reason), 220);
  const needType = resolveFailureNeedType(err || event.reason);
  if (err) {
    return buildTaskStatusTemplate({
      taskId: event.taskId,
      status: `Blocked/failed: ${err}`,
      completed: "I could not finish this task safely.",
      needType,
      needFromUser:
        needType === "credentials"
          ? `Please provide required credentials (minimum scope). ${buildTaskReplyExample(event.taskId)}`
          : needType === "permission"
            ? `Please grant required permission or authorized account access. ${buildTaskReplyExample(event.taskId)}`
            : `Please confirm scope or provide missing details so I can continue. ${buildTaskReplyExample(event.taskId)}`,
    });
  }
  return buildTaskStatusTemplate({
    taskId: event.taskId,
    status: "Blocked/failed.",
    completed: "I could not finish this task safely.",
    needType: "scope_decision",
    needFromUser: `Please provide guidance or missing access so I can continue. ${buildTaskReplyExample(event.taskId)}`,
  });
}

function stripProviderPrefix(raw: string): string {
  return raw.replace(/^(feishu|lark):/i, "").trim();
}

function resolveFeishuRequesterConversation(params: {
  accountId?: string;
  to?: string;
  threadId?: string | number;
  requesterSessionKey?: string;
}): {
  accountId: string;
  conversationId: string;
  parentConversationId?: string;
} | null {
  const manager = getFeishuThreadBindingManager(params.accountId);
  if (!manager) {
    return null;
  }
  const rawTo = params.to?.trim();
  const withoutProviderPrefix = rawTo ? stripProviderPrefix(rawTo) : "";
  const normalizedTarget = rawTo ? normalizeFeishuTarget(rawTo) : null;
  const threadId =
    params.threadId != null && params.threadId !== "" ? String(params.threadId).trim() : "";
  const isChatTarget = /^(chat|group|channel):/i.test(withoutProviderPrefix);
  const parsedRequesterTopic =
    normalizedTarget && threadId && isChatTarget
      ? parseFeishuConversationId({
          conversationId: buildFeishuConversationId({
            chatId: normalizedTarget,
            scope: "group_topic",
            topicId: threadId,
          }),
          parentConversationId: normalizedTarget,
        })
      : null;
  const requesterSessionKey = params.requesterSessionKey?.trim();
  if (requesterSessionKey) {
    const existingBindings = manager.listBySessionKey(requesterSessionKey);
    if (existingBindings.length === 1) {
      const existing = existingBindings[0];
      return {
        accountId: existing.accountId,
        conversationId: existing.conversationId,
        parentConversationId: existing.parentConversationId,
      };
    }
    if (existingBindings.length > 1) {
      if (rawTo && normalizedTarget && !threadId && !isChatTarget) {
        const directMatches = existingBindings.filter(
          (entry) =>
            entry.accountId === manager.accountId &&
            entry.conversationId === normalizedTarget &&
            !entry.parentConversationId,
        );
        if (directMatches.length === 1) {
          const existing = directMatches[0];
          return {
            accountId: existing.accountId,
            conversationId: existing.conversationId,
            parentConversationId: existing.parentConversationId,
          };
        }
        return null;
      }
      if (parsedRequesterTopic) {
        const matchingTopicBindings = existingBindings.filter((entry) => {
          const parsed = parseFeishuConversationId({
            conversationId: entry.conversationId,
            parentConversationId: entry.parentConversationId,
          });
          return (
            parsed?.chatId === parsedRequesterTopic.chatId &&
            parsed?.topicId === parsedRequesterTopic.topicId
          );
        });
        if (matchingTopicBindings.length === 1) {
          const existing = matchingTopicBindings[0];
          return {
            accountId: existing.accountId,
            conversationId: existing.conversationId,
            parentConversationId: existing.parentConversationId,
          };
        }
        const senderScopedTopicBindings = matchingTopicBindings.filter((entry) => {
          const parsed = parseFeishuConversationId({
            conversationId: entry.conversationId,
            parentConversationId: entry.parentConversationId,
          });
          return parsed?.scope === "group_topic_sender";
        });
        if (
          senderScopedTopicBindings.length === 1 &&
          matchingTopicBindings.length === senderScopedTopicBindings.length
        ) {
          const existing = senderScopedTopicBindings[0];
          return {
            accountId: existing.accountId,
            conversationId: existing.conversationId,
            parentConversationId: existing.parentConversationId,
          };
        }
        return null;
      }
    }
  }

  if (!rawTo) {
    return null;
  }
  if (!normalizedTarget) {
    return null;
  }

  if (threadId) {
    if (!isChatTarget) {
      return null;
    }
    return {
      accountId: manager.accountId,
      conversationId: buildFeishuConversationId({
        chatId: normalizedTarget,
        scope: "group_topic",
        topicId: threadId,
      }),
      parentConversationId: normalizedTarget,
    };
  }

  if (isChatTarget) {
    return null;
  }

  return {
    accountId: manager.accountId,
    conversationId: normalizedTarget,
  };
}

function resolveFeishuDeliveryOrigin(params: {
  conversationId: string;
  parentConversationId?: string;
  accountId: string;
  deliveryTo?: string;
  deliveryThreadId?: string;
}): {
  channel: "feishu";
  accountId: string;
  to: string;
  threadId?: string;
} {
  const deliveryTo = params.deliveryTo?.trim();
  const deliveryThreadId = params.deliveryThreadId?.trim();
  if (deliveryTo) {
    return {
      channel: "feishu",
      accountId: params.accountId,
      to: deliveryTo,
      ...(deliveryThreadId ? { threadId: deliveryThreadId } : {}),
    };
  }
  const parsed = parseFeishuConversationId({
    conversationId: params.conversationId,
    parentConversationId: params.parentConversationId,
  });
  if (parsed?.topicId) {
    return {
      channel: "feishu",
      accountId: params.accountId,
      to: `chat:${params.parentConversationId?.trim() || parsed.chatId}`,
      threadId: parsed.topicId,
    };
  }
  return {
    channel: "feishu",
    accountId: params.accountId,
    to: `user:${params.conversationId}`,
  };
}

function resolveMatchingChildBinding(params: {
  accountId?: string;
  childSessionKey: string;
  requesterSessionKey?: string;
  requesterOrigin?: {
    to?: string;
    threadId?: string | number;
  };
}) {
  const manager = getFeishuThreadBindingManager(params.accountId);
  if (!manager) {
    return null;
  }
  const childBindings = manager.listBySessionKey(params.childSessionKey.trim());
  if (childBindings.length === 0) {
    return null;
  }

  const requesterConversation = resolveFeishuRequesterConversation({
    accountId: manager.accountId,
    to: params.requesterOrigin?.to,
    threadId: params.requesterOrigin?.threadId,
    requesterSessionKey: params.requesterSessionKey,
  });
  if (requesterConversation) {
    const matched = childBindings.find(
      (entry) =>
        entry.accountId === requesterConversation.accountId &&
        entry.conversationId === requesterConversation.conversationId &&
        (entry.parentConversationId?.trim() || undefined) ===
          (requesterConversation.parentConversationId?.trim() || undefined),
    );
    if (matched) {
      return matched;
    }
  }

  return childBindings.length === 1 ? childBindings[0] : null;
}

export function registerFeishuSubagentHooks(api: OpenClawPluginApi) {
  api.on("subagent_spawning", async (event, ctx) => {
    if (!event.threadRequested) {
      return;
    }
    const requesterChannel = event.requester?.channel?.trim().toLowerCase();
    if (requesterChannel !== "feishu") {
      return;
    }

    const manager = getFeishuThreadBindingManager(event.requester?.accountId);
    if (!manager) {
      return {
        status: "error" as const,
        error:
          "Feishu current-conversation binding is unavailable because the Feishu account monitor is not active.",
      };
    }

    const conversation = resolveFeishuRequesterConversation({
      accountId: event.requester?.accountId,
      to: event.requester?.to,
      threadId: event.requester?.threadId,
      requesterSessionKey: ctx.requesterSessionKey,
    });
    if (!conversation) {
      return {
        status: "error" as const,
        error:
          "Feishu current-conversation binding is only available in direct messages or topic conversations.",
      };
    }

    try {
      const binding = manager.bindConversation({
        conversationId: conversation.conversationId,
        parentConversationId: conversation.parentConversationId,
        targetKind: "subagent",
        targetSessionKey: event.childSessionKey,
        metadata: {
          agentId: event.agentId,
          label: event.label,
          boundBy: "system",
          deliveryTo: event.requester?.to,
          deliveryThreadId:
            event.requester?.threadId != null && event.requester.threadId !== ""
              ? String(event.requester.threadId)
              : undefined,
        },
      });
      if (!binding) {
        return {
          status: "error" as const,
          error:
            "Unable to bind this Feishu conversation to the spawned subagent session. Session mode is unavailable for this target.",
        };
      }
      return {
        status: "ok" as const,
        threadBindingReady: true,
      };
    } catch (err) {
      return {
        status: "error" as const,
        error: `Feishu conversation bind failed: ${summarizeError(err)}`,
      };
    }
  });

  api.on("subagent_spawned", async (event, ctx) => {
    const requesterChannel = event.requester?.channel?.trim().toLowerCase();
    if (requesterChannel !== "feishu") {
      return;
    }
    const binding = resolveMatchingChildBinding({
      accountId: event.requester?.accountId,
      childSessionKey: event.childSessionKey,
      requesterSessionKey: ctx.requesterSessionKey,
      requesterOrigin: {
        to: event.requester?.to,
        threadId: event.requester?.threadId,
      },
    });
    if (!binding) {
      return;
    }
    const origin = resolveFeishuDeliveryOrigin({
      conversationId: binding.conversationId,
      parentConversationId: binding.parentConversationId,
      accountId: binding.accountId,
      deliveryTo: binding.deliveryTo,
      deliveryThreadId: binding.deliveryThreadId,
    });
    await sendFeishuSubagentStatusUpdate({
      api,
      accountId: origin.accountId,
      to: origin.to,
      text: buildSpawnStatusText({
        taskId: event.taskId,
        label: event.label,
        agentId: event.agentId,
        mode: event.mode,
      }),
    }).catch(() => {
      // Best effort: status updates should never fail task execution.
    });
  });

  api.on("subagent_delivery_target", (event) => {
    if (!event.expectsCompletionMessage) {
      return;
    }
    const requesterChannel = event.requesterOrigin?.channel?.trim().toLowerCase();
    if (requesterChannel !== "feishu") {
      return;
    }

    const binding = resolveMatchingChildBinding({
      accountId: event.requesterOrigin?.accountId,
      childSessionKey: event.childSessionKey,
      requesterSessionKey: event.requesterSessionKey,
      requesterOrigin: {
        to: event.requesterOrigin?.to,
        threadId: event.requesterOrigin?.threadId,
      },
    });
    if (!binding) {
      return;
    }

    return {
      origin: resolveFeishuDeliveryOrigin({
        conversationId: binding.conversationId,
        parentConversationId: binding.parentConversationId,
        accountId: binding.accountId,
        deliveryTo: binding.deliveryTo,
        deliveryThreadId: binding.deliveryThreadId,
      }),
    };
  });

  api.on("subagent_ended", (event) => {
    const manager = getFeishuThreadBindingManager(event.accountId);
    const bindings = manager?.listBySessionKey(event.targetSessionKey) ?? [];
    const task = event.runId ? resolveTaskByRunId(event.runId) : undefined;
    for (const binding of bindings) {
      const origin = resolveFeishuDeliveryOrigin({
        conversationId: binding.conversationId,
        parentConversationId: binding.parentConversationId,
        accountId: binding.accountId,
        deliveryTo: binding.deliveryTo,
        deliveryThreadId: binding.deliveryThreadId,
      });
      void sendFeishuSubagentStatusUpdate({
        api,
        accountId: origin.accountId,
        to: origin.to,
        text: buildEndedStatusText({
          taskId: task?.taskId,
          reason: event.reason,
          outcome: event.outcome,
          error: event.error,
        }),
      }).catch(() => {
        // Best effort: status updates should never fail task cleanup.
      });
    }
    manager?.unbindBySessionKey(event.targetSessionKey);
  });
}
