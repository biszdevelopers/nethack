<script setup lang="ts">
useHead({
    meta: [
        {
            name: "description",
            content:
                "Descend through six award-winning projects from the Beneath the Surface season of the BIBS-C Network Hackathon.",
        },
    ],
});

type WinnerTheme = "rainbow" | "land" | "forest" | "metadata" | "unseen" | "trace";

interface WinnerConfig {
    id: number;
    pathway: "junior" | "senior";
    rank: 1 | 2 | 3;
    theme: WinnerTheme;
    projectName: string;
    teamName: string;
    chapter: string;
    lede: string;
}

const WINNERS: readonly WinnerConfig[] = [
    {
        id: 50,
        pathway: "junior",
        rank: 1,
        theme: "rainbow",
        projectName: "Where the Rainbow Ends",
        teamName: "Where the Rainbow Ends",
        chapter: "Neon above. A tired city below.",
        lede: "A cyberpunk visual novel that splits what people say from what they really think, revealing two lives trapped on opposite sides of the same immaculate city.",
    },
    {
        id: 12,
        pathway: "junior",
        rank: 2,
        theme: "land",
        projectName: "Beneath the Land",
        teamName: "NaN",
        chapter: "When the water rises, the only way is down.",
        lede: "A flooded top-down world becomes a puzzle-filled descent, where each crate pushed into place opens another layer beneath the land.",
    },
    {
        id: 49,
        pathway: "junior",
        rank: 3,
        theme: "forest",
        projectName: "Horror Forest",
        teamName: "Team ZLZH",
        chapter: "The forest remembers every tree.",
        lede: "Gather resources by day, then survive the creatures that surface after dark—a warning about what answers when we take too much.",
    },
    {
        id: 9,
        pathway: "senior",
        rank: 1,
        theme: "metadata",
        projectName: "metadata manipulation tool",
        teamName: "/usr/335",
        chapter: "Every file tells more than it shows.",
        lede: "A privacy utility for inspecting, editing, and removing hidden metadata—including the coordinates and device details quietly carried inside ordinary files.",
    },
    {
        id: 47,
        pathway: "senior",
        rank: 2,
        theme: "unseen",
        projectName: "Unseen Layers",
        teamName: "CSL",
        chapter: "Eighteen hours to remember who you are.",
        lede: "A fog-bound RPG about a protective personality piecing together fractured memories and the silent inner world of a comatose patient.",
    },
    {
        id: 25,
        pathway: "senior",
        rank: 3,
        theme: "trace",
        projectName: "TraceShadow",
        teamName: "67Team",
        chapter: "A website is never just one website.",
        lede: "A web scanner that maps the third-party domains loaded behind a URL, turning invisible requests into a network anyone can inspect.",
    },
] as const;

const { data: teams, error } = await useApiFetch<GetTeamResponse[]>("/api/teams?season_id=1");

const winners = computed(() => {
    const byId = new Map((teams.value ?? []).map((team) => [team.id, team]));
    return WINNERS.map((config) => ({
        config,
        team: byId.get(config.id) ?? null,
    }));
});

const root = ref<HTMLElement | null>(null);
let media: { revert: () => void } | null = null;
let disposed = false;

const pathwayLabel = (pathway: WinnerConfig["pathway"]) =>
    pathway === "junior" ? "Junior pathway" : "Senior pathway";

const rankLabel = (rank: WinnerConfig["rank"]) =>
    rank === 1 ? "First place" : rank === 2 ? "Second place" : "Third place";

const scrollToWinners = () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelector("#winner-50")?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
    });
};

onMounted(async () => {
    const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
    ]);

    if (disposed || !root.value) return;

    gsap.registerPlugin(ScrollTrigger);
    await nextTick();
    await document.fonts?.ready;

    if (disposed || !root.value) return;

    const storyRoot = root.value;
    media = gsap.matchMedia();
    media.add(
        {
            isDesktop: "(min-width: 900px)",
            reduceMotion: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
            const { isDesktop, reduceMotion } = context.conditions as {
                isDesktop: boolean;
                reduceMotion: boolean;
            };

            if (reduceMotion) {
                gsap.set("[data-reveal], [data-art]", { clearProps: "all" });
                return;
            }

            gsap.timeline({ defaults: { ease: "power3.out" } })
                .from(".hero-kicker", { autoAlpha: 0, y: 18, duration: 0.55 })
                .from(
                    ".hero-title-line",
                    { autoAlpha: 0, yPercent: 110, stagger: 0.11, duration: 0.9 },
                    "-=0.25",
                )
                .from(
                    ".hero-summary, .hero-actions, .hero-chart",
                    { autoAlpha: 0, y: 24, stagger: 0.12, duration: 0.65 },
                    "-=0.5",
                );

            gsap.fromTo(
                ".depth-progress",
                { scaleY: 0 },
                {
                    scaleY: 1,
                    ease: "none",
                    scrollTrigger: {
                        trigger: storyRoot,
                        start: "top top",
                        end: "bottom bottom",
                        scrub: 0.25,
                    },
                },
            );

            const sections = gsap.utils.toArray<HTMLElement>("[data-project-section]");
            sections.forEach((section) => {
                const reveals = section.querySelectorAll("[data-reveal]");
                const art = section.querySelectorAll("[data-art]");
                const stage = section.querySelector<HTMLElement>(".project-stage");

                const timeline = gsap.timeline({
                    defaults: { ease: "power2.out" },
                    scrollTrigger: isDesktop
                        ? {
                              trigger: section,
                              start: "top top",
                              end: "+=70%",
                              pin: stage,
                              scrub: 0.7,
                              invalidateOnRefresh: true,
                          }
                        : {
                              trigger: section,
                              start: "top 76%",
                              end: "bottom 45%",
                              toggleActions: "play none none reverse",
                          },
                });

                timeline
                    .from(reveals, {
                        autoAlpha: 0,
                        y: 42,
                        stagger: 0.09,
                        duration: isDesktop ? 0.55 : 0.7,
                    })
                    .from(
                        art,
                        {
                            autoAlpha: 0,
                            scale: 0.94,
                            y: 30,
                            stagger: 0.06,
                            duration: 0.7,
                        },
                        "<0.08",
                    );
            });

            gsap.utils.toArray<HTMLElement>("[data-drift]").forEach((element, index) => {
                gsap.to(element, {
                    y: index % 2 === 0 ? -12 : 12,
                    x: index % 3 === 0 ? 8 : -6,
                    duration: 3.8 + (index % 4) * 0.65,
                    ease: "sine.inOut",
                    repeat: -1,
                    yoyo: true,
                });
            });

            if (!isDesktop) return;

            const glow = root.value?.querySelector<HTMLElement>(".hero-glow");
            if (!glow) return;

            const moveX = gsap.quickTo(glow, "x", { duration: 0.8, ease: "power3.out" });
            const moveY = gsap.quickTo(glow, "y", { duration: 0.8, ease: "power3.out" });
            const handlePointerMove = (event: PointerEvent) => {
                moveX((event.clientX / window.innerWidth - 0.5) * 70);
                moveY((event.clientY / window.innerHeight - 0.5) * 48);
            };

            window.addEventListener("pointermove", handlePointerMove, { passive: true });
            return () => window.removeEventListener("pointermove", handlePointerMove);
        },
        storyRoot,
    );

    ScrollTrigger.refresh();
});

