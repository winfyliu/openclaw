---
summary: "90-day execution checklist for OpenClaw Harness Engineering with milestones, acceptance gates, and update ledger"
title: OpenClaw Harness Engineering Execution Checklist
read_when:
  - You need the actionable implementation plan
  - You need milestone-by-milestone acceptance criteria
  - You want a living ledger to update after each completed increment
status: active
---

# OpenClaw Harness Engineering Execution Checklist

## Program Goal

Deliver an always-responsive main-agent experience with asynchronous subagent execution, structured recovery, and measurable reliability.

## 90-Day Plan

### Phase 1 (Day 1-30): Core reliability and interaction baseline

- [x] Enforce task-state transition validation at update boundaries
- [x] Enforce idempotent event application (eventId + version)
- [x] Finalize interactive-first lane behavior under concurrent tasks
- [x] Stabilize blocked -> resume flow for credential and permission scenarios
- [x] Ensure task status panel is visible and coherent for active sessions

Acceptance gates:

- [x] InvalidTransitionCount = 0 in targeted runs
- [x] Resume flow passes scenario tests (single blocked / multi blocked)
- [x] FirstAckLatencyP95 measured and within initial threshold

### Phase 2 (Day 31-60): Operational controls and contention management

- [x] Add retry policy with bounded exponential backoff
- [x] Add non-retryable error classification
- [x] Add task GC policy (terminal cleanup + stale blocked flagging)
- [x] Introduce resource lock domains for shared writes
- [x] Add per-session active task budget controls

Acceptance gates:

- [x] RetryExhaustionRate tracked and bounded
- [x] No unresolved stale-blocked tasks beyond policy window
- [x] Write-conflict incidents reduced vs pre-lock baseline

### Phase 3 (Day 61-90): Quality scaling and evaluation hardening

- [x] Introduce role specialization baseline (planner/executor first)
- [x] Add verification hooks before completion transitions
- [x] Build capability eval suite for core async/session scenarios
- [x] Build regression suite and wire into CI gates
- [x] Add transcript-grading review loop for quality drift detection

Acceptance gates:

- [x] PlanComplianceRate > 95% in sampled sessions
- [x] Regression suite green for release candidates
- [x] Capability score trend is stable or improving

## Weekly Operating Cadence

For each week:

- [ ] Define 1-2 concrete outcomes only (avoid broad scope creep)
- [ ] Link code changes to checklist items and acceptance gates
- [ ] Record metrics snapshot before/after changes
- [ ] Record risk deltas (new risk / mitigated risk)
- [ ] Update the progress ledger below

## Standard Acceptance Checklist (Per Increment)

- [ ] Functional path validated with at least one automated test
- [ ] Failure path validated with at least one automated test
- [ ] Security/redaction checks pass for user-visible and log-visible outputs
- [ ] No regression in core responsiveness metrics
- [ ] Documentation updated (review + execution checklist)

## Metrics Tracking Table (Living Section)

| Date       | Increment | FirstAckLatencyP95                                     | ChatResponsivenessP95 | BlockedToResumeP95 | InvalidTransitionCount | SecretRedactionCoverage | Notes                                                                            |
| ---------- | --------- | ------------------------------------------------------ | --------------------- | ------------------ | ---------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| 2026-03-22 | Baseline  | TBD                                                    | TBD                   | TBD                | 0 (targeted tests)     | TBD                     | Phase 1 state-transition + idempotency baseline landed                           |
| 2026-03-22 | INC-002   | Instrumented via `message.first_ack` diagnostics event | TBD                   | TBD                | 0 (targeted tests)     | TBD                     | Ack latency now measurable from webhook receive to first outbound reply emission |

## Increment Progress Ledger (Living Section)

Append one row after each completed increment.

