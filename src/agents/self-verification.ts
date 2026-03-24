import * as fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export type VerificationScenario =
  | "critical" // Production deployment, data migration
  | "standard" // Code development, feature implementation
  | "exploratory" // Research, analysis, exploration
  | "cleanup"; // Cleanup, refactoring

export type VerificationPolicy = {
  runVerification: boolean;
  required: boolean;
  defaultChecks: Array<"file_exists" | "test_passes" | "schema_valid" | "no_errors">;
  maxRetries: number;
};

export const SCENARIO_POLICIES: Record<VerificationScenario, VerificationPolicy> = {
  critical: {
    runVerification: true,
    required: true,
    defaultChecks: ["file_exists", "test_passes", "schema_valid", "no_errors"],
    maxRetries: 3,
  },
  standard: {
    runVerification: true,
    required: false,
    defaultChecks: ["file_exists", "test_passes"],
    maxRetries: 2,
  },
  exploratory: {
    runVerification: false,
    required: false,
    defaultChecks: [],
    maxRetries: 1,
  },
  cleanup: {
    runVerification: true,
    required: false,
    defaultChecks: ["no_errors"],
    maxRetries: 1,
  },
};

export type VerificationCheck = {
  type: "file_exists" | "test_passes" | "schema_valid" | "no_errors" | "custom";
  params: Record<string, unknown>;
  required?: boolean; // Overrides policy if set
};

export type VerificationResult = {
  check: VerificationCheck;
  passed: boolean;
  message: string;
  severity?: "critical" | "warning"; // Added severity
};

export function inferVerificationScenario(taskDescription: string): VerificationScenario {
  const lower = taskDescription.toLowerCase();
  if (lower.includes("deploy") || lower.includes("production") || lower.includes("migration") || lower.includes("release")) {
    return "critical";
  }
  if (lower.includes("research") || lower.includes("analyze") || lower.includes("investigate") || lower.includes("explore")) {
    return "exploratory";
  }
  if (lower.includes("clean") || lower.includes("refactor") || lower.includes("format") || lower.includes("lint")) {
    return "cleanup";
  }
  return "standard";
}

export async function runVerification(
  checks: VerificationCheck[],
  scenario: VerificationScenario = "standard",
): Promise<VerificationResult[]> {
  const policy = SCENARIO_POLICIES[scenario];

  if (!policy.runVerification) {
    return []; // Skip verification for this scenario
  }

  const results: VerificationResult[] = [];

  for (const check of checks) {
    const result = await runSingleCheck(check);
    
    const isRequired = check.required ?? policy.required;
    result.severity = isRequired ? "critical" : "warning";

    results.push(result);

    // Fail fast on required checks
    if (!result.passed && isRequired) {
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
      if (!logs || !Array.isArray(logs)) {
          return { check, passed: true, message: "No logs provided for check" };
      }
      const hasErrors = logs.some((l) => l.includes("ERROR") || l.includes("FAIL"));
      return {
        check,
        passed: !hasErrors,
        message: hasErrors ? "Errors found in logs" : "No errors in logs",
      };
    }

    case "custom": {
        if (check.params.command && typeof check.params.command === 'string') {
            const result = await runTest(check.params.command);
            return {
                check,
                passed: result.success,
                message: result.success ? "Custom check passed" : `Custom check failed: ${result.output?.slice(0, 200)}`
            };
        }
        return {
            check,
            passed: true,
            message: "Custom check skipped (no command provided)",
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
  const failedResults = results.filter((r) => !r.passed);
  
  if (failedResults.length === 0) {
      return "✅ Verification Passed";
  }

  const criticalFailures = failedResults.filter(r => r.severity === "critical");
  const warningFailures = failedResults.filter(r => r.severity === "warning");

  let report = "";
  
  if (criticalFailures.length > 0) {
      report += `❌ Critical Failures (${criticalFailures.length}):\n`;
      report += criticalFailures.map(r => `  • ${r.check.type}: ${r.message}`).join("\n");
  }

  if (warningFailures.length > 0) {
      if (report) report += "\n\n";
      report += `⚠️ Warnings (${warningFailures.length}):\n`;
      report += warningFailures.map(r => `  • ${r.check.type}: ${r.message}`).join("\n");
  }

  return report;
}

// Helper functions for checks
async function checkFileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function runTest(command: string): Promise<{ success: boolean; output?: string }> {
  try {
    const { stdout, stderr } = await execAsync(command);
    return { success: true, output: stdout };
  } catch (error: any) {
    return { success: false, output: error.message || error.stderr || String(error) };
  }
}

function validateSchema(data: any, schema: any): boolean {
  // Basic mock implementation for schema validation
  // In a real implementation, this would use a library like ajv or zod
  if (!data || !schema) return false;
  return true;
}
