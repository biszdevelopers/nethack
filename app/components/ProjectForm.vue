<script setup lang="ts">
import { nextTick } from "vue";
import { apiFetch } from "~~/app/composables/useApiFetch";
import { isSafeUrl } from "~~/app/utils/url-validation";
import {
    applyProjectFormDraft,
    projectAutosavePayload,
    reconcileProjectForm,
    sameProjectForm,
    snapshotProjectForm,
    type ProjectFormDraft,
    type ProjectFormState,
} from "~~/app/utils/project-autosave";
import { readSessionDraft, registerSessionDraft } from "~~/app/utils/session-draft";
import {
    SubmitTeamRequest,
    UpdateTeamRequest,
    MAX_PROJECT_NAME_LENGTH,
    MAX_PROJECT_DESCRIPTION_LENGTH,
    MAX_PROJECT_SOURCE_LENGTH,
    MAX_URL_LENGTH,
} from "~~/shared/schemas";

const { team: defaultTeam, disabled = false } = defineProps<{
    team: APITeam | null | undefined;
    disabled?: boolean;
}>();
const emit = defineEmits<{
    dirty: [dirty: boolean];
    refresh: [];
}>();

const NO_AI_DISCLOSURE = "No AI tools or models were used in this project.";
const VIDEOS_HELP =
    "Host a 2–3 minute silent video on YouTube, Bilibili, or OneDrive/SharePoint. Share a public view-only link, do not host it on GitHub, and keep faces, names, and voices out of the recording.";

const route = useRoute();
const formRef = useTemplateRef<{ submit: () => void | Promise<void> }>("formRef");
const {
    data: activeRubric,
    pending: rubricPending,
    error: rubricError,
} = await useApiFetch<{
    version_id: number;
    tracks: Record<string, { name: string; criteria: unknown[] }>;
}>("/api/seasons/active/rubric");
const pathwayOptions = computed(() =>
    Object.entries(activeRubric.value?.tracks ?? {}).map(([value, track]) => ({
        label: track.name,
        value,
    })),
);

const toast = useToast();

const projectFormState = reactive<ProjectFormState>({
    name: "",
    pathway: "",
    project: {
        name: "",
        description: "",
        repo_url: "",
        demo_url: "",
        video_url: "",
        sourcing: "",
    },
});

const videoUrl = computed({
    get: () => projectFormState.project.video_url,
    set: (value: string | number | null) => {
        projectFormState.project.video_url = String(value ?? "");
    },
});

const repoUrl = computed({
    get: () => projectFormState.project.repo_url,
    set: (value: string | number | null) => {
        projectFormState.project.repo_url = String(value ?? "");
    },
});

const lastSaved = shallowRef<ProjectFormState>(snapshotProjectForm(projectFormState));
const isDirty = computed(
    () => !sameProjectForm(snapshotProjectForm(projectFormState), lastSaved.value),
);

watch(
    isDirty,
    (value) => {
        emit("dirty", value);
    },
    { immediate: true },
);

const intent = ref<"save" | "submit">("save");
const showConfirmModal = ref(false);
const submitting = ref(false);
const acknowledged = ref(false);
const draftRestored = ref(false);
const autosaveStatus = ref("");
const autosaveError = ref("");
const videoError = ref("");
const sourcingError = ref("");

const noAiUsed = computed({
    get: () => projectFormState.project.sourcing.trim() === NO_AI_DISCLOSURE,
    set: (value: boolean) => {
        if (value) {
            projectFormState.project.sourcing = NO_AI_DISCLOSURE;
        } else if (projectFormState.project.sourcing.trim() === NO_AI_DISCLOSURE) {
            projectFormState.project.sourcing = "";
        }
    },
});

const checklist = computed(() => [
    {
        label: "Project name and description are complete",
        done:
            projectFormState.project.name.trim().length > 0 &&
            projectFormState.project.description.trim().length >= 30,
    },
    {
        label: "Public repository link with a README and license",
        done: isSafeUrl(projectFormState.project.repo_url),
    },
    {
        label: "Working demo link",
        done: isSafeUrl(projectFormState.project.demo_url),
    },
    {
        label: "Public demonstration video link",
        done: isSafeUrl(projectFormState.project.video_url),
    },
    {
        label: "AI-use disclosure is complete",
        done: projectFormState.project.sourcing.trim().length > 0,
    },
]);

function applySnapshot(snapshot: ProjectFormState) {
    projectFormState.name = snapshot.name;
    projectFormState.pathway = snapshot.pathway;
    projectFormState.project.name = snapshot.project.name;
    projectFormState.project.description = snapshot.project.description;
    projectFormState.project.repo_url = snapshot.project.repo_url;
    projectFormState.project.demo_url = snapshot.project.demo_url;
    projectFormState.project.video_url = snapshot.project.video_url;
    projectFormState.project.sourcing = snapshot.project.sourcing;
}

