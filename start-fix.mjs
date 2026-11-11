import { resolve } from "node:path";
process.env.NODE_ENV ??= "production";
const entryPath = resolve(".output/server/index.mjs");
globalThis._importMeta_ = { url: `file:///${entryPath.replace(/\\/g, "/")}` };
await import("./.output/server/index.mjs");
