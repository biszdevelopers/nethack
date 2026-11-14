import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NethackPermissions } from "~~/shared/permissions";
import { DEFAULT_RUBRIC_DEFINITION } from "~~/shared/rubric";
import { mockBody, mockParams, resetMockState, setupNitroGlobals } from "~~/tests/api/helpers";

const rubricDatabase = vi.hoisted(() => ({
    listRubricTemplates: vi.fn(),
    createRubricTemplate: vi.fn(),
    updateRubricTemplate: vi.fn(),
    deleteRubricTemplate: vi.fn(),
    createRubricVersion: vi.fn(),
}));

vi.mock("~~/server/utils/database/rubrics", () => rubricDatabase);

const event = { context: {} };
const user = { id: 17, role: "admin" };
const template = { id: 3, name: "Junior", description: null };
const rubricBody = {
    name: "Junior",
    description: "A reusable rubric",
    definition: DEFAULT_RUBRIC_DEFINITION,
};
const versionBody = {
    name: "Season rubric",
    definition: DEFAULT_RUBRIC_DEFINITION,
};

let listTemplates: (event: unknown) => Promise<unknown>;
let createTemplate: (event: unknown) => Promise<unknown>;
let updateTemplate: (event: unknown) => Promise<unknown>;
let deleteTemplate: (event: unknown) => Promise<unknown>;
let createSeasonRubric: (event: unknown) => Promise<unknown>;

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("readValidatedBody", async (_event: unknown, parse: (body: unknown) => unknown) =>
        parse(mockBody.value),
    );

    listTemplates = (await import("~~/server/api/admin/rubric-templates/index.get")).default;
    createTemplate = (await import("~~/server/api/admin/rubric-templates/index.post")).default;
    updateTemplate = (await import("~~/server/api/admin/rubric-templates/[id].put")).default;
    deleteTemplate = (await import("~~/server/api/admin/rubric-templates/[id].delete")).default;
    createSeasonRubric = (await import("~~/server/api/admin/seasons/[id]/rubric.post")).default;
});

