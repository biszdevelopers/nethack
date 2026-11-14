<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import {
    DEFAULT_RUBRIC_DEFINITION,
    withDefaultRubricCommentGuidance,
    type RubricDefinition,
} from "~~/shared/rubric";
import type { JudgeCommentGuidance } from "~~/shared/judge-comments";
import { JudgeCommentGuidanceSchema } from "~~/shared/schemas";
import RubricDefinitionEditor from "~/components/admin/RubricDefinitionEditor.vue";
import JudgeCommentGuidanceEditor from "~/components/admin/JudgeCommentGuidanceEditor.vue";
import RubricTemplateLibrary from "~/components/admin/RubricTemplateLibrary.vue";
import type { RubricTemplateSummary } from "~/components/admin/rubric-types";

interface SeasonChoice {
    id: number;
    name: string;
    rubric_version_id: number | null;
}

interface RubricVersionSummary {
    id: number;
    season_id: number;
    version: number;
    name: string;
    definition: RubricDefinition;
    source_template_id: number | null;
    created_at: number | string | Date;
}

interface RubricResponse {
    yamlManaged?: boolean;
    active: RubricVersionSummary | null;
    versions: RubricVersionSummary[];
    templates: RubricTemplateSummary[];
}

const props = defineProps<{
    seasonId: number;
    seasons: SeasonChoice[];
}>();

const toast = useToast();
const api = useNuxtApp().$api ?? globalThis.$fetch;
const rubricData = shallowRef<RubricResponse | null>(null);
const definition = ref<RubricDefinition>(copyDefinition(DEFAULT_RUBRIC_DEFINITION));
const versionName = ref("");
const templateName = ref("");
const templateDescription = ref("");
const selectedTemplateId = ref<number | null>(null);
const copySeasonId = ref<number | null>(null);
const loading = ref(false);
const savingVersion = ref(false);
const savingTemplate = ref(false);
const deletingTemplateId = ref<number | null>(null);
const loadError = ref("");

const activeVersion = computed(() => rubricData.value?.active ?? null);
const yamlManaged = computed(() => rubricData.value?.yamlManaged === true);
const commentGuidance = computed<JudgeCommentGuidance>({
    get: () => definition.value.commentGuidance ?? DEFAULT_RUBRIC_DEFINITION.commentGuidance!,
    set: (value) => {
        definition.value = { ...definition.value, commentGuidance: value };
    },
});
const versions = computed(() => rubricData.value?.versions ?? []);
const templates = computed(() => rubricData.value?.templates ?? []);
const sourceSeasons = computed(() =>
    props.seasons.filter((season) => season.id !== props.seasonId && season.rubric_version_id),
);

function copyDefinition(source: RubricDefinition): RubricDefinition {
    return withDefaultRubricCommentGuidance(JSON.parse(JSON.stringify(source)) as RubricDefinition);
}

