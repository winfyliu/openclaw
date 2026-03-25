import { logVerbose } from "../../globals.js";
import { listSkillCommandsForAgents } from "../skill-commands.js";
import {
  buildCommandsMessage,
  buildCommandsMessagePaginated,
  buildHelpMessage,
} from "../status.js";
import { buildContextReply } from "./commands-context-report.js";
import { buildExportSessionReply } from "./commands-export-session.js";
import { buildStatusReply } from "./commands-status.js";
import {
  readRecentTaskApprovalEvents,
  readTaskPolicies,
  summarizeTaskApprovalEvents,
  writeTaskPolicies,
} from "./task-policies.js";
import type { CommandHandler } from "./commands-types.js";

export const handleHelpCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  if (params.command.commandBodyNormalized !== "/help") {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /help from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  return {
    shouldContinue: false,
    reply: { text: buildHelpMessage(params.cfg) },
  };
};

export const handleCommandsListCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  if (params.command.commandBodyNormalized !== "/commands") {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /commands from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const skillCommands =
    params.skillCommands ??
    listSkillCommandsForAgents({
      cfg: params.cfg,
      agentIds: params.agentId ? [params.agentId] : undefined,
    });
  const surface = params.ctx.Surface;

  if (surface === "telegram") {
    const result = buildCommandsMessagePaginated(params.cfg, skillCommands, {
      page: 1,
      surface,
    });

    if (result.totalPages > 1) {
      return {
        shouldContinue: false,
        reply: {
          text: result.text,
          channelData: {
            telegram: {
              buttons: buildCommandsPaginationKeyboard(
                result.currentPage,
                result.totalPages,
                params.agentId,
              ),
            },
          },
        },
      };
    }

    return {
      shouldContinue: false,
      reply: { text: result.text },
    };
  }

  return {
    shouldContinue: false,
    reply: { text: buildCommandsMessage(params.cfg, skillCommands, { surface }) },
  };
};

export function buildCommandsPaginationKeyboard(
  currentPage: number,
  totalPages: number,
  agentId?: string,
): Array<Array<{ text: string; callback_data: string }>> {
  const buttons: Array<{ text: string; callback_data: string }> = [];
  const suffix = agentId ? `:${agentId}` : "";

  if (currentPage > 1) {
    buttons.push({
      text: "◀ Prev",
      callback_data: `commands_page_${currentPage - 1}${suffix}`,
    });
  }

  buttons.push({
    text: `${currentPage}/${totalPages}`,
    callback_data: `commands_page_noop${suffix}`,
  });

  if (currentPage < totalPages) {
    buttons.push({
      text: "Next ▶",
      callback_data: `commands_page_${currentPage + 1}${suffix}`,
    });
  }

  return [buttons];
}

export const handleStatusCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalizedCommand = params.command.commandBodyNormalized.trim().toLowerCase();
  const normalizedRaw = params.command.rawBodyNormalized.trim().toLowerCase();
  const tokenUsageAliases = new Set([
    "/tokens",
    "/token",
    "/token-usage",
    "/token_usage",
    "/usage",
    "/用量",
    "/token用量",
    "/tokens用量",
  ]);
  const isNaturalLanguageTokenUsageQuery = (() => {
    const text = normalizedRaw;
    if (!text || text.startsWith("/")) {
      return false;
    }
    if (/\b(and|then|also)\b|并且|然后|再帮我|顺便|另外/.test(text)) {
      return false;
    }
    const hasTokenWord = /\btoken(s)?\b|令牌|token用量|tokens用量/.test(text);
    const hasUsageIntent =
      /usage|used|spent|cost|统计|用量|用了|消耗|本地/.test(text) ||
      /多少\s*token/.test(text) ||
      /token\s*(usage|used|spent|count)/.test(text);
    if (!hasTokenWord || !hasUsageIntent) {
      return false;
    }
    return text.length <= 80;
  })();
  const statusRequested =
    params.directives.hasStatusDirective ||
    normalizedCommand === "/status" ||
    tokenUsageAliases.has(normalizedCommand) ||
    isNaturalLanguageTokenUsageQuery;
  if (!statusRequested) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /status from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const reply = await buildStatusReply({
    cfg: params.cfg,
    command: params.command,
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    parentSessionKey: params.ctx.ParentSessionKey,
    sessionScope: params.sessionScope,
    provider: params.provider,
    model: params.model,
    contextTokens: params.contextTokens,
    resolvedThinkLevel: params.resolvedThinkLevel,
    resolvedVerboseLevel: params.resolvedVerboseLevel,
    resolvedReasoningLevel: params.resolvedReasoningLevel,
    resolvedElevatedLevel: params.resolvedElevatedLevel,
    resolveDefaultThinkingLevel: params.resolveDefaultThinkingLevel,
    isGroup: params.isGroup,
    defaultGroupActivation: params.defaultGroupActivation,
    mediaDecisions: params.ctx.MediaUnderstandingDecisions,
  });
  return { shouldContinue: false, reply };
};

