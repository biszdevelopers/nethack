import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createError } from "h3";
import fetch from "node-fetch";
import { parse, parseDocument } from "yaml";
import { z } from "zod";
import { RubricDefinitionSchema } from "../../shared/schemas";

const maxBytes = 64 * 1024;
const refreshInterval = 5 * 60 * 1000;

export function getHackathonCacheFile(): string {
    return resolve(process.env.HACKATHON_CACHE_PATH?.trim() || "assets/hackathon-config.yml");
}
/** Local manifest edited by the portal when the YAML source is `local`. */
export function getLocalHackathonConfigPath(): string {
    return process.env.HACKATHON_CONFIG_PATH?.trim() || "HACKATHON.yml";
}
const flag = z
    .union([z.literal(0), z.literal(1), z.boolean()])
    .transform((value) => (value ? 1 : 0));
const timestamp = z.union([
    z.number().int().nonnegative().max(8_640_000_000_000_000),
    z.iso.datetime({ offset: true }).transform(Date.parse).pipe(z.number().int().nonnegative()),
]);
const hackathonSchema = z.strictObject({
    id: z.literal(1).default(1),
    status: z.enum(["not_started", "in_progress", "voting", "finished", "paused"]),
    voting_enabled: flag,
    results_published: flag,
    show_scores: flag,
    show_ranking: flag,
    submitted_count: z.number().int().nonnegative().default(0),
    max_votes_per_user: z.number().int().nonnegative(),
    judging_open: flag,
    schedule_start: z.string().nullable(),
    schedule_end: z.string().nullable(),
    start_timestamp: timestamp,
    end_timestamp: timestamp,
    voting_start_timestamp: timestamp,
    voting_end_timestamp: timestamp,
    results_open_timestamp: timestamp,
    theme_name: z.string().nullable(),
    theme_description: z.string().nullable(),
    announcement: z.string().nullable().default(null),
    rubric: z
        .object({ name: z.string().trim().min(1).max(100) })
        .and(RubricDefinitionSchema)
        .optional(),
});

type HackathonConfig = z.infer<typeof hackathonSchema>;

export function parseHackathonConfig(source: string): HackathonConfig {
    return hackathonSchema.parse(parse(source, { maxAliasCount: 0 }));
}

export function getHackathonConfigSource() {
    const source = process.env.YAML_SOURCE_HACKATHON?.trim();
    return !source || source === "local" ? "local" : source;
}

export function hackathonUsesYaml() {
    return getHackathonConfigSource() !== "database";
}

let localConfig:
    | { path: string; modifiedAt: number; size: number; value: HackathonConfig }
    | undefined;

async function readLocalConfig() {
    const path = getLocalHackathonConfigPath();
    const file = await stat(path);
    if (file.size > maxBytes) throw new Error("HACKATHON.yml exceeds 64 KiB");
    if (
        localConfig?.path === path &&
        localConfig.modifiedAt === file.mtimeMs &&
        localConfig.size === file.size
    ) {
        return localConfig.value;
    }
    const source = await readFile(path);
    if (source.length > maxBytes) throw new Error("HACKATHON.yml exceeds 64 KiB");
    const value = parseHackathonConfig(source.toString("utf8"));
    localConfig = { path, modifiedAt: file.mtimeMs, size: file.size, value };
    return value;
}

async function readCachedRemoteConfig() {
    const source = await readFile(getHackathonCacheFile());
    if (source.length > maxBytes) throw new Error("Cached HACKATHON.yml exceeds 64 KiB");
    return parseHackathonConfig(source.toString("utf8"));
}

async function writeCachedRemoteConfig(source: string) {
    try {
        await mkdir(dirname(getHackathonCacheFile()), { recursive: true });
        const temporary = `${getHackathonCacheFile()}.${process.pid}.tmp`;
        await writeFile(temporary, source, { mode: 0o600 });
        await rename(temporary, getHackathonCacheFile());
    } catch {
        // The cache is best-effort; the in-memory manifest remains usable.
    }
}

function getRemoteConfigUrl(source: string) {
    const url = new URL(source);
    if (
        (url.protocol !== "https:" &&
            !(url.protocol === "http:" && process.env.NODE_ENV !== "production")) ||
        url.username ||
        url.password ||
        url.hash
    )
        throw new Error("YAML_SOURCE_HACKATHON must be a credential-free HTTPS URL in production");
    return url.pathname === "/" && !url.search ? new URL("HACKATHON.yml", url) : url;
}

