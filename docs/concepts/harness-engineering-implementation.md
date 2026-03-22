---
summary: "OpenClaw Harness Engineering implementation roadmap with concrete code examples and migration steps"
title: Harness Engineering Implementation Guide
read_when:
  - You want to implement Harness Engineering improvements in OpenClaw
  - You need concrete code examples for task orchestration
  - You are planning the next phase of agent system development
---

# Harness Engineering Implementation Guide

This document provides concrete implementation guidance for enhancing OpenClaw's agent orchestration system based on Harness Engineering principles.

## Current State Analysis

### What OpenClaw Already Has

| Component         | File                            | Harness Principle        |
| ----------------- | ------------------------------- | ------------------------ |
| Task Events       | src/agents/task-events.ts       | State machine definition |
| Task Registry     | src/agents/task-registry.ts     | Persistent memory        |
| Task Resume       | src/agents/task-resume.ts       | Recovery mechanism       |
| Task Orchestrator | src/agents/task-orchestrator.ts | Progress transparency    |
| Subagent Spawn    | src/agents/subagent-spawn.ts    | Agent lifecycle          |
| Subagent Announce | src/agents/subagent-announce.ts | Communication            |
| Context Engine    | docs/concepts/context-engine.md | Context architecture     |

### Gaps to Fill

| Gap                                  | Priority | Effort |
| ------------------------------------ | -------- | ------ |
| State transition validation (Linter) | P0       | Low    |
| Context budget enforcement           | P0       | Medium |
| Task garbage collection              | P1       | Low    |
| Agent specialization roles           | P1       | Medium |
| Self-verification hooks              | P2       | Medium |
| Observability integration            | P2       | High   |

---

## Phase 1: State Linter (P0)

### Problem

task-events.ts defines a state machine, but there's no enforcement. Agents can skip states or enter invalid states.

### Solution

Add validation in task-registry.ts with fix instructions.

### Implementation

```typescript
// src/agents/task-state-linter.ts

import type { TaskStatus } from "./task-events";

type TransitionRule = {
  from: TaskStatus;
  to: TaskStatus[];
  requires?: string[];
};

const TRANSITION_RULES: TransitionRule[] = [
  { from: "accepted", to: ["planning", "blocked", "cancelled"] },
  { from: "planning", to: ["executing", "blocked", "cancelled"] },
  { from: "executing", to: ["evaluating", "blocked", "failed", "timeout", "cancelled"] },
  { from: "evaluating", to: ["completed", "failed", "blocked"] },
  { from: "blocked", to: ["planning", "executing", "cancelled"] },
  { from: "completed", to: [] },
  { from: "failed", to: [] },
  { from: "timeout", to: [] },
  { from: "cancelled", to: [] },
];

export type ValidationResult = {
  valid: boolean;
  error?: {
    code: string;
    message: string;
    fixInstruction: string;
  };
};

export function validateStateTransition(
  current: TaskStatus,
  next: TaskStatus,
  context?: { taskId?: string; reason?: string },
): ValidationResult {
  const rule = TRANSITION_RULES.find((r) => r.from === current);

  if (!rule) {
    return {
      valid: false,
      error: {
        code: "UNKNOWN_STATE",
        message: `Unknown state: ${current}`,
        fixInstruction: `Check task state consistency. Valid states: accepted, planning, executing, evaluating, completed, failed, timeout, blocked, cancelled`,
      },
    };
  }

  if (rule.to.length === 0) {
    return {
      valid: false,
      error: {
        code: "TERMINAL_STATE",
        message: `Cannot transition from terminal state '${current}'`,
        fixInstruction: `Task ${context?.taskId || ""} is already in terminal state. Create a new task for related work instead of modifying this one.`,
      },
    };
  }

  if (!rule.to.includes(next)) {
    return {
      valid: false,
      error: {
        code: "INVALID_TRANSITION",
        message: `Invalid transition: ${current} → ${next}`,
        fixInstruction: [
          `Allowed transitions from '${current}':`,
          ...rule.to.map((t) => `  - ${current} → ${t}`),
          context?.taskId ? `\nTaskId: ${context.taskId}` : "",
        ].join("\n"),
      },
    };
  }

  return { valid: true };
}

export function buildLinterErrorMessage(result: ValidationResult): string {
  if (result.valid || !result.error) return "";

  return [
    `TASK_LINTER_ERROR [${result.error.code}]`,
    result.error.message,
    "",
    "Fix:",
    result.error.fixInstruction,
  ].join("\n");
}
```