onUnmounted(() => {
    disposed = true;
    media?.revert();
    media = null;
});
</script>

<template>
    <GoBackUp />

    <main ref="root" class="surface-story">
        <div class="story-grain" aria-hidden="true" />

        <section class="surface-hero">
            <div class="hero-glow" aria-hidden="true" />
            <div class="hero-sonar" aria-hidden="true">
                <i />
                <i />
                <i />
            </div>

            <div class="hero-content">
                <p class="hero-kicker">May 2026</p>
                <h1>
                    <span class="title-mask"><span class="hero-title-line">Beneath</span></span>
                    <span class="title-mask title-offset">
                        <span class="hero-title-line">the Surface</span>
                    </span>
                </h1>
                <p class="hero-summary">
                    Six projects looked past what was obvious. Descend through the top three
                    discoveries from each pathway.
                </p>
            </div>

            <div class="hero-chart" aria-hidden="true">
                <div class="chart-heading">
                    <span>Expedition log</span>
                    <span>Surface / 00m</span>
                </div>
                <div class="chart-paths">
                    <div>
                        <span>Junior</span>
                        <i />
                        <i />
                        <i />
                    </div>
                    <div>
                        <span>Senior</span>
                        <i />
                        <i />
                        <i />
                    </div>
                </div>
                <p>Signal acquired</p>
            </div>

            <p v-if="error" class="hero-error">
                Live project details are temporarily unavailable. The archived winner profiles
                remain below.
            </p>
        </section>

        <section
            v-for="winner in winners"
            :id="`winner-${winner.config.id}`"
            :key="winner.config.id"
            class="project-section"
            :class="`theme-${winner.config.theme}`"
            :data-project="winner.config.theme"
            data-project-section
        >
            <div class="project-stage">
                <div class="section-grid" aria-hidden="true" />
                <div class="section-noise" aria-hidden="true" />

                <article class="project-copy">
                    <div class="project-meta" data-reveal>
                        <span
                            class="rank-medal"
                            :class="`medal-r${winner.config.rank}`"
                            role="img"
                            :aria-label="rankLabel(winner.config.rank)"
                        >
                            #{{ winner.config.rank }}
                        </span>
                        <span class="pathway-chip" :class="`pathway-${winner.config.pathway}`">
                            <i class="pathway-sonar" aria-hidden="true" />
                            <span>{{ pathwayLabel(winner.config.pathway) }}</span>
                        </span>
                    </div>
                    <p class="project-chapter" data-reveal>{{ winner.config.chapter }}</p>
                    <h2 data-reveal>
                        {{ winner.team?.project.name || winner.config.projectName }}
                    </h2>
                    <p class="project-team" data-reveal>
                        Built by {{ winner.team?.name || winner.config.teamName }}
                    </p>
                    <p class="project-lede" data-reveal>{{ winner.config.lede }}</p>
                    <div v-if="winner.team" class="project-actions" data-reveal>
                        <UModal :title="winner.team.project.name || winner.config.projectName">
                            <UButton color="primary" trailing-icon="i-lucide-arrow-up-right">
                                Open project
                            </UButton>
                            <template #body>
                                <ProjectCard :id="winner.team.id" :team="winner.team" />
                            </template>
                        </UModal>
                        <UButton
                            v-if="safeUrl(winner.team.project.repo_url)"
                            :href="safeUrl(winner.team.project.repo_url)"
                            target="_blank"
                            rel="noopener noreferrer"
                            external
                            color="neutral"
                            variant="outline"
                            icon="i-lucide-git-branch"
                        >
                            Repository
                        </UButton>
                    </div>
                    <p v-else class="project-unavailable" data-reveal>
                        Live links for this archived project are currently unavailable.
                    </p>
                </article>

                <div class="project-visual" aria-hidden="true">
                    <template v-if="winner.config.theme === 'rainbow'">
                        <div class="tokyo-sun" data-art />
                        <div class="rain-field" data-art>
                            <i v-for="drop in 16" :key="drop" />
                        </div>
                        <div class="city-blocks" data-art>
                            <i v-for="building in 8" :key="building" />
                        </div>
                        <div class="dialogue surface-dialogue" data-art data-drift>
                            <span>SURFACE / 23:48</span>
                            <strong>“Everything is fine.”</strong>
                        </div>
                        <div class="dialogue thought-dialogue" data-art data-drift>
                            <span>INTERNAL / UNSENT</span>
                            <strong>I cannot breathe here.</strong>
                        </div>
                    </template>

                    <template v-else-if="winner.config.theme === 'land'">
                        <div class="pixel-sky" data-art>
                            <span />
                            <span />
                            <span />
                        </div>
                        <div class="flood-line" data-art><span>Water level 87%</span></div>
                        <div class="underground-shaft" data-art>
                            <div class="pixel-player" data-drift />
                            <div class="pixel-crate crate-one" />
                            <div class="pixel-crate crate-two" />
                            <div class="detector"><i /></div>
                            <div class="shaft-door">LEVEL −04</div>
                        </div>
                    </template>

                    <template v-else-if="winner.config.theme === 'forest'">
                        <div class="forest-moon" data-art />
                        <div class="forest-haze" data-art />
                        <div class="tree-line tree-line-back" data-art>
                            <i v-for="tree in 9" :key="tree" />
                        </div>
                        <div class="tree-line tree-line-front" data-art>
                            <i v-for="tree in 7" :key="tree" />
                        </div>
                        <div class="forest-warning" data-art data-drift>
                            <span>NIGHT 04</span>
                            <strong>THE WOODS ARE AWAKE</strong>
                            <i>RUN → WATER</i>
                        </div>
                    </template>

                    <template v-else-if="winner.config.theme === 'metadata'">
                        <div class="file-inspector" data-art>
                            <div class="file-toolbar">
                                <i />
                                <i />
                                <i />
                                <span>IMG_2048.JPG — EXIF</span>
                            </div>
                            <div class="metadata-row">
                                <span>GPS LATITUDE</span>
                                <strong>22.3193° N</strong>
                            </div>
                            <div class="metadata-row">
                                <span>GPS LONGITUDE</span>
                                <strong>114.1694° E</strong>
                            </div>
                            <div class="metadata-row">
                                <span>DEVICE</span>
                                <strong>VISIBLE TO ANYONE</strong>
                            </div>
                            <div class="metadata-row metadata-removed">
                                <span>OWNER</span>
                                <strong>REMOVED</strong>
                            </div>
                            <div class="clean-command">$ metadata-tool --strip ./IMG_2048.JPG</div>
                        </div>
                        <div class="map-grid" data-art data-drift><i /></div>
                    </template>

                    <template v-else-if="winner.config.theme === 'unseen'">
                        <div class="memory-room" data-art>
                            <div class="room-door"><span>?</span></div>
                            <div class="room-clock">18:00:00</div>
                            <div class="memory-fragment fragment-one" data-drift>WHO</div>
                            <div class="memory-fragment fragment-two" data-drift>AM</div>
                            <div class="memory-fragment fragment-three" data-drift>I</div>
                            <div class="room-floor" />
                        </div>
                        <div class="apartment-fog" data-art />
                    </template>

                    <template v-else>
                        <div class="trace-panel" data-art>
                            <div class="trace-header">
                                <span>TRACE / ACTIVE</span>
                                <i>12 external domains</i>
                            </div>
                            <svg viewBox="0 0 620 430" role="presentation">
                                <g class="trace-lines">
                                    <path d="M310 215 115 92" />
                                    <path d="M310 215 492 74" />
                                    <path d="M310 215 544 242" />
                                    <path d="M310 215 420 364" />
                                    <path d="M310 215 150 350" />
                                    <path d="M115 92 220 55" />
                                    <path d="M544 242 560 345" />
                                </g>
                                <g class="trace-nodes">
                                    <circle class="origin-node" cx="310" cy="215" r="34" />
                                    <circle cx="115" cy="92" r="15" />
                                    <circle cx="492" cy="74" r="11" />
                                    <circle cx="544" cy="242" r="18" />
                                    <circle cx="420" cy="364" r="12" />
                                    <circle cx="150" cy="350" r="14" />
                                    <circle cx="220" cy="55" r="7" />
                                    <circle cx="560" cy="345" r="8" />
                                </g>
                            </svg>
                            <div class="scan-beam" />
                            <span class="domain-chip domain-one">analytics</span>
                            <span class="domain-chip domain-two">cdn</span>
                            <span class="domain-chip domain-three">tracker</span>
                        </div>
                    </template>
                </div>

                <span class="section-index" aria-hidden="true">
                    {{ String(winner.config.rank).padStart(2, "0") }}
                </span>
            </div>
        </section>

        <section class="surface-return">
            <div class="return-rings" aria-hidden="true">
                <i />
                <i />
                <i />
            </div>
            <h2>The surface looks different once you know what lies beneath.</h2>
            <UButton
                to="/showcase"
                size="xl"
                color="neutral"
                variant="outline"
                trailing-icon="i-lucide-arrow-right"
            >
                Explore the full showcase
            </UButton>
        </section>
    </main>
