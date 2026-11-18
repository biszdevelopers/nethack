<script setup lang="ts">
import { nextTick } from "vue";
import { apiFetch } from "~~/app/composables/useApiFetch";
import type { FormSubmitEvent } from "@nuxt/ui";
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

const formRef = useTemplateRef("formRef");
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
const dirty = ref(false);

watch(
    dirty,
    (value) => {
        emit("dirty", value);
    },
    { immediate: true },
);

const intent = ref<"save" | "submit">("save");
const showConfirmModal = ref(false);
let pendingSubmitEvent: FormSubmitEvent<UpdateTeamRequest | SubmitTeamRequest> | null = null;

const autosaveStatus = ref("");

async function triggerAutosave() {
    if (!dirty.value || !defaultTeam) {
        // autosaveStatus.value = 'Synced with origin';
        return;
    }

    autosaveStatus.value = "Auto-saving...";
    try {
        await apiFetch(`/api/teams/${defaultTeam.id}`, {
            method: "PATCH",
            body: {
                name: formState.name,
                // The schema rejects an empty pathway; omit it until a track is chosen.
                ...(formState.pathway ? { pathway: formState.pathway } : {}),
                project: {
                    name: formState.project.name,
                    description: formState.project.description,
                    demo_url: formState.project.demo_url || null,
                    repo_url: formState.project.repo_url || null,
                    sourcing: formState.project.sourcing,
                },
            },
        });
        dirty.value = false;
        autosaveStatus.value = `Auto-saved at ${new Date().toLocaleTimeString()}`;
    } catch {
        autosaveStatus.value = "Auto-save failed";
    }
}

let autosaveInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
    autosaveInterval = setInterval(triggerAutosave, 10000);
});

onUnmounted(() => {
    if (autosaveInterval) {
        clearInterval(autosaveInterval);
    }
});

const formState = reactive({
    name: "",
    pathway: "" as TeamPathway,
    project: {
        name: "",
        description: "",
        repo_url: "",
        demo_url: "",
        sourcing: "",
    },
});

const pathway = computed<TeamPathway>({
    get: () => formState.pathway,
    set: (value) => {
        formState.pathway = value;
    },
});

let suppressDirty = false;

watch(
    () => defaultTeam,
    (value) => {
        if (!value) return;
        suppressDirty = true;
        formState.name = value.name;
        formState.pathway = value.pathway || pathwayOptions.value[0]?.value || "";
        formState.project.name = value.project.name;
        formState.project.description = value.project.description;
        formState.project.repo_url = value.project.repo_url || "";
        formState.project.demo_url = value.project.demo_url || "";
        formState.project.sourcing = value.project.sourcing || "";
        dirty.value = false;
    },
    { deep: true, immediate: true },
);

watch(
    formState,
    () => {
        if (suppressDirty) {
            suppressDirty = false;
            return;
        }
        dirty.value = true;
    },
    { deep: true },
);

watch(
    pathwayOptions,
    (options) => {
        if (!formState.pathway && options.length > 0) {
            suppressDirty = true;
            formState.pathway = options[0]!.value;
        }
    },
    { immediate: true },
);

async function onSubmit(event: FormSubmitEvent<UpdateTeamRequest | SubmitTeamRequest>) {
    if (intent.value === "submit") {
        // Store the event and show confirmation modal
        pendingSubmitEvent = event;
        showConfirmModal.value = true;
        return;
    }

    // For save action, proceed directly
    await performSubmit(event);
}

async function performSubmit(event: FormSubmitEvent<UpdateTeamRequest | SubmitTeamRequest>) {
    const isSubmit = intent.value === "submit";

    const payload = {
        ...event.data,
        project: {
            ...event.data.project,
            demo_url: event.data.project?.demo_url || null,
            repo_url: event.data.project?.repo_url || null,
        },
    };

    try {
        await withLoadingIndicator(async () => {
            let res: { message: string };
            if (!defaultTeam) {
                return;
            }
            if (!isSubmit) {
                res = await apiFetch<{ message: string }>(`/api/teams/${defaultTeam.id}`, {
                    method: "PATCH",
                    body: payload,
                });
            } else {
                res = await apiFetch<{ message: string }>(`/api/teams/${defaultTeam.id}/submit`, {
                    method: "POST",
                    body: payload,
                });
            }
            toast.add({
                color: "success",
                title: res.message,
            });

            autosaveStatus.value = `Saved at ${new Date().toLocaleTimeString()}`;
            dirty.value = false;
        });
        emit("refresh");
    } catch (e) {
        toast.add({
            color: "error",
            title: "Failed to update project",
            description: getErrorMessage(e),
        });
    }
}

async function confirmSubmit() {
    const event = pendingSubmitEvent;
    pendingSubmitEvent = null;
    if (event) {
        showConfirmModal.value = false;
        await performSubmit(event);
    }
}

async function submitProject() {
    intent.value = "submit";
    await nextTick();
    (formRef.value as any)?.submit();
}
</script>

<template>
    <UForm
        ref="formRef"
        :state="formState"
        :schema="intent === 'save' ? UpdateTeamRequest : SubmitTeamRequest"
        :disabled="disabled"
        class="w-full space-y-4 mb-4"
        @submit="onSubmit"
    >
        <UFormField name="project.name" label="Project name" help="Make it sound even cooler!">
            <UInput
                v-model="formState.project.name"
                class="min-h-11 w-full"
                :maxlength="MAX_PROJECT_NAME_LENGTH"
            />
        </UFormField>

        <UFormField name="project.description" label="Project description">
            <UTextarea
                v-model="formState.project.description"
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
            help="Describe any AI tools you used and for which parts of the project. The rules require a comprehensive disclosure."
        >
            <UTextarea
                v-model="formState.project.sourcing"
                :rows="4"
                class="w-full"
                :maxlength="MAX_PROJECT_SOURCE_LENGTH"
            />
        </UFormField>

        <UFormField name="project.demo_url" label="Demo URL">
            <UInput
                v-model="formState.project.demo_url"
                class="min-h-11 w-full"
                :maxlength="MAX_URL_LENGTH"
            />

            <template #help>
                This should allow anyone can experience your project. For more information, please
                review the hackathon rules.
            </template>
        </UFormField>

        <UFormField name="project.repo_url" label="Repository URL">
            <UInput
                v-model="formState.project.repo_url"
                class="min-h-11 w-full"
                :maxlength="MAX_URL_LENGTH"
            />

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
                .
            </template>
        </UFormField>

        <UFormField name="pathway" label="Pathway">
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

        <div class="flex gap-4">
            <UButton
                id="project-save"
                :disabled="disabled"
                variant="subtle"
                class="min-h-11"
                type="submit"
                @click="intent = 'save'"
            >
                Save
            </UButton>

            <UButton
                id="project-submit"
                :disabled="disabled"
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
            >
                <template #content>
                    <p>
                        Confirm submission to your project? You will not be able to make further
                        changes once submitted.
                    </p>
                </template>
            </ModalConfirm>
        </div>

        <p v-if="autosaveStatus" class="text-sm text-neutral-500">
            {{ autosaveStatus }}
        </p>
    </UForm>
</template>