function teamSnapshot(value: APITeam): ProjectFormState {
    const project = value.project as APITeam["project"] & {
        video_url?: string | null;
        sourcing?: string | null;
    };
    return {
        name: value.name,
        pathway: value.pathway || pathwayOptions.value[0]?.value || "",
        project: {
            name: project.name,
            description: project.description,
            repo_url: project.repo_url || "",
            demo_url: project.demo_url || "",
            video_url: project.video_url || "",
            sourcing: project.sourcing || "",
        },
    };
}

let inFlight: Promise<boolean> | null = null;

async function saveDirtyFields(mode: "auto" | "manual"): Promise<boolean> {
    if (!defaultTeam || disabled) return false;
    if (inFlight) await inFlight;
    if (!defaultTeam || disabled) return false;

    if (!isDirty.value) {
        lastSaved.value = snapshotProjectForm(projectFormState);
        if (mode === "manual") autosaveStatus.value = "Everything is already saved.";
        return true;
    }

    const sent = snapshotProjectForm(projectFormState);
    const payload = projectAutosavePayload(sent, lastSaved.value);
    if (Object.keys(payload).length === 0) {
        lastSaved.value = sent;
        return true;
    }

    autosaveError.value = "";
    autosaveStatus.value = mode === "manual" ? "Saving…" : "Auto-saving…";
    const teamID = defaultTeam.id;
    inFlight = (async () => {
        try {
            await apiFetch(`/api/teams/${teamID}`, {
                method: "PATCH",
                body: payload,
            });
            lastSaved.value = sent;
            autosaveStatus.value = `Saved at ${new Date().toLocaleTimeString()}`;
            return true;
        } catch (e) {
            autosaveError.value = getErrorMessage(e);
            autosaveStatus.value = "Changes are not saved";
            return false;
        } finally {
            inFlight = null;
        }
    })();
    return inFlight;
}

async function triggerAutosave() {
    if (disabled || submitting.value || inFlight || !isDirty.value) return;
    await saveDirtyFields("auto");
}

let autosaveInterval: ReturnType<typeof setInterval> | null = null;
let unregisterDraft: (() => void) | null = null;

onMounted(() => {
    const draft = readSessionDraft<ProjectFormDraft>(route.path);
    if (draft) {
        applySnapshot(applyProjectFormDraft(snapshotProjectForm(projectFormState), draft));
        draftRestored.value = true;
    }

    unregisterDraft = registerSessionDraft(route.path, () => {
        if (!isDirty.value) return null;
        const payload = projectAutosavePayload(
            snapshotProjectForm(projectFormState),
            lastSaved.value,
        );
        return Object.keys(payload).length > 0 ? payload : null;
    });

    autosaveInterval = setInterval(triggerAutosave, 10000);
});

onUnmounted(() => {
    unregisterDraft?.();
    if (autosaveInterval) clearInterval(autosaveInterval);
});

const pathway = computed<TeamPathway>({
    get: () => projectFormState.pathway,
    set: (value) => {
        projectFormState.pathway = value;
    },
});

watch(
    () => defaultTeam,
    (value) => {
        if (!value) return;
        const reconciled = reconcileProjectForm(
            snapshotProjectForm(projectFormState),
            lastSaved.value,
            teamSnapshot(value),
        );
        applySnapshot(reconciled.form);
        lastSaved.value = reconciled.lastSaved;
    },
    { deep: true, immediate: true },
);

watch(
    pathwayOptions,
    (options) => {
        if (projectFormState.pathway || options.length === 0) return;
        const fallback = options[0]!.value;
        projectFormState.pathway = fallback;
        lastSaved.value = { ...lastSaved.value, pathway: fallback };
    },
    { immediate: true },
);

function validateSubmission(): boolean {
    videoError.value = "";
    sourcingError.value = "";

    const video = projectFormState.project.video_url.trim();
    if (!video) {
        videoError.value = "Add the public link to your demonstration video.";
    } else if (!isSafeUrl(video)) {
        videoError.value = "Use a full https:// link to YouTube, Bilibili, or OneDrive/SharePoint.";
    }

    if (!projectFormState.project.sourcing.trim()) {
        sourcingError.value = 'Describe your AI use, or tick "No AI used".';
    }

    return !videoError.value && !sourcingError.value;
}

