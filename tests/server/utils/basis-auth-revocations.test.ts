import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDatabase } from "~~/server/database";
import {
    cleanBasisAccessTokenRevocations,
    isBasisCredentialRevoked,
    recordBasisAccessTokenRevocation,
    recordBasisSubjectLogout,
} from "~~/server/utils/database/basis-auth-revocations";

describe("Basis Auth revocation storage", () => {
    it("queries both cutoffs with the token and session times passed as SQL parameters", async () => {
        const execute = vi.fn().mockResolvedValue([{ revoked: true }]);
        const db = { execute } as unknown as DrizzleDatabase;
        await expect(
            isBasisCredentialRevoked(db, { iss: "issuer", sub: "subject", jti: "jti" }, 100, 200),
        ).resolves.toBe(true);
        const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
        expect(query.params).toEqual(["issuer", "jti", 200, "issuer", "subject", 100]);
        expect(query.sql).toContain('"valid_after" <= $3');
        expect(query.sql).toContain('"issued_at" >= $6');
    });

    it("uses atomic extrema when persisting retried events", async () => {
        const onConflictDoUpdate = vi.fn();
        const values = vi.fn(() => ({ onConflictDoUpdate }));
        const db = { insert: () => ({ values }) } as unknown as DrizzleDatabase;
        await recordBasisAccessTokenRevocation(db, "issuer", "jti", 100, 200);
        await recordBasisSubjectLogout(db, "issuer", "subject", 100);
        expect(values.mock.calls).toEqual([
            [{ issuer: "issuer", jti: "jti", validAfter: 100, retainUntil: 200 }],
            [{ issuer: "issuer", subject: "subject", issuedAt: 100 }],
        ]);
        const dialect = new PgDialect();
        const [revocation, logout] = onConflictDoUpdate.mock.calls.map(([update]) => update.set);
        expect(dialect.sqlToQuery(revocation.validAfter).sql).toContain("least(");
        expect(dialect.sqlToQuery(revocation.retainUntil).sql).toContain("greatest(");
        expect(dialect.sqlToQuery(logout.issuedAt).sql).toContain("greatest(");
    });

    it("deletes only revocations whose retention deadline has arrived", async () => {
        const where = vi.fn();
        const db = { delete: () => ({ where }) } as unknown as DrizzleDatabase;
        await cleanBasisAccessTokenRevocations(db, 300);
        expect(new PgDialect().sqlToQuery(where.mock.calls[0]![0])).toMatchObject({
            sql: '"basis_access_token_revocations"."retain_until" <= $1',
            params: [300],
        });
    });
});
