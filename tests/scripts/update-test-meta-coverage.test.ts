import { afterEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({ writeFileSync: vi.fn() }));
vi.mock("node:fs", () => ({ writeFileSync: fsMocks.writeFileSync }));

describe("test metadata stream processor", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const run = async (chunks: string[]) => {
        vi.resetModules();
        const initialData = new Set(process.stdin.listeners("data"));
        const initialEnd = new Set(process.stdin.listeners("end"));
        await import("../../scripts/update-test-meta.ts");
        const dataHandlers = process.stdin
            .listeners("data")
            .filter((handler) => !initialData.has(handler));
        const endHandlers = process.stdin
            .listeners("end")
            .filter((handler) => !initialEnd.has(handler));
        for (const chunk of chunks) {
            for (const handler of dataHandlers) (handler as (value: string) => void)(chunk);
        }
        for (const handler of endHandlers) (handler as () => void)();
        for (const handler of dataHandlers) process.stdin.removeListener("data", handler as any);
        for (const handler of endHandlers) process.stdin.removeListener("end", handler as any);
    };

    it("writes the test count, result file count, failure count, and generation time", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        fsMocks.writeFileSync.mockClear();

        await run(['vitest output\n{"numTotalTests":12,"testResults":[{},{}],"numFailedTests":0}']);

        expect(fsMocks.writeFileSync).toHaveBeenCalledOnce();
        const [path, content] = fsMocks.writeFileSync.mock.calls[0];
        expect(path).toMatch(/[\\/]tests[\\/].test-meta.json$/);
        expect(JSON.parse(content)).toMatchObject({ total: 12, files: 2, failed: 0 });
        expect(JSON.parse(content).generatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
        expect(log).toHaveBeenCalledWith("Test meta written: 12 tests, 2 files");
    });

    it("defaults absent counts and treats a non-array result list as zero files", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        fsMocks.writeFileSync.mockClear();

        await run(['{"testResults":null}']);

        expect(JSON.parse(fsMocks.writeFileSync.mock.calls[0][1])).toMatchObject({
            total: 0,
            files: 0,
            failed: 0,
        });
        expect(log).toHaveBeenCalledWith("Test meta written: 0 tests, 0 files");
    });

    it("reports test failures and sets the process exit status", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

        await run(['{"numTotalTests":2,"testResults":[],"numFailedTests":2}']);

        expect(error).toHaveBeenCalledWith("Tests failed: 2 failures");
        expect(exit).toHaveBeenCalledWith(1);
    });

    it.each([{ chunks: [] as string[] }, { chunks: ["not-json"] }])(
        "rejects input without a valid final JSON line",
        async ({ chunks }) => {
            const error = vi.spyOn(console, "error").mockImplementation(() => {});
            const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

            await run(chunks);

            expect(error).toHaveBeenCalledWith("Failed to generate test meta:", expect.any(Error));
            expect(exit).toHaveBeenCalledWith(1);
        },
    );
});
