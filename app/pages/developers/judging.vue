<script setup lang="ts">
import { apiFetch } from "~~/app/composables/useApiFetch";
import { NethackPermissions } from "~~/shared/permissions";
import { formatDateTime } from "~/utils/datetime";

useHead({ title: `Judge coverage | ${WEBSITE_NAME}` });

definePageMeta({
    layout: "developers-dashboard",
    middleware: ["auth"],
});

type AdminTeamRow = {
    id: number;
    name: string;
    pathway: string | null;
    project_name: string;
    project_submitted: number | boolean;
};

type AdminUserRow = {
    id: number;
    email?: string;
    name: string | null;
    is_admin?: boolean;
};

type JudgingFlag = {
    id: number;
    team_id: number;
    judge_user_id: number;
    reason?: string | null;
    status?: string | null;
    created_at?: string | number | null;
    resolved_at?: string | number | null;
};

type AssignmentScope = "all" | "track" | "team";

const toast = useToast();
const { can } = useNethackPermissions();
const isAdmin = computed(() => can(NethackPermissions.all));

const { data: activeSeason } = await useApiFetch<{ id?: number; name?: string }>(
    "/api/seasons/active",
    { server: false, lazy: true },
);
const {
    data: users,
    error: usersError,
    refresh: refreshUsers,
} = await useApiFetch<AdminUserRow[]>("/api/users", {
    server: false,
    lazy: true,
    default: () => [],
});
const {
    data: teams,
    error: teamsError,
    refresh: refreshTeams,
} = await useApiFetch<AdminTeamRow[]>("/api/admin/teams", {
    server: false,
    lazy: true,
    default: () => [],
});
const {
    data: assignmentData,
    status: assignmentStatus,
    error: assignmentError,
    refresh: refreshAssignments,
} = await useApiFetch<GetJudgeAssignmentsResponse>("/api/admin/judging/assignments", {
    server: false,
    lazy: true,
});
const {
    data: flagData,
    error: flagError,
    refresh: refreshFlags,
} = await useApiFetch<JudgingFlag[] | { flags?: JudgingFlag[] }>("/api/admin/judging/flags", {
    server: false,
    lazy: true,
});
const {
    data: calibration,
    error: calibrationError,
    refresh: refreshCalibration,
} = await useApiFetch<GetJudgingCalibrationResponse>("/api/admin/judging/calibration", {
    server: false,
    lazy: true,
});

const assignments = computed(() => {
    const payload = assignmentData.value as unknown;
    if (Array.isArray(payload)) return payload as GetJudgeAssignmentsResponse["assignments"];
    return (payload as GetJudgeAssignmentsResponse | null)?.assignments ?? [];
});
const flags = computed(() => {
    const payload = flagData.value;
    if (Array.isArray(payload)) return payload;
    return Array.isArray(payload?.flags) ? payload.flags : [];
});
const openFlags = computed(() =>
    flags.value.filter((flag) => (flag.status ?? "open") !== "resolved" && !flag.resolved_at),
);
const assignmentsUnavailable = computed(() => isEndpointUnavailable(assignmentError.value));
const flagsUnavailable = computed(() => isEndpointUnavailable(flagError.value));
const calibrationUnavailable = computed(() => isEndpointUnavailable(calibrationError.value));
const assignmentsLoading = computed(
    () => assignmentStatus.value === "idle" || assignmentStatus.value === "pending",
);

const judgeItems = computed(() =>
    (users.value ?? []).map((user) => ({
        label: user.name || user.email || `User #${user.id}`,
        value: user.id,
    })),
);
const trackItems = computed(() => {
    const tracks = new Set<string>();
    for (const team of teams.value ?? []) {
        if (team.pathway) tracks.add(team.pathway);
    }
    return [...tracks].sort().map((track) => ({ label: track, value: track }));
});
const teamItems = computed(() =>
    [...(teams.value ?? [])]
        .sort((a, b) => (a.project_name || a.name).localeCompare(b.project_name || b.name))
        .map((team) => ({
            label: `${team.project_name || team.name} · ${team.name}`,
            value: team.id,
        })),
);
const submittedTeams = computed(() =>
    (teams.value ?? []).filter((team) => Boolean(team.project_submitted)),
);
const judgeAssignmentsByUser = computed(() => {
    const map = new Map<number, number>();
    for (const row of assignments.value) {
        map.set(row.judge_user_id, (map.get(row.judge_user_id) ?? 0) + 1);
    }
    return map;
});

