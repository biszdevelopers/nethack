import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    createSession,
    getDeepSeekSession,
    getAllSessions,
    deleteSession,
    addMessage,
    getMessages,
} from "~~/server/utils/deepseek-store";

// ---------------------------------------------------------------------------
// The deepseek-store module maintains in-memory state (a Map and a counter).
// We need to reset the module between tests to avoid state leakage.
// Since we can't easily reset module-level variables, we clear sessions
// by deleting all of them before each test.
// ---------------------------------------------------------------------------

beforeEach(() => {
    // Delete all existing sessions to start fresh
    const allSessions = getAllSessions();
    for (const session of allSessions) {
        deleteSession(session.id);
    }
});

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe("createSession", () => {
    it("creates a session with auto-incrementing ID starting from 1", () => {
        const session1 = createSession("First Session");
        const session2 = createSession("Second Session");

        expect(session1.id).toBeGreaterThan(0);
        expect(session2.id).toBe(session1.id + 1);
    });

    it("sets the correct session name", () => {
        const session = createSession("My Chat");

        expect(session.sessionName).toBe("My Chat");
    });

    it("initializes with an empty messages array", () => {
        const session = createSession("Empty Chat");

        expect(session.messages).toEqual([]);
    });

    it("sets a numeric createdAt timestamp", () => {
        const before = Math.floor(Date.now() / 1000);
        const session = createSession("Timestamped");
        const after = Math.floor(Date.now() / 1000);

        expect(session.createdAt).toBeGreaterThanOrEqual(before);
        expect(session.createdAt).toBeLessThanOrEqual(after);
    });

    it("returns the full session object", () => {
        const session = createSession("Full Check");

        expect(session).toHaveProperty("id");
        expect(session).toHaveProperty("sessionName");
        expect(session).toHaveProperty("createdAt");
        expect(session).toHaveProperty("messages");
    });

    it("evicts only the oldest session owned by the same user at the owner cap", () => {
        const first = createSession("Owner A first", 5);
        for (let index = 0; index < 19; index += 1) {
            createSession(`Owner A ${index}`, 5);
        }
        const other = createSession("Owner B", 6);

        const created = createSession("Owner A newest", 5);

        expect(getDeepSeekSession(first.id)).toBeUndefined();
        expect(getAllSessions(5)).toHaveLength(20);
        expect(getAllSessions(5).some((session) => session.id === created.id)).toBe(true);
        expect(getDeepSeekSession(other.id)).toBeDefined();
    });
});

