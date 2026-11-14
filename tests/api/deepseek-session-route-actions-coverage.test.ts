import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NethackPermissions } from "~~/shared/permissions";
import { mockBody, mockParams, resetMockState, setupNitroGlobals } from "~~/tests/api/helpers";

const mocks = vi.hoisted(() => ({
    requireUser: vi.fn(),
    createSession: vi.fn(),
    getDeepSeekSession: vi.fn(),
    deleteSession: vi.fn(),
    addMessage: vi.fn(),
    getMessages: vi.fn(),
    fetchExternalHtml: vi.fn(),
    translateHtml: vi.fn(),
    createCompletion: vi.fn(),
    openAIOptions: vi.fn(),
}));

vi.mock("~~/server/utils/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("~~/server/utils/deepseek-store", () => ({
    createSession: mocks.createSession,
    getDeepSeekSession: mocks.getDeepSeekSession,
    deleteSession: mocks.deleteSession,
    addMessage: mocks.addMessage,
    getMessages: mocks.getMessages,
}));
vi.mock("~~/server/utils/rateLimit", () => ({
    applyRateLimit: (handler: (event: unknown) => unknown) => handler,
    DEFAULT_RATE_LIMIT_CONFIG: {},
}));
vi.mock("~~/server/utils/url-validation", () => ({
    fetchExternalHtml: mocks.fetchExternalHtml,
}));
vi.mock("node-html-markdown", () => ({
    NodeHtmlMarkdown: { translate: mocks.translateHtml },
}));
vi.mock("openai", () => ({
    default: class FakeOpenAI {
        baseURL: string;
        chat = { completions: { create: mocks.createCompletion } };

        constructor(options: { baseURL: string; apiKey: string }) {
            mocks.openAIOptions(options);
            this.baseURL = options.baseURL;
        }
    },
}));

const originalDeepSeekApiKey = process.env.DEEPSEEK_API_KEY;
const messages: unknown[] = [];
const testUser = { id: 29, email: "judge@example.com" };
const session = { id: 41, sessionName: "Test session", userId: testUser.id };
const readBody = vi.fn(async (_event: unknown, parse: (body: unknown) => unknown) =>
    parse(mockBody.value),
);

let create: (event: any) => Promise<unknown>;
let get: (event: any) => Promise<unknown>;
let remove: (event: any) => Promise<unknown>;
let sendMessage: (event: any) => Promise<unknown>;
const event = {};

beforeAll(async () => {
    setupNitroGlobals();
    vi.stubGlobal("readValidatedBody", readBody);
    // Nitro auto-imports this helper into the compiled route module.
    vi.stubGlobal("deleteSession", mocks.deleteSession);
    create = (await import("~~/server/api/debug/deepseek/sessions/index.post")).default;
    get = (await import("~~/server/api/debug/deepseek/sessions/[id]/index.get")).default;
    remove = (await import("~~/server/api/debug/deepseek/sessions/[id]/index.delete")).default;
    sendMessage = (await import("~~/server/api/debug/deepseek/sessions/[id]/message.post")).default;
});

beforeEach(() => {
    resetMockState();
    readBody.mockClear();
    mockBody.value = undefined;
    mockParams.values = {};
    messages.length = 0;
    mocks.requireUser.mockReset().mockResolvedValue(testUser);
    mocks.createSession.mockReset().mockReturnValue(session);
    mocks.getDeepSeekSession
        .mockReset()
        .mockImplementation((id: number) => (id === session.id ? session : undefined));
    mocks.deleteSession.mockReset();
    mocks.addMessage.mockReset().mockImplementation((_id: number, message: unknown) => {
        messages.push(message);
    });
    mocks.getMessages.mockReset().mockImplementation(() => [...messages]);
    mocks.fetchExternalHtml.mockReset().mockResolvedValue("<p>page content</p>");
    mocks.translateHtml.mockReset().mockReturnValue("page content");
    mocks.createCompletion.mockReset().mockResolvedValue({
        choices: [{ message: { role: "assistant", content: "Done" } }],
    });
    mocks.openAIOptions.mockClear();
});