const judgeID = ref<number | undefined>(undefined);
const scope = ref<AssignmentScope>("all");
const pathway = ref<string | undefined>(undefined);
const teamID = ref<number | undefined>(undefined);
const scopeItems: Array<{ label: string; value: AssignmentScope }> = [
    { label: "Every submitted project", value: "all" },
    { label: "One track", value: "track" },
    { label: "One project", value: "team" },
];
const saving = ref(false);
const actionError = ref<string | null>(null);
const deletingID = ref<number | null>(null);
const resolvingID = ref<number | null>(null);

const canCreate = computed(
    () =>
        Boolean(judgeID.value) &&
        !saving.value &&
        !assignmentsUnavailable.value &&
        (scope.value !== "track" || Boolean(pathway.value)) &&
        (scope.value !== "team" || Boolean(teamID.value)),
);

function judgeLabel(userID: number): string {
    const row = assignments.value.find((assignment) => assignment.judge_user_id === userID);
    if (row?.judge_name) return row.judge_name;
    if (row?.judge_email) return row.judge_email;
    const user = users.value?.find((item) => item.id === userID);
    return user?.name || user?.email || `User #${userID}`;
}

function teamLabel(teamID: number): string {
    const team = teams.value?.find((item) => item.id === teamID);
    return team ? team.project_name || team.name : `Team #${teamID}`;
}

function coverageCount(row: GetJudgeAssignmentsResponse["assignments"][number]): number {
    if (row.team_id) return 1;
    if (row.pathway) {
        return submittedTeams.value.filter((team) => team.pathway === row.pathway).length;
    }
    return submittedTeams.value.length;
}

function coverageLabel(row: GetJudgeAssignmentsResponse["assignments"][number]): string {
    if (row.team_id) return `Only ${teamLabel(row.team_id)}`;
    if (row.pathway) return `Track: ${row.pathway}`;
    return "Every submitted project";
}

async function createAssignment() {
    if (!canCreate.value || !judgeID.value) return;
    saving.value = true;
    actionError.value = null;
    try {
        const body: Record<string, unknown> = { judge_user_id: judgeID.value };
        if (scope.value === "track") body.pathway = pathway.value;
        if (scope.value === "team") body.team_id = teamID.value;
        await apiFetch("/api/admin/judging/assignments", { method: "POST", body });
        toast.add({ color: "success", title: "Judge assignment created" });
        await refreshAssignments();
    } catch (e) {
        actionError.value = getErrorMessage(e);
        toast.add({
            color: "error",
            title: "Could not create the assignment",
            description: actionError.value,
        });
    } finally {
        saving.value = false;
    }
}

async function deleteAssignment(id: number) {
    if (deletingID.value !== null) return;
    if (
        !window.confirm(
            "Remove this judge assignment? The judge will fall back to the next available assignment scope.",
        )
    ) {
        return;
    }
    deletingID.value = id;
    try {
        await apiFetch(`/api/admin/judging/assignments?id=${id}`, { method: "DELETE" });
        toast.add({ color: "success", title: "Assignment removed" });
        await refreshAssignments();
    } catch (e) {
        toast.add({
            color: isEndpointUnavailable(e) ? "warning" : "error",
            title: isEndpointUnavailable(e)
                ? "Assignments are not enabled"
                : "Could not remove the assignment",
            description: getErrorMessage(e),
        });
    } finally {
        deletingID.value = null;
    }
}

async function resolveFlag(flag: JudgingFlag) {
    if (resolvingID.value !== null) return;
    resolvingID.value = flag.id;
    try {
        await apiFetch(`/api/admin/judging/flags/${flag.id}`, {
            method: "PATCH",
            body: { status: "resolved" },
        });
        toast.add({ color: "success", title: "Flag resolved" });
        await refreshFlags();
    } catch (e) {
        toast.add({
            color: isEndpointUnavailable(e) ? "warning" : "error",
            title: isEndpointUnavailable(e)
                ? "Judge flags are not enabled"
                : "Could not resolve the flag",
            description: getErrorMessage(e),
        });
    } finally {
        resolvingID.value = null;
    }
}
</script>