</template>

<style scoped>
.surface-story {
    --ink: #eaf7f3;
    --muted: #9cb8b4;
    position: relative;
    overflow: clip;
    background: #020b10;
    color: var(--ink);
}

.story-grain {
    position: fixed;
    inset: 0;
    z-index: 90;
    opacity: 0.055;
    pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.75'/%3E%3C/svg%3E");
    mix-blend-mode: soft-light;
}

.depth-rail {
    position: fixed;
    top: 50%;
    right: 1.25rem;
    z-index: 80;
    display: grid;
    justify-items: center;
    gap: 0.5rem;
    transform: translateY(-50%);
}

.depth-rail-label {
    color: #95b9b3;
    font-size: 0.58rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    writing-mode: vertical-rl;
}

.depth-track {
    width: 1px;
    height: 5rem;
    overflow: hidden;
    background: rgb(181 226 216 / 20%);
}

.depth-progress {
    display: block;
    width: 100%;
    height: 100%;
    transform-origin: top;
    background: #a9ffe6;
    box-shadow: 0 0 0.8rem #a9ffe6;
}

.depth-rail a {
    display: grid;
    width: 1.45rem;
    aspect-ratio: 1;
    place-items: center;
    border: 1px solid rgb(180 228 217 / 20%);
    border-radius: 999px;
    color: #a9c2be;
    font-size: 0.55rem;
    transition:
        color 180ms ease,
        border-color 180ms ease,
        background 180ms ease;
}

.depth-rail a:hover,
.depth-rail a:focus-visible {
    border-color: #a9ffe6;
    background: rgb(169 255 230 / 12%);
    color: #fff;
}

.surface-hero {
    position: relative;
    display: grid;
    min-height: max(48rem, calc(100svh - 4rem));
    grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.45fr);
    align-items: center;
    gap: clamp(2rem, 6vw, 7rem);
    isolation: isolate;
    padding: clamp(2rem, 6vw, 7rem) max(2rem, calc((100vw - 82rem) / 2));
    overflow: hidden;
    background:
        linear-gradient(180deg, rgb(9 74 88 / 48%), transparent 38%),
        radial-gradient(circle at 72% 28%, rgb(43 182 169 / 20%), transparent 24rem),
        linear-gradient(155deg, #0c3440 0%, #061b25 45%, #020b10 100%);
}

