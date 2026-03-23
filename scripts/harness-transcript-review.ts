import { promises as fs } from "node:fs";
import path from "node:path";
import { gradeTranscript, parseTranscriptJsonl } from "../src/agents/transcript-grading.js";

type ReviewOutput = {
  reviewedAt: string;
  transcriptPath: string;
  grade: ReturnType<typeof gradeTranscript>;
};

async function main(): Promise<void> {
  const transcriptPath = process.argv[2];
  if (!transcriptPath) {
    throw new Error(
      "Usage: node --import tsx scripts/harness-transcript-review.ts <transcript-jsonl-path>",
    );
  }
  const content = await fs.readFile(transcriptPath, "utf8");
  const grade = gradeTranscript(parseTranscriptJsonl(content));
  const outDir = path.join(process.cwd(), ".local", "harness-review");
  await fs.mkdir(outDir, { recursive: true });
  const output: ReviewOutput = {
    reviewedAt: new Date().toISOString(),
    transcriptPath,
    grade,
  };
  const filePath = path.join(outDir, `transcript-grade-${Date.now()}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`Transcript grade written: ${filePath}\n`);
  process.stdout.write(
    `Score=${grade.score} plan=${grade.metrics.planSignal} verify=${grade.metrics.verificationSignal}\n`,
  );
}

await main();
