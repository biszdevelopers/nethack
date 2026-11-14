import { readFile, stat } from "node:fs/promises";
import { createError } from "h3";
import fetch from "node-fetch";
import { parse } from "yaml";
import { z } from "zod";
import { RubricDefinitionSchema } from "../../shared/schemas";

const maxBytes = 64 * 1024;
const refreshInterval = 5 * 60 * 1000;
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

let localConfig: { modifiedAt: number; size: number; value: HackathonConfig } | undefined;

async function readLocalConfig() {
    const file = await stat("HACKATHON.yml");
    if (file.size > maxBytes) throw new Error("HACKATHON.yml exceeds 64 KiB");
    if (localConfig?.modifiedAt === file.mtimeMs && localConfig.size === file.size) {
        return localConfig.value;
    }
    const source = await readFile("HACKATHON.yml");
    if (source.length > maxBytes) throw new Error("HACKATHON.yml exceeds 64 KiB");
    const value = parseHackathonConfig(source.toString("utf8"));
    localConfig = { modifiedAt: file.mtimeMs, size: file.size, value };
    return value;
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
            state.value = parseHackathonConfig(await response.text());
            state.etag = response.headers.get("etag") ?? undefined;
        } else {
            response.body?.destroy();
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

    if (remote?.source !== source) remote = { source, nextCheck: 0 };
    const state = remote;
    if (Date.now() >= state.nextCheck) {
        state.pending ??= refreshRemote(state);
        await state.pending;
    }
    if (!state.value) {
        throw createError({
            statusCode: 503,
            message: "Remote hackathon configuration is unavailable.",
        });
    }
    return state.value;
}