### Integration Point

```typescript
// In src/agents/task-registry.ts, modify updateTaskFromRunEvent

import { validateStateTransition, buildLinterErrorMessage } from "./task-state-linter";

export function updateTaskFromRunEvent(params: { runId: string; event: TaskProgressEvent }): {
  updated: boolean;
  linterError?: string;
} {
  const existing = findTaskByRunId(params.runId);
  if (!existing) return { updated: false };

  // Validate transition
  if (params.event.status && params.event.status !== existing.status) {
    const validation = validateStateTransition(existing.status, params.event.status, {
      taskId: existing.taskId,
    });

    if (!validation.valid) {
      const errorMsg = buildLinterErrorMessage(validation);
      console.error(errorMsg);
      return {
        updated: false,
        linterError: errorMsg,
      };
    }
  }

  // Proceed with update...
}
```

---

## Phase 2: Context Budget (P0)

### Problem

No enforcement of context utilization. Agents can enter "Dumb Zone" (>40% context) without warning.

### Solution

Add budget tracking and warnings in context assembly.

### Implementation

```typescript
// src/agents/context-budget.ts

export type ContextBudgetConfig = {
  maxTokens: number;
  smartZoneThreshold: number;
  dumbZoneThreshold: number;
  warningLevels: number[];
};

export const DEFAULT_BUDGET: ContextBudgetConfig = {
  maxTokens: 128_000,
  smartZoneThreshold: 0.4, // 40% - Smart Zone boundary
  dumbZoneThreshold: 0.7, // 70% - Critical zone
  warningLevels: [0.3, 0.4, 0.5, 0.6, 0.7],
};

export type BudgetStatus = {
  tokens: number;
  utilization: number;
  zone: "smart" | "warning" | "dumb" | "overflow";
  shouldCompact: boolean;
  message?: string;
};

export function checkContextBudget(
  tokens: number,
  config: ContextBudgetConfig = DEFAULT_BUDGET,
): BudgetStatus {
  const utilization = tokens / config.maxTokens;

  if (utilization > 1) {
    return {
      tokens,
      utilization,
      zone: "overflow",
      shouldCompact: true,
      message: `CRITICAL: Context overflow (${(utilization * 100).toFixed(1)}%). Trigger immediate compaction.`,
    };
  }

  if (utilization > config.dumbZoneThreshold) {
    return {
      tokens,
      utilization,
      zone: "dumb",
      shouldCompact: true,
      message: `WARNING: Dumb Zone (${(utilization * 100).toFixed(1)}%). Quality degradation expected. Compact now.`,
    };
  }

  if (utilization > config.smartZoneThreshold) {
    return {
      tokens,
      utilization,
      zone: "warning",
      shouldCompact: false,
      message: `CAUTION: Exiting Smart Zone (${(utilization * 100).toFixed(1)}%). Consider selective compaction.`,
    };
  }

  return {
    tokens,
    utilization,
    zone: "smart",
    shouldCompact: false,
  };
}

export function buildBudgetReport(status: BudgetStatus): string {
  const zoneIcon = {
    smart: "🟢",
    warning: "🟡",
    dumb: "🔴",
    overflow: "💥",
  }[status.zone];

  const barLength = 20;
  const filled = Math.floor(status.utilization * barLength);
  const bar = "█".repeat(filled) + "░".repeat(barLength - filled);

  return [
    `${zoneIcon} Context Budget: [${bar}] ${(status.utilization * 100).toFixed(1)}%`,
    `  Tokens: ${status.tokens.toLocaleString()} / ${DEFAULT_BUDGET.maxTokens.toLocaleString()}`,
    status.message ? `  ${status.message}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
```

### Integration with Context Engine

```typescript
// Hook into existing context engine assemble() method

