---
summary: "Transcript grading loop for Harness quality drift detection"
title: Harness Transcript Grading
read_when:
  - You need to run transcript quality reviews for async/session scenarios
  - You need to monitor plan/verification/completion quality drift over time
status: active
---

# Harness Transcript Grading

Use this loop to sample real transcript JSONL sessions and track quality drift for Harness flows.

## Signals scored

- Plan signal present
- Verification signal present
- Blocked to resume recovery signal present
- Completion clarity signal present

The scoring utility is implemented in `src/agents/transcript-grading.ts`.

## Run the capability eval suite

Run baseline scenario grading checks:

```bash
pnpm test:harness:capability-eval
```

This verifies core async/session scenarios and exits non-zero when a scenario falls below threshold.

## Run the Harness regression suite

Run the curated Harness regression pack:

```bash
pnpm test:harness:regression
```

Use this command as a release-candidate gate for Harness changes.

## Grade a sampled transcript

```bash
pnpm test:harness:transcript-review -- ~/.openclaw/sessions/<session-id>.jsonl
```

The review writes a JSON artifact under `.local/harness-review/` with score, metrics, and evidence.

## Suggested operating cadence

- Sample at least 10 transcripts per week across core async/session flows.
- Track rolling average score and fail-fast on sudden drops.
- Investigate any transcript with score below 75.

## Related docs

- [Harness Engineering Execution Checklist](/concepts/harness-engineering-openclaw-execution-checklist)
- [Harness Engineering Review](/concepts/harness-engineering-openclaw-review)
