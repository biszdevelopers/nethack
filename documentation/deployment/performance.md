---
title: Production Performance Defaults
description: Static asset compression, caching, and font loading optimizations configured for production builds.
---

# Production Performance Defaults

Production builds of basishacks ship with a set of performance defaults in `nuxt.config.ts`. These are applied automatically by Nitro and `@nuxt/fonts`; no extra environment variables are required.

## Static asset compression

Nitro is configured to pre-compress public assets:

```ts
nitro: {
    compressPublicAssets: true,
}
```

This generates **gzip and brotli** versions of eligible static files so the Node/Bun server can serve compressed responses without runtime overhead. Brotli typically achieves 15–25% better compression ratios than gzip for text-based assets.

## Request body size limits

`server/middleware/01.request-body-limit.ts` applies a streaming byte limit before API route handlers parse buffered request bodies. Ordinary API payloads are capped at **1 MiB** and receive `413 Payload Too Large` when they exceed it. The user profile handler authenticates and authorizes the caller before reading its separate **10 MiB** allowance for base64 images. Microsoft Graph webhooks have a stricter **64 KiB** route-specific cap, while multipart uploads are streamed and capped by their file and multipart-overhead limits.

The application discards over-limit bodies without retaining the remaining chunks. Keep an ingress body-size limit and request-body timeout enabled as a second boundary. The supplied Nginx configuration uses a 10 MiB limit, which accommodates the supported profile-image request format.

## Long-lived cache headers

`routeRules` attach immutable cache headers to versioned/hashed static asset paths:

```ts
routeRules: {
    "/_nuxt/**": {
        headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
    "/assets/**": {
        headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
    "/fonts/**": {
        headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
}
```

- `/_nuxt/**` covers hashed Nuxt build chunks.
- `/assets/**` covers user-uploaded and static assets under `public/assets`.
- `/fonts/**` covers the Monaspace Neon font files.

::: tip These paths are assumed to contain hashed or versioned filenames. If you add mutable files under `/assets/` or `/fonts/`, either use a hash in the filename or lower the cache time for that path. :::

## Font loading

The critical Monaspace Neon font is preloaded in `app/app.vue`:

```ts
useHead({
    link: [
        {
            rel: "preload",
            href: "/fonts/Monaspace-Neon.woff2",
            as: "font",
            type: "font/woff2",
            crossorigin: "anonymous",
        },
    ],
});
```

`@nuxt/fonts` is configured to apply `font-display: swap` and preload discovered fonts:

```ts
fonts: {
    provider: "local",
    defaults: {
        display: "swap",
        preload: true,
    },
    processCSSVariables: true,
}
```

`display: "swap"` ensures text remains visible with a fallback font while Monaspace Neon loads.

## Build target

`vite.build.target` is kept at `es2020`:

```ts
vite: {
    build: {
        target: "es2020",
    },
}
```

Node.js >= v24 and Bun both support `es2020` without issue. The target can be re-evaluated to `es2022` or later once the project is confirmed to build cleanly with a newer target.

## Vite build target

`vite` is constrained by the compatible `^8.0.16` override in `package.json`. The lockfile selects the exact tested release. Keep the lockfile committed and run the production build after updating this override because Nuxt and Nitro also depend on the Vite/Rolldown integration.

## Bounded server icon collection

`@nuxt/icon` normally bundles every installed icon collection for server-side icon requests. This app scans the source for used icons and generates a local custom collection containing only those icons before `bun run dev`, `bun run build`, and `bun run generate`. The generated SVGs live under the ignored `node_modules/.cache/basishacks-icon-collections` directory and are embedded into the production output. Run `bun run postinstall` after installing dependencies if the Nuxt icon scan file is missing.

In a local production build, the Nitro output decreased from 29.8 MB with discovered collections to 3.24 MB with the 92 scanned icons, an 89% reduction. This measures build output size only; it does not prove the idle RSS target. Measure RSS separately with the Linux workflow below.

## Verification