import { checkContextBudget, buildBudgetReport } from "./context-budget";

// In assemble() method:
const budgetStatus = checkContextBudget(estimatedTokens);

if (budgetStatus.shouldCompact) {
  // Trigger compaction before returning
  await compact({ sessionId, force: false });
}

// Log budget status for observability
console.debug(buildBudgetReport(budgetStatus));
```

---

## Phase 3: Task Garbage Collection (P1)

### Problem

Blocked tasks hang forever; completed tasks never cleaned. Session store grows unbounded.

### Solution

Implement periodic GC with configurable policies.

### Implementation

```typescript
// src/agents/task-gc.ts

import type { TaskRecord } from "./task-registry";
import { listTasksForSession, deleteTask, updateTask } from "./task-registry";

export type GcPolicy = {
  maxCompletedAgeDays: number;
  maxStaleBlockedHours: number;
  maxTasksPerSession: number;
  dryRun: boolean;
};

export const DEFAULT_GC_POLICY: GcPolicy = {
  maxCompletedAgeDays: 7,
  maxStaleBlockedHours: 48,
  maxTasksPerSession: 50,
  dryRun: false,
};

export type GcResult = {
  deleted: TaskRecord[];
  flagged: TaskRecord[];
  retained: TaskRecord[];
  report: string;
};

export function runTaskGc(sessionKey: string, policy: GcPolicy = DEFAULT_GC_POLICY): GcResult {
  const tasks = listTasksForSession(sessionKey);
  const now = Date.now();

  const deleted: TaskRecord[] = [];
  const flagged: TaskRecord[] = [];
  const retained: TaskRecord[] = [];

  // Sort by priority: terminal states first, then by age
  const sortedTasks = [...tasks].sort((a, b) => {
    const aTerminal = isTerminalTaskStatus(a.status);
    const bTerminal = isTerminalTaskStatus(b.status);
    if (aTerminal !== bTerminal) return aTerminal ? -1 : 1;
    return a.createdAt - b.createdAt;
  });

  for (const task of sortedTasks) {
    const ageDays = (now - task.createdAt) / (1000 * 60 * 60 * 24);
    const blockedHours = task.blockedAt ? (now - task.blockedAt) / (1000 * 60 * 60) : 0;

    let action: "delete" | "flag" | "retain" = "retain";
    let reason = "";

    // Rule 1: Old terminal tasks
    if (isTerminalTaskStatus(task.status) && ageDays > policy.maxCompletedAgeDays) {
      action = "delete";
      reason = `Terminal state for ${ageDays.toFixed(1)} days`;
    }
    // Rule 2: Stale blocked tasks
    else if (task.status === "blocked" && blockedHours > policy.maxStaleBlockedHours) {
      action = "flag";
      reason = `Blocked for ${blockedHours.toFixed(1)} hours`;
    }
    // Rule 3: Over limit
    else if (
      tasks.length - deleted.length > policy.maxTasksPerSession &&
      isTerminalTaskStatus(task.status)
    ) {
      action = "delete";
      reason = `Over limit (${tasks.length} > ${policy.maxTasksPerSession})`;
    }

    if (action === "delete") {
      deleted.push(task);
      if (!policy.dryRun) {
        deleteTask(task.taskId, sessionKey);
      }
    } else if (action === "flag") {
      flagged.push(task);
      if (!policy.dryRun) {
        updateTask({
          taskId: task.taskId,
          sessionKey,
          updates: {
            lastMessage: `[STALE] ${reason}. User needs to respond or cancel.`,
          },
        });
      }
    } else {
      retained.push(task);
    }
  }

  const report = [
    `Task GC Report for ${sessionKey}`,
    "=".repeat(40),
    `Total tasks: ${tasks.length}`,
    `Deleted: ${deleted.length}`,
    `Flagged: ${flagged.length}`,
    `Retained: ${retained.length}`,
    "",
    deleted.length > 0
      ? ["Deleted tasks:", ...deleted.map((t) => `  - ${t.taskId}: ${t.status} (${t.title})`)]
      : [],
    flagged.length > 0
      ? [
          "Flagged tasks (need attention):",
          ...flagged.map(
            (t) =>
              `  - ${t.taskId}: blocked for ${((now - t.blockedAt!) / (1000 * 60 * 60)).toFixed(1)}h`,
          ),
        ]
      : [],
  ]
    .flat()
    .filter(Boolean)
    .join("\n");

  return { deleted, flagged, retained, report };
}

