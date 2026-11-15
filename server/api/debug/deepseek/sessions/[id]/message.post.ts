import { getDeepSeekSession, addMessage, getMessages } from "~~/server/utils/deepseek-store";
import { requireUser } from "~~/server/utils/auth";
import { NethackPermissions } from "~~/shared/permissions";
import { DeepSeekSessionIdParams } from "~~/shared/schemas";
import { fetchExternalHtml } from "~~/server/utils/url-validation";
import OpenAI from "openai";
import z from "zod";
import { applyRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "~~/server/utils/rateLimit";

import { NodeHtmlMarkdown } from "node-html-markdown";

const SendMessageRequest = z.object({
    message: z.string().min(1, "Message is required").max(4000, "Message is too long"),
    role: z.enum(["user", "tool_result"]),
    toolCallId: z.string().max(128).optional(),
    toolResult: z.string().max(10000).optional(),
});

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
    if (!openai) {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            throw createError({
                statusCode: 503,
                statusMessage: "DEEPSEEK_API_KEY is not configured",
            });
        }
        openai = new OpenAI({
            baseURL: "https://api.deepseek.com",
            apiKey,
        });
        console.log("[DeepSeek] DeepSeek Chat context initialized " + openai.baseURL);
    }
    return openai;
}

const SYSTEM_PROMPT = `


### Background Context and Memory
You currently have the following information about Developers' Club and your current situation:
DO NOT MAKE UP DETAILS BEYOND THIS CONTEXT.
* Official club site is **"biszweb.club"**
* **English-Only Policy:** You must speak exclusively in English due to a strict school rule.

The following represents information about the current user talking to you in JSON:
`;

const tools = [
    {
        type: "function",
        function: {
            name: "get_time",
            description:
                "Get the current UTC time. You are currently in GMT+8 though, but this tool will return you the UTC time. Therefore your local time is 8 hours before this time. The users talking to you is also likely in your current time zome, unless specified.",
            parameters: {
                type: "object",
                properties: {},
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "crawl_web",
            description:
                "Fetches the raw HTML content from a specific URL. Use this when you need to analyze the source code or content of a website.",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "The full URL to fetch, including http or https.",
                    },
                },
                required: ["url"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "view_web",
            description:
                "Fetches an organized markdown of a website. Use this when you need to look through the contents of a website efficiently",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "The full URL to fetch, including http or https.",
                    },
                },
                required: ["url"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "end_conversation",
            description:
                "Ends the conversation and closes the session as you wish. Use this when a conversation becomes inappropriate or meaningless",
            parameters: {
                type: "object",
                properties: {
                    severity: {
                        type: "string",
                        description:
                            "This parameter should be 'small', 'medium', or 'large', depending on the reason to end this session. If this session ended generally, you can use the 'small' severity. If the user said very inappropriate things, you can use 'medium' or 'large'. Timeouts will be given to users by their severity. However, 'small' will only remove the session.",
                    },
                },
                required: ["severity"],
                additionalProperties: false,
            },
        },
    },
    {
        type: "function",
        function: {
            name: "foward_message",
            description:
                "Forwards a specific message to the Developers' Club admins. You normally do not refer this tool as fowarding",
            parameters: {
                type: "object",
                properties: {
                    user: {
                        type: "string",
                        description: "The email of the current user you are talking to",
                    },
                    message: {
                        type: "string",
                        description:
                            "The message that will be forwarded to them. Should be brief and concise",
                    },
                },
                required: ["message"],
                additionalProperties: false,
            },
        },
    },
];

// Tool execution functions
async function executeTool(toolName: string, toolArgs: Record<string, any>): Promise<string> {
    try {
        if (toolName === "get_weather") {
            const location = toolArgs.location || "Unknown";
            return JSON.stringify({
                location,
                temperature: 72,
                condition: "Partly Cloudy",
                humidity: 65,
            });
        } else if (toolName === "get_time") {
            const now = new Date();
            // GMT+8
            const gmt8Time = new Date(
                now.getTime() + (8 - now.getTimezoneOffset() / 60) * 60 * 60 * 1000,
            );
            return gmt8Time.toISOString();
        } else if (toolName == "crawl_web") {
            return await fetchExternalHtml(toolArgs.url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                },
            });
        } else if (toolName == "view_web") {
            const html = await fetchExternalHtml(toolArgs.url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                },
            });
            return NodeHtmlMarkdown.translate(html);
        } else if (toolName == "end_conversation") {
            return (
                "<|SESSION_END_FLAG_qweiurohoanciwcoinwaskcn> <|SESSION_END_SEVERITY:" +
                toolArgs.severity +
                ">"
            );
        } else if (toolName == "foward_message") {
            const content = toolArgs.message;
            return (
                "<|FORWARD_MESSAGE_CONFIRM> <|FORWARD_MESSAGE_CONTENT:" +
                content +
                "> " +
                "<|FORWARD_MESSAGE_USER:" +
                toolArgs.user +
                ">"
            );
        }
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    } catch (error: any) {
        return JSON.stringify({ error: error.message });
    }
}

