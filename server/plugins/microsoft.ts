import { env } from "node:process";

const metadata = {
    access_token: null as string | null,
    user_access_token: null as string | null | undefined,
    user_refresh_token: null as string | null | undefined,
    webhook_state: process.env.MICROSOFT_WEBHOOK_STATE ?? null,
    webhook_id: process.env.MICROSOFT_WEBHOOK_ID ?? null,
};

let initPromise: Promise<string | null> | null = null;

export default async function initializeMSAccessToken() {
    if (!process.env.MICROSOFT_TENANT_ID || !process.env.MICROSOFT_CLIENT_ID) {
        console.warn(
            "[MSGraph] MICROSOFT_TENANT_ID or MICROSOFT_CLIENT_ID not set - Microsoft Graph features will be unavailable",
        );
        return null;
    }

    console.log("[MSGraph] Initializing MS Access Token...");

    if (metadata.access_token) {
        console.log("MS Access Token already initialized");
        return metadata.access_token;
    }

    let req: Response;
    try {
        req = await fetch(
            `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    client_id: process.env.MICROSOFT_CLIENT_ID || "",
                    scope: "https://graph.microsoft.com/.default",
                    client_secret: env.MICROSOFT_CLIENT_SECRET ?? "",
                    grant_type: "client_credentials",
                }).toString(),
            },
        );
    } catch {
        // Graph is an optional integration. A token endpoint outage must not
        // reject Nitro's startup and prevent core hackathon flows from serving.
        console.warn(
            "[MS Graph] Token endpoint is unavailable - Microsoft Graph features will be unavailable",
        );
        return null;
    }

    const code = req.status;
    if (code !== 200) {
        console.warn(
            `[MS Graph] MS Token Endpoint returned ${code} - Microsoft Graph features will be unavailable`,
        );
        return null;
    } else {
        console.log("[MSGraph] API Endpoint response: " + code);
    }
    const data: any = await req.json();
    metadata.access_token = data.access_token;

    if (process.env.MICROSOFT_WEBHOOK_STATE && process.env.CURRENT_URL_ORIGIN) {
        try {
            await initializeChatbotWebhook();
        } catch (error) {
            console.warn("[MS Graph] Webhook subscription initialization failed", error);
        }
    }

    return metadata.access_token;
}

export async function getMSAccessToken() {
    if (!initPromise) {
        initPromise = initializeMSAccessToken();
    }
    const token = await initPromise;
    if (!token) {
        throw new Error("[MS Graph] MS Access Token not initialized");
    }
    return token;
}

/*
 SECURITY POLICY: All microsoft graph related API MUST BE CALLED IN THIS FILE.
 If you need any api usage, create a wrapper inside this function and export it.
 */

export async function requestMicrosoft(
    endpoint: string,
    method: string = "GET",
    body: string | Object | null = null,
    retried: boolean = false,
) {
    const res = await fetch("https://graph.microsoft.com/v1.0" + endpoint, {
        method,
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + (await getMSAccessToken()),
        },
        body: method === "GET" ? null : typeof body === "string" ? body : JSON.stringify(body),
    });

    if (res.status === 401 && !retried) {
        console.warn("[MS Graph] Application token unauthorized, refreshing...");
        metadata.access_token = null;
        initPromise = null;
        await initializeMSAccessToken();
        return requestMicrosoft(endpoint, method, body, true);
    }

    return res;
}

export async function requestUserMicrosoft(
    endpoint: string,
    method: string = "GET",
    body: string | Object | null = null,
    retried: boolean = false,
) {
    // Lazily initialize the user access token if missing
    if (!metadata.user_access_token) {
        await initializeDummyUserAccessToken();
    }

    const res = await fetch("https://graph.microsoft.com/v1.0" + endpoint, {
        method,
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + getDummyUserAccessToken(),
        },
        body: method === "GET" ? null : typeof body === "string" ? body : JSON.stringify(body),
    });

    if (res.status == 401) {
        if (retried) {
            throw new Error("[MS Graph] User token refresh failed after retry");
        }
        console.warn("[MS Graph] User token unauthorized, refreshing dummy user access token...");
        metadata.user_access_token = null;
        await initializeDummyUserAccessToken();
        return requestUserMicrosoft(endpoint, method, body, true);
    }

    return res;
}

export async function createMicrosoftMeeting(
    target: string,
    subject: string,
    htmlDescription: string,
    startTime: string,
    endTime: string,
    attendees: any[],
): Promise<Response> {
    const disclaimer = `<br><br><hr><p style='font-size:10pt;color:gray;'><i>This event was auto-generated by basishacks. If you believe this was scheduled in error or need to reschedule, please feel free to direct message devclub-bisz@basischina.com and your message will be fowarded to the necessary person.</i></p>`;

    const body = JSON.stringify({
        subject: subject,
        body: {
            contentType: "HTML",
            content: htmlDescription + disclaimer,
        },
        start: {
            dateTime: startTime,
            timeZone: "UTC",
        },
        end: {
            dateTime: endTime,
            timeZone: "UTC",
        },
        attendees: attendees.map((email) => ({
            emailAddress: {
                address: email,
            },
        })),
    });

    const res = await requestMicrosoft("/users/" + target + "/events", "POST", body);

    return res; // Created
}

export async function initializeDummyUserAccessToken() {
    if (!process.env.MICROSOFT_TENANT_ID || !process.env.MICROSOFT_CLIENT_ID) {
        console.warn(
            "[MSGraph] MICROSOFT_TENANT_ID or MICROSOFT_CLIENT_ID not set - Microsoft Graph features will be unavailable",
        );
        return null;
    }

    const res = await fetch(
        `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                client_id: process.env.MICROSOFT_CLIENT_ID || "",
                scope: "https://graph.microsoft.com/Chat.ReadWrite openid profile offline_access",
                username: env.MICROSOFT_DUMMY_USER_NAME ?? "",
                password: env.MICROSOFT_DUMMY_USER_PASSWORD ?? "",
                grant_type: "password",
                client_secret: env.MICROSOFT_CLIENT_SECRET ?? "",
            }).toString(),
        },
    );

    const data: any = await res.json();

    console.log("[MS Graph] Response from Dummy User Token Endpoint: " + res.status);

    if (res.status == 400) {
        console.log("[MS Graph] Dummy user error: " + data.error_description);
    }

    metadata.user_access_token = data.access_token as string | undefined;
    metadata.user_refresh_token = data.refresh_token as string | undefined;

    return data.access_token;
}