function isTerminalTaskStatus(status: string): boolean {
  return ["completed", "failed", "timeout", "cancelled"].includes(status);
}
```

### Scheduled Execution

```typescript
// Add to gateway startup or as a periodic job

import { runTaskGc } from "./task-gc";

// Run GC every 6 hours
const GC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startTaskGcScheduler() {
  setInterval(() => {
    const sessions = listAllSessions();
    for (const session of sessions) {
      const result = runTaskGc(session.key);
      if (result.deleted.length > 0 || result.flagged.length > 0) {
        console.info(result.report);
      }
    }
  }, GC_INTERVAL_MS);
}
```

---

## Phase 4: Agent Specialization (P1)

### Problem

All subagents have the same capabilities. No role-based restrictions.

### Solution

Define specialized roles with scoped permissions.

### Implementation

```typescript
// src/agents/specialized-roles.ts

export type SpecializedRole =
  | "orchestrator"
  | "researcher"
  | "planner"
  | "executor"
  | "reviewer"
  | "debugger"
  | "cleaner";

export type RoleCapabilities = {
  canRead: boolean;
  canWrite: boolean;
  canSpawn: boolean;
  canExecute: boolean;
  allowedTools: string[] | "*";
  deniedTools: string[];
  maxContextTokens?: number;
  priority: number;
};

export const ROLE_DEFINITIONS: Record<SpecializedRole, RoleCapabilities> = {
  orchestrator: {
    canRead: true,
    canWrite: true,
    canSpawn: true,
    canExecute: true,
    allowedTools: "*",
    deniedTools: [],
    priority: 1,
  },

  researcher: {
    canRead: true,
    canWrite: false,
    canSpawn: false,
    canExecute: false,
    allowedTools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch"],
    deniedTools: ["Write", "Edit", "Delete", "Bash", "Exec"],
    maxContextTokens: 50_000,
    priority: 2,
  },

  planner: {
    canRead: true,
    canWrite: false,
    canSpawn: false,
    canExecute: false,
    allowedTools: ["Read", "Grep", "Glob", "Write"],
    deniedTools: ["Edit", "Delete", "Bash", "Exec"],
    maxContextTokens: 30_000,
    priority: 2,
  },

  executor: {
    canRead: true,
    canWrite: true,
    canSpawn: true,
    canExecute: true,
    allowedTools: ["Read", "Write", "Edit", "Bash", "Exec", "Grep", "Glob"],
    deniedTools: [],
    maxContextTokens: 80_000,
    priority: 3,
  },

  reviewer: {
    canRead: true,
    canWrite: false,
    canSpawn: false,
    canExecute: false,
    allowedTools: ["Read", "Grep", "Glob", "Test"],
    deniedTools: ["Write", "Edit", "Delete", "Bash", "Exec"],
    maxContextTokens: 40_000,
    priority: 2,
  },

  debugger: {
    canRead: true,
    canWrite: true,
    canSpawn: false,
    canExecute: true,
    allowedTools: ["Read", "Edit", "Bash", "Grep", "Glob"],
    deniedTools: ["Write", "Delete"],
    maxContextTokens: 60_000,
    priority: 3,
  },

  cleaner: {
    canRead: true,
    canWrite: true,
    canSpawn: false,
    canExecute: false,
    allowedTools: ["Read", "Write", "Edit", "Delete", "Grep", "Glob"],
    deniedTools: ["Bash", "Exec"],
    maxContextTokens: 40_000,
    priority: 4,
  },
};

export function getRoleCapabilities(role: SpecializedRole): RoleCapabilities {
  return ROLE_DEFINITIONS[role];
}

export function isToolAllowed(tool: string, role: SpecializedRole): boolean {
  const caps = ROLE_DEFINITIONS[role];

  if (caps.allowedTools === "*") return true;
  if (caps.deniedTools.includes(tool)) return false;
  if (caps.allowedTools.includes(tool)) return true;

  return false;
}

