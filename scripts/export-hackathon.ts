import { writeFile } from "node:fs/promises";
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
    for (const key of [
        "start_timestamp",
        "end_timestamp",
        "voting_start_timestamp",
        "voting_end_timestamp",
        "results_open_timestamp",
    ]) {
        row[key] = Number(row[key]);
    }
    const yaml = stringify(row);
    parseHackathonConfig(yaml);
    await writeFile(output, yaml, { flag: "wx" });
    console.info(`Exported the live hackathon configuration to ${output}.`);
} finally {
    await sql.end();
}