function validationIssues(value: RubricDefinition): string[] {
    const issues: string[] = [];
    const trackEntries = Object.entries(value.tracks ?? {});

    if (trackEntries.length < 1 || trackEntries.length > 8) {
        issues.push("Add between 1 and 8 tracks.");
    }

    for (const [trackId, track] of trackEntries) {
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(trackId)) {
            issues.push(`Track key “${trackId}” must use lowercase letters, numbers, _ or -.`);
        }
        if (!track.name.trim() || track.name.length > 80) {
            issues.push(`Track “${track.name || trackId}” needs a name of 1–80 characters.`);
        }
        if (track.criteria.length < 1 || track.criteria.length > 20) {
            issues.push(`Track “${track.name || trackId}” needs 1–20 criteria.`);
        }

        const ids = new Set<string>();
        let weightTotal = 0;
        for (const criterion of track.criteria) {
            if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(criterion.id)) {
                issues.push(
                    `Criterion key “${criterion.id}” must use lowercase letters, numbers, _ or -.`,
                );
            }
            if (ids.has(criterion.id)) {
                issues.push(
                    `Track “${track.name || trackId}” has duplicate criterion key “${criterion.id}”.`,
                );
            }
            ids.add(criterion.id);
            if (!criterion.name.trim() || criterion.name.length > 100) {
                issues.push(
                    `Each criterion in “${track.name || trackId}” needs a name of 1–100 characters.`,
                );
            }
            if (criterion.description.length > 500) {
                issues.push(
                    `Criterion “${criterion.name}” description must be 500 characters or fewer.`,
                );
            }
            if (
                !Number.isInteger(criterion.weight) ||
                criterion.weight < 1 ||
                criterion.weight > 100
            ) {
                issues.push(
                    `Criterion “${criterion.name}” weight must be a whole number from 1 to 100.`,
                );
            }
            if (
                !Number.isInteger(criterion.minScore) ||
                !Number.isInteger(criterion.maxScore) ||
                criterion.minScore < 0 ||
                criterion.minScore > 99 ||
                criterion.maxScore < 1 ||
                criterion.maxScore > 100 ||
                criterion.maxScore <= criterion.minScore
            ) {
                issues.push(`Criterion “${criterion.name}” needs a valid integer score range.`);
            }
            weightTotal += Number(criterion.weight || 0);
        }
        if (weightTotal !== 100) {
            issues.push(
                `Weights for “${track.name || trackId}” currently total ${weightTotal}%; change them to 100%.`,
            );
        }
    }

    const guidance = JudgeCommentGuidanceSchema.safeParse(value.commentGuidance);
    if (!guidance.success) {
        issues.push(...guidance.error.issues.map((issue) => issue.message));
    }

    return [...new Set(issues)];
}

const issues = computed(() => validationIssues(definition.value));
const canSave = computed(() => !loading.value && !savingVersion.value && issues.value.length === 0);

async function loadRubric() {
    loading.value = true;
    loadError.value = "";
    try {
        const response = await api<RubricResponse>(`/api/admin/seasons/${props.seasonId}/rubric`);
        rubricData.value = response;
        definition.value = copyDefinition(response.active?.definition ?? DEFAULT_RUBRIC_DEFINITION);
        versionName.value = response.active?.name ?? "Season rubric";
        selectedTemplateId.value = null;
        templateName.value = "";
        templateDescription.value = "";
        copySeasonId.value = sourceSeasons.value[0]?.id ?? null;
    } catch (error) {
        loadError.value = getErrorMessage(error);
    } finally {
        loading.value = false;
    }
}

watch(() => props.seasonId, loadRubric, { immediate: true });

async function refreshRubric(keepEditor = false) {
    const previousDefinition = keepEditor ? copyDefinition(definition.value) : null;
    const previousTemplateId = keepEditor ? selectedTemplateId.value : null;
    const previousTemplateName = keepEditor ? templateName.value : "";
    const previousTemplateDescription = keepEditor ? templateDescription.value : "";
    await loadRubric();
    if (previousDefinition) {
        definition.value = previousDefinition;
        selectedTemplateId.value = previousTemplateId;
        templateName.value = previousTemplateName;
        templateDescription.value = previousTemplateDescription;
    }
}

