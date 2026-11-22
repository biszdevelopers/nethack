import { describe, expect, it } from "vitest";
import {
    applyProjectFormDraft,
    projectAutosavePayload,
    reconcileProjectForm,
    sameProjectForm,
    snapshotProjectForm,
    type ProjectFormState,
} from "~~/app/utils/project-autosave";

function state(overrides: Partial<ProjectFormState["project"]> = {}): ProjectFormState {
    return {
        name: "Team One",
        pathway: "junior",
        project: {
            name: "Project",
            description: "A sufficiently long project description.",
            repo_url: "https://github.com/example/project",
            demo_url: "https://example.com",
            video_url: "https://youtu.be/example",
            sourcing: "No AI tools or models were used in this project.",
            ...overrides,
        },
    };
}

describe("project autosave helpers", () => {
    it("snapshots are deep copies taken at call time", () => {
        const live = state();
        const sent = snapshotProjectForm(live);

        live.project.name = "Changed while the request was in flight";

        expect(sent.project.name).toBe("Project");
        expect(sameProjectForm(live, sent)).toBe(false);
    });

    it("sends only fields changed since the saved snapshot and keeps blank URLs null", () => {
        const saved = state();
        const current = state({ name: "Renamed", demo_url: "", video_url: "" });

        const payload = projectAutosavePayload(current, saved);

        expect(payload).toEqual({
            project: { name: "Renamed", demo_url: null, video_url: null },
        });
    });

    it("keeps edits typed during a request dirty after the sent snapshot is saved", () => {
        const lastSaved = state();
        const sent = snapshotProjectForm(state({ name: "Sent name" }));
        const current = state({ name: "Typed after the request started" });

        expect(sameProjectForm(current, sent)).toBe(false);
        expect(projectAutosavePayload(current, sent)).toEqual({
            project: { name: "Typed after the request started" },
        });
        expect(sameProjectForm(current, lastSaved)).toBe(false);
    });

    it("reconciles clean fields from the server while preserving in-flight edits", () => {
        const lastSaved = state();
        const current = state({ description: "Locally edited description" });
        const incoming = state({
            description: "Server description",
            repo_url: "https://github.com/example/server",
        });

        const reconciled = reconcileProjectForm(current, lastSaved, incoming);

        expect(reconciled.form.project.description).toBe("Locally edited description");
        expect(reconciled.lastSaved.project.description).toBe(
            "A sufficiently long project description.",
        );
        expect(reconciled.form.project.repo_url).toBe("https://github.com/example/server");
        expect(reconciled.lastSaved.project.repo_url).toBe("https://github.com/example/server");
        expect(sameProjectForm(reconciled.form, reconciled.lastSaved)).toBe(false);
    });

    it("restores a cleared URL as an empty field", () => {
        const restored = applyProjectFormDraft(state(), {
            project: { demo_url: null as never, repo_url: null as never },
        });

        expect(restored.project.demo_url).toBe("");
        expect(restored.project.repo_url).toBe("");
    });

    it("restores only valid draft fields", () => {
        const restored = applyProjectFormDraft(state(), {
            name: "Draft name",
            project: { video_url: "https://youtu.be/draft", sourcing: 42 as never },
        });

        expect(restored.name).toBe("Draft name");
        expect(restored.project.video_url).toBe("https://youtu.be/draft");
        expect(restored.project.sourcing).toBe("No AI tools or models were used in this project.");
    });
});
