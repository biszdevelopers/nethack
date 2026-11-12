import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const metaPath = resolve(repoRoot, "tests", ".test-meta.json");

// Read stdin which receives the JSON report from vitest
let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
    input += chunk;
});
process.stdin.on("end", () => {
    try {
        const lines = input.trim().split("\n");
        const lastLine = lines[lines.length - 1];
        if (!lastLine) throw new Error("No JSON output found");
        const result = JSON.parse(lastLine);
        const meta = {
            total: result.numTotalTests ?? 0,
            files: Array.isArray(result.testResults) ? result.testResults.length : 0,
            failed: result.numFailedTests ?? 0,
            generatedAt: new Date().toISOString(),
        };
        writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
        if (meta.failed > 0) {
            console.error(`Tests failed: ${meta.failed} failures`);
            process.exit(1);
        }
        console.log(`Test meta written: ${meta.total} tests, ${meta.files} files`);
    } catch (err) {
        console.error("Failed to generate test meta:", err);
        process.exit(1);
    }
});