async function performSave() {
    if (disabled || submitting.value) return;
    submitting.value = true;
    try {
        const saved = await saveDirtyFields("manual");
        if (saved) {
            toast.add({ color: "success", title: "Project saved" });
            emit("refresh");
        } else {
            toast.add({
                color: "error",
                title: "Failed to save project",
                description: autosaveError.value || "Try again shortly.",
            });
        }
    } finally {
        submitting.value = false;
    }
}

async function onSubmit() {
    if (intent.value === "submit") {
        if (!validateSubmission()) return;
        if (!acknowledged.value) {
            toast.add({
                color: "warning",
                title: "Confirm the submission checklist first",
            });
            return;
        }
        showConfirmModal.value = true;
        return;
    }

    await performSave();
}

async function performSubmit() {
    if (disabled || submitting.value || !defaultTeam) return;

    submitting.value = true;
    const teamID = defaultTeam.id;
    try {
        if (inFlight) await inFlight;
        if (disabled) return;
        const snapshot = snapshotProjectForm(projectFormState);
        const payload = {
            name: snapshot.name,
            pathway: snapshot.pathway,
            project: {
                name: snapshot.project.name,
                description: snapshot.project.description,
                demo_url: snapshot.project.demo_url || null,
                repo_url: snapshot.project.repo_url || null,
                video_url: snapshot.project.video_url || null,
                sourcing: snapshot.project.sourcing,
            },
        };

        const res = await withLoadingIndicator(async () =>
            apiFetch<{ message: string }>(`/api/teams/${teamID}/submit`, {
                method: "POST",
                body: payload,
            }),
        );
        lastSaved.value = snapshot;
        autosaveStatus.value = `Submitted at ${new Date().toLocaleTimeString()}`;
        toast.add({
            color: "success",
            title: res.message,
        });
        emit("refresh");
    } catch (e) {
        toast.add({
            color: "error",
            title: "Failed to submit project",
            description: getErrorMessage(e),
        });
    } finally {
        submitting.value = false;
    }
}

async function confirmSubmit() {
    await performSubmit();
    intent.value = "save";
}

function onConfirmOpenChange(open: boolean) {
    if (!open) intent.value = "save";
}

async function submitProject() {
    if (disabled || submitting.value) return;
    intent.value = "submit";
    await nextTick();
    await formRef.value?.submit();
}
</script>

