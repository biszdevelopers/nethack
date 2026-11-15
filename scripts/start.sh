#!/bin/sh
set -eu

# The runtime selector is plain JavaScript so it runs on either supported
# runtime. Prefer Node here; fall back to Bun when only Bun is installed.
if command -v node >/dev/null 2>&1; then
    exec node scripts/start-runtime.mjs
fi

if command -v bun >/dev/null 2>&1; then
    exec bun scripts/start-runtime.mjs
fi

printf '%s\n' 'Start requires Bun 1.3 or newer, or Node.js 24 or newer.' >&2
exit 127