export const handleContextCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/context" && !normalized.startsWith("/context ")) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /context from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  return { shouldContinue: false, reply: await buildContextReply(params) };
};

export const handleExportSessionCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (
    normalized !== "/export-session" &&
    !normalized.startsWith("/export-session ") &&
    normalized !== "/export" &&
    !normalized.startsWith("/export ")
  ) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /export-session from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  return { shouldContinue: false, reply: await buildExportSessionReply(params) };
};

export const handleWhoamiCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  if (params.command.commandBodyNormalized !== "/whoami") {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /whoami from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const senderId = params.ctx.SenderId ?? "";
  const senderUsername = params.ctx.SenderUsername ?? "";
  const lines = ["🧭 Identity", `Channel: ${params.command.channel}`];
  if (senderId) {
    lines.push(`User id: ${senderId}`);
  }
  if (senderUsername) {
    const handle = senderUsername.startsWith("@") ? senderUsername : `@${senderUsername}`;
    lines.push(`Username: ${handle}`);
  }
  if (params.ctx.ChatType === "group" && params.ctx.From) {
    lines.push(`Chat: ${params.ctx.From}`);
  }
  if (params.ctx.MessageThreadId != null) {
    lines.push(`Thread: ${params.ctx.MessageThreadId}`);
  }
  if (senderId) {
    lines.push(`AllowFrom: ${senderId}`);
  }
  return { shouldContinue: false, reply: { text: lines.join("\n") } };
};

export const handleTaskPrefsCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized.trim();
  if (
    normalized !== "/task-prefs" &&
    normalized !== "/task-prefs reset" &&
    normalized !== "/task-prefs stats"
  ) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /task-prefs from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (normalized === "/task-prefs reset") {
    const next = writeTaskPolicies((current) => ({
      ...current,
      planApprovalMode: "auto_execute",
      riskApprovalRequired: true,
      externalSideEffectsApproval: true,
      costlyOpsApproval: false,
      allowBackgroundExecution: true,
      interruptPolicy: "cancel_and_replan",
      progressVerbosity: "normal",
      finalResponseStyle: "brief",
      failureHandling: "ask_user",
      planDiffRequired: false,
    }));
    return {
      shouldContinue: false,
      reply: { text: `Task preferences reset. planApprovalMode=${next.planApprovalMode}` },
    };
  }
  if (normalized === "/task-prefs stats") {
    const events = readRecentTaskApprovalEvents(200);
    return {
      shouldContinue: false,
      reply: { text: summarizeTaskApprovalEvents(events) },
    };
  }
  const prefs = readTaskPolicies();
  const text = [
    "Task Preferences",
    `- planApprovalMode: ${prefs.planApprovalMode}`,
    `- riskApprovalRequired: ${prefs.riskApprovalRequired}`,
    `- externalSideEffectsApproval: ${prefs.externalSideEffectsApproval}`,
    `- costlyOpsApproval: ${prefs.costlyOpsApproval}`,
    `- allowBackgroundExecution: ${prefs.allowBackgroundExecution}`,
    `- interruptPolicy: ${prefs.interruptPolicy}`,
    `- progressVerbosity: ${prefs.progressVerbosity}`,
    `- finalResponseStyle: ${prefs.finalResponseStyle}`,
    `- failureHandling: ${prefs.failureHandling}`,
    `- planDiffRequired: ${prefs.planDiffRequired}`,
    "",
    "Approval Commands",
    "- confirm: 确认执行 / confirm execute",
    "- cancel: 取消执行 / cancel execute",
    "- replan: 重新规划: <要求>",
  ].join("\n");
  return { shouldContinue: false, reply: { text } };
};