<template>
    <UForm
        ref="formRef"
        :state="projectFormState"
        :schema="intent === 'save' ? UpdateTeamRequest : SubmitTeamRequest"
        :disabled="disabled"
        class="mb-4 w-full space-y-4"
        @submit="onSubmit"
    >
        <UAlert
            v-if="draftRestored"
            color="warning"
            variant="subtle"
            icon="i-lucide-history"
            title="Restored unsaved changes"
        >
            <template #description>
                Your session expired while you were editing. Review these saved changes; autosave
                will store them again.
            </template>
            <template #actions>
                <UButton variant="outline" class="min-h-11" @click="draftRestored = false">
                    Dismiss
                </UButton>
            </template>
        </UAlert>

        <FormRequiredNotification />

        <UFormField
            name="project.name"
            label="Project name"
            help="Make it sound even cooler!"
            required
        >
            <UInput
                v-model="projectFormState.project.name"
                class="min-h-11 w-full"
                :maxlength="MAX_PROJECT_NAME_LENGTH"
            />
        </UFormField>

        <UFormField name="project.description" label="Project description" required>
            <UTextarea
                v-model="projectFormState.project.description"
                :rows="10"
                class="w-full"
                :maxlength="MAX_PROJECT_DESCRIPTION_LENGTH"
            />

            <template #help>
                <p>Please include:</p>
                <p>* A brief summary of the project</p>
                <p>* What problem it solves (if any)</p>
                <p>* How to use it</p>
                <p>* Technologies used (optional)</p>
            </template>
        </UFormField>

        <UFormField
            name="project.sourcing"
            label="AI-use disclosure"
            :error="sourcingError"
            required
        >
            <UTextarea
                v-model="projectFormState.project.sourcing"
                :rows="4"
                class="w-full"
                :maxlength="MAX_PROJECT_SOURCE_LENGTH"
                :disabled="noAiUsed"
            />

            <div class="mt-2">
                <UCheckbox
                    v-model="noAiUsed"
                    :disabled="disabled || submitting"
                    label="No AI tools or models were used in this project"
                />
            </div>

            <template #help>
                Required. Name the AI tools or models you used and the parts they touched. A vague
                statement such as "AI was used" is not enough. Undeclared or misleading AI use may
                be treated as plagiarism.
            </template>
        </UFormField>

        <UFormField name="project.demo_url" label="Demo URL" required>
            <UInput
                v-model="projectFormState.project.demo_url"
                class="min-h-11 w-full"
                :maxlength="MAX_URL_LENGTH"
            />

            <template #help>
                This should allow anyone to experience your project. For more information, please
                review the
                <ULink href="/rules" class="text-default underline underline-offset-2">
                    hackathon rules
                </ULink>
                .
            </template>
        </UFormField>

        <UFormField
            name="project.video_url"
            label="Demonstration video URL"
            :error="videoError"
            required
        >
            <UInput
                v-model="videoUrl"
                class="min-h-11 w-full"
                :maxlength="MAX_URL_LENGTH"
                placeholder="https://youtu.be/…"
            />

            <template #help>
                {{ VIDEOS_HELP }}
                <ULink href="/rules" class="text-default underline underline-offset-2">
                    Read the video rules.
                </ULink>
            </template>
        </UFormField>

        <UFormField name="project.repo_url" label="Repository URL" required>
            <UInput v-model="repoUrl" class="min-h-11 w-full" :maxlength="MAX_URL_LENGTH" />

            <template #help>
                Your project must be open source on
                <ULink
                    href="https://github.com"
                    target="_blank"
                    class="text-default underline underline-offset-2"
                >
                    GitHub
                </ULink>
                (preferred) or
                <ULink
                    href="https://gitee.com"
                    target="_blank"
                    class="text-default underline underline-offset-2"
                >
                    Gitee
                </ULink>
                , with a README. Without a license file the rules apply a default MIT license and
                the public showcase terms.
            </template>
        </UFormField>

        <UFormField name="pathway" label="Pathway" required>
            <URadioGroup
                v-model="pathway"
                :items="pathwayOptions"
                :disabled="disabled || rubricPending || pathwayOptions.length === 0"
                class="min-h-11"
            />

            <template #help>
                <span v-if="rubricPending">Loading the season's available tracks…</span>
                <span v-else-if="rubricError || pathwayOptions.length === 0">
                    Tracks are unavailable right now. Your project is saved; try again shortly.
                </span>
                <span v-else>Choose the track that best matches your project's focus.</span>
            </template>
        </UFormField>

        <UCard variant="subtle">
            <h2 class="mb-2 text-lg font-bold">Submission checklist</h2>
            <ul class="mb-4 space-y-1 text-sm">
                <li v-for="item in checklist" :key="item.label" class="flex items-start gap-2">
                    <UIcon
                        :name="item.done ? 'i-lucide-check' : 'i-lucide-dot'"
                        class="mt-0.5 shrink-0"
                        :class="item.done ? 'text-success' : 'text-muted'"
                    />
                    <span :class="item.done ? '' : 'text-muted'">{{ item.label }}</span>
                </li>
            </ul>

            <UCheckbox
                v-model="acknowledged"
                :disabled="disabled || submitting"
                label="I have read the rules and confirm my submission meets the video, repository, README, AI-disclosure, and licensing/showcase requirements."
            />
        </UCard>

        <div class="flex gap-4">
            <UButton
                id="project-save"
                :disabled="disabled || submitting"
                variant="subtle"
                class="min-h-11"
                type="submit"
                @click="intent = 'save'"
            >
                Save
            </UButton>

            <UButton
                id="project-submit"
                :disabled="disabled || submitting || !acknowledged"
                class="min-h-11"
                type="button"
                @click="submitProject"
            >
                Submit
            </UButton>

            <ModalConfirm
                v-model:open="showConfirmModal"
                title="Confirm submission"
                color="error"
                :click="confirmSubmit"
                @update:open="onConfirmOpenChange"
            >
                <template #content>
                    <p>
                        Submitting locks your project name, description, repository, demo, video,
                        and AI-use disclosure. You will not be able to edit them afterwards.
                    </p>
                    <p class="mt-2">
                        Confirm that the video is 2–3 minutes, silent, shows no personal identity,
                        and that your repository is public with a README.
                    </p>
                    <p class="mt-2">
                        Read the
                        <ULink href="/rules" class="text-default underline underline-offset-2">
                            hackathon rules
                        </ULink>
                        before you continue.
                    </p>
                </template>
            </ModalConfirm>
        </div>

        <UAlert
            v-if="autosaveError"
            color="error"
            variant="subtle"
            title="Changes are not saved"
            :description="autosaveError"
        >
            <template #actions>
                <UButton
                    variant="outline"
                    class="min-h-11"
                    :disabled="disabled || submitting"
                    @click="performSave"
                >
                    Retry save
                </UButton>
            </template>
        </UAlert>

        <p v-else-if="autosaveStatus" class="text-sm text-muted" aria-live="polite">
            {{ autosaveStatus }}
        </p>
    </UForm>
</template>
