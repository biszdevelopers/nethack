<script setup lang="ts">
import { NethackPermissions } from "~~/shared/permissions";
import { SCORE_CURVE_PRESETS, type ScoreCurvePreset } from "~~/shared/score-curve";
import AdminRubricManager from "~/components/admin/RubricManager.vue";
definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});

useHead({
    title: `Hackathon Administration | ${WEBSITE_NAME}`,
});

const toast = useToast();
const { data: user, status } = await useApiUser();
const { can } = useNethackPermissions();

if (status.value !== "pending" && status.value !== "idle") {
    if (!user.value || !can(NethackPermissions.all)) {
        throw createError({ statusCode: 403, statusMessage: "Access Denied" });
    }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const { data: adminData, refresh: refreshAdmin } = await useApiFetch("/api/admin/hackathon", {
    server: false,
    $fetch: globalThis.$fetch,
});
const hackathon = computed(() => adminData.value?.hackathon ?? null);
const seasons = computed(() => adminData.value?.seasons ?? []);
const liveConfigReadOnly = computed(
    () =>
        adminData.value?.configSource !== "database" &&
        (activeSeasonId.value === null ||
            seasons.value.some(
                (season: Season) => season.id === activeSeasonId.value && season.is_active === 1,
            )),
);

// ---------------------------------------------------------------------------
// Helpers: ms epoch <-> datetime-local
// ---------------------------------------------------------------------------
function tsToDatetime(ts: unknown): string {
    const num = Number(ts);
    if (!Number.isFinite(num) || num <= 0) return "";
    const d = new Date(num);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function datetimeToTs(s: string): number {
    if (!s) return 0;
    return new Date(s).getTime();
}

async function downloadDatabase(format: "json" | "csv") {
    const blob = await $fetch<Blob>(`/api/admin/database/export?format=${format}`, {
        responseType: "blob",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `basishacks-export.${format}`;
    link.click();
    URL.revokeObjectURL(url);
}

// All config fields — every field is per-season (saved with season_id)
const allFieldKeys = [
    "status",
    "voting_enabled",
    "judging_open",
    "results_published",
    "show_scores",
    "show_ranking",
    "max_votes_per_user",
    "theme_name",
    "theme_description",
    "schedule_start",
    "schedule_end",
    "start_timestamp",
    "end_timestamp",
    "voting_start_timestamp",
    "voting_end_timestamp",
    "results_open_timestamp",
] as const;

const tsKeys: readonly string[] = [
    "start_timestamp",
    "end_timestamp",
    "voting_start_timestamp",
    "voting_end_timestamp",
    "results_open_timestamp",
];

const boolKeys = new Set([
    "voting_enabled",
    "judging_open",
    "results_published",
    "show_scores",
    "show_ranking",
]);

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------
const hackathonForm = reactive<Record<string, any>>({});
const formInitialized = ref(false);
const saving = ref(false);
const scoreCurvePreset = ref<ScoreCurvePreset>("original");
const scoreCurveSaving = ref(false);
const scoreCurveItems = Object.entries(SCORE_CURVE_PRESETS).map(([value, preset]) => ({
    label: preset.label,
    value,
}));

/** Populate form from a season row, skipping DB defaults so the global value shines through. */
function restoreSeasonConfig(season: any) {
    if (!season) return;
    for (const key of allFieldKeys) {
        const val = season[key];
        if (val === undefined) continue;
        if (val === null) {
            hackathonForm[key] = "";
            continue;
        }
        if (isDefaultValue(key, val)) continue;
        hackathonForm[key] = tsKeys.includes(key) ? tsToDatetime(val) : val;
    }
}

function isDefaultValue(key: string, val: any): boolean {
    if (key === "status") return val === "not_started";
    if (key === "max_votes_per_user") return val === 0;
    if (boolKeys.has(key)) return val === 0;
    if (tsKeys.includes(key)) return val === 0;
    return false;
}

/** Initialize form from global values, then overlay the selected season's overrides. */
function applyConfig(seasonId: number | null) {
    const h = hackathon.value;
    if (!h) return;

    const raw: Record<string, any> = {};
    for (const key of allFieldKeys) {
        const dbVal = (h as any)[key];
        if (tsKeys.includes(key)) {
            raw[key] = tsToDatetime(dbVal);
        } else {
            raw[key] = dbVal ?? "";
        }
    }
    Object.assign(hackathonForm, raw);

    if (seasonId !== null && !liveConfigReadOnly.value) {
        const s = seasons.value?.find((s: any) => s.id === seasonId);
        if (s) restoreSeasonConfig(s);
    }

    formInitialized.value = true;
}

/** Normalize a form value to its wire format (bool→0/1, timestamp→number, number-string→number). */
function normalize(key: string, val: any): any {
    if (typeof val === "boolean") return val ? 1 : 0;
    if (tsKeys.includes(key)) return datetimeToTs(val as string);
    if (key === "max_votes_per_user") return Number(val);
    return val;
}

/** Compare a normalized value against the global baseline, with type coercion.
 *  Returns false when baseline is undefined (field hasn't been loaded yet). */
function hasChanged(key: string, normalized: any): boolean {
    const baseline = (hackathon.value as any)?.[key];
    if (baseline === undefined || baseline === null) return false;
    if (boolKeys.has(key) || key === "max_votes_per_user" || tsKeys.includes(key)) {
        return Number(normalized) !== Number(baseline);
    }
    return normalized !== baseline;
}

/** Serialized PATCH queue — only one request in-flight at a time.
 *  Every PATCH carries ALL current form fields so no field can be
 *  silently dropped or overwritten by a stale concurrent request. */
let patchChain = Promise.resolve();

function onFieldChange() {
    if (liveConfigReadOnly.value) return;
    const body: Record<string, any> = {};
    for (const key of allFieldKeys) {
        const raw = hackathonForm[key];
        if (raw === undefined || raw === null) continue;
        const val = normalize(key, raw);
        if (typeof val === "number" && Number.isNaN(val)) continue;
        body[key] = val;
    }
    body.season_id = activeSeasonId.value;

    // Chain onto the previous PATCH so they never race.
    // Each PATCH carries every field, so even if the user changed
    // field A, then field B before the first PATCH finished, the
    // second PATCH will persist BOTH.
    saving.value = true;
    patchChain = patchChain
        .then(() => $fetch("/api/admin/hackathon", { method: "PATCH", body }))
        .then(() => refreshAdmin())
        .catch(() => {})
        .then(() => {
            saving.value = false;
        });
}

// ---------------------------------------------------------------------------
// Active season — picker at top, activates on "Set Active"
// ---------------------------------------------------------------------------
const activeSeasonId = ref<number | null>(null);

// One-time initialization: wait for both hackathon and seasons to load.
// Selects the last (newest) season by default. After this, activeSeasonId
// only changes via the dropdown v-model (user action).
watchEffect(() => {
    const h = hackathon.value;
    const s = seasons.value;
    if (!h || !s || s.length === 0 || formInitialized.value) return;
    const last = s[s.length - 1];
    activeSeasonId.value = last?.id ?? null;
    applyConfig(activeSeasonId.value);
});

const activeSeasonItems = computed(() => [
    { label: "None", value: null },
    ...(seasons.value?.map((s: { id: number; name: string }) => ({ label: s.name, value: s.id })) ||
        []),
]);

// ---------------------------------------------------------------------------
// Season name — separate editable field to rename the selected season
// ---------------------------------------------------------------------------
const seasonNameForm = ref("");

watch(activeSeasonId, (id) => {
    // Update season name
    seasonNameForm.value = seasons.value?.find((s: any) => s.id === id)?.name ?? "";
    scoreCurvePreset.value =
        (seasons.value?.find((s: any) => s.id === id)?.score_curve_preset as
            | ScoreCurvePreset
            | undefined) ?? "original";
    // Re-apply the full config (global + season overrides). When id is null,
    // applyConfig skips the overlay, showing only the global hackathon values.
    applyConfig(id);
});

async function saveScoreCurvePreset(value: ScoreCurvePreset) {
    const seasonId = activeSeasonId.value;
    if (seasonId === null) return;
    scoreCurveSaving.value = true;
    try {
        await $fetch(`/api/admin/seasons/${seasonId}/score-curve`, {
            method: "PATCH",
            body: { preset: value },
        });
        await refreshAdmin();
        toast.add({ title: "Score display curve updated.", color: "success" });
    } catch (error) {
        scoreCurvePreset.value =
            (seasons.value?.find((season: any) => season.id === seasonId)?.score_curve_preset as
                | ScoreCurvePreset
                | undefined) ?? "original";
        toast.add({
            title: "Could not update score curve",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        scoreCurveSaving.value = false;
    }
}

const seasonNameSaving = ref(false);

async function renameSeason() {
    if (activeSeasonId.value === null || !seasonNameForm.value.trim()) return;
    seasonNameSaving.value = true;
    try {
        await $fetch("/api/admin/seasons", {
            method: "PATCH",
            body: { id: activeSeasonId.value, name: seasonNameForm.value.trim() },
        });
        await refreshAdmin();
        toast.add({ title: "Season renamed.", color: "success" });
    } catch (e: any) {
        toast.add({ title: "Error", description: getErrorMessage(e), color: "error" });
    } finally {
        seasonNameSaving.value = false;
    }
}

async function setActiveSeason() {
    if (activeSeasonId.value === null) return;
    try {
        await $fetch("/api/seasons/active", {
            method: "PATCH",
            body: { season_id: activeSeasonId.value },
        });
        await refreshAdmin();
        toast.add({ title: "Active season updated.", color: "success" });
    } catch (e: any) {
        toast.add({ title: "Error", description: getErrorMessage(e), color: "error" });
    }
}

// ---------------------------------------------------------------------------
// New season — prompts then adds to the dropdown
// ---------------------------------------------------------------------------
async function addSeason() {
    const name = prompt("New season name:");
    if (!name || !name.trim()) return;
    try {
        await $fetch("/api/admin/seasons", { method: "POST", body: { name: name.trim() } });
        await refreshAdmin();
        toast.add({ title: `Season "${name}" created.`, color: "success" });
    } catch (e: any) {
        toast.add({ title: "Error", description: getErrorMessage(e), color: "error" });
    }
}
</script>

<template>
    <UDashboardPanel id="hackathon-admin">
        <template #header>
            <UDashboardNavbar title="Hackathon Administration">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <!-- Season picker at the top -->
            <section class="bg-ui-bg p-6">
                <h2 class="text-xl font-semibold mb-3">Season</h2>
                <div class="flex flex-wrap items-center gap-3">
                    <UFormField label="Select season" class="w-full sm:w-auto sm:max-w-xs">
                        <USelect
                            v-model="activeSeasonId"
                            :items="activeSeasonItems"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>
                    <UButton class="min-h-11" @click="setActiveSeason" color="primary">
                        Set Active
                    </UButton>
                    <UButton class="min-h-11" @click="addSeason" variant="outline">
                        + New Season
                    </UButton>
                </div>
            </section>
            <USeparator />

            <!-- Season Name (rename active season) -->
            <section class="bg-ui-bg p-6">
                <h2 class="text-xl font-semibold mb-3">Season Name</h2>
                <div class="flex flex-wrap items-center gap-3">
                    <UFormField label="Season name" class="min-w-0 flex-1">
                        <UInput
                            v-model="seasonNameForm"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>
                    <UButton
                        class="min-h-11"
                        @click="renameSeason"
                        :loading="seasonNameSaving"
                        color="primary"
                    >
                        Rename Season
                    </UButton>
                </div>
            </section>
            <USeparator />

            <section v-if="activeSeasonId !== null" class="bg-ui-bg p-6 space-y-3">
                <h2 class="text-xl font-semibold">Score display curve</h2>
                <p class="max-w-3xl text-sm text-ui-text-muted">
                    This changes the displayed score only. The original judge average stays saved,
                    and published ranking always uses that original score.
                </p>
                <div class="flex flex-wrap items-center gap-3">
                    <UFormField label="Display curve" class="w-full max-w-xs">
                        <USelect
                            v-model="scoreCurvePreset"
                            :items="scoreCurveItems"
                            :disabled="scoreCurveSaving"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                            @update:model-value="saveScoreCurvePreset"
                        />
                    </UFormField>
                    <span v-if="scoreCurveSaving" class="text-sm text-muted">Saving…</span>
                </div>
            </section>
            <USeparator />

            <AdminRubricManager
                v-if="activeSeasonId !== null"
                :key="activeSeasonId"
                :season-id="activeSeasonId"
                :seasons="seasons"
            />
            <USeparator />

            <section v-if="hackathon && formInitialized" class="bg-ui-bg p-6 space-y-4">
                <h2 class="text-xl font-semibold">
                    Hackathon Configuration
                    <span v-if="saving" class="text-sm text-primary font-normal ms-2">
                        Saving...
                    </span>
                </h2>
                <p v-if="liveConfigReadOnly" class="text-sm text-ui-text-muted">
                    Edit HACKATHON.yml to change live settings.
                </p>
                <p v-else class="text-sm text-ui-text-muted">
                    Changes auto-save with the selected season.
                </p>

                <fieldset
                    :disabled="liveConfigReadOnly"
                    class="grid grid-cols-1 md:grid-cols-2 gap-4"
                >
                    <UFormField label="Status" name="status" class="w-full">
                        <USelect
                            :items="[
                                { label: 'Not Started', value: 'not_started' },
                                { label: 'In Progress', value: 'in_progress' },
                                { label: 'Voting', value: 'voting' },
                                { label: 'Finished', value: 'finished' },
                                { label: 'Paused', value: 'paused' },
                            ]"
                            v-model="hackathonForm.status"
                            :disabled="liveConfigReadOnly"
                            @update:model-value="onFieldChange()"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField label="Max Votes Per User" name="max_votes_per_user" class="w-full">
                        <UInput
                            type="number"
                            name="max_votes_per_user"
                            v-model="hackathonForm.max_votes_per_user"
                            min="0"
                            max="100"
                            @change="onFieldChange()"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>

                    <div class="flex items-center gap-3">
                        <UCheckbox
                            v-model="hackathonForm.voting_enabled"
                            label="Voting Enabled"
                            :ui="{ label: 'min-h-11 cursor-pointer py-3' }"
                            :true-value="1"
                            :false-value="0"
                            :disabled="liveConfigReadOnly"
                            @update:model-value="onFieldChange()"
                        />
                    </div>

                    <div class="flex items-center gap-3">
                        <UCheckbox
                            v-model="hackathonForm.judging_open"
                            label="Judging Open"
                            :ui="{ label: 'min-h-11 cursor-pointer py-3' }"
                            :true-value="1"
                            :false-value="0"
                            :disabled="liveConfigReadOnly"
                            @update:model-value="onFieldChange()"
                        />
                    </div>

                    <div class="flex items-center gap-3">
                        <UCheckbox
                            v-model="hackathonForm.results_published"
                            label="Results Published"
                            :ui="{ label: 'min-h-11 cursor-pointer py-3' }"
                            :true-value="1"
                            :false-value="0"
                            :disabled="liveConfigReadOnly"
                            @update:model-value="onFieldChange()"
                        />
                    </div>

                    <div class="flex items-center gap-3">
                        <UCheckbox
                            v-model="hackathonForm.show_scores"
                            label="Show Scores"
                            :ui="{ label: 'min-h-11 cursor-pointer py-3' }"
                            :true-value="1"
                            :false-value="0"
                            :disabled="liveConfigReadOnly"
                            @update:model-value="onFieldChange()"
                        />
                    </div>

                    <div class="flex items-center gap-3">
                        <UCheckbox
                            v-model="hackathonForm.show_ranking"
                            label="Show Ranking"
                            :ui="{ label: 'min-h-11 cursor-pointer py-3' }"
                            :true-value="1"
                            :false-value="0"
                            :disabled="liveConfigReadOnly"
                            @update:model-value="onFieldChange()"
                        />
                    </div>

                    <UFormField label="Theme Name" name="theme_name" class="w-full">
                        <UInput
                            name="theme_name"
                            v-model="hackathonForm.theme_name"
                            @change="onFieldChange()"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField
                        label="Theme Description"
                        name="theme_description"
                        class="w-full md:col-span-2"
                    >
                        <UTextarea
                            name="theme_description"
                            v-model="hackathonForm.theme_description"
                            :rows="2"
                            @change="onFieldChange()"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField label="Schedule Start" name="schedule_start" class="w-full">
                        <UInput
                            type="datetime-local"
                            name="schedule_start"
                            v-model="hackathonForm.schedule_start"
                            @change="onFieldChange()"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField label="Schedule End" name="schedule_end" class="w-full">
                        <UInput
                            type="datetime-local"
                            name="schedule_end"
                            v-model="hackathonForm.schedule_end"
                            @change="onFieldChange()"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField label="Start" name="start_timestamp" class="w-full">
                        <UInput
                            type="datetime-local"
                            name="start_timestamp"
                            v-model="hackathonForm.start_timestamp"
                            @change="onFieldChange()"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField label="End" name="end_timestamp" class="w-full">
                        <UInput
                            type="datetime-local"
                            name="end_timestamp"
                            v-model="hackathonForm.end_timestamp"
                            @change="onFieldChange()"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField label="Voting Start" name="voting_start_timestamp" class="w-full">
                        <UInput
                            type="datetime-local"
                            name="voting_start_timestamp"
                            v-model="hackathonForm.voting_start_timestamp"
                            @change="onFieldChange()"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField label="Voting End" name="voting_end_timestamp" class="w-full">
                        <UInput
                            type="datetime-local"
                            name="voting_end_timestamp"
                            v-model="hackathonForm.voting_end_timestamp"
                            @change="onFieldChange()"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField label="Results Open" name="results_open_timestamp" class="w-full">
                        <UInput
                            type="datetime-local"
                            name="results_open_timestamp"
                            v-model="hackathonForm.results_open_timestamp"
                            @change="onFieldChange()"
                            :ui="{ base: 'min-h-11' }"
                            class="w-full"
                        />
                    </UFormField>
                </fieldset>
            </section>
            <USeparator />

            <!-- Database Export -->
            <section class="bg-ui-bg p-6 space-y-3">
                <h2 class="text-xl font-semibold">Database Export</h2>
                <p class="text-sm text-ui-text-muted">Download a full snapshot of the database.</p>
                <div class="flex flex-wrap items-center gap-3">
                    <UButton
                        class="min-h-11"
                        color="primary"
                        variant="solid"
                        @click="downloadDatabase('json')"
                    >
                        Download JSON
                    </UButton>
                    <UButton
                        class="min-h-11"
                        color="neutral"
                        variant="outline"
                        @click="downloadDatabase('csv')"
                    >
                        Download CSV
                    </UButton>
                </div>
            </section>
        </template>
    </UDashboardPanel>
</template>
