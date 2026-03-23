import { gradeTranscript, parseTranscriptJsonl } from "../src/agents/transcript-grading.js";

type EvalScenario = {
  id: string;
  transcriptJsonl: string;
  minScore: number;
};

const scenarios: EvalScenario[] = [
  {
    id: "async-lane-responsiveness",
    minScore: 75,
    transcriptJsonl: [
      JSON.stringify({
        role: "assistant",
        text: "Plan: prioritize interactive lane and isolate subagent backlog.",
      }),
      JSON.stringify({
        role: "assistant",
        text: "Validated queue behavior and verified main-lane responsiveness.",
      }),
      JSON.stringify({ role: "assistant", text: "Completed with clear status summary." }),
    ].join("\n"),
  },
  {
    id: "blocked-resume-credentials",
    minScore: 75,
    transcriptJsonl: [
      JSON.stringify({
        role: "assistant",
        text: "Plan: request scoped credentials, then resume and verify completion.",
      }),
      JSON.stringify({ role: "assistant", text: "Task is blocked pending credentials." }),
      JSON.stringify({
        role: "assistant",
        text: "Received credentials and resume path is active. Verified completion checks and finalized output.",
      }),
    ].join("\n"),
  },
  {
    id: "session-task-budget-backpressure",
    minScore: 75,
    transcriptJsonl: [
      JSON.stringify({
        role: "assistant",
        text: "Plan: enforce per-session active task budget before spawn.",
      }),
      JSON.stringify({
        role: "assistant",
        text: "Blocked extra spawn, then resume capacity after task completion and validated recovery.",
      }),
      JSON.stringify({
        role: "assistant",
        text: "Completed with explicit budget evidence and next-step notes.",
      }),
    ].join("\n"),
  },
];

let failed = 0;
let totalScore = 0;
for (const scenario of scenarios) {
  const grade = gradeTranscript(parseTranscriptJsonl(scenario.transcriptJsonl));
  totalScore += grade.score;
  const status = grade.score >= scenario.minScore ? "PASS" : "FAIL";
  if (status === "FAIL") {
    failed += 1;
  }
  process.stdout.write(
    `${status} ${scenario.id}: score=${grade.score} min=${scenario.minScore} plan=${grade.metrics.planSignal} verify=${grade.metrics.verificationSignal} blockedRecovery=${grade.metrics.blockedRecoverySignal} clear=${grade.metrics.completionClaritySignal}\n`,
  );
}

const averageScore = Math.round(totalScore / scenarios.length);
process.stdout.write(`Capability eval average score: ${averageScore}\n`);
if (failed > 0) {
  process.stderr.write(
    `Capability eval failed (${failed}/${scenarios.length} scenarios below threshold).\n`,
  );
  process.exit(1);
}
