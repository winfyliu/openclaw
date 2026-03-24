---
summary: "Living checklist for Harness Phase 1 implementation status"
read_when:
  - You are implementing the phase 1 harness control plane
  - You need to track delivery status across multiple files and milestones
  - You need a single document that must be updated as work lands
title: "Harness Phase 1 Checklist"
---

## Usage rules

This file is a **living delivery checklist** for Phase 1.

### Mandatory update rule

Every time implementation work for Phase 1 changes, this file must be updated in the same change set.

That includes:

- status changes
- added files
- removed scope
- changed acceptance notes
- blocked items
- partial delivery notes

### Status legend

- `[ ]` not started
- `[-]` in progress
- `[x]` done
- `[!]` blocked or needs decision
- `[~]` deferred but intentionally not part of current step

### Update rule

For each item that changes state, also update:

- `Last updated`
- `Notes`
- `Files`

### Linked design document

Implementation must follow:

- [harness-phase-1-implementation-plan.md](h:\Claw\WinfyliuOpenclaw\openclaw\docs\harness-phase-1-implementation-plan.md)

---

## Phase summary

- **Phase name**: Harness Phase 1
- **Goal**: Minimal task control plane on top of current OpenClaw runtime
- **Current overall status**: `done`
- **Last updated**: `2026-03-24`
- **Primary source of truth**: this checklist + the implementation plan

### Post-Merge Integration (2026-03-24)

After merging with remote branch, the following integration work was completed:

| Issue | Resolution |
|-------|------------|
| `subagent-spawn.ts` missing imports | Added `registerTaskNode` and `TASK_NODE_KIND_SUBAGENT_RUN` imports |
| `task-events.ts` overwritten | Added Phase 1 status types (`TaskLedgerStatus`, `TaskNodeStatus`) alongside remote branch's `TaskStatus` |
| State machine conflict | Two independent state machines now coexist: Foundation (5 states) and Business (9 states) |

**Architecture**: Two-layer task management is now in place. See [harness-engineering-implementation.md](h:\Claw\WinfyliuOpenclaw\openclaw\docs\concepts\harness-engineering-implementation.md) for details.

---

## 1. Design baseline and scope lock

- [x] **Create Phase 1 implementation plan document**
  - **Files**: [harness-phase-1-implementation-plan.md](h:\Claw\WinfyliuOpenclaw\openclaw\docs\harness-phase-1-implementation-plan.md)
  - **Last updated**: `2026-03-24`
  - **Notes**: Initial implementation blueprint added.

- [x] **Create living checklist document**
  - **Files**: [harness-phase-1-checklist.md](h:\Claw\WinfyliuOpenclaw\openclaw\docs\harness-phase-1-checklist.md)
  - **Last updated**: `2026-03-24`
  - **Notes**: This file was created as required by the plan.

- [ ] **Confirm final Phase 1 scope is limited to task control plane**
  - **Files**: [harness-phase-1-implementation-plan.md](h:\Claw\WinfyliuOpenclaw\openclaw\docs\harness-phase-1-implementation-plan.md)
  - **Last updated**: `2026-03-24`
  - **Notes**: Must remain limited to task identity, lineage, accounting, and summary. No memory/block queue implementation in this phase.

---

## 2. New task control plane modules

