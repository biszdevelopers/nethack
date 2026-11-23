import { describe, expect, it } from "vitest";
import {
    applyProjectFormDraft,
    projectAutosavePayload,
    reconcileProjectForm,
    type ProjectFormState,
} from "~~/app/utils/project-autosave";

function state(overrides: Partial<ProjectFormState> = {}): ProjectFormState {
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
        },
        ...overrides,
    };
}

describe("project autosave payload branches", () => {
    it("sends renamed team and pathway changes only when present", () => {
        const saved = state();
        const payload = projectAutosavePayload(
            state({ name: "Renamed", pathway: "senior" }),
            saved,
        );

        expect(payload).toEqual({ name: "Renamed", pathway: "senior" });
    });

    it("skips an empty pathway but still sends a renamed team", () => {
        const payload = projectAutosavePayload(state({ name: "Renamed", pathway: "" }), state());

        expect(payload).toEqual({ name: "Renamed" });
    });

    it("returns an empty payload when nothing changed", () => {
        expect(projectAutosavePayload(state(), state())).toEqual({});
    });

    it("keeps non-URL fields as-is and sends changed URL fields", () => {
        const payload = projectAutosavePayload(
            state({
                project: {
                    ...state().project,
                    description: "Changed description",
                    sourcing: "Changed sourcing",
                    repo_url: "https://github.com/example/next",
                },
            }),
            state(),
        );

        expect(payload).toEqual({
            project: {
                description: "Changed description",
                sourcing: "Changed sourcing",
                repo_url: "https://github.com/example/next",
            },
        });
    });
});

describe("project form reconciliation branches", () => {
    it("keeps dirty team, pathway, and project fields while refreshing clean ones", () => {
        const lastSaved = state();
        const current = state({
            name: "Local team",
            pathway: "senior",
            project: { ...lastSaved.project, description: "Local description" },
        });
        const incoming = state({
            name: "Server team",
            pathway: "open",
            project: {
                ...lastSaved.project,
                description: "Server description",
                repo_url: "https://github.com/example/server",
            },
        });

        const { form, lastSaved: base } = reconcileProjectForm(current, lastSaved, incoming);

        expect(form.name).toBe("Local team");
        expect(base.name).toBe("Team One");
        expect(form.pathway).toBe("senior");
        expect(base.pathway).toBe("junior");
        expect(form.project.description).toBe("Local description");
        expect(base.project.description).toBe(lastSaved.project.description);
        expect(form.project.repo_url).toBe("https://github.com/example/server");
        expect(base.project.repo_url).toBe("https://github.com/example/server");
    });
});

describe("project draft restoration branches", () => {
    it("restores a draft pathway and accepts a draft without project fields", () => {
        const restored = applyProjectFormDraft(state(), { pathway: "senior" });

        expect(restored.pathway).toBe("senior");
        expect(restored.project).toEqual(state().project);
    });

    it("ignores non-string draft fields", () => {
        const restored = applyProjectFormDraft(state(), {
            name: 42 as never,
            pathway: null as never,
            project: { name: 7 as never },
        });

        expect(restored.name).toBe("Team One");
        expect(restored.pathway).toBe("junior");
        expect(restored.project.name).toBe("Project");
    });
});
