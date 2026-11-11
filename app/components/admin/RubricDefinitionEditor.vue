<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { RubricDefinition, RubricTrack } from "~~/shared/rubric";

const definition = defineModel<RubricDefinition>({ required: true });

const props = defineProps<{
    disabled?: boolean;
}>();

const selectedTrackId = ref("");
const trackEntries = computed(() => Object.entries(definition.value.tracks));
const selectedTrack = computed(() => definition.value.tracks[selectedTrackId.value] ?? null);
const criterionLimit = 20;
const trackLimit = 8;

watch(
    trackEntries,
    (tracks) => {
        if (!tracks.some(([id]) => id === selectedTrackId.value)) {
            selectedTrackId.value = tracks[0]?.[0] ?? "";
        }
    },
    { immediate: true },
);

function makeUniqueId(base: string, existing: string[]) {
    let suffix = 1;
    let candidate = base;
    while (existing.includes(candidate)) {
        candidate = `${base}-${suffix++}`;
    }
    return candidate;
}

function inputValue(event: Event): string {
    return (event.target as HTMLInputElement | null)?.value ?? "";
}

function addTrack() {
    const tracks = { ...definition.value.tracks };
    const id = makeUniqueId("track", Object.keys(tracks));
    tracks[id] = {
        name: "New track",
        criteria: [
            {
                id: "criterion-one",
                name: "Criterion one",
                description: "What should judges look for?",
                weight: 50,
                minScore: 0,
                maxScore: 5,
            },
            {
                id: "criterion-two",
                name: "Criterion two",
                description: "What should judges look for?",
                weight: 50,
                minScore: 0,
                maxScore: 5,
            },
        ],
    };
    definition.value = { tracks };
    selectedTrackId.value = id;
}

function removeTrack(trackId: string) {
    const tracks = { ...definition.value.tracks };
    if (Object.keys(tracks).length <= 1) return;
    delete tracks[trackId];
    definition.value = { tracks };
}

function renameTrackId(oldId: string, newId: string) {
    const nextId = newId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-");
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(nextId) || nextId === oldId) return;
    if (Object.hasOwn(definition.value.tracks, nextId)) return;

    const tracks: Record<string, RubricTrack> = {};
    for (const [id, track] of Object.entries(definition.value.tracks)) {
        tracks[id === oldId ? nextId : id] = track;
    }
    definition.value = { tracks };
    selectedTrackId.value = nextId;
}

function addCriterion(trackId: string) {
    const track = definition.value.tracks[trackId];
    if (!track || track.criteria.length >= criterionLimit) return;
    const donor = track.criteria.reduce(
        (best, criterion) => (criterion.weight > best.weight ? criterion : best),
        track.criteria[0],
    );
    if (!donor || donor.weight <= 1) return;

    const id = makeUniqueId(
        "criterion",
        track.criteria.map((criterion) => criterion.id),
    );
    definition.value.tracks[trackId] = {
        ...track,
        criteria: [
            ...track.criteria.map((criterion) =>
                criterion.id === donor.id
                    ? { ...criterion, weight: criterion.weight - 1 }
                    : criterion,
            ),
            {
                id,
                name: "New criterion",
                description: "Describe the standard judges should apply.",
                weight: 1,
                minScore: 0,
                maxScore: 5,
            },
        ],
    };
}

function removeCriterion(trackId: string, criterionId: string) {
    const track = definition.value.tracks[trackId];
    if (!track || track.criteria.length <= 1) return;
    const removed = track.criteria.find((criterion) => criterion.id === criterionId);
    if (!removed) return;
    const remaining = track.criteria.filter((criterion) => criterion.id !== criterionId);
    const receiver = remaining.reduce((best, criterion) =>
        criterion.weight > best.weight ? criterion : best,
    );
    definition.value.tracks[trackId] = {
        ...track,
        criteria: remaining.map((criterion) =>
            criterion.id === receiver.id
                ? { ...criterion, weight: criterion.weight + removed.weight }
                : criterion,
        ),
    };
}

function updateCriterionId(trackId: string, oldId: string, newId: string) {
    const nextId = newId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-");
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(nextId) || nextId === oldId) return;
    const track = definition.value.tracks[trackId];
    if (!track || track.criteria.some((criterion) => criterion.id === nextId)) return;
    definition.value.tracks[trackId] = {
        ...track,
        criteria: track.criteria.map((criterion) =>
            criterion.id === oldId ? { ...criterion, id: nextId } : criterion,
        ),
    };
}

const weightTotal = (track: RubricTrack) =>
    track.criteria.reduce((total, criterion) => total + Number(criterion.weight || 0), 0);
</script>

