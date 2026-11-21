import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (...segments: string[]) =>
    readFileSync(resolve(import.meta.dirname, "..", "..", ...segments), "utf-8");

describe("admin season form safety", () => {
    const season = readSource("app", "pages", "developers", "season.vue");

    it("captures the season and value when an edit happens", () => {
        expect(season).toContain("const seasonId = selectedSeasonId.value;");
        expect(season).toContain("const raw = hackathonForm[key];");
        expect(season).toContain(
            "saveQueue = saveQueue.then(() => writeField(key, seasonId, raw))",
        );
        expect(season).toContain(
            "async function writeField(key: string, seasonId: number | null, raw: unknown)",
        );
        expect(season).toContain("if (seasonId !== null) body.season_id = seasonId;");
    });

    it("flushes the save queue before create, delete, rename, and activation", () => {
        expect((season.match(/await saveQueue;/g) ?? []).length).toBeGreaterThanOrEqual(6);
    });

    it("guards unsaved edits on route leave and browser unload", () => {
        expect(season).toContain('import { onBeforeRouteLeave } from "vue-router";');
        expect(season).toContain('window.addEventListener("beforeunload", warnBeforeUnload)');
        expect(season).toContain("onBeforeRouteLeave(() => {");
        expect(season).toContain("Some season settings are still saving");
    });

    it("confirms live switches and describes the publish freeze", () => {
        expect(season).toContain("Pausing the event immediately disables voting and judging");
        expect(season).toContain("freezes the published scores and ranks");
        expect(season).toContain("results_published: 1,");
        expect(season).toContain("judging_open: 0,");
        expect(season).toContain("voting_enabled: 0,");
    });

    it("derives the visible capabilities from paused and published state", () => {
        expect(season).toContain(
            'const paused = computed(() => hackathonForm.status === "paused");',
        );
        expect(season).toContain(
            "const published = computed(() => Number(hackathonForm.results_published) === 1);",
        );
        expect(season).toContain("!paused.value && Number(hackathonForm.voting_enabled) === 1");
        expect(season).toContain("published.value && Number(hackathonForm.show_scores) === 1");
        expect(season).toContain('v-for="capability in capabilities"');
    });

    it("validates schedule order inline before saving", () => {
        expect(season).toContain("The event must end after it starts.");
        expect(season).toContain("Voting must end after voting starts.");
        expect(season).toContain("Results must open after voting closes.");
        expect(season).toContain(':error="timestampErrors.end_timestamp"');
        expect(season).toContain(':error="timestampErrors.results_open_timestamp"');
        expect(season).toContain("@change=\"saveTimestamp('end_timestamp')\"");
    });

    it("labels the vote cap for what it actually limits", () => {
        expect(season).toContain('label="Max projects a voter can score"');
        expect(season).toContain("Each voter can give stars to at most this many projects.");
        expect(season).not.toContain("Max Votes Per User");
    });

    it("describes the new-season copy accurately", () => {
        expect(season).toContain(
            "New season copies the live event's schedule and theme and inherits its",
        );
        expect(season).toContain("Status, voting, judging, results, and visibility switches");
    });
});

describe("admin command center", () => {
    const index = readSource("app", "pages", "developers", "index.vue");

    it("checks its own permission", () => {
        expect(index).toContain("can(NethackPermissions.all)");
        expect(index).toContain('title="Access denied"');
    });

    it("loads the readiness contract and degrades when it is unavailable", () => {
        expect(index).toContain("/api/admin/preflight?season_id=${season.id}");
        expect(index).toContain("teams_below_minimum_evaluations");
        expect(index).toContain("preflightMismatches");
        expect(index).toContain("vote_cap?.feasible");
        expect(index).toContain("isEndpointUnavailable(preflightError)");
        expect(index).toContain('title="Readiness check is not enabled"');
    });

    it("asks before publishing and explains the freeze", () => {
        expect(index).toContain("freezes the published scores and ranks");
        expect(index).toContain("judging_open: 0,");
        expect(index).toContain("voting_enabled: 0,");
        expect(index).toContain('title: "Results published"');
    });

    it("downloads standings and links the audit and awards pages", () => {
        expect(index).toContain("/api/admin/standings.csv?season_id=${season.id}");
        expect(index).toContain("URL.createObjectURL(blob)");
        expect(index).toContain('to="/developers/audit"');
        expect(index).toContain('to="/developers/awards"');
    });
});

describe("admin team management", () => {
    const teams = readSource("app", "pages", "developers", "teams.vue");

    it("checks its own permission and prevents duplicate deletes", () => {
        expect(teams).toContain("can(NethackPermissions.all)");
        expect(teams).toContain('title="Access denied"');
        expect(teams).toContain("const deleting = ref(false);");
        expect(teams).toContain(':loading="deleting"');
    });

    it("exposes status, reopen, score void, award, and recompute actions", () => {
        expect(teams).toContain("`/api/admin/teams/${team.id}/status`");
        expect(teams).toContain("`/api/admin/teams/${team.id}/reopen`");
        expect(teams).toContain("`/api/admin/teams/${team.id}/scores/${entry.judge_id}`");
        expect(teams).toContain("`/api/admin/teams/${team.id}/awards`");
        expect(teams).toContain("`/api/admin/teams/${team.id}/awards/${namespace}`");
        expect(teams).toContain("`/api/admin/scores/compute?season_id=${team.season_id}`");
        expect(teams).toContain("no_show");
        expect(teams).toContain("Reopen submission");
        expect(teams).toContain("Recompute standings");
    });

    it("shows submission and evaluation timestamps when the API provides them", () => {
        expect(teams).toContain("submitted_at?: number | null");
        expect(teams).toContain("formatSubmitted(row.original)");
        expect(teams).toContain("created_at?: string | number | null");
        expect(teams).toContain("formatDateTime(entry.created_at)");
    });

    it("shows a neutral state when award endpoints are absent", () => {
        expect(teams).toContain("awardsUnavailable.value = isEndpointUnavailable(catalog.reason)");
        expect(teams).toContain("The award catalog is not enabled on this deployment.");
    });
});

describe("admin users page", () => {
    const users = readSource("app", "pages", "developers", "users.vue");

    it("checks its own permission and guards destructive actions", () => {
        expect(users).toContain("can(NethackPermissions.all)");
        expect(users).toContain('title="Access denied"');
        expect(users).toContain("const deleting = ref(false);");
        expect(users).toContain("const pendingAdminIds = ref<number[]>([]);");
        expect(users).toContain("getErrorMessage(e)");
    });
});

describe("admin audit and awards pages", () => {
    it("renders a neutral audit state and a readable diff", () => {
        const audit = readSource("app", "pages", "developers", "audit.vue");
        expect(audit).toContain("/api/admin/audit?");
        expect(audit).toContain("Audit log is not enabled");
        expect(audit).toContain("function diffEntries");
        expect(audit).toContain("useHead({ title: `Audit log | ${WEBSITE_NAME}` })");
    });

    it("renders a neutral awards manager with catalog CRUD", () => {
        const awards = readSource("app", "pages", "developers", "awards.vue");
        expect(awards).toContain("/api/admin/awards");
        expect(awards).toContain('method: "POST"');
        expect(awards).toContain("`/api/admin/awards/${award.namespace}`");
        expect(awards).toContain("Awards are not enabled");
        expect(awards).toContain("useHead({ title: `Awards | ${WEBSITE_NAME}` })");
    });
});
