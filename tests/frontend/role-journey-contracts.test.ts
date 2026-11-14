import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (...segments: string[]) =>
    readFileSync(resolve(import.meta.dirname, "..", "..", "app", ...segments), "utf8");

const between = (source: string, start: string, end: string) => {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    expect(startIndex, `Expected to find ${start}`).toBeGreaterThanOrEqual(0);
    expect(endIndex, `Expected to find the boundary ${end}`).toBeGreaterThan(startIndex);
    return source.slice(startIndex, endIndex);
};

describe("participant action paths", () => {
    const voting = readSource("pages", "voting.vue");
    const votingCard = readSource("components", "VotingProjectCard.vue");
    const projectForm = readSource("components", "ProjectForm.vue");
    const teamPage = readSource("pages", "dashboard", "teams", "index.vue");
    const confirmModal = readSource("components", "ModalConfirm.vue");

    it("gives peer-voting controls names, live scores, and 44px touch targets", () => {
        expect(votingCard).toContain(':aria-label="`Remove a star from ${team.project.name}`"');
        expect(votingCard).toContain(':aria-label="`Add a star to ${team.project.name}`"');
        expect(votingCard).toContain('aria-live="polite"');
        expect(votingCard.match(/class="min-h-11 min-w-11"/g)).toHaveLength(2);
        expect(voting).toContain('class="min-h-11"');
    });

    it("keeps team creation, project save/submit, and confirmation actions touch-sized", () => {
        expect(teamPage).toContain('<UButton type="submit" class="min-h-11">Create</UButton>');
        expect(projectForm).toContain('id="project-save"');
        expect(projectForm).toContain('id="project-submit"');
        expect(projectForm).toMatch(/id="project-save"[\s\S]*?class="min-h-11"/);
        expect(projectForm).toMatch(/id="project-submit"[\s\S]*?class="min-h-11"/);
        expect(confirmModal.match(/class="min-h-12"/g)).toHaveLength(2);
    });

    it("limits star distribution and makes voting available only at exactly ten stars", () => {
        expect(voting).toContain(
            "const totalStars = computed(() => state.scores.reduce((a, b) => a + b, 0))",
        );
        expect(voting).toContain("(state.scores[index] ?? 0) < 5 && totalStars < 10");
        expect(voting).toContain("(state.scores[index] ?? 0) > 0");
        expect(voting).toContain(':disabled="totalStars !== 10 || projects.length === 0"');
        expect(voting).toContain(':disabled="submitted"');
    });

    it("keeps vote cancellation local and refreshes the saved ballot after success", () => {
        const submit = between(voting, "async function onSubmit", "</script>");
        expect(submit).toMatch(/if\s*\(\s*!confirm\([\s\S]*?\)\s*\)\s*return;/);
        expect(submit).toContain('method: "POST"');
        expect(submit).toContain("await refresh()");
        expect(submit).toContain('title: "Failed to submit vote"');
        expect(submit).toContain("getErrorMessage(e)");
    });

    it("autosaves project edits only when the form is dirty and preserves blank URLs as null", () => {
        const autosave = between(
            projectForm,
            "async function triggerAutosave",
            "let autosaveInterval",
        );
        expect(autosave).toContain("if (!formRef.value?.dirty || !defaultTeam)");
        expect(autosave).toContain('method: "PATCH"');
        expect(autosave).toContain("demo_url: state.project.demo_url || null");
        expect(autosave).toContain("repo_url: state.project.repo_url || null");
        expect(autosave).toContain('autosaveStatus.value = "Auto-save failed"');
    });

    it("requires a confirmation step before final submission and clears the pending form event", () => {
        const onSubmit = between(
            projectForm,
            "async function onSubmit",
            "async function performSubmit",
        );
        const confirmSubmit = between(projectForm, "async function confirmSubmit", "</script>");
        expect(onSubmit).toContain('if (intent.value === "submit")');
        expect(onSubmit).toContain("pendingSubmitEvent = event");
        expect(onSubmit).toContain("showConfirmModal.value = true");
        expect(confirmSubmit).toContain("if (pendingSubmitEvent)");
        expect(confirmSubmit).toContain("await performSubmit(pendingSubmitEvent)");
        expect(confirmSubmit).toContain("pendingSubmitEvent = null");
    });

    it("uses separate save and submit endpoints, reports failures, and refreshes after a save", () => {
        const performSubmit = between(
            projectForm,
            "async function performSubmit",
            "async function confirmSubmit",
        );
        expect(performSubmit).toContain('method: "PATCH"');
        expect(performSubmit).toContain('method: "POST"');
        expect(performSubmit).toContain("/submit");
        expect(performSubmit).toContain('title: "Failed to update project"');
        expect(performSubmit).toContain('emit("refresh")');
    });
});