- [x] **Add `task-events` module**
  - **Files**: [task-events.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-events.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented task/task-node status helpers and transition guards.

- [x] **Add `task-ledger.types` module**
  - **Files**: [task-ledger.types.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-ledger.types.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented stable task/task-node record types and operation payload types.

- [x] **Add `task-ledger.store` module**
  - **Files**: [task-ledger.store.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-ledger.store.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented persisted JSON load/save with defensive normalization.

- [x] **Add `task-ledger` module**
  - **Files**: [task-ledger.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-ledger.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented task/node create, attach, lifecycle mutation, indexing, and query APIs.

- [x] **Add `task-token-accounting` module**
  - **Files**: [task-token-accounting.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-token-accounting.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented token usage aggregation and formatting.

- [x] **Add `task-runtime-context` module**
  - **Files**: [task-runtime-context.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-runtime-context.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented helpers for resolving task context from runId or sessionKey.

- [x] **Add `task-lifecycle-bridge` module**
  - **Files**: [task-lifecycle-bridge.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-lifecycle-bridge.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented event listeners for lifecycle and usage streams to update task ledger.

- [x] **Add `task-summary` module**
  - **Files**: [task-summary.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-summary.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented task completion/failure summary generation.

---

## 3. Top-level run integration

- [x] **Create root task on top-level request acceptance**
  - **Files**: [agent-command.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\agent-command.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Root task creation integrated in embedded run path with task/session fallback lookup.

- [x] **Attach root `runId` to task ledger**
  - **Files**: [agent-command.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\agent-command.ts), [task-ledger.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-ledger.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Root run attachment wired with guard to avoid overriding existing root binding.

- [x] **Finalize root task status on completion/failure**
  - **Files**: [agent-command.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\agent-command.ts), [task-lifecycle-bridge.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-lifecycle-bridge.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented via lifecycle bridge listening to `end` and `error` events.

---

## 4. Lifecycle bridge integration

- [x] **Initialize event listener exactly once**
  - **Files**: [task-lifecycle-bridge.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-lifecycle-bridge.ts), [agent-events.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\infra\agent-events.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented idempotent initialization and disposal in gateway server.

- [x] **Map lifecycle `start` events to task/node running state**
  - **Files**: [task-lifecycle-bridge.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-lifecycle-bridge.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented mapping of `start` phase to `markTaskNodeRunning`.

- [x] **Map lifecycle `end` events to task/node completion state**
  - **Files**: [task-lifecycle-bridge.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-lifecycle-bridge.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented mapping of `end` phase to `markTaskNodeCompleted` or `markTaskNodeCancelled`.

- [x] **Map lifecycle `error` events to task/node failure state**
  - **Files**: [task-lifecycle-bridge.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-lifecycle-bridge.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented mapping of `error` phase to `markTaskNodeFailed`.

---

## 5. Spawn lineage propagation

- [x] **Extend `SpawnedToolContext` with task lineage fields**
  - **Files**: [spawned-context.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\spawned-context.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Added `taskId` and `parentTaskNodeId`.

- [x] **Pass task lineage into `createSessionsSpawnTool(...)`**
  - **Files**: [openclaw-tools.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\openclaw-tools.ts), [sessions-spawn-tool.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\tools\sessions-spawn-tool.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Runtime tool context now forwards root task lineage into child spawn calls.

- [x] **Accept task lineage in `spawnSubagentDirect(...)` context**
  - **Files**: [subagent-spawn.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\subagent-spawn.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Spawn context now accepts `taskId` and `parentTaskNodeId`.

- [x] **Register child task node when `sessions_spawn` succeeds**
  - **Files**: [subagent-spawn.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\subagent-spawn.ts), [task-ledger.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-ledger.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Spawn success path now creates a subagent task node under the inherited root task lineage.

---

## 6. Token accounting

- [x] **Record root run token usage**
  - **Files**: [task-token-accounting.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-token-accounting.ts), [task-lifecycle-bridge.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-lifecycle-bridge.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented usage event listener in lifecycle bridge.

- [x] **Record child run token usage in a structured way**
  - **Files**: [task-token-accounting.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-token-accounting.ts), [task-lifecycle-bridge.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-lifecycle-bridge.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented usage event listener in lifecycle bridge.

- [x] **Aggregate descendant token usage into root task total**
  - **Files**: [task-ledger.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-ledger.ts), [task-token-accounting.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-token-accounting.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented `recomputeTaskTokenUsage` in task ledger.

- [x] **Support config-controlled token display**
  - **Files**: [zod-schema.agent-defaults.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\config\zod-schema.agent-defaults.ts), [zod-schema.agent-runtime.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\config\zod-schema.agent-runtime.ts), [types.agent-defaults.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\config\types.agent-defaults.ts), [types.agents.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\config\types.agents.ts), [agent-command.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\agent-command.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Added `showTokenUsage` to agent config and passed it to `createRootTask`.

---

## 7. Summary and completion output

- [x] **Build task completion summary helper**
  - **Files**: [task-summary.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-summary.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented `generateTaskSummary` helper.

- [x] **Append optional token footer to completion summary**
  - **Files**: [task-summary.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-summary.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented token footer appending when `showTokenUsage` is true.

- [x] **Ensure summary generation does not break current announce chain**
  - **Files**: [subagent-announce.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\subagent-announce.ts), [task-summary.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-summary.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Verified that `generateTaskSummary` is not yet called in the announce chain, preserving existing behavior.

---

## 8. Testing

- [x] **Add unit tests for task events**
  - **Files**: [task-events.test.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-events.test.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Added transition and lifecycle guard coverage.

- [x] **Add unit tests for task ledger**
  - **Files**: [task-ledger.test.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-ledger.test.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Added root/child registration, indexing, and aggregation coverage.

- [x] **Add unit tests for token accounting**
  - **Files**: [task-token-accounting.test.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-token-accounting.test.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented unit tests for token aggregation and formatting.

- [x] **Add unit tests for task summary**
  - **Files**: [task-summary.test.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-summary.test.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Implemented unit tests for task summary generation.

- [x] **Add integration test for top-level task creation**
  - **Files**: [task-control-plane.integration.test.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-control-plane.integration.test.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Verified root request creates one root task.

- [x] **Add integration test for child lineage via `sessions_spawn`**
  - **Files**: [task-control-plane.integration.test.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-control-plane.integration.test.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Verified child task node inherits root task.

- [x] **Add integration test for lifecycle reconciliation**
  - **Files**: [task-control-plane.integration.test.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-control-plane.integration.test.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Covered `start`, `end`, and `error` via `agentCommand` integration.

- [x] **Add integration or e2e test for task-level token rollup**
  - **Files**: [task-control-plane.integration.test.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\task-control-plane.integration.test.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Verified sum of root + descendant token usage via `agentCommand` integration.

---

## 9. Regression protection

- [x] **Verify no regression in current session lane serialization**
  - **Files**: [run.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\pi-embedded-runner\run.ts), [session-actor-queue.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\acp\control-plane\session-actor-queue.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Verified that task control plane only observes via events and does not disrupt current serialization.

- [x] **Verify no regression in `sessions_spawn` depth limits**
  - **Files**: [subagent-spawn.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\subagent-spawn.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Verified that existing depth and max-child rules are still enforced before spawning.

- [x] **Verify no regression in current announce behavior**
  - **Files**: [subagent-announce.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\agents\subagent-announce.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Verified that `generateTaskSummary` is not yet called in the announce chain, preserving existing behavior.

- [x] **Verify no regression in `waitForAgentJob(...)` semantics**
  - **Files**: [agent-job.ts](h:\Claw\WinfyliuOpenclaw\openclaw\src\gateway\server-methods\agent-job.ts)
  - **Last updated**: `2026-03-24`
  - **Notes**: Verified that cached snapshot and transient error grace behavior are untouched.

---

## 10. Acceptance gate

- [x] **AC1: one root task per top-level request**
  - **Last updated**: `2026-03-24`
  - **Notes**: Proven by integration tests in `task-control-plane.integration.test.ts`.

- [x] **AC2: root `runId` attached to task**
  - **Last updated**: `2026-03-24`
  - **Notes**: Queryable in ledger via `findTaskByRunId`.

- [x] **AC3: child spawn attached to same task lineage**
  - **Last updated**: `2026-03-24`
  - **Notes**: Proven by integration tests in `task-control-plane.integration.test.ts`.

- [x] **AC4: child completion updates node status**
  - **Last updated**: `2026-03-24`
  - **Notes**: Driven by lifecycle reconciliation in `task-lifecycle-bridge.ts`.

- [x] **AC5: task only completes when descendants settle**
  - **Last updated**: `2026-03-24`
  - **Notes**: Enforced by `recomputeTaskStatus` in `task-ledger.ts`.

- [x] **AC6: failure state recorded correctly**
  - **Last updated**: `2026-03-24`
  - **Notes**: Covered root and child failure paths in `task-lifecycle-bridge.ts` and tests.

- [x] **AC7: task token usage recorded**
  - **Last updated**: `2026-03-24`
  - **Notes**: Included structured accounting in `task-token-accounting.ts`.

- [x] **AC8: token usage display is configurable**
  - **Last updated**: `2026-03-24`
  - **Notes**: Supported via `showTokenUsage` in agent config.

- [x] **AC9: current subagent behavior remains compatible**
  - **Last updated**: `2026-03-24`
  - **Notes**: No user-visible regression, verified by regression protection checks.

- [x] **AC10: checklist kept current during implementation**
  - **Last updated**: `2026-03-24`
  - **Notes**: Checklist updated continuously throughout the implementation.

---

## Blockers / decisions

Use this section to track active blockers.

- [ ] **No active blockers right now**
  - **Last updated**: `2026-03-24`
  - **Notes**: If a blocker appears, replace this item with a concrete blocker entry.

---

## Change log

- **2026-03-24**: Initial checklist created.
- **2026-03-24**: Resumed implementation after interruption; completed task lineage propagation chain (`agent-command` -> embedded run -> tool context -> `sessions_spawn` -> `subagent-spawn`) and synced checklist progress.
- **2026-03-24**: Implemented `task-lifecycle-bridge`, `task-runtime-context`, `task-token-accounting`, and `task-summary` modules. Integrated lifecycle bridge into gateway server startup/shutdown.
- **2026-03-24**: Added unit tests for `task-lifecycle-bridge`, `task-token-accounting`, and `task-summary`.
- **2026-03-24**: Added `showTokenUsage` to agent configuration and implemented optional token footer in `task-summary`.
- **2026-03-24**: Added integration tests for task control plane (`task-control-plane.integration.test.ts`) and verified regression protection. Phase 1 implementation is now complete.
- **2026-03-24**: **Post-merge integration**: Fixed missing imports in `subagent-spawn.ts`, added dual status types to `task-events.ts` to support both Foundation and Business layers. Updated `task-ledger.ts` to use new `TaskLedgerStatus` functions. Documented unified two-layer architecture in `harness-engineering-implementation.md`.