A configuration test in `tests/nuxt-config.test.ts` asserts that the performance defaults are present in `nuxt.config.ts`. Run it with:

```bash
bun run test tests/nuxt-config.test.ts
```

For a full production smoke test, build the app:

```bash
bun run build
```

and then start the server with `bun run start` or `node start-fix.mjs`.

## VPS measurement workflow

Use `scripts/benchmark-vps.mjs` on the Linux VPS to collect app-process RSS, request throughput, unexpected error rate, latency percentiles, and app CPU percentage. The harness samples RSS every second and emits a JSON report. It fails when unexpected errors exceed 0.1%, when idle p95 RSS exceeds its runtime-specific ceiling, or when load max RSS reaches its ceiling. It measures the process ID supplied with `--pid`; run the Bun and Node services separately with the same build, database configuration, host, and request targets.

The idle process RSS p95 ceilings are exactly 100,663,296 bytes (96 MiB) under Bun and 134,217,728 bytes (128 MiB) under Node. The load run checks maximum process RSS below 500,000,000 bytes. App-service cgroup memory must also stay below 500,000,000 bytes during startup and the 60-minute load run. `MemoryHigh=450000000` and `MemoryMax=500000000` enforce pressure and the hard limit for the systemd cgroup. The harness reports process RSS; also sample the unit's cgroup memory during startup and load:

```bash
watch -n 1 'systemctl show basishacks.service --property=MemoryCurrent --value'
```

Common API p95 latency must be at most 500 ms, heavier report p95 at most 1 second, and unexpected request errors below 0.1%. For each measured N+1 bottleneck, target at least a 30% p95 reduction against the `main` baseline while meeting the absolute latency limit.

Create a target file with representative health/page/database-backed requests. For example, this exercises the home page, active-season lookup, and public team list:

```json
[
    { "name": "home", "path": "/", "type": "page" },
    { "name": "active-season", "path": "/api/seasons/active", "type": "api" },
    { "name": "team-list", "path": "/api/teams?season_id=1", "type": "api" }
]
```

Set `type` to `api` for endpoints with a 500 ms p95 ceiling or `report` for report endpoints with a 1,000 ms ceiling. For an authenticated report target, configure a short-lived benchmark token with `BENCHMARK_HEADERS_JSON`; do not store credentials in the target file. Set `nPlusOne: true` and a stable `name` on each target whose p95 must improve by at least 30% against the baseline.

Measure five cold starts per runtime with the startup harness. In systemd mode, the harness stops and starts the named unit five times, measures the service process RSS, and samples the service's `memory.current` cgroup value while it starts. Run it in a maintenance window with permission to control the unit. The systemd memory limit remains active for every run:

```bash
sudo node scripts/benchmark-startup.mjs \
  --systemd-unit basishacks.service \
  --url http://127.0.0.1:3000 \
  --runs 5 \
  --timeout-ms 60000 \
  --cgroup-memory-file /sys/fs/cgroup/system.slice/basishacks.service/memory.current \
  --memory-limit-bytes 500000000 \
  --output /var/log/basishacks/cold-start-bun.json
```

Install the Bun unit as `basishacks.service` for that measurement. For Node, install the Node unit under the same service name, then rerun with a separate report file. The harness reads the unit's main PID and cgroup, so its own memory is excluded from service measurements.

After each cold-start series, start the service and run the five-minute warm-up followed by five minutes of one-second RSS sampling:

```bash
node scripts/benchmark-vps.mjs \
  --mode idle \
  --runtime bun \
  --url http://127.0.0.1:3000 \
  --pid "$APP_PID" \
  --targets /etc/basishacks/benchmark-targets.json \
  --cgroup-memory-file /sys/fs/cgroup/system.slice/basishacks-bun.service/memory.current \
  --warmup 300 \
  --duration 300 \
  --output /var/log/basishacks/idle-bun-1.json
```

Run this command against the Node service with `--runtime node` and a distinct output filename:

```bash
node scripts/benchmark-vps.mjs \
  --mode idle \
  --runtime node \
  --url http://127.0.0.1:3000 \
  --pid "$APP_PID" \
  --targets /etc/basishacks/benchmark-targets.json \
  --cgroup-memory-file /sys/fs/cgroup/system.slice/basishacks-node.service/memory.current \
  --warmup 300 \
  --duration 300 \
  --output /var/log/basishacks/idle-node-1.json
```

Repeat each cold-start and idle measurement five times for Bun and five times for Node. The harness selects the corresponding 96 MiB or 128 MiB p95 threshold from `--runtime`. For a 250-user, 60-minute soak, use the matching runtime value:

```bash
node scripts/benchmark-vps.mjs \
  --mode load \
  --runtime bun \
  --url http://127.0.0.1:3000 \
  --pid "$APP_PID" \
  --targets /etc/basishacks/benchmark-targets.json \
  --cgroup-memory-file /sys/fs/cgroup/system.slice/basishacks-bun.service/memory.current \
  --database-metrics /var/log/basishacks/bun-metrics.jsonl \
  --users 250 \
  --warmup 300 \
  --duration 3600 \
  --memory-limit-bytes 500000000 \
  --output /var/log/basishacks/load-bun.json
```

Run a second soak against the Node service with `--runtime node` and a separate output filename.

Enable `DATABASE_METRICS=1` in the service environment before the run, restart the service, and capture its identifier-free PostgreSQL timing summaries from journald:

```bash
sudo journalctl --output=cat --unit=basishacks.service --follow \
  > /var/log/basishacks/postgres-metrics.jsonl &
METRICS_CAPTURE_PID=$!
# Run the 60-minute benchmark here.
sudo kill "$METRICS_CAPTURE_PID"
```

Pass that JSON-lines file as `--database-metrics /var/log/basishacks/postgres-metrics.jsonl`. The benchmark reports query-runtime and pool-acquire-wait p50/p95/p99, counts, and errors from samples whose timestamps fall inside the measured window. Store the service's benchmark JSON separately from its metrics log.

Run the same 60-minute load command once against `main` and save its JSON report. Then run it against the candidate with `--baseline /var/log/basishacks/main-report.json`; the harness reports throughput, errors, latency percentiles, CPU, RSS, and database timing differences, and compares named targets marked `nPlusOne: true`. It fails unless each marked target's p95 latency improves by at least 30%. Use the same URL, target file, database snapshot, CPU limits, and warm-up/duration settings in both runs:

```bash
# Baseline build from main
node scripts/benchmark-vps.mjs --mode load --runtime bun --url http://127.0.0.1:3000 \
  --pid "$MAIN_PID" --targets /etc/basishacks/benchmark-targets.json \
  --users 250 --warmup 300 --duration 3600 \
  --output /var/log/basishacks/main-report.json

# Candidate build
node scripts/benchmark-vps.mjs --mode load --runtime bun --url http://127.0.0.1:3000 \
  --pid "$CANDIDATE_PID" --targets /etc/basishacks/benchmark-targets.json \
  --users 250 --warmup 300 --duration 3600 \
  --baseline /var/log/basishacks/main-report.json \
  --output /var/log/basishacks/candidate-report.json
```

Target entries also report per-target p50/p95/p99, request counts, unexpected errors, and whether their p95 ceiling passed.

Set `DATABASE_METRICS=1` on the app service while measuring to emit bounded, identifier-free PostgreSQL query-runtime and pool-acquisition wait histograms once per minute. Save those `postgres_metrics` log lines alongside each benchmark report. Use the same targets and database snapshot for the `main` baseline and candidate build; compare p50/p95/p99 latency, throughput, error rate, CPU, RSS, and pool/query timing. Include representative authorized API routes in the targets when assessing authenticated journeys; set request headers through `BENCHMARK_HEADERS_JSON` rather than saving credentials in the target file.

These commands describe the release-gate procedure; Linux measurements have not been run as part of the documentation build. Record the outputs for both runtimes and compare them with the `main` baseline before release.