async function saveVersion() {
    if (yamlManaged.value) return;
    if (!canSave.value || !versionName.value.trim()) {
        if (!versionName.value.trim()) {
            toast.add({ title: "Enter a name for this rubric version.", color: "warning" });
        }
        return;
    }

    savingVersion.value = true;
    try {
        const response = await api<{ active: RubricVersionSummary }>(
            `/api/admin/seasons/${props.seasonId}/rubric`,
            {
                method: "POST",
                body: {
                    name: versionName.value.trim(),
                    definition: copyDefinition(definition.value),
                },
            },
        );
        await refreshRubric();
        toast.add({
            title: `Rubric version ${response.active.version} is now active.`,
            color: "success",
        });
    } catch (error) {
        toast.add({
            title: "Could not save this rubric version",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        savingVersion.value = false;
    }
}

async function copyFromSeason(customize: boolean) {
    if (copySeasonId.value === null) return;
    const sourceSeason = sourceSeasons.value.find((season) => season.id === copySeasonId.value);
    if (!sourceSeason) return;

    if (!customize) {
        await createVersion(
            { copyFromSeasonId: sourceSeason.id },
            `${sourceSeason.name} rubric copied`,
        );
        return;
    }

    loading.value = true;
    try {
        const response = await api<RubricResponse>(`/api/admin/seasons/${sourceSeason.id}/rubric`);
        if (!response.active) {
            throw new Error("That season does not have an active rubric to copy.");
        }
        definition.value = copyDefinition(response.active.definition);
        versionName.value = `${response.active.name} (copy)`;
        selectedTemplateId.value = null;
        templateName.value = "";
        templateDescription.value = "";
        toast.add({
            title: `Loaded the rubric from ${sourceSeason.name}. Edit it, then save a new version.`,
            color: "success",
        });
    } catch (error) {
        toast.add({
            title: "Could not load that season’s rubric",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        loading.value = false;
    }
}

async function createVersion(
    source: { sourceTemplateId: number } | { copyFromSeasonId: number },
    name: string,
) {
    savingVersion.value = true;
    try {
        await api(`/api/admin/seasons/${props.seasonId}/rubric`, {
            method: "POST",
            body: { name: name.trim() || "Copied rubric", ...source },
        });
        await refreshRubric();
        toast.add({ title: "Copied rubric and activated a new version.", color: "success" });
    } catch (error) {
        toast.add({
            title: "Could not create the rubric version",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        savingVersion.value = false;
    }
}

function applyTemplate(template: RubricTemplateSummary) {
    selectedTemplateId.value = template.id;
    definition.value = copyDefinition(template.definition);
    versionName.value = `${template.name} (season version)`;
    templateName.value = template.name;
    templateDescription.value = template.description ?? "";
    toast.add({
        title: `Loaded “${template.name}”. Edit it, then save a new version.`,
        color: "success",
    });
}

async function createFromTemplate(template: RubricTemplateSummary) {
    selectedTemplateId.value = template.id;
    await createVersion({ sourceTemplateId: template.id }, versionName.value || template.name);
}

async function saveTemplate(updateExisting = false) {
    if (issues.value.length > 0 || !templateName.value.trim()) {
        if (!templateName.value.trim()) {
            toast.add({ title: "Enter a name for the reusable template.", color: "warning" });
        }
        return;
    }

    savingTemplate.value = true;
    try {
        const body = {
            name: templateName.value.trim(),
            description: templateDescription.value.trim() || undefined,
            definition: copyDefinition(definition.value),
        };
        if (updateExisting && selectedTemplateId.value !== null) {
            await api(`/api/admin/rubric-templates/${selectedTemplateId.value}`, {
                method: "PUT",
                body,
            });
            toast.add({ title: "Template updated.", color: "success" });
        } else {
            const response = await api<{ template: RubricTemplateSummary }>(
                "/api/admin/rubric-templates",
                { method: "POST", body },
            );
            selectedTemplateId.value = response.template.id;
            toast.add({ title: "Reusable template saved.", color: "success" });
        }
        await refreshRubric(true);
    } catch (error) {
        toast.add({
            title: "Could not save this template",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        savingTemplate.value = false;
    }
}

async function removeTemplate(template: RubricTemplateSummary) {
    if (
        !window.confirm(
            `Delete the reusable template “${template.name}”? Existing season versions will keep their saved rubric.`,
        )
    ) {
        return;
    }
    deletingTemplateId.value = template.id;
    try {
        await api(`/api/admin/rubric-templates/${template.id}`, { method: "DELETE" });
        if (selectedTemplateId.value === template.id) {
            selectedTemplateId.value = null;
            templateName.value = "";
            templateDescription.value = "";
        }
        await refreshRubric(true);
        toast.add({ title: "Template deleted.", color: "success" });
    } catch (error) {
        toast.add({
            title: "Could not delete this template",
            description: getErrorMessage(error),
            color: "error",
        });
    } finally {
        deletingTemplateId.value = null;
    }
}
</script>

<template>
    <section class="space-y-6 bg-ui-bg p-4 sm:p-6" aria-labelledby="season-rubric-title">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="max-w-3xl">
                <h2 id="season-rubric-title" class="text-xl font-semibold">Judging rubric</h2>
                <p class="mt-1 text-sm text-ui-text-muted">
                    Build a season-specific scoring guide. Saving creates an immutable version so
                    finalized evaluations always retain the rubric judges used.
                </p>
            </div>
            <UBadge v-if="activeVersion" color="primary" variant="soft" class="w-fit">
                Active · v{{ activeVersion.version }}
            </UBadge>
        </div>

        <UAlert
            v-if="loadError"
            color="error"
            variant="subtle"
            title="Rubric could not be loaded"
            :description="loadError"
            :actions="[{ label: 'Try again', onClick: loadRubric }]"
        />

        <div
            v-if="loading && !rubricData"
            class="py-8 text-center text-sm text-ui-text-muted"
            role="status"
        >
            Loading rubric settings…
        </div>

        <template v-else>
            <UAlert
                v-if="!activeVersion"
                color="warning"
                variant="subtle"
                title="This season does not have an active rubric yet"
                description="Create one below before judges begin scoring projects."
            />

            <p v-if="yamlManaged" class="text-sm text-muted">
                Edit the rubric section of HACKATHON.yml to publish a new live rubric.
            </p>
            <div
                class="grid gap-4 rounded-xl border border-ui-border bg-ui-bg-elevated/40 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.8fr)] lg:items-end"
            >
                <label class="block space-y-1.5">
                    <span class="text-sm font-medium">New rubric version name</span>
                    <UInput
                        v-model="versionName"
                        maxlength="100"
                        placeholder="For example, Season 3 judging rubric"
                        class="w-full"
                    />
                </label>
                <div class="grid gap-2 sm:grid-cols-2">
                    <UButton
                        icon="i-lucide-save"
                        color="primary"
                        class="min-h-11 justify-center"
                        :loading="savingVersion"
                        :disabled="yamlManaged || !canSave || !versionName.trim()"
                        @click="saveVersion"
                    >
                        Save new version
                    </UButton>
                    <UButton
                        icon="i-lucide-rotate-ccw"
                        variant="outline"
                        class="min-h-11 justify-center"
                        :disabled="loading || savingVersion"
                        @click="refreshRubric()"
                    >
                        Reload active
                    </UButton>
                </div>
            </div>

            <UAlert
                v-if="issues.length"
                color="warning"
                variant="subtle"
                title="A few details need attention before saving"
            >
                <template #description>
                    <ul class="list-disc space-y-1 ps-5">
                        <li v-for="issue in issues.slice(0, 8)" :key="issue">{{ issue }}</li>
                        <li v-if="issues.length > 8">And {{ issues.length - 8 }} more checks.</li>
                    </ul>
                </template>
            </UAlert>

            <RubricDefinitionEditor v-model="definition" :disabled="savingVersion || loading" />
            <JudgeCommentGuidanceEditor
                v-model="commentGuidance"
                :disabled="savingVersion || loading"
            />

            <section
                class="space-y-3 border-t border-ui-border pt-5"
                aria-labelledby="copy-rubric-title"
            >
                <div>
                    <h3 id="copy-rubric-title" class="text-lg font-semibold">
                        Copy a prior season
                    </h3>
                    <p class="mt-1 text-sm text-ui-text-muted">
                        Reuse a saved rubric as-is, or load it into the editor to customize first.
                    </p>
                </div>
                <div
                    v-if="sourceSeasons.length"
                    class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                >
                    <select
                        v-model.number="copySeasonId"
                        :disabled="loading || savingVersion"
                        aria-label="Season to copy rubric from"
                        class="min-h-11 w-full rounded-md border border-ui-border bg-ui-bg px-3 text-sm text-ui-text focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                        <option v-for="season in sourceSeasons" :key="season.id" :value="season.id">
                            {{ season.name }}
                        </option>
                    </select>
                    <UButton
                        icon="i-lucide-copy"
                        variant="outline"
                        class="min-h-11 justify-center"
                        :disabled="loading || savingVersion || copySeasonId === null"
                        @click="copyFromSeason(false)"
                    >
                        Copy as version
                    </UButton>
                    <UButton
                        icon="i-lucide-pencil"
                        variant="outline"
                        class="min-h-11 justify-center"
                        :disabled="loading || savingVersion || copySeasonId === null"
                        @click="copyFromSeason(true)"
                    >
                        Load to customize
                    </UButton>
                </div>
                <UAlert
                    v-else
                    color="neutral"
                    variant="subtle"
                    title="No other season has a saved rubric yet"
                    description="You can create a rubric from scratch or save one as a reusable template."
                />
                <p class="text-xs text-ui-text-muted">
                    A track used by submitted projects cannot be removed until those projects are
                    moved to another track.
                </p>
            </section>

            <section
                class="space-y-3 border-t border-ui-border pt-5"
                aria-labelledby="template-save-title"
            >
                <div>
                    <h3 id="template-save-title" class="text-lg font-semibold">
                        Save and manage templates
                    </h3>
                    <p class="mt-1 text-sm text-ui-text-muted">
                        Templates are reusable starting points. Updating one never changes a rubric
                        version already used for judging.
                    </p>
                </div>
                <div class="grid gap-3 lg:grid-cols-2">
                    <label class="block space-y-1.5">
                        <span class="text-sm font-medium">Template name</span>
                        <UInput
                            v-model="templateName"
                            maxlength="100"
                            placeholder="For example, Project showcase rubric"
                            class="w-full"
                        />
                    </label>
                    <label class="block space-y-1.5">
                        <span class="text-sm font-medium">
                            Description
                            <span class="font-normal text-ui-text-muted">(optional)</span>
                        </span>
                        <UInput
                            v-model="templateDescription"
                            maxlength="500"
                            placeholder="When and how to use this template"
                            class="w-full"
                        />
                    </label>
                </div>
                <div class="grid gap-2 sm:grid-cols-2">
                    <UButton
                        icon="i-lucide-bookmark-plus"
                        variant="outline"
                        class="min-h-11 justify-center"
                        :loading="savingTemplate && selectedTemplateId === null"
                        :disabled="
                            issues.length > 0 ||
                            !templateName.trim() ||
                            savingTemplate ||
                            savingVersion
                        "
                        @click="saveTemplate(false)"
                    >
                        Save as new template
                    </UButton>
                    <UButton
                        icon="i-lucide-save"
                        variant="outline"
                        class="min-h-11 justify-center"
                        :loading="savingTemplate && selectedTemplateId !== null"
                        :disabled="
                            selectedTemplateId === null ||
                            issues.length > 0 ||
                            !templateName.trim() ||
                            savingTemplate ||
                            savingVersion
                        "
                        @click="saveTemplate(true)"
                    >
                        Update selected template
                    </UButton>
                </div>
            </section>

            <RubricTemplateLibrary
                :templates="templates"
                :selected-template-id="selectedTemplateId"
                :disabled="savingTemplate || savingVersion || deletingTemplateId !== null"
                @apply="applyTemplate"
                @select="createFromTemplate"
                @remove="removeTemplate"
            />

            <section v-if="versions.length" class="space-y-3 border-t border-ui-border pt-5">
                <div>
                    <h3 class="text-lg font-semibold">Version history</h3>
                    <p class="mt-1 text-sm text-ui-text-muted">
                        Finalized scores remain attached to their saved version.
                    </p>
                </div>
                <ol class="divide-y divide-ui-border rounded-xl border border-ui-border">
                    <li
                        v-for="version in versions"
                        :key="version.id"
                        class="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
                    >
                        <div class="min-w-0">
                            <p class="break-words font-medium">{{ version.name }}</p>
                            <p class="text-sm text-ui-text-muted">
                                {{ Object.keys(version.definition.tracks).length }} tracks
                            </p>
                        </div>
                        <UBadge
                            :color="activeVersion?.id === version.id ? 'primary' : 'neutral'"
                            variant="soft"
                            class="w-fit shrink-0"
                        >
                            {{
                                activeVersion?.id === version.id
                                    ? "Active"
                                    : `Version ${version.version}`
                            }}
                        </UBadge>
                    </li>
                </ol>
            </section>
        </template>
    </section>
</template>
