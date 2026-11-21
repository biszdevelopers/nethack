import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createStorage() {
    const entries = new Map<string, string>();
    return {
        get length() {
            return entries.size;
        },
        clear: () => entries.clear(),
        getItem: (key: string) => entries.get(key) ?? null,
        key: (index: number) => [...entries.keys()][index] ?? null,
        removeItem: (key: string) => {
            entries.delete(key);
        },
        setItem: (key: string, value: string) => {
            entries.set(key, value);
        },
    } as unknown as Storage;
}

describe("session draft storage", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("sessionStorage", createStorage());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("persists and restores registered form state once", async () => {
        const { persistSessionDraft, readSessionDraft, registerSessionDraft } =
            await import("~~/app/utils/session-draft");
        const unregister = registerSessionDraft("/dashboard/general", () => ({
            project: { video_url: "https://youtu.be/draft" },
        }));

        persistSessionDraft("/dashboard/general");

        expect(readSessionDraft("/dashboard/general")).toEqual({
            project: { video_url: "https://youtu.be/draft" },
        });
        expect(readSessionDraft("/dashboard/general")).toBeNull();
        unregister();
    });

    it("writes nothing for pages without unsaved state", async () => {
        const { persistSessionDraft, readSessionDraft, registerSessionDraft } =
            await import("~~/app/utils/session-draft");
        registerSessionDraft("/dashboard/general", () => null);

        persistSessionDraft("/dashboard/general");

        expect(readSessionDraft("/dashboard/general")).toBeNull();
    });

    it("keeps at most five drafts", async () => {
        const { persistSessionDraft, registerSessionDraft } =
            await import("~~/app/utils/session-draft");
        for (let index = 0; index < 6; index += 1) {
            registerSessionDraft(`/form/${index}`, () => ({ value: index }));
            persistSessionDraft(`/form/${index}`);
        }

        const keys: string[] = [];
        for (let index = 0; index < sessionStorage.length; index += 1) {
            const key = sessionStorage.key(index);
            if (key) keys.push(key);
        }

        expect(keys).toHaveLength(5);
    });
});