let remote:
    | {
          source: string;
          value?: HackathonConfig;
          etag?: string;
          nextCheck: number;
          pending?: Promise<void>;
      }
    | undefined;

async function refreshRemote(state: NonNullable<typeof remote>) {
    try {
        const response = await fetch(getRemoteConfigUrl(state.source), {
            redirect: "error",
            signal: AbortSignal.timeout(3000),
            size: maxBytes,
            headers: state.etag ? { "If-None-Match": state.etag } : {},
        });
        if (response.ok) {
            const source = await response.text();
            state.value = parseHackathonConfig(source);
            state.etag = response.headers.get("etag") ?? undefined;
            await writeCachedRemoteConfig(source);
        } else {
            (response.body as unknown as { destroy?: () => void } | null)?.destroy?.();
        }
    } catch {
        // Keep the last successfully validated configuration during an outage.
    } finally {
        state.nextCheck = Date.now() + refreshInterval;
        state.pending = undefined;
    }
}

export async function readHackathonConfig(): Promise<HackathonConfig> {
    const source = getHackathonConfigSource();
    if (source === "local") {
        try {
            return await readLocalConfig();
        } catch {
            throw createError({
                statusCode: 503,
                message: "Local HACKATHON.yml is missing or invalid.",
            });
        }
    }

    try {
        getRemoteConfigUrl(source);
    } catch {
        throw createError({
            statusCode: 503,
            message: "YAML_SOURCE_HACKATHON must be a credential-free HTTPS URL in production.",
        });
    }

    if (remote?.source !== source) remote = { source, nextCheck: 0 };
    const state = remote;
    if (Date.now() >= state.nextCheck) {
        state.pending ??= refreshRemote(state);
        await state.pending;
    }
    if (!state.value) {
        try {
            return await readCachedRemoteConfig();
        } catch {
            try {
                return await readLocalConfig();
            } catch {
                throw createError({
                    statusCode: 503,
                    message: "Remote hackathon configuration is unavailable.",
                });
            }
        }
    }
    return state.value;
}

/** Settings the portal may write back into the local manifest. */
const writableConfigKeys = new Set<keyof HackathonConfig>([
    "status",
    "voting_enabled",
    "results_published",
    "show_scores",
    "show_ranking",
    "max_votes_per_user",
    "judging_open",
    "schedule_start",
    "schedule_end",
    "start_timestamp",
    "end_timestamp",
    "voting_start_timestamp",
    "voting_end_timestamp",
    "results_open_timestamp",
    "theme_name",
    "theme_description",
    "announcement",
]);

let pendingWrite: Promise<unknown> = Promise.resolve();

async function writeLocalConfig(patch: Record<string, unknown>): Promise<HackathonConfig> {
    for (const key of Object.keys(patch)) {
        if (!writableConfigKeys.has(key as keyof HackathonConfig)) {
            throw createError({
                statusCode: 400,
                message: `${key} cannot be changed through the portal.`,
            });
        }
    }

    let source: string;
    try {
        source = await readFile(getLocalHackathonConfigPath(), "utf8");
    } catch {
        throw createError({
            statusCode: 503,
            message: "Local HACKATHON.yml is missing or unreadable.",
        });
    }

    // parseDocument keeps comments and the rubric block intact when a single
    // setting changes.
    const document = parseDocument(source);
    let value: HackathonConfig;
    try {
        for (const [key, setting] of Object.entries(patch)) {
            document.set(key, setting);
        }
        value = parseHackathonConfig(document.toString());
    } catch {
        throw createError({
            statusCode: 409,
            message: "The updated HACKATHON.yml would be invalid. Fix the file first.",
        });
    }

    const file = getLocalHackathonConfigPath();
    const temporary = `${file}.${process.pid}.tmp`;
    try {
        await writeFile(temporary, document.toString(), { mode: 0o644 });
        await rename(temporary, file);
    } catch {
        throw createError({
            statusCode: 503,
            message: "Local HACKATHON.yml is not writable.",
        });
    }
    localConfig = undefined;
    return value;
}

/**
 * Persist live settings into the local manifest. Remote manifests are
 * read-only, and database mode writes through the database instead.
 */
export function writeHackathonConfig(patch: Record<string, unknown>): Promise<HackathonConfig> {
    if (getHackathonConfigSource() !== "local") {
        throw createError({
            statusCode: 409,
            message: "Live settings are read-only for this configuration source.",
        });
    }

    const run = pendingWrite.then(() => writeLocalConfig(patch));
    pendingWrite = run.catch(() => undefined);
    return run;
}
