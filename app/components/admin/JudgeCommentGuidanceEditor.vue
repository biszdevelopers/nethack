<script setup lang="ts">
import type { JudgeCommentGuidance, JudgeCommentTemplate } from "~~/shared/judge-comments";

const guidance = defineModel<JudgeCommentGuidance>({ required: true });

const props = defineProps<{
    disabled?: boolean;
}>();

const guidelineLimit = 10;
const templateLimit = 8;

function updateIntroduction(value: string) {
    guidance.value = { ...guidance.value, introduction: value };
}

function updateGuideline(index: number, value: string) {
    guidance.value = {
        ...guidance.value,
        guidelines: guidance.value.guidelines.map((guideline, currentIndex) =>
            currentIndex === index ? value : guideline,
        ),
    };
}

function addGuideline() {
    if (guidance.value.guidelines.length >= guidelineLimit) return;
    guidance.value = {
        ...guidance.value,
        guidelines: [...guidance.value.guidelines, ""],
    };
}

function removeGuideline(index: number) {
    guidance.value = {
        ...guidance.value,
        guidelines: guidance.value.guidelines.filter((_, currentIndex) => currentIndex !== index),
    };
}

function updateTemplate(index: number, changes: Partial<JudgeCommentTemplate>) {
    guidance.value = {
        ...guidance.value,
        templates: guidance.value.templates.map((template, currentIndex) =>
            currentIndex === index ? { ...template, ...changes } : template,
        ),
    };
}

function addTemplate() {
    if (guidance.value.templates.length >= templateLimit) return;
    guidance.value = {
        ...guidance.value,
        templates: [...guidance.value.templates, { label: "New prompt", body: "" }],
    };
}

function removeTemplate(index: number) {
    guidance.value = {
        ...guidance.value,
        templates: guidance.value.templates.filter((_, currentIndex) => currentIndex !== index),
    };
}
</script>

<template>
    <section class="space-y-5" aria-labelledby="judge-comment-guidance-title">
        <div>
            <h3 id="judge-comment-guidance-title" class="text-lg font-semibold">
                Judge comment guidance and templates
            </h3>
            <p class="mt-1 max-w-3xl text-sm text-ui-text-muted">
                These settings are saved with this immutable rubric version and are shown to judges
                while they score. Keep instructions short and avoid adding identifying information.
            </p>
        </div>

        <label class="block space-y-1.5">
            <span class="text-sm font-medium">Introduction</span>
            <UTextarea
                :model-value="guidance.introduction"
                :disabled="props.disabled"
                maxlength="300"
                :rows="2"
                class="w-full"
                @update:model-value="updateIntroduction"
            />
        </label>

        <section class="space-y-3" aria-labelledby="judge-guidelines-title">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h4 id="judge-guidelines-title" class="font-semibold">Guidelines</h4>
                    <p class="text-sm text-ui-text-muted">
                        Add 1–10 short instructions for judges.
                    </p>
                </div>
                <UButton
                    icon="i-lucide-plus"
                    variant="outline"
                    class="min-h-11"
                    :disabled="props.disabled || guidance.guidelines.length >= guidelineLimit"
                    @click="addGuideline"
                >
                    Add guideline
                </UButton>
            </div>

            <div
                v-for="(guideline, index) in guidance.guidelines"
                :key="index"
                class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
                <UInput
                    :model-value="guideline"
                    :disabled="props.disabled"
                    maxlength="240"
                    :aria-label="`Guideline ${index + 1}`"
                    class="w-full"
                    @update:model-value="updateGuideline(index, $event)"
                />
                <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    class="min-h-11 justify-center"
                    :disabled="props.disabled"
                    :aria-label="`Remove guideline ${index + 1}`"
                    @click="removeGuideline(index)"
                />
            </div>
        </section>

        <section
            class="space-y-3 border-t border-ui-border pt-5"
            aria-labelledby="comment-prompts-title"
        >
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h4 id="comment-prompts-title" class="font-semibold">Comment templates</h4>
                    <p class="text-sm text-ui-text-muted">
                        Add 1–8 prompts. Judges can edit the inserted text before submitting.
                    </p>
                </div>
                <UButton
                    icon="i-lucide-plus"
                    variant="outline"
                    class="min-h-11"
                    :disabled="props.disabled || guidance.templates.length >= templateLimit"
                    @click="addTemplate"
                >
                    Add template
                </UButton>
            </div>

            <article
                v-for="(template, index) in guidance.templates"
                :key="index"
                class="space-y-3 rounded-xl border border-ui-border bg-ui-bg-elevated/40 p-3 sm:p-4"
            >
                <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <label class="block space-y-1.5">
                        <span class="text-sm font-medium">Template button label</span>
                        <UInput
                            :model-value="template.label"
                            :disabled="props.disabled"
                            maxlength="60"
                            :aria-label="`Template ${index + 1} label`"
                            class="w-full min-h-11"
                            @update:model-value="updateTemplate(index, { label: $event })"
                        />
                    </label>
                    <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        class="min-h-11 justify-center"
                        :disabled="props.disabled"
                        :aria-label="`Remove template ${index + 1}`"
                        @click="removeTemplate(index)"
                    />
                </div>
                <label class="block space-y-1.5">
                    <span class="text-sm font-medium">Template text</span>
                    <UTextarea
                        :model-value="template.body"
                        :disabled="props.disabled"
                        maxlength="1000"
                        :rows="3"
                        :aria-label="`Template ${index + 1} text`"
                        class="w-full"
                        @update:model-value="updateTemplate(index, { body: $event })"
                    />
                </label>
                <p class="text-xs text-ui-text-muted">
                    Use &#123;&#123;example text&#125;&#125; for placeholders that judges must
                    replace.
                </p>
            </article>
        </section>
    </section>
</template>