export function buildRolePrompt(role: SpecializedRole): string {
  const caps = ROLE_DEFINITIONS[role];

  const roleDescriptions: Record<SpecializedRole, string> = {
    orchestrator:
      "You are the main orchestrator. You coordinate work across specialized agents and aggregate results.",
    researcher: "You are a research agent. You explore and analyze code, but cannot make changes.",
    planner:
      "You are a planning agent. You decompose requirements into structured tasks, but cannot implement.",
    executor:
      "You are an execution agent. You implement specific tasks according to approved plans.",
    reviewer:
      "You are a review agent. You audit completed work and flag issues, but cannot make changes.",
    debugger: "You are a debugging agent. You fix issues found in review, with scoped permissions.",
    cleaner: "You are a cleanup agent. You remove technical debt and maintain code quality.",
  };

  return [
    roleDescriptions[role],
    "",
    "Capabilities:",
    `- Read: ${caps.canRead ? "✓" : "✗"}`,
    `- Write: ${caps.canWrite ? "✓" : "✗"}`,
    `- Spawn subagents: ${caps.canSpawn ? "✓" : "✗"}`,
    `- Execute commands: ${caps.canExecute ? "✓" : "✗"}`,
    caps.allowedTools === "*"
      ? "- All tools available"
      : `- Allowed tools: ${caps.allowedTools.join(", ")}`,
    caps.deniedTools.length > 0 ? `- Denied tools: ${caps.deniedTools.join(", ")}` : null,
    caps.maxContextTokens
      ? `- Max context: ${caps.maxContextTokens.toLocaleString()} tokens`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}
```

### Integration with Subagent Spawn

```typescript
// In src/agents/subagent-spawn.ts

import { getRoleCapabilities, buildRolePrompt, type SpecializedRole } from "./specialized-roles";

export function spawnSpecializedAgent(params: {
  role: SpecializedRole;
  task: string;
  parentSessionKey: string;
}): SpawnResult {
  const caps = getRoleCapabilities(params.role);
  const rolePrompt = buildRolePrompt(params.role);

  // Inject role prompt into system prompt
  const systemPrompt = [rolePrompt, "", "# Task", params.task].join("\n");

  // Apply tool restrictions
  const toolPolicy =
    caps.allowedTools === "*" ? undefined : { allow: caps.allowedTools, deny: caps.deniedTools };

  return spawnSubagent({
    systemPrompt,
    toolPolicy,
    maxContextTokens: caps.maxContextTokens,
    parentSessionKey: params.parentSessionKey,
  });
}
```

---

## Phase 5: Self-Verification Hooks (P2)

### Problem

Agents mark tasks complete without verifying outputs.

### Solution

Add verification hooks that run before task completion.

### Implementation

```typescript
// src/agents/self-verification.ts

export type VerificationCheck = {
  type: "file_exists" | "test_passes" | "schema_valid" | "no_errors" | "custom";
  params: Record<string, unknown>;
  required: boolean;
};

export type VerificationResult = {
  check: VerificationCheck;
  passed: boolean;
  message: string;
};

export async function runVerification(checks: VerificationCheck[]): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (const check of checks) {
    const result = await runSingleCheck(check);
    results.push(result);

    // Fail fast on required checks
    if (!result.passed && check.required) {
      break;
    }
  }

  return results;
}

async function runSingleCheck(check: VerificationCheck): Promise<VerificationResult> {
  switch (check.type) {
    case "file_exists": {
      const path = check.params.path as string;
      const exists = await checkFileExists(path);
      return {
        check,
        passed: exists,
        message: exists ? `File exists: ${path}` : `File not found: ${path}`,
      };
    }

    case "test_passes": {
      const testCommand = check.params.command as string;
      const result = await runTest(testCommand);
      return {
        check,
        passed: result.success,
        message: result.success ? "Tests passed" : `Tests failed: ${result.output?.slice(0, 200)}`,
      };
    }

    case "schema_valid": {
      const data = check.params.data;
      const schema = check.params.schema;
      const valid = validateSchema(data, schema);
      return {
        check,
        passed: valid,
        message: valid ? "Schema validation passed" : "Schema validation failed",
      };
    }

    case "no_errors": {
      const logs = check.params.logs as string[];
      const hasErrors = logs.some((l) => l.includes("ERROR") || l.includes("FAIL"));
      return {
        check,
        passed: !hasErrors,
        message: hasErrors ? "Errors found in logs" : "No errors in logs",
      };
    }

    default:
      return {
        check,
        passed: true,
        message: "Unknown check type, skipping",
      };
  }
}