// In-memory cache: target user id -> chat id
// One-on-one chats are stable, so we keep them for the lifetime of the process.
const directChatCache = new Map<string, string>();

/*
 * Creates or retrieves an existing direct chat with the dummy user, and returns the chat ID.
 * Cached in-memory to avoid repeated Microsoft Graph requests for the same target.
 */
export async function createOrGetExistingDirectChat(targetId: string): Promise<{ id: string }> {
    const cached = directChatCache.get(targetId);
    if (cached) {
        return { id: cached };
    }

    const res = await requestUserMicrosoft(
        "/chats",
        "POST",
        JSON.stringify({
            chatType: "oneOnOne",
            members: [
                {
                    "@odata.type": "#microsoft.graph.aadUserConversationMember",
                    roles: ["owner"],
                    "user@odata.bind":
                        "https://graph.microsoft.com/v1.0/users('" +
                        process.env.MICROSOFT_DUMMY_USER_NAME +
                        "')",
                },
                {
                    "@odata.type": "#microsoft.graph.aadUserConversationMember",
                    roles: ["owner"],
                    "user@odata.bind": "https://graph.microsoft.com/v1.0/users('" + targetId + "')",
                },
            ],
        }),
    );

    const data = await res.json();

    if (!res.ok) {
        throw createError({
            statusCode: res.status,
            message: data.error?.message || "Failed to create or retrieve direct chat",
        });
    }

    const chatId = data.id as string;
    if (!chatId) {
        throw createError({
            statusCode: 500,
            message: "Microsoft Graph response missing chat id",
        });
    }

    directChatCache.set(targetId, chatId);
    return { id: chatId };
}