.surface-hero::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background-image:
        linear-gradient(rgb(197 255 237 / 6%) 1px, transparent 1px),
        linear-gradient(90deg, rgb(197 255 237 / 6%) 1px, transparent 1px);
    background-size: 5.5rem 5.5rem;
    mask-image: linear-gradient(to bottom, #000, transparent 86%);
}

.hero-glow {
    position: absolute;
    top: 5%;
    right: 8%;
    z-index: -1;
    width: min(42rem, 70vw);
    aspect-ratio: 1;
    border-radius: 50%;
    background: radial-gradient(circle, rgb(137 255 222 / 16%), transparent 64%);
    filter: blur(0.5rem);
}

.hero-sonar {
    position: absolute;
    top: -18rem;
    left: 40%;
    z-index: -1;
    width: 42rem;
    aspect-ratio: 1;
}

.hero-sonar i {
    position: absolute;
    inset: calc(var(--ring, 0) * 5rem);
    border: 1px solid rgb(185 255 233 / 10%);
    border-radius: 50%;
}

.hero-sonar i:nth-child(2) {
    --ring: 1;
}

.hero-sonar i:nth-child(3) {
    --ring: 2;
}

.hero-content {
    position: relative;
    z-index: 2;
}

.hero-kicker,
.project-meta,
.project-team,
.hero-chart,
.surface-return > p {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
}

.hero-kicker {
    margin-bottom: 1.7rem;
    color: #9eead7;
}

.surface-hero h1 {
    display: grid;
    margin: 0;
    font-family: "Unbounded", "Monaspace Neon", monospace;
    font-size: clamp(4.5rem, 10.6vw, 9.6rem);
    font-weight: 800;
    letter-spacing: -0.045em;
    line-height: 0.9;
}

.title-mask {
    display: block;
    overflow: hidden;
    padding-right: 0.08em;
}

.hero-title-line {
    display: block;
}

.title-offset {
    margin-left: clamp(1rem, 8vw, 7rem);
    padding-bottom: 0.12em;
    color: #a9ffe6;
    text-shadow: 0 0 2.5rem rgb(89 255 208 / 24%);
}

.hero-summary {
    max-width: 37rem;
    margin: 2.2rem 0 0;
    color: #b0cbc6;
    font-size: clamp(1rem, 1.6vw, 1.18rem);
    line-height: 1.7;
}

.hero-actions,
.project-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.8rem 1rem;
    margin-top: 2rem;
}

.hero-actions > span {
    color: #789b96;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.hero-chart {
    position: relative;
    align-self: end;
    margin-bottom: 1.5rem;
    padding: 1.2rem;
    border: 1px solid rgb(178 235 220 / 18%);
    background: rgb(2 17 24 / 52%);
    box-shadow: inset 0 1px rgb(255 255 255 / 6%);
    backdrop-filter: blur(1rem);
}

.chart-heading,
.chart-paths,
.trace-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
}

.chart-heading {
    color: #b9d9d2;
}

.chart-heading span:last-child,
.hero-chart > p {
    color: #6e9991;
}

.chart-paths {
    min-height: 10rem;
    align-items: end;
    margin: 1.2rem 0;
    padding: 1.2rem 1rem 0;
    border-block: 1px solid rgb(178 235 220 / 12%);
    background: linear-gradient(90deg, transparent 49.7%, rgb(178 235 220 / 9%) 50%);
}

.chart-paths > div {
    display: grid;
    width: 42%;
    grid-template-columns: repeat(3, 1fr);
    align-items: end;
    gap: 0.45rem;
}

.chart-paths span {
    grid-column: 1 / -1;
    color: #91c4b8;
}

.chart-paths i {
    height: var(--height, 4rem);
    border-top: 2px solid #9ef7dd;
    background: linear-gradient(to top, rgb(95 244 203 / 3%), rgb(95 244 203 / 20%));
}

.chart-paths i:nth-child(2) {
    --height: 5.7rem;
}

.chart-paths i:nth-child(3) {
    --height: 4.8rem;
}

.hero-error {
    position: absolute;
    right: 2rem;
    bottom: 1rem;
    left: 2rem;
    margin: 0;
    color: #ffc7a7;
    font-size: 0.75rem;
    text-align: center;
}

.project-section {
    --accent: #a9ffe6;
    --accent-rgb: 169 255 230;
    position: relative;
    min-height: 100svh;
    isolation: isolate;
}

.project-stage {
    position: relative;
    display: grid;
    width: 100%;
    min-height: 100svh;
    grid-template-columns: minmax(18rem, 0.78fr) minmax(22rem, 1.22fr);
    align-items: center;
    gap: clamp(2rem, 6vw, 7rem);
    padding: clamp(5rem, 9vw, 8rem) max(2rem, calc((100vw - 82rem) / 2));
    overflow: hidden;
    background: var(--section-bg);
}

.section-grid,
.section-noise {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
}

.section-grid {
    opacity: 0.3;
    background-image:
        linear-gradient(rgb(var(--accent-rgb) / 8%) 1px, transparent 1px),
        linear-gradient(90deg, rgb(var(--accent-rgb) / 8%) 1px, transparent 1px);
    background-size: 4rem 4rem;
    mask-image: radial-gradient(circle at 70% 48%, #000, transparent 72%);
}

.section-noise {
    background:
        radial-gradient(circle at 76% 50%, rgb(var(--accent-rgb) / 13%), transparent 28rem),
        linear-gradient(90deg, rgb(0 0 0 / 30%), transparent 60%);
}

.project-copy {
    position: relative;
    z-index: 3;
    max-width: 36rem;
}

.project-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.9rem;
    color: var(--accent);
}

.rank-medal {
    font-size: 2.4rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1;
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: medal-shimmer 3s ease-in-out infinite;
}

.medal-r1 {
    background-image: linear-gradient(
        135deg,
        #ffd700,
        #ffa500 25%,
        #fff3b0 50%,
        #ffa500 75%,
        #ffd700
    );
}