describe("judge action paths", () => {
    const scoringCard = readSource("components", "JudgingCard.vue");
    const judgingQueue = readSource("pages", "judging", "continue.vue");

    it("requires valid scores, a complete comment, and a loaded draft before review", () => {
        expect(scoringCard).toContain("Number.isInteger(value)");
        expect(scoringCard).toContain("value >= criterion.minScore && value <= criterion.maxScore");
        expect(scoringCard).toContain("isJudgeCommentReady(props.reasoning)");
        expect(scoringCard).toContain("criteriaComplete.value &&");
        expect(scoringCard).toContain("reasoningComplete.value &&");
        expect(scoringCard).toContain("props.draftReady &&");
        expect(scoringCard).toContain(
            ":disabled=\"!canReview || draftStatus === 'error' || draftStatus === 'saving'\"",
        );
    });

    it("keeps scoring accessible and prevents edits after an evaluation is finalized", () => {
        expect(scoringCard).toContain('role="radiogroup"');
        expect(scoringCard).toContain(
            ':aria-label="`${score} of ${criterion.maxScore} for ${criterion.name}`"',
        );
        expect(scoringCard).toContain('type="range"');
        expect(scoringCard).toContain(
            ":disabled=\"readOnly || !draftReady || draftStatus === 'loading'\"",
        );
        expect(scoringCard).toContain('if (!props.readOnly) emit("score"');
        expect(scoringCard).toContain("Your submitted evaluation");
    });

    it("provides anonymous comment prompts and returns focus to the comment editor", () => {
        expect(scoringCard).toContain("Strength + next step");
        expect(scoringCard).toContain("What stood out");
        expect(scoringCard).toContain("Technical feedback");
        expect(scoringCard).toContain(
            "Do not include your name or details that could identify you.",
        );
        expect(scoringCard).toContain(
            "Teams can read this comment anonymously after results are published.",
        );
        expect(scoringCard).toContain("reasoningInput.value?.focus()");
        expect(scoringCard).toContain("setSelectionRange(nextValue.length, nextValue.length)");
    });

    it("saves judge work before changing projects or entering the review step", () => {
        const saveBeforeNavigation = between(
            judgingQueue,
            "async function saveCurrentDraftBeforeNavigation",
            "async function getQueuePage",
        );
        const openReview = between(
            judgingQueue,
            "async function openReview",
            "async function finalizeEvaluation",
        );
        expect(saveBeforeNavigation).toContain("await draft.flush()");
        expect(saveBeforeNavigation).toContain('title: "Draft not saved"');
        expect(saveBeforeNavigation).toContain("return false");
        expect(judgingQueue).toContain("if (!(await saveCurrentDraftBeforeNavigation())) return;");
        expect(openReview.indexOf("await draft.flush()")).toBeLessThan(
            openReview.indexOf('step.value = "review"'),
        );
    });

    it("finalizes once, retains the rubric version, and keeps scores available if draft cleanup fails", () => {
        const finalize = between(
            judgingQueue,
            "async function finalizeEvaluation",
            "function retryQueue",
        );
        expect(finalize).toContain(
            "if (!team || submitting.value || activeFinalized.value) return",
        );
        expect(finalize).toContain("await draft.flush()");
        expect(finalize).toContain("rubric_version_id: draft.rubricVersionId.value");
        expect(finalize).toContain("await draft.clear(team.id)");
        expect(finalize).toContain('title: "Evaluation submitted"');
        expect(finalize).toContain(
            "Your score is final, but the saved draft could not be cleared.",
        );
        expect(finalize).toContain('title: "Could not submit evaluation"');
    });

    it("supports paginated navigation, retry actions, and unsaved-work route guards", () => {
        expect(judgingQueue).toContain("queuePageSize = 20");
        expect(judgingQueue).toContain("query: { judging: true, page, page_size: queuePageSize }");
        expect(judgingQueue).toContain("async function openNextProject()");
        expect(judgingQueue).toContain("async function openPreviousProject()");
        expect(judgingQueue).toContain("function retryQueue()");
        expect(judgingQueue).toContain(
            "void Promise.all([queueFetch.refresh(), summaryFetch.refresh(), rubricFetch.refresh()])",
        );
        expect(judgingQueue).toContain("onBeforeRouteLeave(async () =>");
        expect(judgingQueue).toContain(
            'window.addEventListener("beforeunload", warnBeforeLeaving)',
        );
        expect(judgingQueue).toContain("return false;");
    });
});

