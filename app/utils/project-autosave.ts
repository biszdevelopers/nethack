export type ProjectFormState = {
    name: string;
    pathway: string;
    project: {
        name: string;
        description: string;
        repo_url: string;
        demo_url: string;
        video_url: string;
        sourcing: string;
    };
};

export type ProjectFormDraft = {
    name?: string;
    pathway?: string;
    project?: Partial<ProjectFormState["project"]>;
};

const PROJECT_FIELDS = [
    "name",
    "description",
    "sourcing",
    "demo_url",
    "repo_url",
    "video_url",
] as const;

const URL_FIELDS = new Set<(typeof PROJECT_FIELDS)[number]>(["demo_url", "repo_url", "video_url"]);

export function snapshotProjectForm(state: ProjectFormState): ProjectFormState {
    return {
        name: state.name,
        pathway: state.pathway,
        project: {
            name: state.project.name,
            description: state.project.description,
            sourcing: state.project.sourcing,
            demo_url: state.project.demo_url,
            repo_url: state.project.repo_url,
            video_url: state.project.video_url,
        },
    };
}

export function sameProjectForm(left: ProjectFormState, right: ProjectFormState): boolean {
    return (
        left.name === right.name &&
        left.pathway === right.pathway &&
        PROJECT_FIELDS.every((field) => left.project[field] === right.project[field])
    );
}

export function projectAutosavePayload(
    current: ProjectFormState,
    lastSaved: ProjectFormState,
): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (current.name !== lastSaved.name) payload.name = current.name;
    if (current.pathway && current.pathway !== lastSaved.pathway) payload.pathway = current.pathway;

    const project: Record<string, unknown> = {};
    for (const field of PROJECT_FIELDS) {
        if (current.project[field] === lastSaved.project[field]) continue;
        project[field] = URL_FIELDS.has(field)
            ? current.project[field] || null
            : current.project[field];
    }
    if (Object.keys(project).length > 0) payload.project = project;
    return payload;
}

/**
 * Copies server values into clean fields only. Fields the user changed since
 * the last save keep their local value and stay dirty.
 */
export function reconcileProjectForm(
    current: ProjectFormState,
    lastSaved: ProjectFormState,
    incoming: ProjectFormState,
): { form: ProjectFormState; lastSaved: ProjectFormState } {
    const form = snapshotProjectForm(current);
    const base = snapshotProjectForm(lastSaved);

    if (current.name === lastSaved.name) {
        form.name = incoming.name;
        base.name = incoming.name;
    }
    if (current.pathway === lastSaved.pathway) {
        form.pathway = incoming.pathway;
        base.pathway = incoming.pathway;
    }
    for (const field of PROJECT_FIELDS) {
        if (current.project[field] !== lastSaved.project[field]) continue;
        form.project[field] = incoming.project[field];
        base.project[field] = incoming.project[field];
    }

    return { form, lastSaved: base };
}

export function applyProjectFormDraft(
    current: ProjectFormState,
    draft: ProjectFormDraft,
): ProjectFormState {
    const form = snapshotProjectForm(current);
    if (typeof draft.name === "string") form.name = draft.name;
    if (typeof draft.pathway === "string") form.pathway = draft.pathway;
    const project = draft.project ?? {};
    for (const field of PROJECT_FIELDS) {
        const value = project[field];
        if (typeof value === "string") form.project[field] = value;
    }
    return form;
}
