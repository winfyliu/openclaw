import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testFiles = [
  "src/agents/task-orchestrator.test.ts",
  "src/agents/task-registry.test.ts",
  "src/agents/task-resume.test.ts",
  "src/agents/task-resource-locks.test.ts",
  "src/plugins/wired-hooks-subagent.test.ts",
  "src/agents/system-prompt.test.ts",
  "src/agents/subagent-capabilities.test.ts",
  "src/agents/transcript-grading.test.ts",
  "src/auto-reply/reply/dispatch-from-config.test.ts",
  "src/process/command-queue.test.ts",
  "src/logging/diagnostic.test.ts",
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const vitestEntrypoint = path.join(scriptDir, "..", "node_modules", "vitest", "vitest.mjs");

const run = spawnSync(process.execPath, [vitestEntrypoint, "run", ...testFiles], {
  stdio: "inherit",
  env: process.env,
});

if (run.error) {
  process.stderr.write(`Harness regression runner failed to start: ${run.error.message}\n`);
  process.exit(1);
}

if (run.status !== 0) {
  process.stderr.write(
    `Harness regression runner failed with status=${run.status ?? -1} signal=${run.signal ?? "none"}\n`,
  );
  process.exit(run.status ?? 1);
}