beforeEach(() => {
    resetMockState();
    vi.mocked(globalThis.requireUser).mockResolvedValue(user as never);
    rubricDatabase.listRubricTemplates.mockReset();
    rubricDatabase.createRubricTemplate.mockReset();
    rubricDatabase.updateRubricTemplate.mockReset();
    rubricDatabase.deleteRubricTemplate.mockReset();
    rubricDatabase.createRubricVersion.mockReset();
    mockBody.value = undefined;
    mockParams.values = {};
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("rubric template routes", () => {
    it("authorizes and returns the listed templates", async () => {
        rubricDatabase.listRubricTemplates.mockResolvedValue([template]);

        await expect(listTemplates(event)).resolves.toEqual({ templates: [template] });
        expect(globalThis.requireUser).toHaveBeenCalledWith(
            event,
            NethackPermissions.Seasons.update,
        );
        expect(rubricDatabase.listRubricTemplates).toHaveBeenCalledWith(event);
    });

    it("does not list templates when authorization fails", async () => {
        vi.mocked(globalThis.requireUser).mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { statusCode: 403 }),
        );

        await expect(listTemplates(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(rubricDatabase.listRubricTemplates).not.toHaveBeenCalled();
    });

    it("creates a template and records the acting user", async () => {
        mockBody.value = rubricBody;
        rubricDatabase.createRubricTemplate.mockResolvedValue(template);

        await expect(createTemplate(event)).resolves.toEqual({ template });
        expect(rubricDatabase.createRubricTemplate).toHaveBeenCalledWith(event, {
            ...rubricBody,
            createdBy: user.id,
        });
    });

    it("validates template input before writing", async () => {
        mockBody.value = { ...rubricBody, name: "  " };

        await expect(createTemplate(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(rubricDatabase.createRubricTemplate).not.toHaveBeenCalled();
    });

    it("returns an internal error when template creation returns no row", async () => {
        mockBody.value = rubricBody;
        rubricDatabase.createRubricTemplate.mockResolvedValue(undefined);

        await expect(createTemplate(event)).rejects.toMatchObject({ statusCode: 500 });
    });

    it("maps duplicate template names to conflict", async () => {
        mockBody.value = rubricBody;
        rubricDatabase.createRubricTemplate.mockRejectedValueOnce(
            Object.assign(new Error("unique violation"), { code: "23505" }),
        );

        await expect(createTemplate(event)).rejects.toMatchObject({ statusCode: 409 });
    });

    it("preserves non-unique template creation failures", async () => {
        const failure = new Error("database unavailable");
        mockBody.value = rubricBody;
        rubricDatabase.createRubricTemplate.mockRejectedValueOnce(failure);

        await expect(createTemplate(event)).rejects.toBe(failure);
    });

    it("updates a template by validated ID", async () => {
        mockParams.values.id = "3";
        mockBody.value = rubricBody;
        rubricDatabase.updateRubricTemplate.mockResolvedValue(template);

        await expect(updateTemplate(event)).resolves.toEqual({ template });
        expect(rubricDatabase.updateRubricTemplate).toHaveBeenCalledWith(event, 3, rubricBody);
    });

    it.each(["0", "-1", "nope"])("rejects invalid template ID %s", async (id) => {
        mockParams.values.id = id;
        mockBody.value = rubricBody;

        await expect(updateTemplate(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(rubricDatabase.updateRubricTemplate).not.toHaveBeenCalled();
    });

    it("validates update body before writing", async () => {
        mockParams.values.id = "3";
        mockBody.value = { ...rubricBody, definition: { tracks: {} } };

        await expect(updateTemplate(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(rubricDatabase.updateRubricTemplate).not.toHaveBeenCalled();
    });

    it("returns not found when the template update matches no row", async () => {
        mockParams.values.id = "3";
        mockBody.value = rubricBody;
        rubricDatabase.updateRubricTemplate.mockResolvedValue(undefined);

        await expect(updateTemplate(event)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("maps duplicate update names to conflict", async () => {
        mockParams.values.id = "3";
        mockBody.value = rubricBody;
        rubricDatabase.updateRubricTemplate.mockRejectedValueOnce(
            Object.assign(new Error("unique violation"), { code: "23505" }),
        );

        await expect(updateTemplate(event)).rejects.toMatchObject({ statusCode: 409 });
    });

    it("preserves other template update failures", async () => {
        const failure = new Error("database unavailable");
        mockParams.values.id = "3";
        mockBody.value = rubricBody;
        rubricDatabase.updateRubricTemplate.mockRejectedValueOnce(failure);

        await expect(updateTemplate(event)).rejects.toBe(failure);
    });

    it("deletes a template", async () => {
        mockParams.values.id = "3";
        rubricDatabase.deleteRubricTemplate.mockResolvedValue({ id: 3 });

        await expect(deleteTemplate(event)).resolves.toEqual({
            message: "Rubric template deleted.",
        });
        expect(rubricDatabase.deleteRubricTemplate).toHaveBeenCalledWith(event, 3);
    });

    it("rejects deletion when the template does not exist", async () => {
        mockParams.values.id = "3";
        rubricDatabase.deleteRubricTemplate.mockResolvedValue(undefined);

        await expect(deleteTemplate(event)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("validates delete IDs before calling the database", async () => {
        mockParams.values.id = "0";

        await expect(deleteTemplate(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(rubricDatabase.deleteRubricTemplate).not.toHaveBeenCalled();
    });
});

describe("season rubric route", () => {
    it("creates a rubric version with the current user's ID", async () => {
        mockParams.values.id = "12";
        mockBody.value = versionBody;
        const version = { id: 8, season_id: 12, version: 1 };
        rubricDatabase.createRubricVersion.mockResolvedValue(version);

        await expect(createSeasonRubric(event)).resolves.toEqual({ active: version });
        expect(rubricDatabase.createRubricVersion).toHaveBeenCalledWith(event, 12, {
            ...versionBody,
            createdBy: user.id,
        });
    });

    it("returns not found for a missing season", async () => {
        mockParams.values.id = "404";
        mockBody.value = versionBody;
        rubricDatabase.createRubricVersion.mockResolvedValue(null);

        await expect(createSeasonRubric(event)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("rejects invalid season IDs before creating a rubric", async () => {
        mockParams.values.id = "0";
        mockBody.value = versionBody;

        await expect(createSeasonRubric(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(rubricDatabase.createRubricVersion).not.toHaveBeenCalled();
    });

    it("rejects invalid rubric source choices before creating a version", async () => {
        mockParams.values.id = "12";
        mockBody.value = {
            name: "Invalid",
            definition: DEFAULT_RUBRIC_DEFINITION,
            sourceTemplateId: 4,
        };

        await expect(createSeasonRubric(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(rubricDatabase.createRubricVersion).not.toHaveBeenCalled();
    });

    it("does not create a season rubric when authorization fails", async () => {
        vi.mocked(globalThis.requireUser).mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { statusCode: 403 }),
        );
        mockParams.values.id = "12";
        mockBody.value = versionBody;

        await expect(createSeasonRubric(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(rubricDatabase.createRubricVersion).not.toHaveBeenCalled();
    });
});