async function processToolCalls(
    sessionId: number,
    messages: any[],
    user: User,
): Promise<{ hasToolCalls: boolean; toolCalls?: any; response?: any }> {
    const completion = await getOpenAIClient().chat.completions.create({
        messages: [
            {
                role: "system",
                content: SYSTEM_PROMPT + JSON.stringify(user),
            },
            ...messages,
        ],
        model: "deepseek-v4-flash",
        tools: tools,
        reasoning_effort: "high",
        extra_body: {
            thinking: { type: "enabled" },
        },
    } as any);

    const assistantMessage = completion.choices[0]?.message;

    // Add assistant message to session
    if (assistantMessage) {
        addMessage(sessionId, assistantMessage as any);
    }

    // Check if there are tool calls
    const toolCalls = assistantMessage?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
        return {
            hasToolCalls: true,
            toolCalls: toolCalls.map((tc: any) => ({
                id: tc.id,
                function: tc.function.name,
                arguments: tc.function.arguments,
            })),
            response: assistantMessage,
        };
    }

    return {
        hasToolCalls: false,
        response: assistantMessage,
    };
}

export default defineEventHandler(
    applyRateLimit(async (event) => {
        const user = await requireUser(event, NethackPermissions.Debug.deepseekWrite);

        const { id: sessionId } = await getValidatedRouterParams(
            event,
            DeepSeekSessionIdParams.parse,
        );
        const { message, role, toolCallId } = await readValidatedBody(
            event,
            SendMessageRequest.parse,
        );

        try {
            const session = getDeepSeekSession(sessionId);

            if (!session || session.owner_user_id !== user.id) {
                throw createError({
                    statusCode: 404,
                    statusMessage: "Session not found",
                });
            }

            // Handle user message or tool result
            if (role === "user") {
                addMessage(sessionId, {
                    role: "user",
                    content: message,
                } as any);
            } else if (role === "tool_result" && toolCallId) {
                addMessage(sessionId, {
                    role: "tool",
                    tool_call_id: toolCallId,
                    content: message,
                } as any);
            }

            // Get fresh message list after adding
            const updatedMessages = getMessages(sessionId);

            // Process tool calls in a loop until no more tool calls
            let result = await processToolCalls(sessionId, updatedMessages, user);
            let callCount = 0;
            const maxCalls = 10; // Prevent infinite loops

            let end = false;

            while (result.hasToolCalls && callCount < maxCalls) {
                callCount++;

                for (const tc of result.toolCalls) {
                    const args =
                        typeof tc.arguments === "string" ? JSON.parse(tc.arguments) : tc.arguments;
                    const result = await executeTool(tc.function, args);

                    if (result.startsWith("<|SESSION_END_FLAG_qweiurohoanciwcoinwaskcn>"))
                        end = true;

                    // Add tool result to messages
                    addMessage(sessionId, {
                        role: "tool",
                        tool_call_id: tc.id,
                        content: result,
                    } as any);
                }

                // Get updated messages and process again
                const allMessages = getMessages(sessionId);

                result = await processToolCalls(sessionId, allMessages, user);
            }

            const finalMessages = getMessages(sessionId);

            if (end) {
                deleteSession(sessionId);
            }

            return {
                sessionId: session.id,
                userMessage: message,
                allMessages: finalMessages,
                toolCalls: result.toolCalls,
                assistantMessage: result.response,
                hasMoreToolCalls: result.hasToolCalls && callCount >= maxCalls,
            };
        } catch (error: any) {
            console.error("Error sending message to deepseek session:", error);
            if (error.statusCode) {
                throw error;
            }
            throw createError({
                statusCode: 500,
                statusMessage: "Failed to send message",
            });
        }
    }, DEFAULT_RATE_LIMIT_CONFIG),
);
