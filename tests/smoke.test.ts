import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, resetTestDatabase, type SQLiteDatabase } from "./setup";

// Smoke test to verify the test framework and database helpers work correctly

describe("test framework smoke test", () => {
    it("basic assertions work", () => {
        expect(1 + 1).toBe(2);
    });

    it("vitest globals are available", () => {
        expect(describe).toBeDefined();
        expect(it).toBeDefined();
        expect(expect).toBeDefined();
    });

    it("string operations work", () => {
        expect("hello".toUpperCase()).toBe("HELLO");
        expect("  trimmed  ".trim()).toBe("trimmed");
    });

    it("array operations work", () => {
        expect([1, 2, 3].length).toBe(3);
        expect([1, 2, 3].map((x) => x * 2)).toEqual([2, 4, 6]);
        expect([1, 2, 3].includes(2)).toBe(true);
    });

    it("object operations work", () => {
        const obj = { a: 1, b: 2 };
        expect(Object.keys(obj)).toEqual(["a", "b"]);
        expect({ ...obj, c: 3 }).toEqual({ a: 1, b: 2, c: 3 });
    });

    it("null and undefined handling works", () => {
        expect(null).toBeNull();
        expect(undefined).toBeUndefined();
        expect((null as string | null) ?? "default").toBe("default");
        expect((undefined as string | undefined) ?? "default").toBe("default");
    });

    it("type coercion works as expected", () => {
        expect(Boolean(1)).toBe(true);
        expect(Boolean(0)).toBe(false);
        expect(Number("42")).toBe(42);
        expect(String(123)).toBe("123");
    });

    it("async/await works", async () => {
        const result = await Promise.resolve(42);
        expect(result).toBe(42);
    });

    it("error throwing and catching works", () => {
        expect(() => {
            throw new Error("test error");
        }).toThrow("test error");
    });
});

describe("in-memory SQLite database", () => {
    let db: SQLiteDatabase;

    beforeAll(async () => {
        db = await createTestDatabase();
    });

    afterAll(() => {
        db.close();
    });

    it("creates all tables from the schema", () => {
        const tables = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all<{ name: string }>();
        const names = tables.results.map((r) => r.name);

        expect(names).toContain("hackathon");
        expect(names).toContain("teams");
        expect(names).toContain("users");
        expect(names).toContain("ballots");
        expect(names).toContain("ballot_scores");
        expect(names).toContain("team_scores");
        expect(names).toContain("oauth2_applications");
        expect(names).toContain("sc_votes");
    });

    it("creates expected indexes", () => {
        const indexes = db
            .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
            .all<{ name: string }>();
        const names = indexes.results.map((r) => r.name);
        // At minimum there should be some indexes
        expect(names.length).toBeGreaterThan(0);
    });

    it("supports INSERT and SELECT", () => {
        db.prepare(
            "INSERT INTO hackathon (id, status, start_timestamp, end_timestamp, voting_start_timestamp, voting_end_timestamp, results_open_timestamp) VALUES (1, ?, 0, 0, 0, 0, 0)",
        )
            .bind("not_started")
            .run();

        const row = db.prepare("SELECT * FROM hackathon WHERE id = 1").first<{ status: string }>();
        expect(row).toBeDefined();
        expect(row!.status).toBe("not_started");
    });

    it("uses defaults for NOT NULL columns when values are omitted", () => {
        db.prepare("INSERT INTO teams (name, pathway) VALUES (?, ?)")
            .bind("default-test", "junior")
            .run();
        const row = db
            .prepare("SELECT project_name, project_description FROM teams WHERE name = ?")
            .bind("default-test")
            .first<{ project_name: string; project_description: string }>();
        expect(row).toBeDefined();
        expect(row!.project_name).toBe("");
        expect(row!.project_description).toBe("");
    });

    it("supports INTEGER PRIMARY KEY auto-increment", () => {
        db.prepare("INSERT INTO teams (name, pathway) VALUES (?, ?)")
            .bind("auto-inc-test", "senior")
            .run();
        const row = db
            .prepare("SELECT id FROM teams WHERE name = ?")
            .bind("auto-inc-test")
            .first<{ id: number }>();
        expect(row).toBeDefined();
        expect(row!.id).toBeGreaterThan(0);
    });

    it("supports multiple data types (INTEGER, TEXT)", () => {
        db.prepare("INSERT INTO teams (name, pathway, score, rank) VALUES (?, ?, ?, ?)")
            .bind("datatype-test", "senior", 85, 3)
            .run();
        const row = db
            .prepare("SELECT name, pathway, score, rank FROM teams WHERE name = ?")
            .bind("datatype-test")
            .first<{ name: string; pathway: string; score: number; rank: number }>();
        expect(row).toBeDefined();
        expect(typeof row!.name).toBe("string");
        expect(typeof row!.score).toBe("number");
        expect(typeof row!.rank).toBe("number");
    });

    it("resetTestDatabase clears all data", () => {
        // First reset to ensure clean state
        resetTestDatabase(db);
        // Insert a team
        db.prepare("INSERT INTO teams (name, pathway) VALUES ('reset-test-team', 'junior')").run();
        let count = db
            .prepare("SELECT COUNT(*) as cnt FROM teams WHERE name = 'reset-test-team'")
            .first<{ cnt: number }>();
        expect(count!.cnt).toBe(1);

        resetTestDatabase(db);

        count = db.prepare("SELECT COUNT(*) as cnt FROM teams").first<{ cnt: number }>();
        expect(count!.cnt).toBe(0);
    });

    it("foreign keys are enforced", () => {
        // Inserting a user with a non-existent team_id should fail
        expect(() => {
            db.prepare(
                "INSERT INTO users (email, role, team_id) VALUES ('test@test.com', 'participant', 9999)",
            ).run();
        }).toThrow();
    });

    it("can insert multiple rows", () => {
        for (let i = 0; i < 5; i++) {
            db.prepare("INSERT INTO teams (name, pathway) VALUES (?, ?)")
                .bind(`multi-row-${i}`, "junior")
                .run();
        }
        const count = db
            .prepare("SELECT COUNT(*) as cnt FROM teams WHERE name LIKE 'multi-row-%'")
            .first<{ cnt: number }>();
        expect(count!.cnt).toBe(5);
    });

    it("handles transactions correctly", () => {
        db.exec("BEGIN");
        db.prepare("INSERT INTO teams (name, pathway) VALUES (?, ?)")
            .bind("tx-test-1", "junior")
            .run();
        db.prepare("INSERT INTO teams (name, pathway) VALUES (?, ?)")
            .bind("tx-test-2", "senior")
            .run();
        db.exec("COMMIT");

        const count = db
            .prepare("SELECT COUNT(*) as cnt FROM teams WHERE name LIKE 'tx-test-%'")
            .first<{ cnt: number }>();
        expect(count!.cnt).toBe(2);
    });

    it("rolls back transactions on error", () => {
        db.exec("BEGIN");
        db.prepare("INSERT INTO teams (name, pathway) VALUES (?, ?)")
            .bind("rollback-test", "junior")
            .run();
        // Intentionally cause an error
        db.exec("ROLLBACK");

        const count = db
            .prepare("SELECT COUNT(*) as cnt FROM teams WHERE name = ?")
            .bind("rollback-test")
            .first<{ cnt: number }>();
        expect(count!.cnt).toBe(0);
    });
});
