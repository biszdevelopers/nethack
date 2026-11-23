import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const apiDir = resolve(import.meta.dirname, "..", "..", "server", "api");

function routeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return routeFiles(full);
        return name.endsWith(".ts") ? [relative(apiDir, full).replace(/\\/g, "/")] : [];
    });
}

/**
 * Routes that must stay reachable without a session, with the mechanism that
 * protects them instead of a role guard. Adding or removing one of these is a
 * deliberate change to this list.
 */
const PUBLIC_ROUTES: Record<string, string> = {
    "_webhooks/lifecycle.post.ts": "retired endpoint that only returns 404",
    "_webhooks/update.post.ts": "retired endpoint that only returns 404",
    "auth/basis/backchannel.post.ts": "signed backchannel token",
    "auth/basis/callback.get.ts": "OIDC state, nonce, and PKCE",
    "auth/logout.post.ts": "clears the session cookie",
    "auth/session.get.ts": "returns no user when unauthenticated",
    "debug/upload.post.ts": "removed endpoint that only returns 410",
    "login.get.ts": "starts the OIDC authorization code flow",
    "seasons/[id]/tweaks.get.ts": "public season settings read",
    "seasons/active.get.ts": "public live season read",
    "seasons/active/rubric.get.ts": "public live rubric read",
    "seasons/index.get.ts": "public season list",
    "users/[id]/profile_picture.get.ts": "public profile image",
    "teams/[id]/index.get.ts": "public team read with optional identity",
    "ballot/results.get.ts": "voting-closed, gallery-public, and results-public gate",
    "users/[id]/index.get.ts": "public profile read with optional identity",
};

const ROLE_GUARD = /(?:requireUser|requireJudge|requireAdmin)\s*\(/;
const FINE_GRAINED_GUARD = /requireUser\(\s*event\s*,\s*NethackPermissions\./;
const RATE_LIMITED = /applyRateLimit\s*\(/;

const files = routeFiles(apiDir).sort();

describe("API route guard inventory", () => {
    it("finds every route handler", () => {
        expect(files.length).toBeGreaterThan(60);
    });

    it("guards every non-public route with a role check", () => {
        const unguarded = files.filter((file) => {
            if (PUBLIC_ROUTES[file]) return false;
            return !ROLE_GUARD.test(readFileSync(join(apiDir, file), "utf8"));
        });

        expect(unguarded).toEqual([]);
    });

    it("keeps the public route list honest", () => {
        const guardedPublicRoutes = Object.keys(PUBLIC_ROUTES).filter((file) =>
            ROLE_GUARD.test(readFileSync(join(apiDir, file), "utf8")),
        );
        const publicRoutesMissingFiles = Object.keys(PUBLIC_ROUTES).filter(
            (file) => !files.includes(file),
        );

        expect(guardedPublicRoutes).toEqual([]);
        expect(publicRoutesMissingFiles).toEqual([]);
    });

    it("requires a named permission on every administrator route", () => {
        const adminRoutes = files.filter((file) => file.startsWith("admin/"));
        const broadOrMissing = adminRoutes.filter(
            (file) => !FINE_GRAINED_GUARD.test(readFileSync(join(apiDir, file), "utf8")),
        );

        expect(adminRoutes.length).toBeGreaterThan(15);
        expect(broadOrMissing).toEqual([]);
    });

    it("requires the all-permission grant on user role mutations", () => {
        const roleRoutes = ["users/[id]/admin.patch.ts", "users/[id]/judge.patch.ts"];
        const weak = roleRoutes.filter(
            (file) =>
                !/requireUser\(\s*event\s*,\s*NethackPermissions\.all\s*\)/.test(
                    readFileSync(join(apiDir, file), "utf8"),
                ),
        );

        expect(weak).toEqual([]);
    });

    it("documents routes that resolve an optional identity without a guard", () => {
        const undocumented = files.filter((file) => {
            if (PUBLIC_ROUTES[file]) return false;
            const source = readFileSync(join(apiDir, file), "utf8");
            if (!/\boptionalUser\s*\(/.test(source)) return false;
            // A conditional guard (for example the judging scope on the public
            // team list) keeps the route out of the unauthenticated set.
            return !ROLE_GUARD.test(source);
        });

        expect(undocumented).toEqual([]);
    });

    it("rate limits every route handler except the removed upload stub", () => {
        const unlimited = files.filter(
            (file) =>
                file !== "debug/upload.post.ts" &&
                !RATE_LIMITED.test(readFileSync(join(apiDir, file), "utf8")),
        );

        expect(unlimited).toEqual([]);
    });
});
