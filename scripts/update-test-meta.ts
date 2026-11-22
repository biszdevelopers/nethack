import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const metaPath = resolve(repoRoot, "tests", ".test-meta.json");

function finish(input: string) {
    try {
        const lines = input.trim().split("\n");
        const lastLine = lines[lines.length - 1];
        if (!lastLine) throw new Error("No JSON output found");
        const result = JSON.parse(lastLine);
        const failedTests = (result.testResults ?? []).flatMap((file: any) =>
            (file.assertionResults ?? [])
                .filter((assertion: any) => assertion.status === "failed")
                .map((assertion: any) => `${file.name} › ${assertion.fullName}`),
        );
        const meta = {
            total: result.numPassedTests ?? result.numTotalTests ?? 0,
            files: Array.isArray(result.testResults) ? result.testResults.length : 0,
            failed: result.numFailedTests ?? 0,
            skipped: result.numPendingTests ?? 0,
            generatedAt: new Date().toISOString(),
        };
        const failedSuites = result.numFailedTestSuites ?? 0;
        writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
        if (meta.failed > 0 || failedSuites > 0) {
            console.error(
                meta.failed > 0
                    ? `Tests failed: ${meta.failed} failures`
                    : `Test suites failed: ${failedSuites}`,
            );
            for (const failure of failedTests) {
                console.error(`Failed test: ${failure}`);
            }
            process.exit(1);
        }
        console.log(`Test meta written: ${meta.total} tests, ${meta.files} files`);
    } catch (err) {
        console.error("Failed to generate test meta:", err);
        process.exit(1);
    }
}

// Vitest's JSON reporter writes a file when an output path is supplied.
const reportPath = process.argv[2];
if (reportPath) {
    try {
        finish(readFileSync(resolve(reportPath), "utf8"));
    } catch (err) {
        console.error("Failed to generate test meta:", err);
        process.exit(1);
    }
} else {
    let input = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
        input += chunk;
    });
    process.stdin.on("end", () => finish(input));
}
