#!/bin/sh
set -eu

if command -v bun >/dev/null 2>&1; then
    if bun_version="$(bun --version 2>/dev/null)"; then
        bun_major="${bun_version%%.*}"
        bun_rest="${bun_version#*.}"
        bun_minor="${bun_rest%%.*}"
        case "$bun_major" in
            ""|*[!0-9]*) ;;
            *)
                case "$bun_minor" in
                    ""|*[!0-9]*) bun_minor=0 ;;
                esac
                if [ "$bun_major" -gt 1 ] || { [ "$bun_major" -eq 1 ] && [ "$bun_minor" -ge 3 ]; }; then
                    exec bun start-fix.mjs
                fi
                ;;
        esac
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

printf '%s\n' 'Start requires Bun 1.3 or newer, or Node.js 24 or newer.' >&2
exit 127
