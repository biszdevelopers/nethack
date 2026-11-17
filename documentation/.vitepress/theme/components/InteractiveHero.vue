<script setup lang="ts">
import { ref, onMounted } from "vue";
import figlet from "figlet";
import ansiShadow from "figlet/importable-fonts/ANSI Shadow.js";

figlet.parseFont("ANSI Shadow", ansiShadow);
const asciiBanner = figlet.textSync("HACKATHON", {
    font: "ANSI Shadow",
    horizontalLayout: "fitted",
});

const bootLines = ref<string[]>([]);
const showMain = ref(false);
const terminalLines = ref<{ type: string; text: string }[]>([]);
const terminalDone = ref(false);

const bootSequence = [
    "nethack-docs v1.0.0",
    "Loading configuration... OK",
    "Resolving sidebar navigation... OK",
    "Mounting API reference... OK",
    "Mounting architecture guides... OK",
    "Mounting shared schemas... OK",
    "Building search index... OK",
    "All documentation systems ready.",
    "",
    "> docs --status=READY",
    "> Hackathon platform documentation",
    "> Awaiting operators...",
];

const terminalCommands = [
    { type: "prompt", text: "$ ls -la docs/" },
    { type: "output", text: "" },
    { type: "output", text: "drwxr-xr-x  guide" },
    { type: "output", text: "drwxr-xr-x  architecture" },
    { type: "output", text: "drwxr-xr-x  frontend" },
    { type: "output", text: "drwxr-xr-x  backend" },
    { type: "output", text: "drwxr-xr-x  shared" },
    { type: "output", text: "drwxr-xr-x  deployment" },
    { type: "output", text: "" },
    { type: "prompt", text: "$ cat docs/welcome.txt" },
    { type: "output", text: "" },
    { type: "output", text: "BIBS-C Network Hackathon Platform" },
    { type: "output", text: "Season details are managed from the admin portal" },
    { type: "output", text: "" },
    { type: "output", text: "Stack: Nuxt 4 + Nitro + Vue 3 + PostgreSQL" },
    { type: "output", text: "Auth: basis-auth OpenID Connect" },
    { type: "output", text: "Features: teams, submissions, peer voting, judge rubrics" },
    { type: "output", text: "Admin: seasons, announcements, rubrics, results" },
    { type: "output", text: "" },
    { type: "prompt", text: "$ _" },
];

onMounted(() => {
    bootSequence.forEach((line, i) => {
        setTimeout(() => {
            bootLines.value.push(line);
        }, i * 110);
    });
    setTimeout(
        () => {
            showMain.value = true;
        },
        bootSequence.length * 110 + 300,
    );

    let delay = 1200;
    terminalCommands.forEach((cmd, i) => {
        setTimeout(
            () => {
                terminalLines.value.push(cmd);
                if (i === terminalCommands.length - 1) {
                    terminalDone.value = true;
                }
            },
            delay + i * 180,
        );
    });
});
</script>

<template>
    <div class="vp-interactive-hero">
        <div v-if="!showMain" class="boot-sequence">
            <div class="ascii-art boot-art" tabindex="0">{{ asciiBanner }}</div>
            <div class="boot-lines">
                <p v-for="(line, i) in bootLines" :key="i" class="boot-line">
                    <span v-if="line.startsWith('>')" class="prompt">$</span>
                    {{ line }}
                    <span v-if="i === bootLines.length - 1" class="crt-cursor-inline">_</span>
                </p>
            </div>
        </div>

        <div v-else class="main-content">
            <div class="hero-section">
                <div class="ascii-art hero-art" tabindex="0">{{ asciiBanner }}</div>
                <h2 class="hero-subtitle">Network Hackathon Platform Docs</h2>
                <p class="hero-tagline">
                    BIBS-C Network &nbsp;|&nbsp; Season configuration lives in the admin portal
                </p>

                <div class="hero-status">
                    <span>
                        <span class="status-dot"></span>
                        System Online
                    </span>
                    <span class="status-center">DOCUMENTATION_STATUS: READY</span>
                    <span>
                        Tests:
                        <TestCount />
                    </span>
                </div>

                <div class="hero-actions">
                    <a href="/guide/getting-started" class="hero-btn primary">Get Started</a>
                    <a href="/architecture/overview" class="hero-btn">Architecture</a>
                    <a href="/backend/api-reference" class="hero-btn">API Ref</a>
                </div>
            </div>

            <div class="bh-terminal">
                <div class="terminal-titlebar">
                    <div class="terminal-dots">
                        <span class="dot-red"></span>
                        <span class="dot-yellow"></span>
                        <span class="dot-green"></span>
                    </div>
                    <span class="terminal-title">nethack@docs:~</span>
                    <span class="terminal-size">bash — 80×24</span>
                </div>
                <div class="terminal-body">
                    <div
                        v-for="(line, i) in terminalLines"
                        :key="i"
                        :class="['terminal-line', line.type]"
                    >
                        <template v-if="line.type === 'prompt'">
                            <span class="ps1-user">nethack</span>
                            <span class="ps1-host">@docs</span>
                            <span class="ps1-path">:~</span>
                            <span class="ps1-cmd">{{ line.text.replace("$ ", "") }}</span>
                        </template>
                        <template v-else>
                            {{ line.text }}
                        </template>
                    </div>
                    <span v-if="terminalDone" class="term-cursor">_</span>
                </div>
            </div>

            <div class="network-grid">
                <div class="network-node">
                    <div class="node-title">Full-Stack Nuxt 4</div>
                    <div class="node-desc">Vue 3 + Nitro + TypeScript + PostgreSQL</div>
                </div>
                <div class="network-node">
                    <div class="node-title">Authentication</div>
                    <div class="node-desc">basis-auth, PKCE, state, nonce</div>
                </div>
                <div class="network-node">
                    <div class="node-title">Hackathon Engine</div>
                    <div class="node-desc">Teams, submissions, peer voting, judge rubrics</div>
                </div>
                <div class="network-node">
                    <div class="node-title">Season Studio</div>
                    <div class="node-desc">
                        Admin-editable announcements, schedules, themes, and rubrics
                    </div>
                </div>
                <div class="network-node">
                    <div class="node-title">Dev Portal</div>
                    <div class="node-desc">Users, teams, seasons, debug tools</div>
                </div>
                <div class="network-node">
                    <div class="node-title">Graph Integration</div>
                    <div class="node-desc">Meetings, Teams chat, webhooks</div>
                </div>
                <div class="network-node">
                    <div class="node-title">VPS</div>
                    <div class="node-desc">Node.js server + PostgreSQL + CI/CD</div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.boot-art,
.hero-art {
    font-size: clamp(0.35rem, 1.2vw, 0.7rem);
    line-height: 1.05;
    overflow-x: auto;
    margin-bottom: 1rem;
}

.boot-lines {
    margin-top: 1rem;
}

.boot-line {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
}

.prompt {
    opacity: 0.6;
    margin-right: 0.4em;
}

.crt-cursor-inline {
    animation: cursor-blink 1s step-end infinite;
}

.main-content {
    animation: fade-in-up 0.5s ease;
}

.hero-section {
    padding: 1.5rem 0 1rem;
}

.hero-section .hero-actions {
    margin-top: 1.5rem;
}
</style>
