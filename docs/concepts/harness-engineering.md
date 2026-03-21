---
summary: "Harness Engineering: designing reliable AI agent systems with constraints, feedback loops, and entropy management"
title: Harness Engineering
read_when:
  - You want to understand how to design reliable AI agent systems
  - You are building multi-agent orchestration
  - You need to prevent agent drift and ensure consistent outputs
---

# Harness Engineering

Harness Engineering is the engineering practice of designing constraints, guardrails, feedback loops, and lifecycle tools that enable AI agents to consistently produce correct, auditable, and maintainable outputs.

## The Core Metaphor

- **AI Model** = A powerful horse (strong execution capability, but unpredictable direction)
- **Harness** = Bridle, saddle, and racetrack barriers (constraints + guidance)
- **Engineer** = The rider (designs the environment, doesn't do the running)

**Essence**: Wrap an **uncertain AI core** with **deterministic code** to ensure stable, reliable operation within defined boundaries.

## Why Harness Engineering Matters

### The Bottleneck is Infrastructure, Not Intelligence

Quantitative evidence from multiple teams:

| Experiment | Change | Result |
|------------|--------|--------|
| Can.ac | Only changed tool format (edit interface) | Grok Code Fast 1: 6.7% → 68.3% on coding benchmarks |
| LangChain | Harness improvements only | Terminal Bench 2.0: #30 → #5, +13.7 points |

**Conclusion**: Before debating model selection, examine your Harness design for higher ROI.

### Agent Failure Modes

Anthropic identified four common failure patterns:

| Failure Mode | Description | Countermeasure |
|--------------|-------------|----------------|
| One-shotting | Agent tries to do everything at once, exhausts context window | Dual-agent architecture + incremental progress |
| Premature victory | Agent declares task complete when only partial work is done | Feature list + forced verification |
| Premature completion marking | Agent marks features done without E2E testing | Forced E2E testing |
| Environment startup friction | Each new session wastes tokens figuring out how to run the app | init.sh scripts + progress files |

### The Smart Zone vs Dumb Zone

Dex Horthy's empirical observation: context quality degrades past ~40% utilization.

| Zone | Utilization | Characteristics |
|------|-------------|-----------------|
| Smart Zone | 0-40% | Focused, accurate reasoning |
| Dumb Zone | >40% | Hallucinations, loops, malformed tool calls, low-quality code |

**Key insight**: More context ≠ better results. Overloading context makes agents dumber.

## The Four Pillars

### Pillar 1: Context Architecture

**Core principle**: Agents should receive exactly the context needed for the current task—no more, no less.

#### Three-Tier Context System

| Tier | Loading Trigger | Content | Context Cost |
|------|-----------------|---------|--------------|
| Tier 1: Session-resident | Auto-loaded every session | AGENTS.md, project structure overview | Minimal |
| Tier 2: On-demand | When specific subagent/skill is invoked | Specialized agent context, domain knowledge | Medium |
| Tier 3: Persistent knowledge | When agent actively queries | Research docs, specs, historical sessions | As needed |

#### Progressive Disclosure Pattern

Instead of one massive instruction file, use a "map" pattern:

```
AGENTS.md (~100 lines)
├── Project overview
├── Architecture entry → docs/architecture/
├── Design docs → docs/design/
├── Coding conventions → docs/conventions/
└── Execution plans → docs/plans/
```

AGENTS.md is a directory, not a manual. Specific knowledge is distributed in structured docs/.

#### Living Documentation

- AGENTS.md is updated whenever an agent fails—it becomes a feedback loop, not a static artifact
- Background agents periodically scan for stale docs and submit cleanup PRs
- Agents maintaining docs for agents

### Pillar 2: Agent Specialization

**Core principle**: Specialized agents with restricted tools outperform general-purpose agents with full permissions.

#### Role-Based Capability Matrix

| Agent Role | Responsibility | Tool Permissions |
|------------|----------------|------------------|
| Orchestrator | Planning and aggregation | Full access |
| Researcher | Explore codebase, analyze implementation | Read-only (Read, Grep, Glob) |
| Planner | Decompose requirements into structured tasks | Read-only, no write permission |
| Executor | Implement specific tasks | Scoped read/write |
| Reviewer | Audit completed work, flag issues | Read-only + marking permission |
| Debugger | Fix issues found in review | Scoped fix permission |
| Cleaner | Combat entropy, clean low-quality code | Read/write |

**Why specialization matters**: Each expert carries less irrelevant information, staying in the "Smart Zone."

### Pillar 3: Persistent Memory

**Core principle**: Persist progress in the filesystem, not in context windows.

Each new agent session starts from zero, rebuilding context through filesystem artifacts.

#### Anthropic's Dual-Agent Pattern

**Initializer Agent** (first session):
- Creates init.sh script
- Creates claude-progress.txt work log
- Creates initial git commit
- Generates feature list (200+ items, all marked "failing")

**Coding Agent** (subsequent sessions):
1. Run `pwd` to see working directory
2. Read git log and progress file
3. Read feature list, select highest-priority incomplete feature
4. Start dev server, run basic E2E test
5. Confirm basic functionality, begin new feature work

**Key finding**: JSON format for feature tracking is more effective than Markdown—agents are less likely to inappropriately modify structured data.

### Pillar 4: Structured Execution

**Core principle**: Separate thinking from execution.

All teams impose a deliberate execution sequence: **Understand → Plan → Execute → Verify**.

#### Research-Plan-Implement Workflow

```
Research Phase
├── Gather information into Smart Zone
├── No code changes
└── Output: Understanding document

Plan Phase
├── Based on Smart Zone information
├── Produce structured plan
└── Output: Task breakdown with dependencies

Implement Phase
├── Execute based on verified plan
├── Keep Zone clean during execution
└── Output: Code changes + verification results
```

#### Human Checkpoint Value

Reviewing a plan is far faster than reviewing code. When the spec is correct, implementation is naturally reliable. When the spec is wrong, you can correct it before 500 lines of code are generated.

## Architectural Constraints

### Mechanized Enforcement

**Key insight**: Documenting rules is not enough. If it cannot be enforced mechanically, agents will deviate.

#### OpenAI's Six-Layer Architecture

```
Types → Config → Repo → Service → Runtime → UI
```

Dependencies flow strictly one direction. CI automatically validates. If an agent writes UI code that directly calls the Repo layer, CI fails immediately.

#### Linter Error Messages as Fix Instructions

Traditional linters only flag violations. OpenAI's custom linters include fix instructions in error messages:

```
ERROR: File exceeds 300 lines limit.
FIX: Split into smaller modules. Move helper functions to utils/.
     See docs/conventions/file-size.md for guidelines.
```

The agent sees the error and immediately knows how to fix it—error messages are teaching moments.

### Three-Pronged Checking System

| Check Type | Use Case | Examples |
|------------|----------|----------|
| Deterministic Linter | Clear rules | Import direction, naming conventions |
| Structural Tests | Runtime behavior | Dependency graph cycle detection |
| LLM-based Agent | Semantic understanding | "Is this class's responsibility crossing boundaries?" |

## Entropy Management (Garbage Collection)

### The Problem

Agent-generated code accumulates "technical debt" differently than human-written code:

- LLM-generated code frequently re-implements existing functionality
- Inconsistent styles spread across files
- Documentation drifts from implementation

### The Solution: Continuous GC

Traditional approach: Technical debt accumulates → painful big refactor
Harness approach: GC agent runs continuously → small incremental cleanup

**OpenAI's practice**: Initially spent 20% of Fridays manually cleaning "AI slop." Later automated as background Codex tasks—cleanup throughput scales with code generation throughput.

### Codifying "Golden Principles"

Translate subjective rules into mechanically enforceable constraints:

| Subjective Rule | Mechanized Translation |
|-----------------|------------------------|
| "Code should be simple" | Single function ≤ 30 lines |
| "Don't reinvent the wheel" | Prefer existing tools in shared/utils/ |
| "Meaningful names" | Function names must start with verb, variables must be noun phrases |
| "Proper error handling" | All errors must go through ErrorProvider |

## Agent Legibility

### Making Applications Visible to Agents

When code throughput increases, the bottleneck shifts from "writing code" to "verifying code."

#### Three Observability Channels

| Channel | Implementation | What Agents Can Do |
|---------|----------------|-------------------|
| UI | Chrome DevTools Protocol | Capture DOM snapshots, screenshots, simulate clicks |
| Logs | LogQL query interface | Query error logs, trace request chains |
| Metrics | PromQL query interface | Query latency, throughput, error rates |

**Example**: "Ensure service starts within 800ms" becomes measurable. Agent can start service, query startup metrics, identify bottlenecks, optimize code, and verify—all without human intervention.

### Self-Verification

Agents should verify their own outputs:

1. **File existence checks**: Did the file actually get created?
2. **Test execution**: Do the tests pass?
3. **Schema validation**: Does output match expected schema?
4. **E2E testing**: Does the full user flow work?

## Maturity Model

| Level | Characteristics | Engineer Role |
|-------|-----------------|---------------|
| Level 0 | No Harness, direct prompts | Manual coding + occasional AI |
| Level 1 | AGENTS.md + basic Linter + manual testing | Mostly coding, AI assistance |
| Level 2 | CI/CD integration + automated testing + progress tracking | Planning + review, some AI coding |
| Level 3 | Multi-agent roles + layered context + persistent memory | Environment design + management |
| Level 4 | Unattended parallelization + automated entropy management + self-healing | Architect + quality gatekeeper |

## OpenClaw Implementation Guide

### Current State Assessment

OpenClaw's task-orchestrator infrastructure already implements several Harness Engineering principles:

| Concept | OpenClaw Implementation |
|---------|------------------------|
| Context Engineering | task-registry.ts manages taskId/runId/session mapping |
| Architectural Constraints | task-events.ts state machine enforces transitions |
| Entropy Management | Task persistence to session store |
| Progress Transparency | buildTaskProgressPanel() progress panel |
| Recovery Mechanism | task-resume.ts credential resume routing |

### Recommended Enhancements

#### 1. Context Budget Enforcement

```typescript
// src/agents/context-budget.ts
export type ContextBudget = {
  maxTokens: number;
  smartZoneThreshold: number;  // ~40%
};

export function enforceContextBudget(
  context: { tokens: number },
  budget: ContextBudget = { maxTokens: 128_000, smartZoneThreshold: 0.4 }
): { withinSmartZone: boolean; warning?: string } {
  const utilization = context.tokens / budget.maxTokens;
  
  if (utilization > budget.smartZoneThreshold) {
    return {
      withinSmartZone: false,
      warning: `Exiting Smart Zone: ${(utilization * 100).toFixed(1)}% utilized`,
    };
  }
  
  return { withinSmartZone: true };
}
```

#### 2. Task State Linter

```typescript
// src/agents/task-state-linter.ts
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  accepted: ["planning", "blocked", "cancelled"],
  planning: ["executing", "blocked", "cancelled"],
  executing: ["evaluating", "blocked", "failed", "timeout", "cancelled"],
  evaluating: ["completed", "failed", "blocked"],
  blocked: ["planning", "executing", "cancelled"],
  completed: [],
  failed: [],
  timeout: [],
  cancelled: [],
};

export function validateTransition(from: TaskStatus, to: TaskStatus): {
  valid: boolean;
  fixInstruction?: string;
} {
  if (VALID_TRANSITIONS[from]?.includes(to)) {
    return { valid: true };
  }
  
  return {
    valid: false,
    fixInstruction: [
      `Invalid transition: ${from} → ${to}`,
      `Allowed from '${from}': ${VALID_TRANSITIONS[from]?.join(", ") || "none"}`,
    ].join("\n"),
  };
}
```

#### 3. Task Garbage Collector

```typescript
// src/agents/task-gc.ts
export type GcPolicy = {
  maxTaskAgeDays: number;
  maxStaleBlockedHours: number;
  maxTasksPerSession: number;
};

export function collectGarbageTasks(
  sessionKey: string,
  policy: GcPolicy = { maxTaskAgeDays: 7, maxStaleBlockedHours: 48, maxTasksPerSession: 40 }
): { toDelete: TaskRecord[]; toFlag: TaskRecord[] } {
  const tasks = listTasksForSession(sessionKey);
  const now = Date.now();
  
  const toDelete = tasks.filter(t => 
    isTerminalTaskStatus(t.status) && 
    (now - t.createdAt) / (1000 * 60 * 60 * 24) > policy.maxTaskAgeDays
  );
  
  const toFlag = tasks.filter(t =>
    t.status === "blocked" &&
    t.blockedAt &&
    (now - t.blockedAt) / (1000 * 60 * 60) > policy.maxStaleBlockedHours
  );
  
  return { toDelete, toFlag };
}
```

#### 4. Agent Specialization

```typescript
// src/agents/specialized-roles.ts
export type SpecializedRole = "orchestrator" | "researcher" | "planner" | "executor" | "reviewer" | "debugger" | "cleaner";

export const ROLE_CAPABILITIES: Record<SpecializedRole, RoleCapabilities> = {
  orchestrator: { canRead: true, canWrite: true, canSpawn: true, allowedTools: ["*"] },
  researcher: { canRead: true, canWrite: false, canSpawn: false, allowedTools: ["Read", "Grep", "Glob"] },
  planner: { canRead: true, canWrite: false, canSpawn: false, allowedTools: ["Read", "Write", "TaskCreate"] },
  executor: { canRead: true, canWrite: true, canSpawn: true, allowedTools: ["Read", "Write", "Edit", "Bash"] },
  reviewer: { canRead: true, canWrite: false, canSpawn: false, allowedTools: ["Read", "Grep", "Test"] },
  debugger: { canRead: true, canWrite: true, canSpawn: false, allowedTools: ["Read", "Edit", "Bash"] },
  cleaner: { canRead: true, canWrite: true, canSpawn: false, allowedTools: ["Read", "Write", "Edit", "Delete"] },
};
```

## Action Checklist

### Immediate Actions

- [ ] Create and maintain AGENTS.md as a living document, updated on every agent failure
- [ ] Establish single source of truth in repository (all team knowledge version-controlled)
- [ ] Build custom Linters with fix instructions embedded in error messages
- [ ] Provide E2E testing tools (browser automation like Puppeteer MCP)
- [ ] Implement incremental execution (one feature per session, git commit + progress update)
- [ ] Layer context management (Tier 1/2/3 progressive disclosure)
- [ ] Keep context utilization below 40%
- [ ] Establish periodic "garbage collection" mechanism

### Key Component Checklist

| Component | Purpose | Priority |
|-----------|---------|----------|
| AGENTS.md / CLAUDE.md | Session-resident context, dynamic feedback loop | P0 |
| Custom Linter + structural tests | Mechanized architecture constraint enforcement | P0 |
| CI/CD pipeline | Automated testing and verification feedback | P0 |
| Progress file (progress.txt / JSON) | Cross-session persistent memory | P1 |
| Feature list file (feature_list.json) | Structured completion criteria | P1 |
| Browser automation (Puppeteer MCP) | E2E test verification | P1 |
| Observability integration | Agent-queryable logs/metrics | P2 |
| Entropy management agent | Periodic cleanup of low-quality code | P2 |
| Specialized sub-agents | Division of labor, reduced context pollution | P2 |

## Open Questions

### Brownfield Project Migration

All public success cases involve greenfield projects. How to introduce Harness Engineering into a 10-year-old legacy codebase without being overwhelmed by alerts remains an open problem.

### Functional Verification

We're good at "constraining agents from doing wrong things" (architecture constraints, Linters, type checking), but "verifying agents did the right thing" is far from solved.

### Long-Term Maintainability

How to prevent "functionally correct but poorly maintainable" code from infiltrating codebases? Agent-written code accumulates technical debt differently than human-written code.

## References

- OpenAI — Harness engineering: leveraging Codex in an agent-first world
- Anthropic — Effective harnesses for long-running agents
- Nicholas Carlini — Building a C Compiler with Claude
- Martin Fowler — Harness Engineering / Context Engineering for Coding Agents
- Mitchell Hashimoto — My AI Adoption Journey (Ghostty project)
- Dex Horthy — Advanced Context Engineering for Coding Agents
- Stripe — Minions: Stripe's one-shot, end-to-end coding agents

---

**Key insight**: In the Agent-First era, the core output of software engineering is no longer code—it's the system that enables agents to efficiently produce high-quality code. You design not features, but constraints, feedback, and environments.
