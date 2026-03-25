import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";

export type PlanApprovalMode = "auto_execute" | "review_first" | "risk_based";

export type TaskPolicies = {
  planApprovalMode: PlanApprovalMode;
  riskApprovalRequired: boolean;
  externalSideEffectsApproval: boolean;
  costlyOpsApproval: boolean;
  allowBackgroundExecution: boolean;
  interruptPolicy: "cancel_and_replan" | "queue_after_current" | "ask_first";
  progressVerbosity: "minimal" | "normal" | "detailed";
  finalResponseStyle: "brief" | "with_steps" | "with_verification";
  failureHandling: "auto_retry_once" | "ask_user" | "fail_fast";
  planDiffRequired: boolean;
  updatedAt: string;
};

export type TaskApprovalEvent = {
  ts: string;
  action: "requested" | "confirmed" | "cancelled" | "replanned";
  sessionKey?: string;
  reason?: string;
  complexity?: "low" | "medium" | "high";
  promptLen?: number;
};

const DEFAULT_POLICIES: TaskPolicies = {
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
  updatedAt: new Date(0).toISOString(),
};

function resolvePoliciesPath(): string {
  return path.join(resolveStateDir(process.env), "prefs", "task-policies.json");
}

function resolveApprovalEventsPath(): string {
  return path.join(resolveStateDir(process.env), "prefs", "task-approval-events.jsonl");
}

function sanitize(raw: Partial<TaskPolicies> | null | undefined): TaskPolicies {
  return {
    planApprovalMode:
      raw?.planApprovalMode === "review_first" || raw?.planApprovalMode === "risk_based"
        ? raw.planApprovalMode
        : "auto_execute",
    riskApprovalRequired: raw?.riskApprovalRequired ?? DEFAULT_POLICIES.riskApprovalRequired,
    externalSideEffectsApproval:
      raw?.externalSideEffectsApproval ?? DEFAULT_POLICIES.externalSideEffectsApproval,
    costlyOpsApproval: raw?.costlyOpsApproval ?? DEFAULT_POLICIES.costlyOpsApproval,
    allowBackgroundExecution:
      raw?.allowBackgroundExecution ?? DEFAULT_POLICIES.allowBackgroundExecution,
    interruptPolicy:
      raw?.interruptPolicy === "queue_after_current" || raw?.interruptPolicy === "ask_first"
        ? raw.interruptPolicy
        : "cancel_and_replan",
    progressVerbosity:
      raw?.progressVerbosity === "minimal" || raw?.progressVerbosity === "detailed"
        ? raw.progressVerbosity
        : "normal",
    finalResponseStyle:
      raw?.finalResponseStyle === "with_steps" || raw?.finalResponseStyle === "with_verification"
        ? raw.finalResponseStyle
        : "brief",
    failureHandling:
      raw?.failureHandling === "auto_retry_once" || raw?.failureHandling === "fail_fast"
        ? raw.failureHandling
        : "ask_user",
    planDiffRequired: raw?.planDiffRequired ?? DEFAULT_POLICIES.planDiffRequired,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

export function readTaskPolicies(): TaskPolicies {
  const policiesPath = resolvePoliciesPath();
  try {
    const content = fs.readFileSync(policiesPath, "utf8");
    const parsed = JSON.parse(content) as Partial<TaskPolicies>;
    return sanitize(parsed);
  } catch {
    return { ...DEFAULT_POLICIES, updatedAt: new Date().toISOString() };
  }
}

export function writeTaskPolicies(update: (current: TaskPolicies) => TaskPolicies): TaskPolicies {
  const policiesPath = resolvePoliciesPath();
  const current = readTaskPolicies();
  const next = sanitize(update(current));
  next.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(policiesPath), { recursive: true });
  fs.writeFileSync(policiesPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function maybeApplyPoliciesFromUserText(text: string): TaskPolicies | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/先给我看规划|先审核再执行|review first|approve first/.test(normalized)) {
    return writeTaskPolicies((current) => ({ ...current, planApprovalMode: "review_first" }));
  }
  if (/可以直接执行|自动执行|不用先审核|auto execute/.test(normalized)) {
    return writeTaskPolicies((current) => ({ ...current, planApprovalMode: "auto_execute" }));
  }
  if (/高风险先确认|风险任务先确认|risk based/.test(normalized)) {
    return writeTaskPolicies((current) => ({ ...current, planApprovalMode: "risk_based" }));
  }
  return null;
}

export function appendTaskApprovalEvent(event: Omit<TaskApprovalEvent, "ts">): void {
  const filePath = resolveApprovalEventsPath();
  const entry: TaskApprovalEvent = {
    ts: new Date().toISOString(),
    ...event,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

export function readRecentTaskApprovalEvents(limit = 200): TaskApprovalEvent[] {
  const filePath = resolveApprovalEventsPath();
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const selected = lines.slice(Math.max(0, lines.length - Math.max(1, limit)));
    const events: TaskApprovalEvent[] = [];
    for (const line of selected) {
      try {
        const parsed = JSON.parse(line) as TaskApprovalEvent;
        if (parsed && typeof parsed.action === "string") {
          events.push(parsed);
        }
      } catch {
        // Ignore malformed lines.
      }
    }
    return events;
  } catch {
    return [];
  }
}

export function summarizeTaskApprovalEvents(events: TaskApprovalEvent[]): string {
  if (events.length === 0) {
    return "No approval events recorded yet.";
  }
  const counts = {
    requested: 0,
    confirmed: 0,
    cancelled: 0,
    replanned: 0,
  };
  for (const event of events) {
    if (event.action in counts) {
      counts[event.action as keyof typeof counts] += 1;
    }
  }
  return [
    `Task Approval Stats (last ${events.length} events)`,
    `- requested: ${counts.requested}`,
    `- confirmed: ${counts.confirmed}`,
    `- cancelled: ${counts.cancelled}`,
    `- replanned: ${counts.replanned}`,
  ].join("\n");
}
