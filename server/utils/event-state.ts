import type { H3Event } from "h3";
import { getHackathon } from "./database/hackathon";
import { getActiveSeason } from "./database/seasons";

export interface EventGates {
    paused: boolean;
    submissionsOpen: boolean;
    submissionsClosed: boolean;
    votingOpen: boolean;
    judgingOpen: boolean;
    galleryPublic: boolean;
    resultsVisible: boolean;
}

export interface EventState extends EventGates {
    season: Season | null;
    hackathon: Hackathon | null;
    now: number;
    enforceDeadlines: boolean;
    submissionGraceMs: number;
}

const OPEN_STATUSES: ReadonlySet<string> = new Set(["not_started", "in_progress"]);

function envFlag(name: string, defaultValue: boolean): boolean {
    const raw = process.env[name]?.trim().toLowerCase();
    if (!raw) return defaultValue;
    if (["off", "false", "0", "no", "disabled"].includes(raw)) return false;
    if (["on", "true", "1", "yes", "enabled"].includes(raw)) return true;
    return defaultValue;
}

/** Public gallery can be force-hidden without changing event state. */
export function isPublicGalleryEnabled(): boolean {
    return envFlag("PUBLIC_GALLERY_MODE", true);
}

/** Peer-voting results can be disabled if the event is not using them. */
export function isPeopleChoiceEnabled(): boolean {
    return envFlag("PEOPLES_CHOICE_ENABLED", true);
}

/** Notification writes can be disabled for a minimal deployment. */
export function isNotificationsEnabled(): boolean {
    return envFlag("NOTIFICATIONS_ENABLED", true);
}

/** Deadline enforcement can be switched off for an untimed local rehearsal. */
export function isDeadlineEnforcementEnabled(): boolean {
    return envFlag("ENFORCE_DEADLINES", true);
}

/** Post-deadline grace window for last-minute submissions. */
export function getSubmissionGraceMs(): number {
    const raw = Number(process.env.SUBMISSION_GRACE_MS ?? 0);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/**
 * Resolve every public gate from the merged event settings.
 *
 * - `paused` closes all mutations.
 * - Submissions need an event phase that accepts projects and a live deadline.
 * - Voting and judging remain organizer-controlled switches, but a configured
 *   deadline still closes them unless enforcement is explicitly disabled.
 * - Project data becomes public only after submissions close.
 * - Results require an explicit publication.
 */
export function resolveEventGates(
    hackathon: Hackathon | null,
    season: Season | null,
    options: {
        now?: number;
        enforceDeadlines?: boolean;
        submissionGraceMs?: number;
        judgingAfterPublish?: boolean;
    } = {},
): EventGates {
    const now = options.now ?? Date.now();
    const enforceDeadlines = options.enforceDeadlines ?? isDeadlineEnforcementEnabled();
    const grace = options.submissionGraceMs ?? getSubmissionGraceMs();
    const judgingAfterPublish =
        options.judgingAfterPublish ?? envFlag("JUDGING_AFTER_PUBLISH", false);

    if (!hackathon) {
        return {
            paused: false,
            submissionsOpen: false,
            submissionsClosed: false,
            votingOpen: false,
            judgingOpen: false,
            galleryPublic: false,
            resultsVisible: false,
        };
    }

    const paused = hackathon.status === "paused";
    const withinSubmissionDeadline =
        !enforceDeadlines || hackathon.end_timestamp <= 0 || now <= hackathon.end_timestamp + grace;
    const submissionsClosed =
        hackathon.status === "voting" ||
        hackathon.status === "finished" ||
        (enforceDeadlines && hackathon.end_timestamp > 0 && now > hackathon.end_timestamp + grace);
    const submissionsOpen =
        !paused && OPEN_STATUSES.has(hackathon.status) && withinSubmissionDeadline;

    const withinVotingDeadline =
        !enforceDeadlines ||
        hackathon.voting_end_timestamp <= 0 ||
        now <= hackathon.voting_end_timestamp;
    const votingOpen = !paused && Boolean(hackathon.voting_enabled) && withinVotingDeadline;

    const publishedWhileFinished =
        hackathon.status === "finished" &&
        Boolean(season?.results_published_at) &&
        !judgingAfterPublish;
    const judgingOpen = !paused && Boolean(hackathon.judging_open) && !publishedWhileFinished;

    return {
        paused,
        submissionsOpen,
        submissionsClosed,
        votingOpen,
        judgingOpen,
        galleryPublic: submissionsClosed && isPublicGalleryEnabled(),
        resultsVisible: Boolean(hackathon.results_published),
    };
}

const stateCache = new WeakMap<object, Promise<EventState>>();

/** Resolve the active season and merged event settings once per request. */
export function getEventState(event: H3Event, now = Date.now()): Promise<EventState> {
    const cached = stateCache.get(event);
    if (cached) return cached;

    const pending = (async () => {
        const [season, hackathon] = await Promise.all([
            getActiveSeason(event),
            getHackathon(event),
        ]);
        return {
            season,
            hackathon,
            now,
            enforceDeadlines: isDeadlineEnforcementEnabled(),
            submissionGraceMs: getSubmissionGraceMs(),
            ...resolveEventGates(hackathon, season, { now }),
        } satisfies EventState;
    })();
    stateCache.set(event, pending);
    pending.catch(() => stateCache.delete(event));
    return pending;
}

/** Drop the request-scoped event state after a mutation that changes it. */
export function invalidateEventStateCache(event: H3Event): void {
    stateCache.delete(event);
}
