import {
  getBlockedTasksForSession,
  listTasksForSession,
  resolveTaskByIdOrRun,
  type TaskRecord,
} from "./task-registry.js";

type ParsedCredentialPayload = {
  fields: string[];
  raw: string;
};

const TASK_ID_RE = /\bT-[A-Z0-9]{4,}\b/i;

function extractBodyText(body: string): string {
  return body.trim();
}

function parseCredentialFields(body: string): ParsedCredentialPayload | undefined {
  const text = extractBodyText(body);
  if (!text) {
    return undefined;
  }
  const lowered = text.toLowerCase();
  const hasCredentialKeyword =
    lowered.includes("password") ||
    lowered.includes("\u8d26\u53f7") ||
    lowered.includes("\u8d26\u6237") ||
    lowered.includes("token") ||
    lowered.includes("api key") ||
    lowered.includes("apikey") ||
    lowered.includes("secret") ||
    lowered.includes("\u9a8c\u8bc1\u7801") ||
    lowered.includes("otp") ||
    lowered.includes("username");
  if (!hasCredentialKeyword) {
    return undefined;
  }

  const keyValueMatches = text.match(/[A-Za-z_\-\u4e00-\u9fa5]{2,}\s*[:=]\s*[^\s,;]+/g) ?? [];
  if (keyValueMatches.length === 0 && text.length < 4) {
    return undefined;
  }
  return {
    fields: keyValueMatches,
    raw: text,
  };
}

function resolveExplicitTaskId(body: string): string | undefined {
  const match = body.match(TASK_ID_RE);
  if (!match) {
    return undefined;
  }
  return match[0].toUpperCase();
}

export type ResumeRoutingDecision =
  | {
      kind: "none";
    }
  | {
      kind: "needs_task_selection";
      blockedTasks: TaskRecord[];
      credentials: ParsedCredentialPayload;
    }
  | {
      kind: "resume_task";
      task: TaskRecord;
      credentials: ParsedCredentialPayload;
    };

export function resolveCredentialResumeRouting(params: {
  sessionKey: string;
  body: string;
}): ResumeRoutingDecision {
  const credentials = parseCredentialFields(params.body);
  if (!credentials) {
    return { kind: "none" };
  }

  const explicitTaskId = resolveExplicitTaskId(params.body);
  if (explicitTaskId) {
    const task = resolveTaskByIdOrRun({
      sessionKey: params.sessionKey,
      taskId: explicitTaskId,
    });
    if (task && task.status === "blocked") {
      return {
        kind: "resume_task",
        task,
        credentials,
      };
    }
  }

  const blockedTasks = getBlockedTasksForSession(params.sessionKey);
  if (blockedTasks.length === 1) {
    return {
      kind: "resume_task",
      task: blockedTasks[0],
      credentials,
    };
  }

  if (blockedTasks.length > 1) {
    return {
      kind: "needs_task_selection",
      blockedTasks,
      credentials,
    };
  }

  const recentBlockedTask = listTasksForSession(params.sessionKey).find((task) => task.status === "blocked");
  if (recentBlockedTask) {
    return {
      kind: "resume_task",
      task: recentBlockedTask,
      credentials,
    };
  }

  return { kind: "none" };
}