.medal-r2 {
    background-image: linear-gradient(
        135deg,
        #e8e8e8,
        #c0c0c0 25%,
        #ffffff 50%,
        #c0c0c0 75%,
        #e8e8e8
    );
}

.medal-r3 {
    background-image: linear-gradient(
        135deg,
        #cd7f32,
        #b87333 25%,
        #df9953 50%,
        #b87333 75%,
        #cd7f32
    );
}

@keyframes medal-shimmer {
    0%,
    100% {
        background-position: 0% 50%;
    }

    50% {
        background-position: 100% 50%;
    }
}

.pathway-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.45rem 0.7rem;
    border: 1px solid rgb(var(--accent-rgb) / 35%);
    border-radius: 999px;
    background: rgb(var(--accent-rgb) / 7%);
    letter-spacing: 0.14em;
}

.pathway-sonar {
    position: relative;
    width: 0.5rem;
    aspect-ratio: 1;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0.5rem var(--accent);
}

.pathway-sonar::before,
.pathway-sonar::after {
    content: "";
    position: absolute;
    inset: -0.35rem;
    border: 1px solid var(--accent);
    border-radius: 50%;
    opacity: 0;
    animation: sonar-ping 2.4s ease-out infinite;
}

.pathway-sonar::after {
    animation-delay: 1.2s;
}

@keyframes sonar-ping {
    0% {
        transform: scale(0.4);
        opacity: 0.9;
    }

    100% {
        transform: scale(1.6);
        opacity: 0;
    }
}

.project-chapter {
    max-width: 30rem;
    margin: 2.5rem 0 0.7rem;
    color: #a9bab8;
    font-size: 0.9rem;
    letter-spacing: 0.03em;
}

.project-copy h2 {
    margin: 0;
    color: #f3f8f6;
    font-family: var(--display-font, inherit);
    font-size: clamp(3rem, 6.3vw, 6.7rem);
    font-weight: var(--display-weight, 720);
    letter-spacing: var(--display-spacing, -0.075em);
    line-height: 0.9;
    text-transform: var(--display-transform, none);
    text-wrap: balance;
}

.project-team {
    margin: 1.25rem 0 0;
    color: var(--accent);
}

.project-lede {
    max-width: 34rem;
    margin: 1.5rem 0 0;
    color: #b9c8c5;
    font-size: clamp(0.95rem, 1.45vw, 1.08rem);
    line-height: 1.72;
}

.project-unavailable {
    margin-top: 1.5rem;
    color: #d8ab91;
    font-size: 0.82rem;
}

.project-visual {
    position: relative;
    width: 100%;
    min-height: min(68vh, 42rem);
}

.section-index {
    position: absolute;
    right: clamp(2rem, 5vw, 5rem);
    bottom: 1.2rem;
    z-index: 1;
    color: rgb(var(--accent-rgb) / 13%);
    font-size: clamp(6rem, 13vw, 12rem);
    font-weight: 800;
    letter-spacing: -0.08em;
    line-height: 0.8;
    pointer-events: none;
}

