type DraftSource = () => Record<string, unknown> | null;

const DRAFT_KEY_PREFIX = "nethack:form-draft:";
const MAX_DRAFT_LENGTH = 64_000;
const MAX_DRAFTS = 5;

const sources = new Map<string, DraftSource>();

/** Registers the unsaved state a page wants preserved when the session expires. */
export function registerSessionDraft(path: string, source: DraftSource): () => void {
    sources.set(path, source);
    return () => {
        if (sources.get(path) === source) sources.delete(path);
    };
}

function draftStorage(): Storage | null {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
        return null;
    }
}

function pruneDrafts(store: Storage) {
    const entries: { key: string; savedAt: number }[] = [];
    for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        if (!key?.startsWith(DRAFT_KEY_PREFIX)) continue;
        try {
            const parsed = JSON.parse(store.getItem(key) ?? "") as { savedAt?: number };
            entries.push({ key, savedAt: Number(parsed.savedAt) || 0 });
        } catch {
            entries.push({ key, savedAt: 0 });
        }
    }
    entries.sort((left, right) => right.savedAt - left.savedAt);
    for (const entry of entries.slice(MAX_DRAFTS)) store.removeItem(entry.key);
}

/** Stored only in the tab's sessionStorage, bounded in size and count. */
export function persistSessionDraft(path: string): void {
    const source = sources.get(path);
    const store = draftStorage();
    if (!source || !store) return;

    try {
        const value = source();
        if (!value) return;
        const serialized = JSON.stringify({ savedAt: Date.now(), value });
        if (serialized.length > MAX_DRAFT_LENGTH) return;
        store.setItem(`${DRAFT_KEY_PREFIX}${path}`, serialized);
        pruneDrafts(store);
    } catch {
        // Storage can be disabled or full; losing this draft must not block login.
    }
}

export function readSessionDraft<T>(path: string): T | null {
    const store = draftStorage();
    if (!store) return null;

    const key = `${DRAFT_KEY_PREFIX}${path}`;
    try {
        const raw = store.getItem(key);
        if (!raw) return null;
        store.removeItem(key);
        return ((JSON.parse(raw) as { value?: T }).value ?? null) as T | null;
    } catch {
        store.removeItem(key);
        return null;
    }
}