<template>
    <UDashboardPanel id="judging">
        <template #header>
            <UDashboardNavbar title="Judge coverage">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UAlert
                v-if="!isAdmin"
                color="error"
                variant="subtle"
                icon="i-lucide-shield-x"
                title="Access denied"
                description="Administrator access is required to manage judge assignments."
            />

            <div v-else class="space-y-6">
                <section class="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 class="text-2xl font-semibold">Judge coverage</h1>
                        <p class="mt-1 max-w-prose text-sm text-muted">
                            Assign judges to every submitted project, one track, or one project.
                            Judges only see the projects their assignments cover; recusals remove
                            conflict-of-interest projects from their queue.
                        </p>
                        <p v-if="activeSeason?.name" class="mt-1 text-sm text-muted">
                            Active season: {{ activeSeason.name }}
                        </p>
                    </div>
                    <UButton to="/judging" variant="outline" class="min-h-11">
                        Open judging overview
                    </UButton>
                </section>

                <UAlert
                    v-if="usersError"
                    color="error"
                    variant="subtle"
                    title="Judges could not be loaded"
                    :description="getErrorMessage(usersError)"
                >
                    <template #actions>
                        <UButton variant="outline" class="min-h-11" @click="() => refreshUsers()">
                            Try again
                        </UButton>
                    </template>
                </UAlert>

                <UAlert
                    v-if="teamsError"
                    color="error"
                    variant="subtle"
                    title="Projects could not be loaded"
                    :description="getErrorMessage(teamsError)"
                >
                    <template #actions>
                        <UButton variant="outline" class="min-h-11" @click="() => refreshTeams()">
                            Try again
                        </UButton>
                    </template>
                </UAlert>

                <UAlert
                    v-if="assignmentsUnavailable"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-info"
                    title="Judge assignments are not enabled"
                    description="This deployment does not expose the judge assignment endpoints yet."
                />

                <UAlert
                    v-else-if="assignmentError"
                    color="error"
                    variant="subtle"
                    title="Judge assignments could not be loaded"
                    :description="getErrorMessage(assignmentError)"
                >
                    <template #actions>
                        <UButton
                            variant="outline"
                            class="min-h-11"
                            @click="() => refreshAssignments()"
                        >
                            Try again
                        </UButton>
                    </template>
                </UAlert>

                <UCard v-else variant="subtle">
                    <template #header>
                        <h2 class="text-lg font-semibold">Create an assignment</h2>
                    </template>

                    <div class="grid gap-3 sm:grid-cols-2">
                        <UFormField label="Judge" class="w-full">
                            <USelect
                                v-model="judgeID"
                                :items="judgeItems"
                                placeholder="Choose a judge"
                                class="min-h-11 w-full"
                            />
                        </UFormField>
                        <UFormField label="Scope" class="w-full">
                            <USelect v-model="scope" :items="scopeItems" class="min-h-11 w-full" />
                        </UFormField>
                        <UFormField v-if="scope === 'track'" label="Track" class="w-full">
                            <USelect
                                v-model="pathway"
                                :items="trackItems"
                                placeholder="Choose a track"
                                class="min-h-11 w-full"
                            />
                        </UFormField>
                        <UFormField v-if="scope === 'team'" label="Project" class="w-full">
                            <USelect
                                v-model="teamID"
                                :items="teamItems"
                                placeholder="Choose a project"
                                class="min-h-11 w-full"
                            />
                        </UFormField>
                    </div>

                    <UAlert
                        v-if="actionError"
                        color="error"
                        variant="subtle"
                        :title="actionError"
                        class="mt-3"
                    />

                    <p v-if="submittedTeams.length === 0" class="mt-3 text-sm text-muted">
                        No project has been submitted for the active season yet.
                    </p>

                    <UButton
                        class="mt-4 min-h-11"
                        :loading="saving"
                        :disabled="!canCreate"
                        @click="createAssignment"
                    >
                        Create assignment
                    </UButton>
                </UCard>

                <UCard variant="subtle">
                    <template #header>
                        <h2 class="text-lg font-semibold">Judges ({{ (users ?? []).length }})</h2>
                    </template>
                    <p v-if="usersError" class="text-sm text-muted">
                        The judge list could not be loaded. Existing assignments still appear below.
                    </p>
                    <p v-else-if="(users ?? []).length === 0" class="text-sm text-muted">
                        No user accounts are available yet.
                    </p>
                    <ul v-else class="divide-y divide-default">
                        <li
                            v-for="judge in users ?? []"
                            :key="judge.id"
                            class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                        >
                            <span class="min-w-0 break-words">
                                {{ judge.name || judge.email || `User #${judge.id}` }}
                            </span>
                            <span class="text-muted">
                                {{ judgeAssignmentsByUser.get(judge.id) ?? 0 }}
                                {{
                                    (judgeAssignmentsByUser.get(judge.id) ?? 0) === 1
                                        ? "assignment"
                                        : "assignments"
                                }}
                            </span>
                        </li>
                    </ul>
                </UCard>

                <section
                    v-if="!assignmentsUnavailable && !assignmentError"
                    aria-labelledby="assignments-heading"
                >
                    <h2 id="assignments-heading" class="mb-3 text-lg font-semibold">
                        Current assignments ({{ assignments.length }})
                    </h2>

                    <p
                        v-if="assignmentsLoading"
                        class="rounded-lg border border-default p-4 text-sm text-muted"
                        aria-live="polite"
                    >
                        Loading assignments…
                    </p>
                    <p
                        v-else-if="assignments.length === 0"
                        class="rounded-lg border border-default p-4 text-sm text-muted"
                    >
                        No judge assignments are configured. Every judge sees the full submitted
                        queue.
                    </p>

                    <ul v-else class="space-y-3">
                        <li
                            v-for="assignment in assignments"
                            :key="assignment.id"
                            class="rounded-xl border border-default p-4"
                        >
                            <div class="flex flex-wrap items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <p class="font-semibold">
                                        {{ judgeLabel(assignment.judge_user_id) }}
                                        <span class="ms-2 text-sm font-normal text-muted">
                                            {{
                                                judgeAssignmentsByUser.get(assignment.judge_user_id)
                                            }}
                                            {{
                                                judgeAssignmentsByUser.get(
                                                    assignment.judge_user_id,
                                                ) === 1
                                                    ? "assignment"
                                                    : "assignments"
                                            }}
                                        </span>
                                    </p>
                                    <p class="mt-1 text-sm">
                                        {{ coverageLabel(assignment) }}
                                        <span class="text-muted">
                                            · {{ coverageCount(assignment) }}
                                            {{
                                                coverageCount(assignment) === 1
                                                    ? "project"
                                                    : "projects"
                                            }}
                                        </span>
                                    </p>
                                    <p class="mt-1 text-xs text-muted">
                                        Created {{ formatDateTime(assignment.created_at) }}
                                    </p>
                                </div>
                                <UButton
                                    color="error"
                                    variant="subtle"
                                    class="min-h-11"
                                    :loading="deletingID === assignment.id"
                                    :disabled="deletingID !== null"
                                    @click="deleteAssignment(assignment.id)"
                                >
                                    Remove
                                </UButton>
                            </div>
                        </li>
                    </ul>
                </section>

                <section aria-labelledby="judge-calibration-heading">
                    <h2 id="judge-calibration-heading" class="mb-3 text-lg font-semibold">
                        Calibration
                    </h2>
                    <UAlert
                        v-if="calibrationUnavailable"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-info"
                        title="Calibration is not enabled"
                        description="This deployment does not expose the judging calibration endpoint yet."
                    />
                    <UAlert
                        v-else-if="calibrationError"
                        color="error"
                        variant="subtle"
                        title="Calibration could not be loaded"
                        :description="getErrorMessage(calibrationError)"
                    >
                        <template #actions>
                            <UButton
                                variant="outline"
                                class="min-h-11"
                                @click="() => refreshCalibration()"
                            >
                                Try again
                            </UButton>
                        </template>
                    </UAlert>
                    <div
                        v-else-if="calibration && calibration.evaluations > 0"
                        class="overflow-x-auto rounded-xl border border-default"
                    >
                        <p class="border-b border-default p-3 text-sm text-muted">
                            {{ calibration.evaluations }} evaluations, mean
                            {{ calibration.overall_average ?? "n/a" }}, standard deviation
                            {{ calibration.standard_deviation }}. A judge is flagged when they have
                            at least three evaluations and sit more than two standard deviations
                            from the mean.
                        </p>
                        <table class="w-full min-w-[32rem] text-sm">
                            <thead>
                                <tr class="border-b border-default text-left">
                                    <th class="p-3 font-semibold">Judge</th>
                                    <th class="p-3 font-semibold">Evaluations</th>
                                    <th class="p-3 font-semibold">Average</th>
                                    <th class="p-3 font-semibold">Deviation</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="judge in calibration.judges"
                                    :key="judge.judge_user_id"
                                    class="border-b border-default last:border-0"
                                >
                                    <td class="p-3">
                                        {{
                                            judge.name ||
                                            judge.email ||
                                            `Judge ${judge.judge_user_id}`
                                        }}
                                        <UBadge
                                            v-if="judge.outlier"
                                            color="warning"
                                            variant="subtle"
                                            class="ms-2"
                                        >
                                            Outlier
                                        </UBadge>
                                    </td>
                                    <td class="p-3">{{ judge.evaluations }}</td>
                                    <td class="p-3">{{ judge.average }}</td>
                                    <td class="p-3">
                                        {{ judge.deviation > 0 ? "+" : "" }}{{ judge.deviation }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p v-else class="rounded-lg border border-default p-4 text-sm text-muted">
                        No finalized evaluations yet.
                    </p>
                </section>

                <section aria-labelledby="judge-flags-heading">
                    <h2 id="judge-flags-heading" class="mb-3 text-lg font-semibold">
                        Judge flags ({{ openFlags.length }})
                    </h2>

                    <UAlert
                        v-if="flagsUnavailable"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-info"
                        title="Judge flags are not enabled"
                        description="This deployment does not expose the judge flag endpoints yet."
                    />
                    <UAlert
                        v-else-if="flagError"
                        color="error"
                        variant="subtle"
                        title="Judge flags could not be loaded"
                        :description="getErrorMessage(flagError)"
                    >
                        <template #actions>
                            <UButton
                                variant="outline"
                                class="min-h-11"
                                @click="() => refreshFlags()"
                            >
                                Try again
                            </UButton>
                        </template>
                    </UAlert>
                    <p
                        v-else-if="openFlags.length === 0"
                        class="rounded-lg border border-default p-4 text-sm text-muted"
                    >
                        No open judge flags. Flags raised in the judging workspace appear here.
                    </p>

                    <ul v-else class="space-y-3">
                        <li
                            v-for="flag in openFlags"
                            :key="flag.id"
                            class="rounded-xl border border-default p-4"
                        >
                            <div class="flex flex-wrap items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <p class="font-semibold">
                                        {{ teamLabel(flag.team_id) }}
                                        <span class="ms-2 text-sm font-normal text-muted">
                                            by {{ judgeLabel(flag.judge_user_id) }}
                                        </span>
                                    </p>
                                    <p class="mt-1 break-words text-sm">
                                        {{ flag.reason || "No reason was provided." }}
                                    </p>
                                    <p v-if="flag.created_at" class="mt-1 text-xs text-muted">
                                        {{ formatDateTime(flag.created_at) }}
                                    </p>
                                </div>
                                <UButton
                                    class="min-h-11"
                                    :loading="resolvingID === flag.id"
                                    :disabled="resolvingID !== null"
                                    @click="resolveFlag(flag)"
                                >
                                    Resolve
                                </UButton>
                            </div>
                        </li>
                    </ul>
                </section>
            </div>
        </template>
    </UDashboardPanel>
</template>
