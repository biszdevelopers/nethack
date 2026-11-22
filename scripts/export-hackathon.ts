import { rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { stringify } from "yaml";
import { parseHackathonConfig } from "../server/utils/hackathon-config";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL before exporting the hackathon configuration.");

const output = process.argv[2] ?? "HACKATHON.yml";
const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
try {
    const [row] = await sql`SELECT * FROM hackathon WHERE id = 1`;
    if (!row) throw new Error("PostgreSQL has no hackathon row with id 1.");
    // The overrides column is a portal-only mirror; the row already carries the
    // effective switches and the manifest schema does not accept this key.
    const { live_overrides: _liveOverrides, ...settings } = row;
    for (const key of [
        "start_timestamp",
        "end_timestamp",
        "voting_start_timestamp",
        "voting_end_timestamp",
        "results_open_timestamp",
    ]) {
        settings[key] = Number(settings[key]);
    }
    const [version] = await sql`
        SELECT rv.name, rv.definition
        FROM seasons s
        JOIN rubric_versions rv ON rv.id = s.rubric_version_id AND rv.season_id = s.id
        WHERE s.is_active = 1
    `;
    const yaml = stringify({
        ...settings,
        ...(version ? { rubric: { ...version.definition, name: version.name } } : {}),
    });
    parseHackathonConfig(yaml);
    // Replace the manifest atomically so an interrupted export cannot leave a
    // truncated file that makes every local-YAML read fail.
    const target = resolve(output);
    const temporary = `${target}.${process.pid}.tmp`;
    try {
        await writeFile(temporary, yaml);
        await rename(temporary, target);
    } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
    console.info(`Exported the live hackathon configuration to ${output}.`);
} finally {
    await sql.end();
}
