import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (...segments: string[]) =>
    readFileSync(resolve(import.meta.dirname, "..", "..", ...segments), "utf-8");

const queuePage = readSource("app", "pages", "judging", "continue.vue");

describe("judging workspace summary degradation", () => {
    it("never blocks the queue or rubric gates on the optional ballot summary", () => {
        expect(queuePage).toContain(
            "() => navigationError.value || queueFetch.error.value || rubricFetch.error.value",
        );
        const loadingBlock = queuePage.slice(
            queuePage.indexOf("const isLoading = computed("),
            queuePage.indexOf("const activeProjectNumber"),
        );
        expect(loadingBlock).toContain("queueFetch.status.value");
        expect(loadingBlock).toContain("rubricFetch.status.value");
        expect(loadingBlock).not.toContain("summaryFetch");
        const errorBlock = queuePage.slice(
            queuePage.indexOf("const queueError = computed("),
            queuePage.indexOf("const isLoading = computed("),
        );
        expect(errorBlock).not.toContain("summaryFetch");
    });

    it("keeps progress and Next unscored available with a retry after a summary failure", () => {
        expect(queuePage).toContain("const summaryFailed = computed(");
        expect(queuePage).toContain("Progress summary unavailable");
        expect(queuePage).toContain("Retry progress");
        expect(queuePage).toContain("const pages = Object.values(queuePages.value);");
        expect(queuePage).toContain('v-if="!summaryFailed && !hasPendingProjects"');
    });

    it("does not let a rejected retry stop the other fetches", () => {
        expect(queuePage).toContain(
            "void Promise.allSettled([queueFetch.refresh(), summaryFetch.refresh(), rubricFetch.refresh()])",
        );
    });

    it("reloads server state for a 409 already-scored response", () => {
        expect(queuePage).toContain('status === 409 || message.includes("already scored")');
        expect(queuePage).toContain("const foundNext = await recordFinalizedEvaluation(team);");
        expect(queuePage).toContain("await refreshQueuePage(currentPage.value)");
    });

    it("waits for the queue even when the summary fails before auto-advancing", () => {
        expect(queuePage).toContain(
            'if (summaryStatus !== "success" && summaryStatus !== "error") return;',
        );
    });
});

describe("rubric manager load failure", () => {
    const manager = readSource("app", "components", "admin", "RubricManager.vue");

    it("hides the editor and refuses to save defaults after a load failure", () => {
        expect(manager).toContain("!loadError.value && issues.value.length === 0");
        expect(manager).toContain('v-else-if="loadError"');
        expect(manager).toContain("Reload the rubric before editing.");
        expect(manager).toContain("if (yamlManaged.value || loadError.value) return;");
        expect(manager).toContain("if (loadError.value) return;");
    });
});