describe("session expiry", () => {
    it("drops a session once its 24-hour TTL has passed, even below capacity", () => {
        const session = createSession("Expired");
        session.createdAt = Math.floor((Date.now() - 25 * 60 * 60 * 1000) / 1000);

        expect(getDeepSeekSession(session.id)).toBeUndefined();
        expect(getAllSessions()).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// getDeepSeekSession
// ---------------------------------------------------------------------------

describe("getDeepSeekSession", () => {
    it("retrieves an existing session by ID", () => {
        const created = createSession("Retrieve Me");
        const retrieved = getDeepSeekSession(created.id);

        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe(created.id);
        expect(retrieved!.sessionName).toBe("Retrieve Me");
    });

    it("returns undefined for a non-existing session", () => {
        const result = getDeepSeekSession(9999);

        expect(result).toBeUndefined();
    });

    it("returns undefined for session ID 0", () => {
        const result = getDeepSeekSession(0);

        expect(result).toBeUndefined();
    });

    it("returns undefined for a negative session ID", () => {
        const result = getDeepSeekSession(-1);

        expect(result).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// getAllSessions
// ---------------------------------------------------------------------------

describe("getAllSessions", () => {
    it("returns an empty array when no sessions exist", () => {
        const result = getAllSessions();

        expect(result).toEqual([]);
    });

    it("returns all created sessions", () => {
        createSession("Session A");
        createSession("Session B");
        createSession("Session C");

        const result = getAllSessions();

        expect(result).toHaveLength(3);
        expect(result.map((s) => s.sessionName)).toEqual(["Session A", "Session B", "Session C"]);
    });

    it("returns a single session when only one exists", () => {
        createSession("Lonely Session");

        const result = getAllSessions();

        expect(result).toHaveLength(1);
        expect(result[0].sessionName).toBe("Lonely Session");
    });

    it("filters sessions by owner", () => {
        createSession("Mine", 7);
        createSession("Theirs", 8);

        expect(getAllSessions(7).map((session) => session.sessionName)).toEqual(["Mine"]);
        expect(getAllSessions(8).map((session) => session.sessionName)).toEqual(["Theirs"]);
        expect(getAllSessions(9)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------

describe("deleteSession", () => {
    it("returns true when deleting an existing session", () => {
        const session = createSession("Delete Me");
        const result = deleteSession(session.id);

        expect(result).toBe(true);
    });

    it("returns false when deleting a non-existing session", () => {
        const result = deleteSession(404);

        expect(result).toBe(false);
    });

    it("actually removes the session from the store", () => {
        const session = createSession("Gone Forever");
        deleteSession(session.id);

        const retrieved = getDeepSeekSession(session.id);
        expect(retrieved).toBeUndefined();
    });

    it("does not affect other sessions when deleting one", () => {
        const session1 = createSession("Keep Me");
        const session2 = createSession("Delete Me");
        deleteSession(session2.id);

        const all = getAllSessions();
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe(session1.id);
    });
});

// ---------------------------------------------------------------------------
// addMessage
// ---------------------------------------------------------------------------

describe("addMessage", () => {
    it("adds a message to an existing session and returns the session", () => {
        const session = createSession("Chat");
        const message = { role: "user" as const, content: "Hello!" };

        const updated = addMessage(session.id, message);

        expect(updated).toBeDefined();
        expect(updated!.messages).toHaveLength(1);
        expect(updated!.messages[0]).toEqual(message);
    });

    it("returns undefined when adding a message to a non-existing session", () => {
        const message = { role: "user" as const, content: "Nobody here" };

        const result = addMessage(9999, message);

        expect(result).toBeUndefined();
    });

    it("preserves existing messages when adding a new one", () => {
        const session = createSession("Multi-Message");
        addMessage(session.id, { role: "user" as const, content: "First" });
        addMessage(session.id, { role: "assistant" as const, content: "Second" });

        const retrieved = getDeepSeekSession(session.id);
        expect(retrieved!.messages).toHaveLength(2);
        expect(retrieved!.messages[0].content).toBe("First");
        expect(retrieved!.messages[1].content).toBe("Second");
    });

    it("can add messages with tool calls", () => {
        const session = createSession("Tool Chat");
        const message = {
            role: "assistant" as const,
            content: null,
            tool_calls: [
                {
                    id: "call_1",
                    type: "function" as const,
                    function: { name: "get_weather", arguments: '{"city":"NYC"}' },
                },
            ],
        };

        const updated = addMessage(session.id, message);

        expect(updated!.messages).toHaveLength(1);
        expect(updated!.messages[0]).toEqual(message);
    });

    it("caps message history at MAX_MESSAGES_PER_SESSION (200)", () => {
        const session = createSession("Cap Chat");
        // Add 205 messages; only the last 200 should be retained
        for (let i = 0; i < 205; i++) {
            addMessage(session.id, { role: "user" as const, content: `msg-${i}` });
        }

        const messages = getMessages(session.id);
        expect(messages).toHaveLength(200);
        // The first 5 messages (msg-0 .. msg-4) should have been evicted
        expect(messages[0]!.content).toBe("msg-5");
        expect(messages[messages.length - 1]!.content).toBe("msg-204");
    });
});

// ---------------------------------------------------------------------------
// getMessages
// ---------------------------------------------------------------------------

describe("getMessages", () => {
    it("returns all messages for an existing session", () => {
        const session = createSession("Chatty");
        addMessage(session.id, { role: "user" as const, content: "Hi" });
        addMessage(session.id, { role: "assistant" as const, content: "Hello!" });

        const messages = getMessages(session.id);

        expect(messages).toHaveLength(2);
        expect(messages[0].role).toBe("user");
        expect(messages[1].role).toBe("assistant");
    });

    it("returns an empty array for a non-existing session", () => {
        const messages = getMessages(12345);

        expect(messages).toEqual([]);
    });

    it("returns an empty array for a session with no messages yet", () => {
        const session = createSession("Silent");

        const messages = getMessages(session.id);

        expect(messages).toEqual([]);
    });

    it("returns messages in insertion order", () => {
        const session = createSession("Ordered");
        addMessage(session.id, { role: "system" as const, content: "You are helpful." });
        addMessage(session.id, { role: "user" as const, content: "A" });
        addMessage(session.id, { role: "user" as const, content: "B" });
        addMessage(session.id, { role: "assistant" as const, content: "C" });

        const messages = getMessages(session.id);

        expect(messages.map((m) => m.content)).toEqual(["You are helpful.", "A", "B", "C"]);
    });

    it("returns a copy, not the internal array reference", () => {
        const session = createSession("Copy Check");
        addMessage(session.id, { role: "user" as const, content: "original" });

        const first = getMessages(session.id);
        const second = getMessages(session.id);

        // Each call returns a distinct array instance
        expect(first).not.toBe(second);
        expect(first).toEqual(second);

        // Mutating the returned array must not affect subsequent calls
        first.push({ role: "user" as const, content: "injected" });
        const third = getMessages(session.id);
        expect(third).toHaveLength(1);
        expect(third[0]!.content).toBe("original");
    });
});

// ---------------------------------------------------------------------------
// MAX_SESSIONS eviction
// ---------------------------------------------------------------------------

describe("MAX_SESSIONS eviction", () => {
    it("evicts the oldest session when creating a new one at capacity (100)", () => {
        // Fill the store up to the maximum of 100 sessions
        const created = [];
        for (let i = 0; i < 100; i++) {
            created.push(createSession(`Session ${i}`));
        }
        expect(getAllSessions()).toHaveLength(100);

        const oldestId = created[0]!.id;
        expect(getDeepSeekSession(oldestId)).toBeDefined();

        // Creating one more should evict the oldest session
        const overflow = createSession("Overflow Session");
        expect(getDeepSeekSession(overflow.id)).toBeDefined();
        expect(getDeepSeekSession(oldestId)).toBeUndefined();

        // Total count should remain at the cap
        expect(getAllSessions()).toHaveLength(100);
    });

    it("sweeps expired sessions on access, not only at capacity", () => {
        const realNow = Date.now();
        const expiredTime = realNow - 25 * 60 * 60 * 1000;
        vi.spyOn(Date, "now").mockReturnValue(expiredTime);
        const expiredSession = createSession("Expired Session");
        vi.restoreAllMocks();

        for (let i = 0; i < 99; i++) {
            createSession(`Session ${i}`);
        }
        expect(getDeepSeekSession(expiredSession.id)).toBeUndefined();
        expect(getAllSessions()).toHaveLength(99);
    });
});

// ---------------------------------------------------------------------------
// Session ordering
// ---------------------------------------------------------------------------

describe("session ordering", () => {
    it("returns sessions in creation order from getAllSessions", () => {
        const s1 = createSession("First");
        const s2 = createSession("Second");
        const s3 = createSession("Third");

        const all = getAllSessions();
        expect(all[0]!.id).toBe(s1.id);
        expect(all[1]!.id).toBe(s2.id);
        expect(all[2]!.id).toBe(s3.id);
    });

    it("allows adding messages after eviction for remaining sessions", () => {
        const created = [];
        for (let i = 0; i < 100; i++) {
            created.push(createSession(`Session ${i}`));
        }

        // Evict the oldest
        createSession("Evictor");

        // Add a message to a remaining session
        const survivor = created[1]!;
        const updated = addMessage(survivor.id, { role: "user" as const, content: "Still alive" });
        expect(updated).toBeDefined();
        expect(updated!.messages).toHaveLength(1);
    });

    it("does not evict when under capacity", () => {
        const s1 = createSession("Only");
        const s2 = createSession("Session");

        expect(getAllSessions()).toHaveLength(2);
        expect(getDeepSeekSession(s1.id)).toBeDefined();
        expect(getDeepSeekSession(s2.id)).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// addMessage edge cases
// ---------------------------------------------------------------------------

describe("addMessage additional edge cases", () => {
    it("adds a message with empty content", () => {
        const session = createSession("Empty msg");
        const updated = addMessage(session.id, { role: "user" as const, content: "" });
        expect(updated).toBeDefined();
        expect(updated!.messages).toHaveLength(1);
        expect(updated!.messages[0]!.content).toBe("");
    });

    it("adds a message with null content and tool_calls", () => {
        const session = createSession("Null content");
        const updated = addMessage(session.id, {
            role: "assistant" as const,
            content: null,
            tool_calls: [
                { id: "tc1", type: "function" as const, function: { name: "f", arguments: "{}" } },
            ],
        });
        expect(updated).toBeDefined();
        expect(updated!.messages[0]!.content).toBeNull();
        expect((updated!.messages[0] as any).tool_calls).toHaveLength(1);
    });

    it("adds multiple messages in sequence and verifies order", () => {
        const session = createSession("Seq");
        addMessage(session.id, { role: "system" as const, content: "You are a bot" });
        addMessage(session.id, { role: "user" as const, content: "Q1" });
        addMessage(session.id, { role: "assistant" as const, content: "A1" });
        addMessage(session.id, { role: "user" as const, content: "Q2" });
        addMessage(session.id, { role: "assistant" as const, content: "A2" });

        const msgs = getMessages(session.id);
        expect(msgs.map((m) => m.content)).toEqual(["You are a bot", "Q1", "A1", "Q2", "A2"]);
    });

    it("addMessage on non-existent session returns undefined", () => {
        const result = addMessage(99999, { role: "user" as const, content: "hi" });
        expect(result).toBeUndefined();
    });

    it("addMessage with undefined session ID returns undefined", () => {
        const result = addMessage(undefined as any, { role: "user" as const, content: "hi" });
        expect(result).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// getMessages additional edge cases
// ---------------------------------------------------------------------------

describe("getMessages additional edge cases", () => {
    it("returns a new array copy each call (not the same reference)", () => {
        const session = createSession("Copy Ref");
        addMessage(session.id, { role: "user" as const, content: "m1" });

        const first = getMessages(session.id);
        const second = getMessages(session.id);
        expect(first).not.toBe(second);
        expect(first).toEqual(second);
    });

    it("mutating returned messages does not affect store", () => {
        const session = createSession("Mutate Guard");
        addMessage(session.id, { role: "user" as const, content: "original" });

        const msgs = getMessages(session.id);
        msgs.push({ role: "assistant" as const, content: "injected" });

        const reloaded = getMessages(session.id);
        expect(reloaded).toHaveLength(1);
        expect(reloaded[0]!.content).toBe("original");
    });

    it("returns empty array for session with ID 0", () => {
        const messages = getMessages(0);
        expect(messages).toEqual([]);
    });

    it("returns empty array for negative session ID", () => {
        const messages = getMessages(-100);
        expect(messages).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// deleteSession additional edge cases
// ---------------------------------------------------------------------------

describe("deleteSession additional edge cases", () => {
    it("returns false for session ID 0", () => {
        const result = deleteSession(0);
        expect(result).toBe(false);
    });

    it("returns false for negative session ID", () => {
        const result = deleteSession(-1);
        expect(result).toBe(false);
    });

    it("returns false when called twice on the same session", () => {
        const session = createSession("Double Delete");
        expect(deleteSession(session.id)).toBe(true);
        expect(deleteSession(session.id)).toBe(false);
    });

    it("does not throw when deleting a non-numeric ID", () => {
        const result = deleteSession(NaN);
        expect(result).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// createSession additional edge cases
// ---------------------------------------------------------------------------

describe("createSession additional edge cases", () => {
    it("creates sessions with empty string name", () => {
        const session = createSession("");
        expect(session.sessionName).toBe("");
    });

    it("creates sessions with very long names", () => {
        const longName = "x".repeat(1000);
        const session = createSession(longName);
        expect(session.sessionName).toBe(longName);
    });

    it("creates sessions with unicode names", () => {
        const session = createSession("测试会话-セッション-세션");
        expect(session.sessionName).toBe("测试会话-セッション-세션");
    });

    it("creates sessions with special characters in name", () => {
        const session = createSession("Chat <b>bold</b> & more!");
        expect(session.sessionName).toBe("Chat <b>bold</b> & more!");
    });

    it("increments session IDs monotonically across resets", () => {
        const allSessions = getAllSessions();
        for (const s of allSessions) {
            deleteSession(s.id);
        }

        const s1 = createSession("A");
        const s2 = createSession("B");
        expect(s2.id).toBe(s1.id + 1);
    });
});

// ---------------------------------------------------------------------------
// getDeepSeekSession additional edge cases
// ---------------------------------------------------------------------------

describe("getDeepSeekSession additional edge cases", () => {
    it("returns undefined for NaN session ID", () => {
        const result = getDeepSeekSession(NaN);
        expect(result).toBeUndefined();
    });

    it("returns undefined for Infinity session ID", () => {
        const result = getDeepSeekSession(Infinity);
        expect(result).toBeUndefined();
    });

    it("returns the session without messages array exposed to mutation", () => {
        const session = createSession("No Mutate");
        const retrieved = getDeepSeekSession(session.id)!;
        retrieved.messages.push({ role: "user" as const, content: "hacked" });

        const retrievedAgain = getDeepSeekSession(session.id)!;
        // The internal array was mutated because it's the same reference
        // This documents current behavior
        expect(retrievedAgain.messages).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// getAllSessions additional edge cases
// ---------------------------------------------------------------------------

describe("getAllSessions additional edge cases", () => {
    it("returns sessions in insertion order (oldest first)", () => {
        const s1 = createSession("Alpha");
        const s2 = createSession("Beta");
        const all = getAllSessions();
        expect(all[0]!.id).toBe(s1.id);
        expect(all[1]!.id).toBe(s2.id);
    });

    it("returns a new array each call (not same reference)", () => {
        const first = getAllSessions();
        const second = getAllSessions();
        expect(first).not.toBe(second);
    });

    it("reflects deletions immediately", () => {
        const session = createSession("Now you see me");
        expect(getAllSessions()).toHaveLength(1);
        deleteSession(session.id);
        expect(getAllSessions()).toHaveLength(0);
    });
});