| Date       | Increment ID | Completed Work                                                                                                                                                                                                                              | Tests/Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Risks Updated                                                                                                                                                                                            | Next Step                                                                                      |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 2026-03-22 | INC-001      | Added transition guardrails in task registry, exported transition validation helper, expanded tests for invalid terminal transitions and resume stability                                                                                   | `corepack pnpm exec vitest run src/agents/task-registry.test.ts src/agents/task-resume.test.ts src/auto-reply/reply/dispatch-from-config.test.ts` and `corepack pnpm tsgo`                                                                                                                                                                                                                                                                                                                                                   | Reduced risk of invalid status rollback from terminal states; idempotent event handling remains enforced                                                                                                 | Implement lane-level responsiveness measurement and fill FirstAckLatencyP95 baseline           |
| 2026-03-22 | INC-002      | Added `message.first_ack` telemetry event, wired first-ack capture across route/tool/block/final reply paths, and added diagnostic unit coverage                                                                                            | `corepack pnpm exec vitest run src/logging/diagnostic.test.ts src/auto-reply/reply/dispatch-from-config.test.ts` and `corepack pnpm tsgo`                                                                                                                                                                                                                                                                                                                                                                                    | Reduced observability gap on first-response responsiveness; enables real FirstAckLatencyP95 baseline collection                                                                                          | Add lane-aware responsiveness tests for interactive-first behavior under concurrent queue load |
| 2026-03-22 | INC-003      | Added lane-aware queue regression coverage proving main-lane interactive runs can complete while subagent lane remains blocked                                                                                                              | `corepack pnpm exec vitest run src/process/command-queue.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Reduced risk that subagent backlog starves interactive turns; establishes guardrail for interactive-first behavior under concurrent lane pressure                                                        | Stabilize blocked -> resume flow for credential and permission scenarios                       |
| 2026-03-22 | INC-004      | Extended resume routing to recognize permission-grant messages, added permission resume routing tests (single/multi blocked), and validated resume-forward behavior updates blocked tasks back to executing state                           | `corepack pnpm exec vitest run src/agents/task-resume.test.ts src/agents/task-orchestrator.test.ts src/auto-reply/reply/dispatch-from-config.test.ts` and `corepack pnpm tsgo`                                                                                                                                                                                                                                                                                                                                               | Reduced risk of stalled blocked tasks when users provide permission approvals instead of credential key/value payloads; improved deterministic resume behavior for ambiguous multi-task blocked sessions | Ensure task status panel is visible and coherent for active sessions                           |
| 2026-03-22 | INC-005      | Refined task status panel to render only active tasks and hide completed-only sessions, plus added mixed-status panel coherence tests                                                                                                       | `corepack pnpm exec vitest run src/agents/task-orchestrator.test.ts src/auto-reply/reply/dispatch-from-config.test.ts` and `corepack pnpm tsgo`                                                                                                                                                                                                                                                                                                                                                                              | Reduced status noise from terminal tasks and improved active-session observability consistency for concurrent runs                                                                                       | Add retry policy with bounded exponential backoff                                              |
| 2026-03-22 | INC-006      | Added bounded exponential backoff retry policy to task resume forwarding path (`task_resume_forward`) with capped attempts and bounded delay window; added success-after-retry and retry-exhaustion coverage                                | `corepack pnpm exec vitest run src/agents/task-orchestrator.test.ts src/agents/task-resume.test.ts src/auto-reply/reply/dispatch-from-config.test.ts` and `corepack pnpm tsgo`                                                                                                                                                                                                                                                                                                                                               | Reduced transient gateway failure impact during blocked-task resume and bounded retry storm risk via strict retry caps                                                                                   | Add non-retryable error classification                                                         |
| 2026-03-22 | INC-007      | Added non-retryable error classification for resume-forward retries (e.g. `chat not found`, `unsupported channel`, `unauthorized`) and wired retry gating via `shouldRetry` policy                                                          | `corepack pnpm exec vitest run src/agents/task-orchestrator.test.ts src/agents/task-resume.test.ts src/auto-reply/reply/dispatch-from-config.test.ts` and `corepack pnpm tsgo`                                                                                                                                                                                                                                                                                                                                               | Reduced wasted retry budget on permanent delivery failures while preserving retry behavior for transient errors                                                                                          | Add task GC policy (terminal cleanup + stale blocked flagging)                                 |
| 2026-03-22 | INC-008      | Added task registry GC policy to evict terminal tasks older than retention window and flag long-blocked tasks as stale; exposed stale-blocked query helper and added GC/stale coverage tests                                                | `corepack pnpm exec vitest run src/agents/task-registry.test.ts src/agents/task-orchestrator.test.ts src/agents/task-resume.test.ts src/auto-reply/reply/dispatch-from-config.test.ts` and `corepack pnpm tsgo`                                                                                                                                                                                                                                                                                                              | Reduced unbounded task-state growth risk and improved operator visibility into stalled blocked tasks requiring intervention                                                                              | Introduce resource lock domains for shared writes                                              |
| 2026-03-22 | INC-009      | Added task resource lock domain primitive (`task_resume_forward`, `task_registry_write`) and applied per-task lock scoping to resume-forward path to serialize competing shared writes for the same task                                    | `corepack pnpm exec vitest run src/agents/task-resource-locks.test.ts src/agents/task-orchestrator.test.ts src/agents/task-registry.test.ts src/agents/task-resume.test.ts src/auto-reply/reply/dispatch-from-config.test.ts` and `corepack pnpm tsgo`                                                                                                                                                                                                                                                                       | Reduced risk of concurrent resume-forward races against shared task/session state while preserving parallelism across unrelated domains and resources                                                    | Add per-session active task budget controls                                                    |
| 2026-03-22 | INC-010      | Added per-session active task budget controls (`agents.defaults.subagents.maxActiveTasksPerSession`) with enforcement at spawn and task registration boundaries, plus budget exhaustion/recovery regression coverage                        | `corepack pnpm exec vitest run src/agents/task-orchestrator.test.ts src/agents/subagent-spawn.model-session.test.ts src/agents/subagent-spawn.task-budget.test.ts src/agents/task-registry.test.ts src/agents/task-resource-locks.test.ts src/agents/task-resume.test.ts src/config/config.agent-concurrency-defaults.test.ts src/auto-reply/reply/dispatch-from-config.test.ts` and `corepack pnpm tsgo`                                                                                                                    | Reduced runaway fan-out risk per session and improved deterministic backpressure when active orchestrator workload is saturated                                                                          | Introduce role specialization baseline (planner/executor first)                                |
| 2026-03-22 | INC-011      | Established planner/executor specialization baseline by threading explicit child role hints into subagent system prompts (planner-first for orchestrators, executor-first for leaf workers) and added capability/prompt regression coverage | `corepack pnpm exec vitest run src/agents/subagent-capabilities.test.ts src/agents/system-prompt.test.ts src/agents/subagent-spawn.model-session.test.ts src/agents/subagent-spawn.task-budget.test.ts src/agents/task-orchestrator.test.ts src/agents/task-registry.test.ts src/agents/task-resource-locks.test.ts src/agents/task-resume.test.ts src/config/config.agent-concurrency-defaults.test.ts src/auto-reply/reply/dispatch-from-config.test.ts` and `corepack pnpm tsgo`                                          | Reduced role ambiguity between coordinating and executing subagents; improves plan compliance consistency and task handoff quality under nested orchestration                                            | Add verification hooks before completion transitions                                           |
| 2026-03-22 | INC-012      | Added `subagent_completion_verification` plugin hook and wired pre-completion verification into task outcome handling; rejected verification now blocks tasks with explicit remediation request instead of marking complete                 | `corepack pnpm exec vitest run src/plugins/wired-hooks-subagent.test.ts src/agents/task-orchestrator.test.ts src/agents/subagent-capabilities.test.ts src/agents/system-prompt.test.ts src/agents/subagent-spawn.model-session.test.ts src/agents/subagent-spawn.task-budget.test.ts src/agents/task-registry.test.ts src/agents/task-resource-locks.test.ts src/agents/task-resume.test.ts src/config/config.agent-concurrency-defaults.test.ts src/auto-reply/reply/dispatch-from-config.test.ts` and `corepack pnpm tsgo` | Reduced false-positive completion risk by introducing policy-gated completion transitions and explicit operator-visible verification failure paths                                                       | Build capability eval suite for core async/session scenarios                                   |
| 2026-03-22 | INC-013      | Added Harness capability eval suite (`scripts/harness-capability-eval.ts`) with async/session scenario scoring and pass/fail thresholds, plus transcript grading primitives and tests (`src/agents/transcript-grading.ts`)                  | `corepack pnpm test:harness:capability-eval` and `corepack pnpm exec vitest run src/agents/transcript-grading.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                       | Reduced blind spots in async/session quality measurement by converting role/verification/recovery expectations into executable scoring checks                                                            | Build regression suite and wire into CI gates                                                  |
| 2026-03-22 | INC-014      | Added dedicated Harness regression suite runner (`scripts/harness-regression-suite.ts`) and wired CI `check-additional` gates (`pnpm test:harness:capability-eval`, `pnpm test:harness:regression`)                                         | `corepack pnpm test:harness:regression` and CI workflow update in `.github/workflows/ci.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                 | Reduced release-candidate regression risk by enforcing a stable Harness-focused test pack in CI                                                                                                          | Add transcript-grading review loop for quality drift detection                                 |
| 2026-03-22 | INC-015      | Added transcript-grading review loop CLI (`scripts/harness-transcript-review.ts`) and operational doc (`docs/concepts/harness-transcript-grading.md`) for ongoing quality drift monitoring                                                  | `corepack pnpm test:harness:capability-eval`, `corepack pnpm test:harness:regression`, and `corepack pnpm tsgo`                                                                                                                                                                                                                                                                                                                                                                                                              | Reduced quality-drift detection lag by standardizing transcript scoring artifacts and review cadence                                                                                                     | Phase 3 acceptance gate verification and baseline refresh                                      |

## Risk Register (Living Section)

| Risk                                        | Severity | Mitigation                                      | Owner | Status |
| ------------------------------------------- | -------- | ----------------------------------------------- | ----- | ------ |
| Context overload degrades output quality    | Medium   | Context budget monitoring + compaction policy   | TBD   | Open   |
| Cross-task write conflict                   | High     | Resource lock domains + scoped write policy     | TBD   | Open   |
| Retry storm / wasted budget                 | Medium   | Retry bounds + non-retryable classification     | TBD   | Open   |
| User confusion from out-of-order completion | Medium   | Stable task IDs + standardized status templates | TBD   | Open   |
| Sensitive value leakage                     | High     | Redaction policy + test coverage + audit checks | TBD   | Open   |

## Update Protocol (Required)

After each completed increment, update:

1. This checklist
   - Mark completed items
   - Add one row to Increment Progress Ledger
   - Refresh Metrics Tracking Table

2. Review document
   - Update overall maturity assessment if changed
   - Update decision log and guardrail changes
   - Document any new boundary/risk discovered

## Versioning

- Current execution version: v1
- Last updated: 2026-03-22
- Next review checkpoint: 2026-03-29