export function buildVerificationReport(results: VerificationResult[]): string {
  const allPassed = results.every((r) => r.passed);

  return [
    allPassed ? "✅ All verifications passed" : "❌ Some verifications failed",
    "",
    ...results.map((r) => `${r.passed ? "✓" : "✗"} ${r.check.type}: ${r.message}`),
  ].join("\n");
}
```

### Integration with Task Completion

```typescript
// In task-orchestrator.ts, modify markSubagentTaskOutcome

import {
  runVerification,
  buildVerificationReport,
  type VerificationCheck,
} from "./self-verification";

export async function markSubagentTaskOutcomeWithVerification(params: {
  runId: string;
  outcome: "ok" | "timeout" | "error";
  verificationChecks?: VerificationCheck[];
}): Promise<TaskStatus> {
  // If outcome is ok and we have verification checks, run them
  if (params.outcome === "ok" && params.verificationChecks?.length) {
    const results = await runVerification(params.verificationChecks);
    const report = buildVerificationReport(results);

    const allPassed = results.every((r) => r.passed);

    if (!allPassed) {
      // Don't mark as completed, instead mark as evaluating with issues
      markSubagentTaskOutcome({
        runId: params.runId,
        outcome: "ok", // The run itself was ok
        statusOverride: "evaluating",
        message: `Verification issues:\n${report}`,
      });

      return "evaluating";
    }

    // All passed, include report in completion
    markSubagentTaskOutcome({
      runId: params.runId,
      outcome: "ok",
      message: report,
    });

    return "completed";
  }

  // No verification, proceed normally
  return markSubagentTaskOutcome({
    runId: params.runId,
    outcome: params.outcome,
  });
}
```

---

## Phase 6: Backpressure & Retry (P2)

### Problem

Failed tasks retry infinitely without backoff, wasting resources.

### Solution

Implement exponential backoff with max retry limits.

### Implementation

```typescript
// src/agents/backpressure.ts

export type RetryPolicy = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  backoffMultiplier: 2,
  jitterMs: 500,
};

export type RetryDecision = {
  shouldRetry: boolean;
  delayMs: number;
  reason: string;
};

const NON_RETRYABLE_PATTERNS = [
  /permission denied/i,
  /authentication failed/i,
  /invalid (input|parameter|credential)/i,
  /not authorized/i,
  /resource not found/i,
];

export function shouldRetry(params: {
  attemptIndex: number;
  lastError?: string;
  policy?: RetryPolicy;
}): RetryDecision {
  const policy = params.policy ?? DEFAULT_RETRY_POLICY;

  // Check max retries
  if (params.attemptIndex >= policy.maxRetries) {
    return {
      shouldRetry: false,
      delayMs: 0,
      reason: `Max retries (${policy.maxRetries}) exceeded`,
    };
  }

  // Check for non-retryable errors
  if (params.lastError) {
    for (const pattern of NON_RETRYABLE_PATTERNS) {
      if (pattern.test(params.lastError)) {
        return {
          shouldRetry: false,
          delayMs: 0,
          reason: `Non-retryable error pattern: ${pattern.source}`,
        };
      }
    }
  }

  // Calculate delay with exponential backoff + jitter
  const baseDelay = policy.baseDelayMs * Math.pow(policy.backoffMultiplier, params.attemptIndex);
  const jitter = Math.random() * policy.jitterMs;
  const delayMs = Math.min(baseDelay + jitter, policy.maxDelayMs);

  return {
    shouldRetry: true,
    delayMs,
    reason: `Retry ${params.attemptIndex + 1}/${policy.maxRetries} in ${(delayMs / 1000).toFixed(1)}s`,
  };
}