<template>
    <section class="space-y-5" aria-labelledby="rubric-editor-title">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
                <h3 id="rubric-editor-title" class="text-lg font-semibold">Tracks and criteria</h3>
                <p class="mt-1 text-sm text-ui-text-muted">
                    Each submitted project must match a track. Every track’s criteria weights must
                    add up to 100%.
                </p>
            </div>
            <UButton
                icon="i-lucide-plus"
                variant="outline"
                :disabled="props.disabled || trackEntries.length >= trackLimit"
                class="min-h-11 w-full justify-center sm:w-auto"
                @click="addTrack"
            >
                Add track
            </UButton>
        </div>

        <div class="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Rubric tracks">
            <button
                v-for="([id, track], index) in trackEntries"
                :key="id"
                type="button"
                :aria-pressed="id === selectedTrackId"
                class="min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors"
                :class="
                    id === selectedTrackId
                        ? 'border-primary bg-primary text-inverted'
                        : 'border-ui-border bg-ui-bg hover:bg-ui-bg-elevated'
                "
                @click="selectedTrackId = id"
            >
                {{ track.name || `Track ${index + 1}` }}
            </button>
        </div>

        <div
            v-if="selectedTrack"
            class="rounded-xl border border-ui-border bg-ui-bg p-4 sm:p-5"
            role="tabpanel"
        >
            <div
                class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.6fr)_auto] sm:items-end"
            >
                <label class="block space-y-1.5">
                    <span class="text-sm font-medium">Track name</span>
                    <UInput
                        v-model="selectedTrack.name"
                        :disabled="props.disabled"
                        maxlength="80"
                        placeholder="For example, Junior"
                        class="w-full min-h-11"
                    />
                </label>
                <label class="block space-y-1.5">
                    <span class="text-sm font-medium">Track key</span>
                    <UInput
                        :model-value="selectedTrackId"
                        :disabled="props.disabled"
                        maxlength="64"
                        placeholder="junior"
                        class="w-full min-h-11 font-mono"
                        @change="renameTrackId(selectedTrackId, inputValue($event))"
                    />
                    <span class="block text-xs text-ui-text-muted">
                        Must match the project pathway key.
                    </span>
                </label>
                <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    :disabled="props.disabled || trackEntries.length <= 1"
                    class="min-h-11 justify-center"
                    @click="removeTrack(selectedTrackId)"
                >
                    Remove track
                </UButton>
            </div>

            <div class="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h4 class="font-semibold">Scoring criteria</h4>
                    <p class="text-sm text-ui-text-muted">
                        Judges score each criterion using its integer range and weight.
                    </p>
                </div>
                <div
                    class="rounded-lg px-3 py-2 text-sm font-semibold"
                    :class="
                        weightTotal(selectedTrack) === 100
                            ? 'bg-success/10 text-success'
                            : 'bg-warning/10 text-warning'
                    "
                    aria-live="polite"
                >
                    {{ weightTotal(selectedTrack) }}% / 100%
                </div>
            </div>

            <div class="mt-3 space-y-3">
                <article
                    v-for="criterion in selectedTrack.criteria"
                    :key="criterion.id"
                    class="rounded-xl border border-ui-border bg-ui-bg-elevated/40 p-3 sm:p-4"
                >
                    <div
                        class="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_5rem_5rem_6rem_auto] xl:items-end"
                    >
                        <label class="block min-w-0 space-y-1.5">
                            <span class="text-sm font-medium">Criterion name</span>
                            <UInput
                                v-model="criterion.name"
                                :disabled="props.disabled"
                                maxlength="100"
                                placeholder="Innovation and originality"
                                class="w-full min-h-11"
                            />
                        </label>
                        <label class="block min-w-0 space-y-1.5">
                            <span class="text-sm font-medium">Description</span>
                            <UInput
                                v-model="criterion.description"
                                :disabled="props.disabled"
                                maxlength="500"
                                placeholder="What should judges consider?"
                                class="w-full min-h-11"
                            />
                        </label>
                        <label class="block min-w-0 space-y-1.5">
                            <span class="text-sm font-medium">Weight %</span>
                            <UInput
                                v-model.number="criterion.weight"
                                :disabled="props.disabled"
                                type="number"
                                min="1"
                                max="100"
                                inputmode="numeric"
                                class="w-full min-h-11"
                            />
                        </label>
                        <label class="block min-w-0 space-y-1.5">
                            <span class="text-sm font-medium">Minimum</span>
                            <UInput
                                v-model.number="criterion.minScore"
                                :disabled="props.disabled"
                                type="number"
                                min="0"
                                max="99"
                                inputmode="numeric"
                                class="w-full min-h-11"
                            />
                        </label>
                        <label class="block min-w-0 space-y-1.5">
                            <span class="text-sm font-medium">Maximum</span>
                            <UInput
                                v-model.number="criterion.maxScore"
                                :disabled="props.disabled"
                                type="number"
                                min="1"
                                max="100"
                                inputmode="numeric"
                                class="w-full min-h-11"
                            />
                        </label>
                        <UButton
                            icon="i-lucide-trash-2"
                            color="error"
                            variant="ghost"
                            :disabled="props.disabled || selectedTrack.criteria.length <= 1"
                            class="min-h-11 justify-center"
                            :aria-label="`Remove ${criterion.name || 'criterion'}`"
                            @click="removeCriterion(selectedTrackId, criterion.id)"
                        />
                        <label class="block space-y-1.5 sm:col-span-2 xl:col-span-3">
                            <span class="text-sm font-medium">Criterion key</span>
                            <UInput
                                :model-value="criterion.id"
                                :disabled="props.disabled"
                                maxlength="64"
                                class="w-full min-h-11 font-mono"
                                @change="
                                    updateCriterionId(
                                        selectedTrackId,
                                        criterion.id,
                                        inputValue($event),
                                    )
                                "
                            />
                            <span class="block text-xs text-ui-text-muted">
                                A stable key used to save scores with this criterion.
                            </span>
                        </label>
                    </div>
                </article>
            </div>

            <UButton
                icon="i-lucide-plus"
                variant="outline"
                :disabled="props.disabled || selectedTrack.criteria.length >= criterionLimit"
                class="mt-3 min-h-11 w-full justify-center sm:w-auto"
                @click="addCriterion(selectedTrackId)"
            >
                Add criterion
            </UButton>
        </div>
    </section>
</template>
