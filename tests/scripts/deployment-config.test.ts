import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("systemd deployment units", () => {
    for (const unit of [
        "deploy/systemd/basishacks-node.service",
        "deploy/systemd/basishacks-bun.service",
    ]) {
        it(`bounds restarts and keeps hardening in ${unit}`, () => {
            const contents = read(unit);

            expect(contents).toContain("Restart=on-failure");
            expect(contents).toContain("StartLimitIntervalSec=60");
            expect(contents).toContain("StartLimitBurst=5");
            expect(contents).toContain("OnFailure=basishacks-failure@%n.service");
            expect(contents).toContain("ReadWritePaths=-/opt/basishacks/current/HACKATHON.yml");
            expect(contents).toContain("MemoryMax=500000000");
            expect(contents).toContain("NoNewPrivileges=true");
            expect(contents).toContain("/api/health/ready");
        });
    }

    it("schedules verified backups with retention", () => {
        const service = read("deploy/systemd/basishacks-backup.service");
        const timer = read("deploy/systemd/basishacks-backup.timer");

        expect(service).toContain("scripts/backup-postgres.mjs --with-assets");
        expect(service).toContain("BACKUP_RETENTION_DAYS=14");
        expect(service).not.toMatch(/PGPASSWORD|DATABASE_URL=postgres/);
        expect(timer).toContain("Unit=basishacks-backup.service");
        expect(timer).toContain("Persistent=true");
    });

    it("documents the proxy rate limit and forwarded client address", () => {
        const nginx = read("deploy/nginx/basishacks-request-limits.conf");

        expect(nginx).toContain("limit_req_zone");
        expect(nginx).toContain("limit_req zone=basishacks_api");
        expect(nginx).toContain("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
        expect(nginx).toContain("client_body_timeout");
    });
});