export function buildRetryMessage(decision: RetryDecision, taskId: string): string {
  if (!decision.shouldRetry) {
    return `Task ${taskId} failed permanently: ${decision.reason}`;
  }

  return `Task ${taskId} retry scheduled: ${decision.reason}`;
}
```

---

## Migration Roadmap

### Week 1: Foundation

1. Implement `task-state-linter.ts`
2. Integrate with `task-registry.ts`
3. Add unit tests for state transitions

### Week 2: Context Management

1. Implement `context-budget.ts`
2. Hook into context engine assemble()
3. Add budget reporting to logs

### Week 3: Cleanup

1. Implement `task-gc.ts`
2. Add GC scheduler
3. Test with real sessions

### Week 4: Specialization

1. Implement `specialized-roles.ts`
2. Modify `subagent-spawn.ts`
3. Add role-based spawning API

### Week 5: Verification

1. Implement `self-verification.ts`
2. Add verification hooks to task completion
3. Test with file/test checks

### Week 6: Polish

1. Implement `backpressure.ts`
2. Add retry logic to task execution
3. Documentation and testing

---

## Testing Strategy

### Unit Tests

```typescript
// src/agents/task-state-linter.test.ts

describe("task-state-linter", () => {
  it("allows valid transitions", () => {
    expect(validateStateTransition("accepted", "planning").valid).toBe(true);
    expect(validateStateTransition("planning", "executing").valid).toBe(true);
    expect(validateStateTransition("executing", "evaluating").valid).toBe(true);
  });

  it("rejects invalid transitions", () => {
    const result = validateStateTransition("completed", "executing");
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe("TERMINAL_STATE");
  });

  it("provides fix instructions", () => {
    const result = validateStateTransition("accepted", "completed");
    expect(result.valid).toBe(false);
    expect(result.error?.fixInstruction).toContain("allowed transitions");
  });
});
```

### Integration Tests

```typescript
// src/agents/task-orchestrator.test.ts

describe("task orchestration with harness", () => {
  it("enforces state transitions on task updates", async () => {
    const task = await createTrackedTask({ sessionKey: "test", title: "Test" });

    // Try invalid transition
    const result = updateTaskFromRunEvent({
      runId: task.runId,
      event: { status: "completed", ... },
    });

    expect(result.updated).toBe(false);
    expect(result.linterError).toContain("INVALID_TRANSITION");
  });
});
```

---

## Monitoring & Observability

### Key Metrics

```typescript
// Add to metrics collection

export const HARNESS_METRICS = {
  // Context budget
  context_utilization: "gauge",
  context_zone: "label", // smart/warning/dumb/overflow

  // Task lifecycle
  task_state_transitions: "counter",
  task_linter_violations: "counter",
  task_gc_deleted: "counter",
  task_gc_flagged: "counter",

  // Retries
  task_retries_total: "counter",
  task_retries_exhausted: "counter",
  task_backpressure_delay_ms: "histogram",

  // Specialization
  agent_role_spawn_count: "counter",
  agent_role_tool_denied: "counter",
};
```

### Dashboard Queries

```promql
# Context zone distribution
sum by (zone) (rate(context_utilization[5m]))

# Task linter violations
rate(task_linter_violations_total[1h])

# Retry exhaustion rate
rate(task_retries_exhausted_total[1h]) / rate(task_retries_total[1h])
```

---

## Summary

This implementation guide provides concrete steps to enhance OpenClaw's agent orchestration with Harness Engineering principles:

| Phase | Component      | Key Benefit                        |
| ----- | -------------- | ---------------------------------- |
| 1     | State Linter   | Prevents invalid state transitions |
| 2     | Context Budget | Keeps agents in Smart Zone         |
| 3     | Task GC        | Prevents unbounded growth          |
| 4     | Specialization | Role-based tool restrictions       |
| 5     | Verification   | Self-checking task completion      |
| 6     | Backpressure   | Controlled retry behavior          |

Each phase builds on the previous, creating a comprehensive Harness that ensures reliable, auditable, and maintainable agent outputs.
