/**
 * In-memory store for DeepSeek chat sessions
 * Supports full tool calling loops with proper message management
 */

import type { ChatCompletionMessage } from "openai/resources/index.mjs";

interface ChatSession {
    id: number;
    sessionName: string;
    /** Owning user id; 0 only appears in direct store tests. */
    owner_user_id: number;
    createdAt: number;
    messages: ChatCompletionMessage[];
}

const MAX_SESSIONS = 100;
const MAX_SESSIONS_PER_OWNER = 20;
const MAX_MESSAGES_PER_SESSION = 200;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let sessionIdCounter = 1;
const sessions = new Map<number, ChatSession>();

/** Remove expired sessions on every access, not only when the store is full. */
function sweepExpiredSessions(now = Date.now()) {
    for (const [id, session] of sessions.entries()) {
        if (now - session.createdAt * 1000 > SESSION_TTL_MS) {
            sessions.delete(id);
        }
    }
}

function oldestSession(ownerUserId?: number): number | null {
    let oldestId: number | null = null;
    let oldestTime = Infinity;
    for (const [id, session] of sessions.entries()) {
        if (ownerUserId !== undefined && session.owner_user_id !== ownerUserId) continue;
        if (session.createdAt < oldestTime) {
            oldestTime = session.createdAt;
            oldestId = id;
        }
    }
    return oldestId;
}

export function createSession(sessionName: string, ownerUserId = 0): ChatSession {
    sweepExpiredSessions();

    // Cap each owner so one operator cannot evict every other operator's work.
    // Owner 0 is reserved for direct store tests and keeps only the global cap.
    if (ownerUserId !== 0) {
        const owned = Array.from(sessions.values()).filter(
            (session) => session.owner_user_id === ownerUserId,
        );
        if (owned.length >= MAX_SESSIONS_PER_OWNER) {
            sessions.delete(oldestSession(ownerUserId)!);
        }
    }

    // If still at global capacity, remove the oldest session.
    if (sessions.size >= MAX_SESSIONS) {
        sessions.delete(oldestSession()!);
    }

    const id = sessionIdCounter++;
    const session: ChatSession = {
        id,
        sessionName,
        owner_user_id: ownerUserId,
        createdAt: Math.floor(Date.now() / 1000),
        messages: [],
    };
    sessions.set(id, session);
    return session;
}

export function getDeepSeekSession(sessionId: number): ChatSession | undefined {
    sweepExpiredSessions();
    return sessions.get(sessionId);
}

export function getAllSessions(ownerUserId?: number): ChatSession[] {
    sweepExpiredSessions();
    const all = Array.from(sessions.values());
    return ownerUserId === undefined
        ? all
        : all.filter((session) => session.owner_user_id === ownerUserId);
}

export function deleteSession(sessionId: number): boolean {
    return sessions.delete(sessionId);
}

export function addMessage(
    sessionId: number,
    message: ChatCompletionMessage,
): ChatSession | undefined {
    sweepExpiredSessions();
    const session = sessions.get(sessionId);
    if (!session) return undefined;
    session.messages.push(message);
    // Cap message history to prevent unbounded growth
    if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
        session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION);
    }
    return session;
}

export function getMessages(sessionId: number): ChatCompletionMessage[] {
    sweepExpiredSessions();
    const session = sessions.get(sessionId);
    // Return a copy to prevent external mutation of the internal array
    return session ? [...session.messages] : [];
}