describe("judge results and admin controls", () => {
    const feedback = readSource("components", "ScoreFeedbackPanel.vue");
    const seasonAdmin = readSource("pages", "developers", "season.vue");
    const rubricManager = readSource("components", "admin", "RubricManager.vue");
    const rubricEditor = readSource("components", "admin", "RubricDefinitionEditor.vue");

    it("uses role-specific score endpoints and hides judge identity in published feedback", () => {
        expect(feedback).toContain("props.admin ? `/api/admin/teams/${props.teamId}/scores`");
        expect(feedback).toContain(": `/api/teams/${props.teamId}/scores`");
        expect(feedback).toContain("Judge names and account IDs are hidden.");
        expect(feedback).toContain("Anonymous evaluation");
        expect(feedback).toContain("No written feedback is available.");
        expect(feedback).toContain("Feedback could not be loaded");
    });

    it("shows original score, curve display, and rank as separate result values", () => {
        expect(feedback).toContain("Original average:");
        expect(feedback).toContain("Curved display ({{ curve?.label }}):");
        expect(feedback).toContain("Rank:");
        expect(feedback).toContain("evaluation.normalized_score !== null");
        expect(feedback).toContain('evaluation.scores[criterion.id] ?? "—"');
    });

    it("persists the admin score curve and restores the saved preset on failure", () => {
        const saveCurve = between(
            seasonAdmin,
            "async function saveScoreCurvePreset",
            "const seasonNameSaving",
        );
        expect(saveCurve).toContain("if (seasonId === null) return");
        expect(saveCurve).toContain("/api/admin/seasons/${seasonId}/score-curve");
        expect(saveCurve).toContain('method: "PATCH"');
        expect(saveCurve).toContain("scoreCurvePreset.value =");
        expect(saveCurve).toContain('title: "Could not update score curve"');
        expect(seasonAdmin).toContain("The original judge average stays saved");
        expect(seasonAdmin).toContain("published ranking always uses that original score");
    });

    it("blocks invalid season rubrics until every track's criteria total 100%", () => {
        expect(rubricManager).toContain("trackEntries.length < 1 || trackEntries.length > 8");
        expect(rubricManager).toContain("track.criteria.length < 1 || track.criteria.length > 20");
        expect(rubricManager).toContain("weightTotal !== 100");
        expect(rubricManager).toContain("criterion.maxScore <= criterion.minScore");
        expect(rubricManager).toContain(
            "!loading.value && !savingVersion.value && issues.value.length === 0",
        );
        expect(rubricManager).toContain(':disabled="!canSave || !versionName.trim()"');
    });

    it("saves immutable rubric versions, supports reusable templates, and preserves history", () => {
        expect(rubricManager).toContain('method: "POST"');
        expect(rubricManager).toContain("copyDefinition(definition.value)");
        expect(rubricManager).toContain("async function copyFromSeason(customize: boolean)");
        expect(rubricManager).toContain("async function createFromTemplate");
        expect(rubricManager).toContain("async function saveTemplate(updateExisting = false)");
        expect(rubricManager).toContain('method: "PUT"');
        expect(rubricManager).toContain("Finalized scores remain attached to their saved version.");
        expect(rubricEditor).toContain("function addTrack()");
        expect(rubricEditor).toContain("function removeTrack(trackId: string)");
        expect(rubricEditor).toContain("function addCriterion(trackId: string)");
        expect(rubricEditor).toContain(
            "function removeCriterion(trackId: string, criterionId: string)",
        );
    });
});
