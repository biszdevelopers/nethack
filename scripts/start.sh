#!/bin/sh
set -eu

# The selector is plain JavaScript and runs on either supported runtime. Use
# whichever executable is installed; it then picks Bun 1.3+ before Node 24+.
if command -v node >/dev/null 2>&1; then
    exec node scripts/start-runtime.mjs
fi

if command -v bun >/dev/null 2>&1; then
    exec bun scripts/start-runtime.mjs
fi

printf '%s\n' 'Start requires Bun 1.3 or newer, or Node.js 24 or newer.' >&2
exit 127