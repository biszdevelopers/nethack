import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DRAFT_PREFIX = "nethack:form-draft:";

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
        entries,
    };
}

function draftKeys(store: ReturnType<typeof createStorage>) {
    return [...store.entries.keys()].filter((key) => key.startsWith(DRAFT_PREFIX));
}

describe("session draft storage branches", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("sessionStorage", createStorage());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("is a no-op when sessionStorage is unavailable", async () => {
        vi.stubGlobal("sessionStorage", undefined);
        const { persistSessionDraft, readSessionDraft, registerSessionDraft } =
            await import("~~/app/utils/session-draft");
        const unregister = registerSessionDraft("/dashboard", () => ({ value: 1 }));

        expect(() => persistSessionDraft("/dashboard")).not.toThrow();
        expect(readSessionDraft("/dashboard")).toBeNull();
        unregister();
    });

    it("treats an accessor that throws as unavailable storage", async () => {
        Object.defineProperty(globalThis, "sessionStorage", {
            configurable: true,
            get() {
                throw new Error("storage is blocked");
            },
        });
        const { persistSessionDraft, readSessionDraft, registerSessionDraft } =
            await import("~~/app/utils/session-draft");
        const unregister = registerSessionDraft("/dashboard", () => ({ value: 1 }));

        expect(() => persistSessionDraft("/dashboard")).not.toThrow();
        expect(readSessionDraft("/dashboard")).toBeNull();
        unregister();
    });

    it("ignores storage keys that are not draft entries while pruning", async () => {
        const store = createStorage();
        vi.stubGlobal("sessionStorage", store);
        store.setItem("other", "keep");
        for (let index = 0; index < 5; index += 1) {
            store.setItem(
                `${DRAFT_PREFIX}/form/${index}`,
                JSON.stringify({ savedAt: index, value: index }),
            );
        }
        const { persistSessionDraft, registerSessionDraft } =
            await import("~~/app/utils/session-draft");
        const unregister = registerSessionDraft("/form/new", () => ({ value: "new" }));

        persistSessionDraft("/form/new");

        expect(store.getItem("other")).toBe("keep");
        expect(draftKeys(store)).toHaveLength(5);
        expect(store.getItem(`${DRAFT_PREFIX}/form/0`)).toBeNull();
        unregister();
    });

    it("tolerates unparseable stored drafts and missing timestamps when pruning", async () => {
        const store = createStorage();
        vi.stubGlobal("sessionStorage", store);
        store.setItem(`${DRAFT_PREFIX}/broken`, "{not json");
        store.setItem(`${DRAFT_PREFIX}/no-time`, JSON.stringify({ value: "x" }));
        for (let index = 0; index < 4; index += 1) {
            store.setItem(
                `${DRAFT_PREFIX}/form/${index}`,
                JSON.stringify({ savedAt: 10 + index, value: index }),
            );
        }
        const { persistSessionDraft, registerSessionDraft } =
            await import("~~/app/utils/session-draft");
        const unregister = registerSessionDraft("/form/new", () => ({ value: "new" }));

        expect(() => persistSessionDraft("/form/new")).not.toThrow();

        expect(draftKeys(store)).toHaveLength(5);
        unregister();
    });

    it("skips drafts larger than the size limit", async () => {
        const store = createStorage();
        vi.stubGlobal("sessionStorage", store);
        const { persistSessionDraft, registerSessionDraft } =
            await import("~~/app/utils/session-draft");
        const unregister = registerSessionDraft("/form/huge", () => ({
            text: "x".repeat(65_000),
        }));

        persistSessionDraft("/form/huge");

        expect(draftKeys(store)).toHaveLength(0);
        unregister();
    });

    it("drops malformed JSON on read and reports null", async () => {
        const store = createStorage();
        vi.stubGlobal("sessionStorage", store);
        const { readSessionDraft } = await import("~~/app/utils/session-draft");
        const key = `${DRAFT_PREFIX}/broken`;
        store.setItem(key, "{not json");

        expect(readSessionDraft("/broken")).toBeNull();
        expect(store.getItem(key)).toBeNull();
    });

    it("returns null for a stored payload without a value", async () => {
        const store = createStorage();
        vi.stubGlobal("sessionStorage", store);
        const { readSessionDraft } = await import("~~/app/utils/session-draft");
        store.setItem(`${DRAFT_PREFIX}/empty`, JSON.stringify({ savedAt: 1 }));

        expect(readSessionDraft("/empty")).toBeNull();
    });

    it("removes an unreadable entry when getItem throws", async () => {
        const removeItem = vi.fn();
        const store = createStorage();
        const failing = {
            get length() {
                return 0;
            },
            key: () => null,
            getItem: () => {
                throw new Error("storage read failed");
            },
            removeItem,
            setItem: store.setItem,
            clear: store.clear,
        };
        vi.stubGlobal("sessionStorage", failing);
        const { readSessionDraft } = await import("~~/app/utils/session-draft");

        expect(readSessionDraft("/broken")).toBeNull();
        expect(removeItem).toHaveBeenCalledWith(`${DRAFT_PREFIX}/broken`);
    });

    it("keeps a newer registration when an older unregister runs", async () => {
        const first = vi.fn(() => ({ value: "first" }));
        const second = vi.fn(() => ({ value: "second" }));
        const { registerSessionDraft, persistSessionDraft, readSessionDraft } =
            await import("~~/app/utils/session-draft");
        const unregisterFirst = registerSessionDraft("/dashboard", first);
        const unregisterSecond = registerSessionDraft("/dashboard", second);

        unregisterFirst();
        persistSessionDraft("/dashboard");

        expect(readSessionDraft("/dashboard")).toEqual({ value: "second" });
        expect(first).not.toHaveBeenCalled();
        unregisterSecond();
    });

    it("treats a missing draft value while pruning as unparseable", async () => {
        const store = createStorage();
        const keyed = {
            get length() {
                return 1;
            },
            key: () => `${DRAFT_PREFIX}/missing`,
            getItem: () => null,
            removeItem: vi.fn(),
            setItem: store.setItem,
            clear: store.clear,
        };
        vi.stubGlobal("sessionStorage", keyed);
        const { persistSessionDraft, registerSessionDraft } =
            await import("~~/app/utils/session-draft");
        const unregister = registerSessionDraft("/form/new", () => ({ value: 1 }));

        expect(() => persistSessionDraft("/form/new")).not.toThrow();
        unregister();
    });
});