export function getDummyUserAccessToken() {
    if (!metadata.user_access_token) {
        throw new Error("[MS Graph] Dummy User Access Token not initialized");
    }
    return metadata.user_access_token;
}

export async function sendChatMessage(chatId: string, content: string) {
    const res = await requestUserMicrosoft(
        "/chats/" + chatId + "/messages",
        "POST",
        JSON.stringify({
            body: {
                contentType: "text",
                content: content,
            },
        }),
    );
    return res;
}

export async function sendRichChatMessage(chatId: string, content: string) {
    const res = await requestUserMicrosoft(
        "/chats/" + chatId + "/messages",
        "POST",
        JSON.stringify({
            body: {
                contentType: "html",
                content: content,
            },
        }),
    );
    return res;
}

export function getMicrosoftWebhookState() {
    return metadata.webhook_state;
}

export async function refreshChatbotWebhook() {
    const webhookId = getChatbotWebhookId();
    if (!webhookId || !getMicrosoftWebhookState()) {
        console.warn("[MS Graph] Webhook ID or persistent webhook state is not configured.");
        return;
    }

    console.log("[MS Graph] Refreshing chatbot webhook subscription...");

    if (
        process.env.CURRENT_URL_ORIGIN == null ||
        process.env.CURRENT_URL_ORIGIN.startsWith("http://localhost")
    ) {
        console.warn("[MS Graph] CURRENT_URL_ORIGIN is not set or is a localhost URL.");
        return;
    }

    const res = await requestMicrosoft("/subscriptions/" + webhookId, "PATCH", {
        expirationDateTime: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 days from now
    });

    console.log("[MS Graph] Refresh response: " + res.status);
}

export async function initializeChatbotWebhook() {
    if (
        process.env.CURRENT_URL_ORIGIN == null ||
        process.env.CURRENT_URL_ORIGIN.startsWith("http://localhost")
    ) {
        console.warn("[MS Graph] CURRENT_URL_ORIGIN is not set or is a localhost URL.");
        return;
    }

    const webhookState = process.env.MICROSOFT_WEBHOOK_STATE;
    if (!webhookState || new TextEncoder().encode(webhookState).byteLength < 32) {
        metadata.webhook_state = null;
        console.warn(
            "[MS Graph] Set MICROSOFT_WEBHOOK_STATE to a persistent secret of at least 32 bytes before registering webhooks.",
        );
        return;
    }

    metadata.webhook_state = webhookState;
    metadata.webhook_id = process.env.MICROSOFT_WEBHOOK_ID ?? null;

    console.log("[MS Graph] Initializing chatbot webhook subscription...");

    if (metadata.webhook_id) {
        await refreshChatbotWebhook();
        return;
    }

    const res = await requestMicrosoft("/subscriptions", "POST", {
        changeType: "created,updated",
        notificationUrl: process.env.CURRENT_URL_ORIGIN + "/api/_webhooks/update",
        lifecycleNotificationUrl: process.env.CURRENT_URL_ORIGIN + "/api/_webhooks/lifecycle",
        resource: "/chats/getAllMessages",
        expirationDateTime: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 days from now
        clientState: metadata.webhook_state,
    });

    if (!res.ok) {
        const errorData = await res.json();
        console.warn(
            "[MS Graph] Failed to create chatbot webhook subscription:",
            res.status,
            errorData,
        );
        return;
    }

    const json = await res.json();
    const subId = json.id;
    metadata.webhook_id = subId;

    console.log("[MS Graph] Created webhook " + subId + "expr:" + json.expirationDateTime);
}

export function getChatbotWebhookId() {
    return metadata.webhook_id;
}

export async function pollChatbotMessages() {
    console.log("[MS Graph] Starting to poll chatbot messages...");

    const res = await requestUserMicrosoft("/me/chats/getAllMessages/delta", "GET");

    const json = await res.json();

    console.log(json);
}
