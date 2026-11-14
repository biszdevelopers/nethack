import {
    createImportSmokeDatabase,
    defaultDependencies,
    loadBunSQLite,
    main,
    runIfDirect,
} from "../../scripts/create-import-smoke-db.mjs";
import { fileURLToPath } from "node:url";

function fakeDatabase({ failOnExec } = {}) {
    const state = { paths: [], statements: [], closed: 0 };
    class Database {
        constructor(path) {
            state.paths.push(path);
        }

        exec(statement) {
            state.statements.push(statement);
            if (failOnExec === state.statements.length) throw new Error("fixture SQL failed");
        }

        close() {
            state.closed += 1;
        }
    }
    return {
        state,
        dependencies: {
            loadSQLite: async () => ({ Database }),
            resolvePath: (path) => `/isolated-fixtures/${path}`,
        },
    };
}

describe("SQLite import fixture database generator", () => {
    it("rejects a missing output path before loading SQLite", async () => {
        const fixture = fakeDatabase();
        await expect(
            createImportSmokeDatabase(undefined, [], fixture.dependencies),
        ).rejects.toThrow("Usage: bun scripts/create-import-smoke-db.mjs");
        await expect(
            main(["bun", "scripts/create-import-smoke-db.mjs"], fixture.dependencies),
        ).rejects.toThrow("Usage: bun scripts/create-import-smoke-db.mjs");
        expect(fixture.state).toEqual({ paths: [], statements: [], closed: 0 });
    });

    it("does nothing when imported and runs its entry point when launched directly", async () => {
        const fixture = fakeDatabase();
        const moduleUrl = new URL("../../scripts/create-import-smoke-db.mjs", import.meta.url).href;
        const executablePath = fileURLToPath(moduleUrl);
        await expect(
            runIfDirect(
                moduleUrl,
                undefined,
                ["bun", executablePath, "ignored.sqlite"],
                fixture.dependencies,
            ),
        ).resolves.toBeNull();
        await expect(
            runIfDirect(
                moduleUrl,
                executablePath,
                ["bun", executablePath, "direct.sqlite"],
                fixture.dependencies,
            ),
        ).resolves.toMatchObject({ outputPath: "/isolated-fixtures/direct.sqlite" });
        expect(fixture.state.paths).toEqual(["/isolated-fixtures/direct.sqlite"]);
        expect(fixture.state.closed).toBe(1);
    });

    it("loads bun:sqlite through an injected module loader without opening a real database", async () => {
        let requestedModule;
        class FakeDatabase {
            constructor() {}

            exec() {}

            close() {}
        }
        const injectedModule = await loadBunSQLite(async (specifier) => {
            requestedModule = specifier;
            return { Database: FakeDatabase };
        });
        expect(requestedModule).toBe("bun:sqlite");
        expect(injectedModule.Database).toBe(FakeDatabase);

        await vi.doMock("bun:sqlite", () => ({ Database: FakeDatabase }));
        try {
            const result = await createImportSmokeDatabase("never-created.sqlite", [], {
                ...defaultDependencies,
                resolvePath: (path) => `/isolated-fake/${path}`,
            });
            expect(result).toEqual({
                outputPath: "/isolated-fake/never-created.sqlite",
                populate: false,
                legacy: false,
            });
        } finally {
            vi.doUnmock("bun:sqlite");
        }
    });

    it("creates the current schema only without inserting fixture rows by default", async () => {
        const fixture = fakeDatabase();
        const result = await main(
            ["bun", "scripts/create-import-smoke-db.mjs", "current.sqlite"],
            fixture.dependencies,
        );
        expect(result).toEqual({
            outputPath: "/isolated-fixtures/current.sqlite",
            populate: false,
            legacy: false,
        });
        expect(fixture.state.paths).toEqual(["/isolated-fixtures/current.sqlite"]);
        expect(fixture.state.statements).toHaveLength(1);
        expect(fixture.state.statements[0]).toContain("CREATE TABLE seasons");
        expect(fixture.state.statements[0]).toContain("season_id INTEGER");
        expect(fixture.state.statements[0]).toContain("INSERT INTO hackathon");
        expect(fixture.state.closed).toBe(1);
    });

    it("populates the current schema with season history and representative relationships", async () => {
        const fixture = fakeDatabase();
        const result = await createImportSmokeDatabase(
            "populated.sqlite",
            ["--populate"],
            fixture.dependencies,
        );
        expect(result).toMatchObject({ populate: true, legacy: false });
        expect(fixture.state.statements).toHaveLength(2);
        expect(fixture.state.statements[1]).toContain("Import smoke history team");
        expect(fixture.state.statements[1]).toContain("INSERT INTO ballot_scores");
        expect(fixture.state.statements[1]).toContain("INSERT INTO team_awards");
        expect(fixture.state.statements[1]).toContain("INSERT INTO user_past_teams");
        expect(fixture.state.closed).toBe(1);
    });

    it("builds the legacy schema and preserves legacy identity columns", async () => {
        const fixture = fakeDatabase();
        await createImportSmokeDatabase("legacy.sqlite", ["--legacy"], fixture.dependencies);
        expect(fixture.state.statements).toHaveLength(1);
        expect(fixture.state.statements[0]).not.toContain("CREATE TABLE seasons");
        expect(fixture.state.statements[0]).toContain("id INTEGER PRIMARY KEY AUTOINCREMENT");
        expect(fixture.state.statements[0]).not.toContain("show_scores INTEGER");
        expect(fixture.state.statements[0]).toContain("INSERT INTO hackathon");
        expect(fixture.state.closed).toBe(1);
    });

    it("populates a legacy fixture without duplicate seed rows and retains its historical score identity", async () => {
        const fixture = fakeDatabase();
        await main(
            [
                "bun",
                "scripts/create-import-smoke-db.mjs",
                "legacy-populated.sqlite",
                "--legacy",
                "--populate",
            ],
            fixture.dependencies,
        );
        expect(fixture.state.statements).toHaveLength(2);
        expect(fixture.state.statements[0]).not.toContain("INSERT INTO hackathon");
        expect(fixture.state.statements[1]).toContain("Legacy import team");
        expect(fixture.state.statements[1]).toContain("INSERT INTO team_scores (id, team_id");
        expect(fixture.state.statements[1]).toContain(
            "fixture-one-time-login-code-must-not-import",
        );
        expect(fixture.state.closed).toBe(1);
    });

    it("closes the SQLite fixture when schema creation fails and propagates the failure", async () => {
        const fixture = fakeDatabase({ failOnExec: 1 });
        await expect(
            createImportSmokeDatabase("bad.sqlite", [], fixture.dependencies),
        ).rejects.toThrow("fixture SQL failed");
        expect(fixture.state.statements).toHaveLength(1);
        expect(fixture.state.closed).toBe(1);
    });

    it("closes the SQLite fixture when population fails and propagates the failure", async () => {
        const fixture = fakeDatabase({ failOnExec: 2 });
        await expect(
            createImportSmokeDatabase("bad-populated.sqlite", ["--populate"], fixture.dependencies),
        ).rejects.toThrow("fixture SQL failed");
        expect(fixture.state.statements).toHaveLength(2);
        expect(fixture.state.closed).toBe(1);
    });
});