afterAll(() => {
    if (originalDeepSeekApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepSeekApiKey;
});

afterEach(() => vi.restoreAllMocks());

describe("DeepSeek session creation route", () => {
    it("requires the write permission before reading input", async () => {
        mocks.requireUser.mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { statusCode: 403 }),
        );
        mockBody.value = { sessionName: "Example" };

        await expect(create(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.requireUser).toHaveBeenCalledWith(
            event,
            NethackPermissions.Debug.deepseekWrite,
        );
        expect(readBody).not.toHaveBeenCalled();
        expect(mocks.createSession).not.toHaveBeenCalled();
    });

    it.each([undefined, "", "x".repeat(101)])("rejects invalid session names", async (name) => {
        mockBody.value = name === undefined ? {} : { sessionName: name };

        await expect(create(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(mocks.createSession).not.toHaveBeenCalled();
    });

    it("creates a session with a valid name", async () => {
        const created = { ...session, sessionName: "My research" };
        mockBody.value = { sessionName: "My research" };
        mocks.createSession.mockReturnValue(created);

        await expect(create(event)).resolves.toBe(created);
        expect(mocks.createSession).toHaveBeenCalledWith("My research");
    });

    it("maps storage failures to a generic server error", async () => {
        const failure = new Error("private database details");
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        mockBody.value = { sessionName: "My research" };
        mocks.createSession.mockImplementation(() => {
            throw failure;
        });

        await expect(create(event)).rejects.toMatchObject({
            statusCode: 500,
            statusMessage: "Failed to create session",
        });
        expect(errorLog).toHaveBeenCalledWith("Error creating deepseek session:", failure);
    });
});

describe("DeepSeek session read route", () => {
    it("requires read permission before parsing the session ID", async () => {
        mocks.requireUser.mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { statusCode: 403 }),
        );

        await expect(get(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.requireUser).toHaveBeenCalledWith(
            event,
            NethackPermissions.Debug.deepseekRead,
        );
        expect(mocks.getDeepSeekSession).not.toHaveBeenCalled();
    });

    it.each([undefined, "0", "-2", "not-a-number"])("rejects invalid ID %s", async (id) => {
        mockParams.values.id = id;

        await expect(get(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(mocks.getDeepSeekSession).not.toHaveBeenCalled();
    });

    it("returns an existing session", async () => {
        mockParams.values.id = String(session.id);

        await expect(get(event)).resolves.toBe(session);
        expect(mocks.getDeepSeekSession).toHaveBeenCalledWith(session.id);
    });

    it("preserves the not-found response", async () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        mockParams.values.id = "999";

        await expect(get(event)).rejects.toMatchObject({ statusCode: 404 });
        expect(errorLog).toHaveBeenCalledOnce();
    });

    it("maps unclassified storage failures to a generic server error", async () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        mockParams.values.id = String(session.id);
        mocks.getDeepSeekSession.mockImplementation(() => {
            throw new Error("private storage details");
        });

        await expect(get(event)).rejects.toMatchObject({
            statusCode: 500,
            statusMessage: "Failed to retrieve session",
        });
        expect(errorLog).toHaveBeenCalledOnce();
    });

    it("rethrows storage errors that already have a status code", async () => {
        const failure = Object.assign(new Error("locked"), { statusCode: 423 });
        vi.spyOn(console, "error").mockImplementation(() => {});
        mockParams.values.id = String(session.id);
        mocks.getDeepSeekSession.mockImplementation(() => {
            throw failure;
        });

        await expect(get(event)).rejects.toBe(failure);
    });
});

describe("DeepSeek session deletion route", () => {
    it("requires write permission before parsing the session ID", async () => {
        mocks.requireUser.mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { statusCode: 403 }),
        );

        await expect(remove(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.requireUser).toHaveBeenCalledWith(
            event,
            NethackPermissions.Debug.deepseekWrite,
        );
        expect(mocks.getDeepSeekSession).not.toHaveBeenCalled();
    });

    it.each([undefined, "0", "bad"])("rejects invalid ID %s", async (id) => {
        mockParams.values.id = id;

        await expect(remove(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(mocks.deleteSession).not.toHaveBeenCalled();
    });

    it("returns not found without attempting deletion", async () => {
        mockParams.values.id = "999";
        vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(remove(event)).rejects.toMatchObject({ statusCode: 404 });
        expect(mocks.deleteSession).not.toHaveBeenCalled();
    });

    it("deletes the existing session", async () => {
        mockParams.values.id = String(session.id);

        await expect(remove(event)).resolves.toEqual({
            success: true,
            message: "Session deleted successfully",
            deletedSessionId: session.id,
        });
        expect(mocks.deleteSession).toHaveBeenCalledWith(session.id);
    });

    it("maps storage errors to a generic server response", async () => {
        mockParams.values.id = String(session.id);
        vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.deleteSession.mockImplementation(() => {
            throw new Error("private storage details");
        });

        await expect(remove(event)).rejects.toMatchObject({
            statusCode: 500,
            statusMessage: "Failed to delete session",
        });
    });

    it("rethrows storage failures that include an HTTP status", async () => {
        const failure = Object.assign(new Error("locked"), { statusCode: 423 });
        mockParams.values.id = String(session.id);
        vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.deleteSession.mockImplementation(() => {
            throw failure;
        });

        await expect(remove(event)).rejects.toBe(failure);
    });
});

describe("DeepSeek message route", () => {
    it("returns service unavailable when the API key is missing", async () => {
        delete process.env.DEEPSEEK_API_KEY;
        mockParams.values.id = String(session.id);
        mockBody.value = { message: "Hello", role: "user" };
        vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(sendMessage(event)).rejects.toMatchObject({
            statusCode: 503,
            statusMessage: "DEEPSEEK_API_KEY is not configured",
        });
        expect(mocks.openAIOptions).not.toHaveBeenCalled();
    });

    it("rejects unauthorized callers and malformed session IDs before touching storage", async () => {
        process.env.DEEPSEEK_API_KEY = "test-key";
        mocks.requireUser.mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), { statusCode: 403 }),
        );
        mockParams.values.id = "41";
        mockBody.value = { message: "Hello", role: "user" };

        await expect(sendMessage(event)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.getDeepSeekSession).not.toHaveBeenCalled();
        expect(mocks.openAIOptions).not.toHaveBeenCalled();
    });

    it.each([undefined, "0", "bad"])("rejects invalid message route session ID %s", async (id) => {
        mockParams.values.id = id;
        mockBody.value = { message: "Hello", role: "user" };

        await expect(sendMessage(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(mocks.getDeepSeekSession).not.toHaveBeenCalled();
    });

    it.each([
        {},
        { message: "", role: "user" },
        { message: "x".repeat(4001), role: "user" },
        { message: "Hello", role: "admin" },
        { message: "Hello", role: "user", toolCallId: "x".repeat(129) },
        { message: "Hello", role: "user", toolResult: "x".repeat(10001) },
    ])("rejects invalid message body %j before loading the session", async (body) => {
        mockParams.values.id = String(session.id);
        mockBody.value = body;

        await expect(sendMessage(event)).rejects.toMatchObject({ name: "ZodError" });
        expect(mocks.getDeepSeekSession).not.toHaveBeenCalled();
    });

    it("returns not found for a missing session", async () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        mockParams.values.id = "999";
        mockBody.value = { message: "Hello", role: "user" };

        await expect(sendMessage(event)).rejects.toMatchObject({ statusCode: 404 });
        expect(errorLog).toHaveBeenCalledOnce();
        expect(mocks.createCompletion).not.toHaveBeenCalled();
    });

    it("adds a user message and returns the assistant response", async () => {
        process.env.DEEPSEEK_API_KEY = "test-key";
        mockParams.values.id = String(session.id);
        mockBody.value = { message: "Hello there", role: "user" };
        mocks.createCompletion.mockResolvedValueOnce({
            choices: [{ message: { role: "assistant", content: "Hi" } }],
        });

        await expect(sendMessage(event)).resolves.toEqual({
            sessionId: session.id,
            userMessage: "Hello there",
            allMessages: [
                { role: "user", content: "Hello there" },
                { role: "assistant", content: "Hi" },
            ],
            toolCalls: undefined,
            assistantMessage: { role: "assistant", content: "Hi" },
            hasMoreToolCalls: false,
        });
        expect(mocks.requireUser).toHaveBeenCalledWith(
            event,
            NethackPermissions.Debug.deepseekWrite,
        );
        expect(mocks.addMessage).toHaveBeenCalledWith(session.id, {
            role: "user",
            content: "Hello there",
        });
        expect(mocks.openAIOptions).toHaveBeenCalledWith({
            baseURL: "https://api.deepseek.com",
            apiKey: "test-key",
        });
        expect(mocks.createCompletion).toHaveBeenCalledOnce();
    });

    it("adds a tool result message when the request includes its call ID", async () => {
        mockParams.values.id = String(session.id);
        mockBody.value = {
            message: "The result is ready",
            role: "tool_result",
            toolCallId: "call-7",
            toolResult: "ignored input remains validated",
        };
        mocks.createCompletion.mockResolvedValueOnce({
            choices: [{ message: { role: "assistant", content: "Received" } }],
        });

        await expect(sendMessage(event)).resolves.toMatchObject({
            assistantMessage: { content: "Received" },
        });
        expect(mocks.addMessage).toHaveBeenCalledWith(session.id, {
            role: "tool",
            tool_call_id: "call-7",
            content: "The result is ready",
        });
    });

    it("skips adding a tool result when its call ID is missing", async () => {
        mockParams.values.id = String(session.id);
        mockBody.value = { message: "No call ID", role: "tool_result" };
        mocks.createCompletion.mockResolvedValueOnce({ choices: [] });

        await expect(sendMessage(event)).resolves.toMatchObject({
            sessionId: session.id,
            assistantMessage: undefined,
            hasMoreToolCalls: false,
        });
        expect(mocks.addMessage).not.toHaveBeenCalled();
    });

    it("executes supported, unknown, and failing tools, then stores the final answer", async () => {
        process.env.DEEPSEEK_API_KEY = "test-key";
        mockParams.values.id = String(session.id);
        mockBody.value = { message: "Research these pages", role: "user" };
        mocks.fetchExternalHtml.mockImplementation(async (url: string) => {
            if (url === "https://failure.example/") throw new Error("fetch failed");
            return "<p>raw page</p>";
        });
        mocks.createCompletion
            .mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            content: null,
                            tool_calls: [
                                {
                                    id: "weather",
                                    function: { name: "get_weather", arguments: "{}" },
                                },
                                { id: "time", function: { name: "get_time", arguments: {} } },
                                {
                                    id: "crawl",
                                    function: {
                                        name: "crawl_web",
                                        arguments: '{"url":"https://failure.example/"}',
                                    },
                                },
                                {
                                    id: "view",
                                    function: {
                                        name: "view_web",
                                        arguments: { url: "https://view.example/" },
                                    },
                                },
                                {
                                    id: "end",
                                    function: {
                                        name: "end_conversation",
                                        arguments: '{"severity":"large"}',
                                    },
                                },
                                {
                                    id: "forward",
                                    function: {
                                        name: "foward_message",
                                        arguments:
                                            '{"user":"user@example.com","message":"Please help"}',
                                    },
                                },
                                { id: "unknown", function: { name: "not_a_tool", arguments: {} } },
                            ],
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({
                choices: [{ message: { role: "assistant", content: "Research complete" } }],
            });

        const result = (await sendMessage(event)) as any;

        expect(result.assistantMessage).toEqual({
            role: "assistant",
            content: "Research complete",
        });
        expect(result.hasMoreToolCalls).toBe(false);
        expect(mocks.fetchExternalHtml).toHaveBeenCalledTimes(2);
        expect(mocks.translateHtml).toHaveBeenCalledWith("<p>raw page</p>");
        expect(mocks.deleteSession).toHaveBeenCalledWith(session.id);
        expect(messages).toContainEqual({
            role: "tool",
            tool_call_id: "unknown",
            content: '{"error":"Unknown tool: not_a_tool"}',
        });
        expect(messages).toContainEqual({
            role: "tool",
            tool_call_id: "crawl",
            content: '{"error":"fetch failed"}',
        });
        expect(messages).toContainEqual({
            role: "tool",
            tool_call_id: "view",
            content: "page content",
        });
        expect(messages).toContainEqual({
            role: "tool",
            tool_call_id: "forward",
            content: expect.stringContaining("Please help"),
        });
        expect(messages).toContainEqual({
            role: "tool",
            tool_call_id: "end",
            content: expect.stringContaining("SESSION_END_SEVERITY:large"),
        });
        expect(mocks.createCompletion).toHaveBeenCalledTimes(2);
    });

    it("continues tool execution up to the configured ten-call safety limit", async () => {
        process.env.DEEPSEEK_API_KEY = "test-key";
        mockParams.values.id = String(session.id);
        mockBody.value = { message: "Continue", role: "user" };
        mocks.createCompletion.mockImplementation(async () => ({
            choices: [
                {
                    message: {
                        role: "assistant",
                        tool_calls: [
                            { id: "repeat", function: { name: "unknown", arguments: {} } },
                        ],
                    },
                },
            ],
        }));

        await expect(sendMessage(event)).resolves.toMatchObject({
            hasMoreToolCalls: true,
            toolCalls: [{ id: "repeat", function: "unknown", arguments: {} }],
        });
        expect(mocks.createCompletion).toHaveBeenCalledTimes(11);
        expect(mocks.addMessage).toHaveBeenCalledTimes(22);
    });

    it("returns a server error for malformed tool arguments", async () => {
        process.env.DEEPSEEK_API_KEY = "test-key";
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        mockParams.values.id = String(session.id);
        mockBody.value = { message: "Try a tool", role: "user" };
        mocks.createCompletion.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        role: "assistant",
                        tool_calls: [
                            { id: "bad-json", function: { name: "get_time", arguments: "{" } },
                        ],
                    },
                },
            ],
        });

        await expect(sendMessage(event)).rejects.toMatchObject({
            statusCode: 500,
            statusMessage: "Failed to send message",
        });
        expect(errorLog).toHaveBeenCalledOnce();
    });

    it("preserves provider errors with a status code", async () => {
        process.env.DEEPSEEK_API_KEY = "test-key";
        const failure = Object.assign(new Error("provider unavailable"), { statusCode: 502 });
        vi.spyOn(console, "error").mockImplementation(() => {});
        mockParams.values.id = String(session.id);
        mockBody.value = { message: "Hello", role: "user" };
        mocks.createCompletion.mockRejectedValueOnce(failure);

        await expect(sendMessage(event)).rejects.toBe(failure);
    });

    it("maps storage failures to a generic message error", async () => {
        process.env.DEEPSEEK_API_KEY = "test-key";
        vi.spyOn(console, "error").mockImplementation(() => {});
        mockParams.values.id = String(session.id);
        mockBody.value = { message: "Hello", role: "user" };
        mocks.getMessages.mockImplementation(() => {
            throw new Error("private storage error");
        });

        await expect(sendMessage(event)).rejects.toMatchObject({
            statusCode: 500,
            statusMessage: "Failed to send message",
        });
    });

    it("maps session deletion failures after an end-conversation tool to a server error", async () => {
        process.env.DEEPSEEK_API_KEY = "test-key";
        vi.spyOn(console, "error").mockImplementation(() => {});
        mockParams.values.id = String(session.id);
        mockBody.value = { message: "End this", role: "user" };
        mocks.deleteSession.mockImplementation(() => {
            throw new Error("delete failed");
        });
        mocks.createCompletion
            .mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            role: "assistant",
                            tool_calls: [
                                {
                                    id: "end",
                                    function: {
                                        name: "end_conversation",
                                        arguments: '{"severity":"small"}',
                                    },
                                },
                            ],
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({
                choices: [{ message: { role: "assistant", content: "Bye" } }],
            });

        await expect(sendMessage(event)).rejects.toMatchObject({
            statusCode: 500,
            statusMessage: "Failed to send message",
        });
    });
});