.theme-rainbow {
    --accent: #75f6ff;
    --accent-rgb: 117 246 255;
    --section-bg: linear-gradient(120deg, #10071f 0%, #170a2b 46%, #041525 100%);
    --display-font: "Orbitron", "Monaspace Neon", monospace;
    --display-weight: 700;
    --display-spacing: -0.01em;
    --display-transform: uppercase;
}

.tokyo-sun {
    position: absolute;
    top: 2%;
    right: 10%;
    width: min(25rem, 50vw);
    aspect-ratio: 1;
    border-radius: 50%;
    background:
        repeating-linear-gradient(
            to bottom,
            transparent 0 1.25rem,
            rgb(13 7 31 / 88%) 1.3rem 1.55rem
        ),
        linear-gradient(145deg, #ff4bbd, #ff7c77);
    box-shadow: 0 0 4rem rgb(255 75 185 / 20%);
}

.rain-field {
    position: absolute;
    inset: 0;
    overflow: hidden;
}

.rain-field i {
    position: absolute;
    top: calc((var(--drop, 1) - 1) * 4%);
    left: calc(var(--drop, 1) * 6%);
    width: 1px;
    height: 6rem;
    transform: rotate(13deg);
    background: linear-gradient(transparent, rgb(113 236 255 / 70%));
}

.rain-field i:nth-child(1) {
    --drop: 1;
}
.rain-field i:nth-child(2) {
    --drop: 2;
}
.rain-field i:nth-child(3) {
    --drop: 3;
}
.rain-field i:nth-child(4) {
    --drop: 4;
}
.rain-field i:nth-child(5) {
    --drop: 5;
}
.rain-field i:nth-child(6) {
    --drop: 6;
}
.rain-field i:nth-child(7) {
    --drop: 7;
}
.rain-field i:nth-child(8) {
    --drop: 8;
}
.rain-field i:nth-child(9) {
    --drop: 9;
}
.rain-field i:nth-child(10) {
    --drop: 10;
}
.rain-field i:nth-child(11) {
    --drop: 11;
}
.rain-field i:nth-child(12) {
    --drop: 12;
}
.rain-field i:nth-child(13) {
    --drop: 13;
}
.rain-field i:nth-child(14) {
    --drop: 14;
}
.rain-field i:nth-child(15) {
    --drop: 15;
}
.rain-field i:nth-child(16) {
    --drop: 16;
}

.city-blocks {
    position: absolute;
    inset: auto 0 0;
    display: flex;
    height: 58%;
    align-items: end;
    gap: 0.35rem;
}

.city-blocks i {
    flex: 1;
    height: calc(25% + var(--building, 1) * 7%);
    border: 1px solid rgb(91 238 255 / 22%);
    background:
        repeating-linear-gradient(90deg, transparent 0 0.8rem, rgb(111 241 255 / 14%) 0.85rem 1rem),
        linear-gradient(#13213e, #070b18);
    box-shadow: inset 0 0 1.5rem rgb(255 67 184 / 8%);
}

.city-blocks i:nth-child(2n) {
    --building: 5;
}

.city-blocks i:nth-child(3n) {
    --building: 3;
}

.city-blocks i:nth-child(5n) {
    --building: 7;
}

.dialogue {
    position: absolute;
    z-index: 3;
    width: min(21rem, 64%);
    padding: 1rem 1.1rem;
    border: 1px solid rgb(255 255 255 / 16%);
    box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 38%);
    backdrop-filter: blur(1rem);
}

.dialogue span {
    display: block;
    margin-bottom: 0.45rem;
    font-size: 0.58rem;
    letter-spacing: 0.16em;
}

.dialogue strong {
    font-size: 1rem;
    font-weight: 600;
}

.surface-dialogue {
    top: 18%;
    left: 2%;
    background: rgb(16 31 58 / 80%);
    color: #8ef6ff;
}

.thought-dialogue {
    right: 0;
    bottom: 13%;
    border-color: rgb(255 91 190 / 32%);
    background: rgb(45 10 47 / 84%);
    color: #ff91cf;
}

.theme-land {
    --accent: #ffd17b;
    --accent-rgb: 255 209 123;
    --section-bg: linear-gradient(135deg, #0a2935 0%, #08202a 48%, #211a13 100%);
    --display-font: "Silkscreen", "Monaspace Neon", monospace;
    --display-weight: 700;
    --display-spacing: -0.02em;
}

.pixel-sky {
    position: absolute;
    inset: 0 0 63%;
    border: 3px solid #9bd9dc;
    background: linear-gradient(#6bb9c2, #b9dad0);
    box-shadow: 0 1rem 0 rgb(33 106 119 / 36%);
}

.pixel-sky::before,
.pixel-sky::after,
.pixel-sky span {
    content: "";
    position: absolute;
    bottom: 0;
    width: 18%;
    height: 35%;
    background: #497d72;
    box-shadow: inset -0.65rem 0 #315b56;
}

.pixel-sky::before {
    left: 4%;
}

.pixel-sky::after {
    right: 8%;
    height: 56%;
}

.pixel-sky span:nth-child(1) {
    left: 34%;
    height: 42%;
}

.pixel-sky span:nth-child(2) {
    right: 29%;
    height: 28%;
}

.flood-line {
    position: absolute;
    inset: 30% 0 auto;
    z-index: 3;
    height: 5rem;
    border-top: 3px solid #8df6ff;
    background: linear-gradient(rgb(70 202 221 / 54%), rgb(13 78 97 / 78%));
    box-shadow: 0 0 2rem rgb(80 230 255 / 40%);
}

.flood-line span {
    position: absolute;
    top: 0.6rem;
    right: 0.8rem;
    color: #d9fbff;
    font-size: 0.65rem;
    letter-spacing: 0.12em;
}

.underground-shaft {
    position: absolute;
    inset: 43% 4% 0;
    border: 3px solid #5f4b35;
    background:
        linear-gradient(90deg, transparent 49%, rgb(255 209 123 / 8%) 50%, transparent 51%),
        repeating-linear-gradient(0deg, #211b16 0 2.7rem, #2d241b 2.75rem 2.85rem);
    box-shadow: inset 0 0 3rem #000;
}

.pixel-player,
.pixel-crate,
.detector {
    position: absolute;
    width: 2.7rem;
    aspect-ratio: 1;
}

.pixel-player {
    bottom: 1.1rem;
    left: 15%;
    background: #d6f1da;
    box-shadow:
        inset 0 -0.9rem #4f837a,
        0.7rem -0.55rem 0 -0.3rem #d6f1da;
}

.pixel-crate {
    bottom: 1rem;
    border: 0.35rem solid #7e5f39;
    background:
        linear-gradient(45deg, transparent 43%, #9d7747 45% 55%, transparent 57%),
        linear-gradient(-45deg, transparent 43%, #9d7747 45% 55%, transparent 57%), #c59350;
}

.crate-one {
    left: 40%;
}

.crate-two {
    right: 19%;
    bottom: 4.2rem;
}

.detector {
    right: 14%;
    bottom: 1rem;
    border: 0.28rem solid #e5ba67;
    background: #332719;
}

.detector i {
    display: block;
    width: 45%;
    aspect-ratio: 1;
    margin: 27%;
    border-radius: 50%;
    background: #8bffb1;
    box-shadow: 0 0 1rem #8bffb1;
}

.shaft-door {
    position: absolute;
    top: 0.7rem;
    left: 50%;
    padding: 0.25rem 0.5rem;
    transform: translateX(-50%);
    border: 1px solid rgb(255 209 123 / 30%);
    color: #e2b767;
    font-size: 0.55rem;
    letter-spacing: 0.14em;
}

.theme-forest {
    --accent: #ff756b;
    --accent-rgb: 255 117 107;
    --section-bg: linear-gradient(180deg, #1b2940 0%, #16251f 50%, #090d0b 100%);
    --display-font: "Creepster", "Monaspace Neon", monospace;
    --display-weight: 400;
    --display-spacing: 0.02em;
}

.forest-moon {
    position: absolute;
    top: 3%;
    right: 10%;
    width: min(19rem, 38vw);
    aspect-ratio: 1;
    border-radius: 50%;
    background:
        radial-gradient(circle at 64% 35%, rgb(90 18 22 / 30%) 0 8%, transparent 9%),
        radial-gradient(circle at 35% 60%, rgb(90 18 22 / 28%) 0 12%, transparent 13%), #ff766e;
    box-shadow: 0 0 5rem rgb(255 78 73 / 28%);
}

.forest-haze {
    position: absolute;
    inset: 35% -10% 0;
    background: linear-gradient(transparent, rgb(185 224 195 / 18%), transparent 60%);
    filter: blur(1.4rem);
}

.tree-line {
    position: absolute;
    inset: auto 0 0;
    display: flex;
    height: 76%;
    align-items: end;
    justify-content: space-around;
}

.tree-line i {
    position: relative;
    width: 0.8rem;
    height: var(--tree-height, 68%);
    background: #14201a;
    box-shadow: 0 0 1.3rem #000;
}

.tree-line i::before,
.tree-line i::after {
    content: "";
    position: absolute;
    top: -2.8rem;
    left: 50%;
    width: 7rem;
    height: 5rem;
    transform: translateX(-50%);
    border-radius: 50%;
    background: #12211a;
}

.tree-line i::after {
    top: 1.4rem;
    width: 4.8rem;
    height: 4rem;
}

.tree-line i:nth-child(2n) {
    --tree-height: 87%;
}

.tree-line i:nth-child(3n) {
    --tree-height: 55%;
}

.tree-line-back {
    opacity: 0.5;
    transform: scale(0.88);
    transform-origin: bottom;
    filter: blur(1px);
}

.tree-line-front {
    margin-inline: -7%;
}

.forest-warning {
    position: absolute;
    right: 4%;
    bottom: 7%;
    z-index: 4;
    width: min(22rem, 72%);
    padding: 1.2rem;
    border: 1px solid rgb(255 117 107 / 50%);
    background: rgb(18 9 9 / 76%);
    box-shadow: 0 1.5rem 4rem #000;
    backdrop-filter: blur(0.8rem);
}

.forest-warning span,
.forest-warning i {
    display: block;
    color: #ff8c84;
    font-size: 0.58rem;
    font-style: normal;
    letter-spacing: 0.18em;
}

.forest-warning strong {
    display: block;
    margin: 0.7rem 0 1.3rem;
    font-size: clamp(1.15rem, 2vw, 1.6rem);
}

.theme-metadata {
    --accent: #b7ff61;
    --accent-rgb: 183 255 97;
    --section-bg:
        radial-gradient(circle at 80% 30%, #173426, transparent 29rem),
        linear-gradient(135deg, #07100d, #0a1712);
    --display-font: "Space Mono", "Monaspace Neon", monospace;
    --display-weight: 700;
    --display-spacing: -0.05em;
}

.file-inspector {
    position: absolute;
    inset: 8% 3% 8% 0;
    overflow: hidden;
    border: 1px solid rgb(183 255 97 / 35%);
    background: rgb(4 12 9 / 92%);
    box-shadow:
        1.3rem 1.3rem 0 rgb(183 255 97 / 5%),
        0 2rem 5rem #000;
}

.file-toolbar {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.9rem;
    border-bottom: 1px solid rgb(183 255 97 / 24%);
    color: #a6dc75;
    font-size: 0.65rem;
    letter-spacing: 0.12em;
}

.file-toolbar i {
    width: 0.45rem;
    aspect-ratio: 1;
    border-radius: 50%;
    background: #486c37;
}

.file-toolbar span {
    margin-left: 0.5rem;
}

.metadata-row {
    display: grid;
    grid-template-columns: minmax(8rem, 0.65fr) 1fr;
    gap: 1rem;
    padding: 1.1rem;
    border-bottom: 1px solid rgb(183 255 97 / 11%);
    font-size: clamp(0.68rem, 1vw, 0.82rem);
    letter-spacing: 0.08em;
}

.metadata-row span {
    color: #638555;
}

.metadata-row strong {
    color: #d6ffb5;
    font-weight: 500;
}

.metadata-removed strong {
    display: inline-flex;
    width: fit-content;
    align-items: center;
    padding-inline: 0.45rem;
    background: #b7ff61;
    color: #07100d;
}

.clean-command {
    position: absolute;
    right: 1rem;
    bottom: 1rem;
    left: 1rem;
    padding: 0.8rem;
    border: 1px dashed rgb(183 255 97 / 30%);
    color: #8fbd65;
    font-size: clamp(0.6rem, 1vw, 0.74rem);
}

.map-grid {
    position: absolute;
    top: 0;
    right: -6%;
    width: 42%;
    aspect-ratio: 1;
    border: 1px solid rgb(183 255 97 / 22%);
    border-radius: 50%;
    background:
        linear-gradient(rgb(183 255 97 / 10%) 1px, transparent 1px),
        linear-gradient(90deg, rgb(183 255 97 / 10%) 1px, transparent 1px);
    background-size: 1.2rem 1.2rem;
}

.map-grid i {
    position: absolute;
    top: 43%;
    left: 51%;
    width: 0.8rem;
    aspect-ratio: 1;
    border: 2px solid #b7ff61;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    box-shadow: 0 0 1rem #b7ff61;
}

.theme-unseen {
    --accent: #e4c38e;
    --accent-rgb: 228 195 142;
    --section-bg:
        radial-gradient(circle at 76% 40%, #5b5d58, transparent 22rem),
        linear-gradient(145deg, #171a1c, #252728 55%, #101213);
    --display-font: "Cormorant Garamond", serif;
    --display-weight: 600;
    --display-spacing: 0;
}

.memory-room {
    position: absolute;
    inset: 5% 1% 6%;
    overflow: hidden;
    border: 1px solid rgb(228 195 142 / 22%);
    background:
        linear-gradient(90deg, transparent 49.8%, rgb(231 218 194 / 8%) 50%, transparent 50.2%),
        linear-gradient(#36393a, #17191a);
    perspective: 800px;
    box-shadow: inset 0 0 6rem #0b0c0d;
}

.room-door {
    position: absolute;
    top: 14%;
    left: 50%;
    display: grid;
    width: 30%;
    height: 61%;
    place-items: center;
    transform: translateX(-50%);
    border: 1px solid #77756c;
    background: #232525;
    box-shadow:
        inset 0 0 2rem #111,
        0 0 3rem rgb(228 195 142 / 8%);
}

.room-door span {
    color: #d5bd94;
    font-size: 4rem;
    opacity: 0.35;
}

.room-clock {
    position: absolute;
    top: 8%;
    right: 6%;
    color: #d6b77f;
    font-size: clamp(0.8rem, 1.5vw, 1.1rem);
    letter-spacing: 0.16em;
    text-shadow: 0 0 1rem #d6b77f;
}

.room-floor {
    position: absolute;
    inset: 75% -30% -30%;
    transform: rotateX(58deg);
    border-top: 1px solid #777;
    background:
        linear-gradient(rgb(228 195 142 / 9%) 1px, transparent 1px),
        linear-gradient(90deg, rgb(228 195 142 / 9%) 1px, transparent 1px);
    background-size: 3rem 3rem;
}

.memory-fragment {
    position: absolute;
    display: grid;
    width: 5rem;
    aspect-ratio: 1;
    place-items: center;
    transform: rotate(var(--fragment-angle, 6deg));
    clip-path: polygon(8% 4%, 100% 0, 89% 89%, 18% 100%, 0 39%);
    background: rgb(226 214 190 / 16%);
    color: #f4e4c8;
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    backdrop-filter: blur(0.5rem);
}

.fragment-one {
    top: 25%;
    left: 8%;
}

.fragment-two {
    --fragment-angle: -9deg;
    top: 52%;
    right: 12%;
}

.fragment-three {
    --fragment-angle: 15deg;
    right: 20%;
    bottom: 5%;
}

.apartment-fog {
    position: absolute;
    inset: 42% -10% -12%;
    z-index: 5;
    background: linear-gradient(transparent, rgb(209 222 215 / 24%), rgb(139 149 145 / 30%));
    filter: blur(1.6rem);
}

.theme-trace {
    --accent: #65fbd2;
    --accent-rgb: 101 251 210;
    --section-bg:
        radial-gradient(circle at 77% 48%, #102f37, transparent 31rem),
        linear-gradient(135deg, #040b12, #07141d);
    --display-font: "Chakra Petch", "Monaspace Neon", monospace;
    --display-weight: 700;
    --display-spacing: -0.02em;
}

.trace-panel {
    position: absolute;
    inset: 2% 0;
    overflow: hidden;
    border: 1px solid rgb(101 251 210 / 25%);
    background:
        linear-gradient(rgb(101 251 210 / 5%) 1px, transparent 1px),
        linear-gradient(90deg, rgb(101 251 210 / 5%) 1px, transparent 1px), rgb(3 13 19 / 92%);
    background-size: 2.2rem 2.2rem;
    box-shadow: 0 2rem 6rem #000;
}

.trace-header {
    position: relative;
    z-index: 2;
    padding: 1rem;
    border-bottom: 1px solid rgb(101 251 210 / 18%);
    color: #74dabf;
    font-size: 0.62rem;
    letter-spacing: 0.14em;
}

.trace-header i {
    color: #4c8275;
    font-style: normal;
}

.trace-panel svg {
    position: absolute;
    inset: 8% 3% 2%;
    width: 94%;
    height: 88%;
}

.trace-lines path {
    fill: none;
    stroke: rgb(101 251 210 / 35%);
    stroke-dasharray: 8 6;
    stroke-width: 1.5;
}

.trace-nodes circle {
    fill: #0d2930;
    stroke: #65fbd2;
    stroke-width: 2;
}

.trace-nodes .origin-node {
    fill: #65fbd2;
    stroke-width: 8;
    stroke: rgb(101 251 210 / 18%);
}

.scan-beam {
    position: absolute;
    inset: 8% auto 0 50%;
    width: 1px;
    transform-origin: bottom;
    background: linear-gradient(transparent, #65fbd2);
    box-shadow: 0 0 1rem #65fbd2;
}

.domain-chip {
    position: absolute;
    padding: 0.3rem 0.45rem;
    border: 1px solid rgb(101 251 210 / 25%);
    background: #07171d;
    color: #7bb8a8;
    font-size: 0.55rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
}

.domain-one {
    top: 21%;
    left: 10%;
}

.domain-two {
    top: 18%;
    right: 9%;
}

.domain-three {
    right: 5%;
    bottom: 30%;
}

.surface-return {
    position: relative;
    display: grid;
    min-height: 78svh;
    place-items: center;
    align-content: center;
    gap: 1.5rem;
    isolation: isolate;
    padding: 5rem 2rem;
    overflow: hidden;
    background:
        radial-gradient(circle at 50% 50%, rgb(96 226 205 / 16%), transparent 24rem),
        linear-gradient(#020b10, #0b3440);
    text-align: center;
}

.surface-return > p {
    margin: 0;
    color: #8edac9;
}

.surface-return h2 {
    max-width: 64rem;
    margin: 0;
    font-family: "Unbounded", "Monaspace Neon", monospace;
    font-size: clamp(2.7rem, 6vw, 6.5rem);
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1;
    text-wrap: balance;
}

.return-rings {
    position: absolute;
    inset: 50% auto auto 50%;
    z-index: -1;
    width: min(60rem, 90vw);
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
}

.return-rings i {
    position: absolute;
    inset: calc(var(--return-ring, 0) * 13%);
    border: 1px solid rgb(151 255 229 / 10%);
    border-radius: 50%;
}

.return-rings i:nth-child(2) {
    --return-ring: 1;
}

.return-rings i:nth-child(3) {
    --return-ring: 2;
}

@media (max-width: 899px) {
    .depth-rail {
        display: none;
    }

    .surface-hero {
        grid-template-columns: 1fr;
        align-content: center;
        padding-inline: 1.5rem;
    }

    .hero-chart {
        width: min(100%, 32rem);
        align-self: auto;
        margin: 0;
    }

    .project-stage {
        min-height: 100svh;
        grid-template-columns: 1fr;
        align-content: center;
        padding: 5rem 1.5rem;
    }

    .project-copy {
        max-width: 42rem;
    }

    .project-visual {
        min-height: min(58vh, 34rem);
    }

    .section-index {
        right: 1.25rem;
    }
}

@media (max-width: 520px) {
    .surface-hero {
        min-height: max(43rem, calc(100svh - 4rem));
        padding-block: 5rem;
    }

    .surface-hero h1 {
        font-size: clamp(4.2rem, 21vw, 6rem);
    }

    .title-offset {
        margin-left: 0.5rem;
    }

    .hero-chart {
        display: none;
    }

    .project-stage {
        padding-block: 4.5rem;
    }

    .project-copy h2 {
        font-size: clamp(3rem, 15vw, 4.6rem);
    }

    .project-meta {
        flex-wrap: wrap;
    }

    .project-visual {
        min-height: 24rem;
    }

    .dialogue {
        width: 82%;
    }

    .metadata-row {
        grid-template-columns: 1fr;
        gap: 0.35rem;
        padding-block: 0.75rem;
    }

    .map-grid {
        display: none;
    }

    .file-inspector {
        inset-inline: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .surface-story {
        scroll-behavior: auto;
    }

    [data-reveal],
    [data-art],
    [data-drift],
    .depth-progress,
    .hero-title-line {
        opacity: 1 !important;
        transform: none !important;
        visibility: visible !important;
    }

    .rank-medal,
    .pathway-sonar::before,
    .pathway-sonar::after {
        animation: none;
    }
}
</style>
