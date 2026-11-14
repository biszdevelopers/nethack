#!/bin/sh
set -eu

if command -v bun >/dev/null 2>&1; then
    if bun_version="$(bun --version 2>/dev/null)" && [ "$bun_version" = "1.3.14" ]; then
        exec bun start-fix.mjs
    fi
fi

if command -v node >/dev/null 2>&1; then
    node_version="$(node --version 2>/dev/null || true)"
    case "$node_version" in
        v[0-9]*)
            node_major="${node_version#v}"
            node_major="${node_major%%.*}"
            case "$node_major" in
                ""|*[!0-9]*) ;;
                *)
                    if [ "$node_major" -ge 24 ]; then
                        exec node start-fix.mjs
                    fi
                    ;;
            esac
            ;;
    esac
fi

printf '%s\n' 'Start requires Bun 1.3.14 or Node.js 24 or newer.' >&2
exit 127
