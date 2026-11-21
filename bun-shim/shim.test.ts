// Shim executed by `bun test`. The suite is Vitest-only; fail loudly so a
// passing `bun test` can never be mistaken for a passing suite.
import { test, expect } from "bun:test";

test("bun test is not the project test runner", () => {
    console.error("\nThis project uses Vitest. Run: bun run test\n");
    expect("bun test").toBe("unsupported; run bun run test");
});
