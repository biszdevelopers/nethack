<script setup lang="ts">
import type { RubricTemplateSummary } from "~/components/admin/rubric-types";

defineProps<{
    templates: RubricTemplateSummary[];
    selectedTemplateId: number | null;
    disabled?: boolean;
}>();

const emit = defineEmits<{
    apply: [template: RubricTemplateSummary];
    select: [template: RubricTemplateSummary];
    remove: [template: RubricTemplateSummary];
}>();

function summary(template: RubricTemplateSummary) {
    const tracks = Object.values(template.definition.tracks);
    const criterionCount = tracks.reduce((total, track) => total + track.criteria.length, 0);
    return `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} · ${criterionCount} ${criterionCount === 1 ? "criterion" : "criteria"}`;
}
</script>

<template>
    <section class="space-y-3" aria-labelledby="rubric-template-library-title">
        <div>
            <h3 id="rubric-template-library-title" class="text-lg font-semibold">
                Reusable templates
            </h3>
            <p class="mt-1 text-sm text-ui-text-muted">
                Apply a template to edit it for this season, or create a new version from it.
            </p>
        </div>

        <div v-if="templates.length" class="grid gap-3 lg:grid-cols-2">
            <article
                v-for="template in templates"
                :key="template.id"
                class="rounded-xl border p-4 transition-colors"
                :class="
                    selectedTemplateId === template.id
                        ? 'border-primary bg-primary/5'
                        : 'border-ui-border bg-ui-bg'
                "
            >
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <h4 class="break-words font-semibold">{{ template.name }}</h4>
                        <p class="mt-1 text-xs text-ui-text-muted">{{ summary(template) }}</p>
                        <p v-if="template.description" class="mt-2 whitespace-pre-wrap text-sm">
                            {{ template.description }}
                        </p>
                    </div>
                    <UBadge
                        v-if="selectedTemplateId === template.id"
                        color="primary"
                        variant="soft"
                    >
                        Selected
                    </UBadge>
                </div>
                <div class="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    <UButton
                        icon="i-lucide-pencil"
                        variant="outline"
                        class="min-h-11 justify-center"
                        :disabled="disabled"
                        @click="emit('apply', template)"
                    >
                        Customize
                    </UButton>
                    <UButton
                        icon="i-lucide-copy-plus"
                        variant="soft"
                        color="primary"
                        class="min-h-11 justify-center"
                        :disabled="disabled"
                        @click="emit('select', template)"
                    >
                        Create version
                    </UButton>
                    <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        class="min-h-11 justify-center col-span-2 sm:col-span-1"
                        :disabled="disabled"
                        :aria-label="`Delete template ${template.name}`"
                        @click="emit('remove', template)"
                    >
                        Delete
                    </UButton>
                </div>
            </article>
        </div>
        <UAlert
            v-else
            color="neutral"
            variant="subtle"
            title="No reusable templates yet"
            description="Save a rubric template below to reuse it for this or a future season."
        />
    </section>
</template>
