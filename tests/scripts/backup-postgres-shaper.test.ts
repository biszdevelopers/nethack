import { describe, expect, it } from "vitest";
import {
    backupFileName,
    backupTimestamp,
    main,
    selectExpiredSnapshots,
} from "../../scripts/backup-postgres.mjs";

describe("backup naming and retention", () => {
    it("uses a filesystem-safe UTC timestamp", () => {
        const stamp = backupTimestamp(new Date("2026-11-21T03:15:42.123Z"));
        expect(stamp).toBe("2026-11-21T03-15-42-123Z");
        expect(backupFileName(new Date("2026-11-21T03:15:42.123Z"))).toBe(
            "basishacks-2026-11-21T03-15-42-123Z.dump",
        );
    });

    it("selects only managed snapshots older than the retention window", () => {
        const now = Date.parse("2026-11-21T00:00:00Z");
        const day = 24 * 60 * 60 * 1000;
        const expired = selectExpiredSnapshots(
            [
                { name: "basishacks-old.dump", mtimeMs: now - 20 * day },
                { name: "basishacks-2026-11-20T03-15-00-000Z.dump", mtimeMs: now - 16 * day },
                {
                    name: "basishacks-2026-11-20T03-15-00-000Z.dump.sha256",
                    mtimeMs: now - 16 * day,
                },
                { name: "assets-2026-11-20T03-15-00-000Z.tar.gz", mtimeMs: now - 16 * day },
                { name: "basishacks-recent.dump", mtimeMs: now - day },
                { name: "notes.txt", mtimeMs: now - 30 * day },
            ],
            now,
            14,
        );

        expect(expired).toEqual([
            "basishacks-2026-11-20T03-15-00-000Z.dump",
            "assets-2026-11-20T03-15-00-000Z.tar.gz",
        ]);
    });

    it("keeps everything inside the retention window", () => {
        const now = Date.now();
        expect(
            selectExpiredSnapshots([{ name: "basishacks-a.dump", mtimeMs: now - 1000 }], now, 14),
        ).toEqual([]);
    });
});

describe("backup argument validation", () => {
    const databaseUrl = "postgres://localhost/app";

    it("requires DATABASE_URL", async () => {
        await expect(main([], {})).rejects.toThrow("Set DATABASE_URL");
    });

    it("requires a path after --output", async () => {
        await expect(main(["--output"], { DATABASE_URL: databaseUrl })).rejects.toThrow(
            "Pass a path after --output.",
        );
    });

    it("requires a whole retention day count", async () => {
        await expect(
            main(["--retention-days", "two"], { DATABASE_URL: databaseUrl }),
        ).rejects.toThrow("whole number of days");
    });

    it("refuses a restore without explicit confirmation and a scratch URL", async () => {
        await expect(
            main(["--restore-check", "snapshot.dump"], { DATABASE_URL: databaseUrl }),
        ).rejects.toThrow("--confirm-scratch-restore");

        await expect(
            main(["--restore-check", "snapshot.dump", "--confirm-scratch-restore"], {
                DATABASE_URL: databaseUrl,
            }),
        ).rejects.toThrow("PG_RESTORE_SCRATCH_URL");
    });
});
