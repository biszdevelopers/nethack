import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (...segments: string[]) =>
    readFileSync(resolve(import.meta.dirname, "..", "..", ...segments), "utf-8");

describe("admin season operations", () => {
    const season = readSource("app", "pages", "developers", "season.vue");

    it("saves season settings explicitly in one request", () => {
        expect(season).toContain("async function saveSettings()");
        expect(season).toContain('await apiFetch("/api/admin/hackathon"');
        expect(season).toContain("season_id: season.id,");
        expect(season).not.toContain("saveQueue");
        expect(season).not.toContain("saveField(");
        expect(season).toContain("Every field here belongs to");
    });

    it("initializes the settings form before the immediate season watcher runs", () => {
        const settingsIndex = season.indexOf("const settings = reactive");
        const watchIndex = season.indexOf("watch(\n    selectedSeasonId");
        expect(settingsIndex).toBeGreaterThan(-1);
        expect(watchIndex).toBeGreaterThan(settingsIndex);
        expect(season).toContain("{ immediate: true }");
    });

    it("guards unsaved edits on route leave and browser unload", () => {
        expect(season).toContain('import { onBeforeRouteLeave } from "vue-router";');
        expect(season).toContain('window.addEventListener("beforeunload", warnBeforeUnload)');
        expect(season).toContain("onBeforeRouteLeave(() => {");
        expect(season).toContain("Discard the unsaved season settings?");
    });

    it("drives the lifecycle from clear stage actions", () => {
        expect(season).toContain('payload.status = "in_progress";');
        expect(season).toContain('payload.status = "voting";');
        expect(season).toContain("payload.results_published = 1;");
        expect(season).toContain("payload.judging_open = 0;");
        expect(season).toContain("payload.voting_enabled = 0;");
        expect(season).toContain('key: "publish"');
        expect(season).toContain('key: "finish"');
    });

    it("validates schedule order inline before saving", () => {
        expect(season).toContain("The event must end after it starts.");
        expect(season).toContain("Voting must end after voting starts.");
        expect(season).toContain("Results must open after voting closes.");
        expect(season).toContain(':error="settingsErrors.end_timestamp"');
        expect(season).toContain(':error="settingsErrors.results_open_timestamp"');
        expect(season).toContain("if (!settingsValid.value)");
    });

    it("labels the vote cap for what it actually limits", () => {
        expect(season).toContain('label="Maximum stars per voter"');
        expect(season.replace(/\s+/g, " ")).toContain(
            "Each ballot always distributes exactly 10 stars.",
        );
        expect(season).not.toContain("Max Votes Per User");
    });

    it("separates season settings from site-wide settings", () => {
        expect(season).toContain("Site-wide awards");
        expect(season).toContain('to="/developers/awards"');
        expect(season).toContain("The award catalog is independent of seasons.");
    });

    it("saves the team limit through the season endpoint", () => {
        expect(season).toContain("async function saveTeamLimit()");
        expect(season).toContain('await apiFetch("/api/admin/seasons"');
        expect(season).toContain("max_team_members");
    });

    it("shows the activation prerequisites instead of blocking silently", () => {
        expect(season).toContain("const activationBlockers = computed");
        expect(season).toContain("Set the event dates.");
        expect(season).toContain("Publish a judging rubric.");
        expect(season).toContain("Record board approval.");
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
