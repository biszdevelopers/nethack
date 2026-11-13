<template>
    <GoBackUp />
    <LoaderAnimation :show="dirtyLoading" />

    <Transition name="fade">
        <div
            v-show="showScrollText"
            class="fixed bottom-4 left-1/2 transform -translate-x-1/2 text-white text-center flex flex-col items-center gap-4 z-30"
        >
            <h3 class="text-2xl text-gray-200">Scroll for more</h3>
            <UIcon name="i-heroicons-chevron-double-down" size="2em" class="text-gray-200" />
        </div>
    </Transition>

    <div
        id="title"
        class="m-0 bg-black text-white landscape min-h-screen flex flex-col items-center justify-center gap-4 relative z-20"
    >
        <div class="text-center lg:text-right lg:ml-auto lg:mr-48">
            <h3 class="text-2xl text-gray-200">Feburary 2026</h3>
            <h1 class="text-4xl sm:text-6xl leading-16">
                When there is
                <br />
                <span class="bold glow text-primary neon">Signal</span>
            </h1>
        </div>
    </div>

    <!--Team 1-->

    <div
        id="team1"
        ref="team1Ref"
        class="bg-black text-white min-h-screen flex items-center justify-center max-lg:flex-col"
    >
        <div
            ref="team1DescriptionWrapper"
            class="team1-description-wrapper mx-8 lg:ml-48 lg:pl-16 relative overflow-visible max-lg:flex-2"
            @mousemove="updateTeam1Cursor"
            @mouseleave="resetTeam1Cursor"
        >
            <div
                ref="team1NumberRef"
                class="team1-background-number hidden lg:block"
                :style="team1NumberStyle"
            >
                #1
            </div>
            <div v-if="cursorAuraVisible" class="team1-cursor-aura" :style="team1AuraStyle" />
            <Transition name="slide-right">
                <div v-if="team1showDescriptionRef" class="team1-description transition-content">
                    <h1
                        class="block lg:hidden text-8xl text-left metallic-gold uppercase mb-12 bold"
                    >
                        #1
                    </h1>

                    <h3 class="text-2xl text-left text-neutral-400 uppercase leading-16">
                        Featuring 白鹿青崖间
                    </h3>
                    <h1 class="text-4xl sm:text-6xl text-left leading-16 bold glow">Syl</h1>

                    <p class="mt-16 text-neutral-400">
                        ... by 6 scenes, the player can experience the story of a fallen
                        civilization and a blade of grass in a fading world seeking self-redemption
                    </p>
                    <p class="mt-4 text-neutral-400">
                        In this chaotic time, Syl tries to give herself purpose by delivering the
                        mail "feather", imitating a predecessor.
                    </p>
                    <p class="mt-4 text-white">
                        If the player pays more attention to the surroundings while playing, they
                        may discover and reveal a hidden truth of that world
                    </p>

                    <div class="mt-4 mb-8">
                        <ResultsProjectLinks
                            github-link="https://github.com/Rua-You/Syl"
                            demo-link="https://rua-you.itch.io/syl"
                            video-link="/assets/ee2c39cc-c590-4c36-a73e-43d335c76a86.mp4"
                        />
                    </div>
                </div>
            </Transition>
        </div>

        <video
            ref="videoRef"
            src="/assets/8a214d32-c43d-4141-b534-5225722a4d2b"
            muted
            preload="metadata"
            class="lg:ml-auto h-auto w-[50vw] max-lg:w-[75vw] max-lg:-order-1 max-lg:flex-1"
        />
        <!-- text -->
    </div>

    <div id="team2" ref="team2Ref" class="bg-white text-black m-0 p-0 min-h-screen lg:max-h-screen">
        <div class="flex flex-col xl:flex-row items-center justify-between w-full min-h-screen">
            <div class="xl:mt-auto max-xl:flex items-center justify-start max-xl:w-full">
                <img
                    src="/assets/d3048fe7-b43b-4a95-a0a8-1d654819ddb3"
                    class="max-xl:h-[40vh] xl:w-[20vw] max-xl:-scale-y-100"
                />
            </div>

            <div class="max-h-[20vh] xl:min-h-screen flex flex-col justify-center w-full">
                <div class="flex flex-col items-center justify-center">
                    <h1 class="hidden max-sm:block metallic-silver text-8xl z-4 bold mb-4">#2</h1>

                    <h3 class="bold z-3 text-2xl text-neutral-400 uppercase leading-16">
                        =^^= presents
                    </h3>
                    <div class="metallic-silver team2-background-number select-none max-sm:hidden">
                        #2
                    </div>
                    <h1
                        :class="team2Visible ? 'animate' : ''"
                        class="text-4xl text-left leading-16 bold relative z-10 hidden lg:block"
                    >
                        <span class="word word-1">Super</span>
                        <span class="word word-2">Cool</span>
                        <span class="word word-3">But</span>
                        <span class="word word-4">Creepy</span>
                        <span class="word word-5">Visual</span>
                        <span class="word word-6">Recognition</span>
                        <span class="word word-7">Robotic</span>
                        <span class="word word-8">Head</span>
                    </h1>
                    <h1
                        class="text-4xl text-center lg:leading-16 bold relative z-10 lg:hidden max-lg:mb-8"
                    >
                        Super Cool But Creepy Visual Recognition Robotic Head
                    </h1>
                    <p class="z-3 w-full max-w-xl text-center px-4 sm:px-8">
                        A robotic head that looks cool and is able to recognize learned faces and
                        colors, and provide personalized reactions
                    </p>

                    <div class="mt-12 text-black fill-black z-3">
                        <ResultsProjectLinks
                            color="fill-gray-400"
                            class="z-3"
                            github-link="https://github.com/zhizhizhi00/visual-recognition-robotic-head"
                            video-link="/assets/b1aee7a2-33fa-4681-bdbe-1fef3a481f0e"
                        />
                    </div>
                </div>

                <!-- <div class="flex-1 mx-auto">
            <UPopover mode="hover" :ui="{content: 'p-4'}">
              <UButton label="Report Image Usage" variant="ghost" size="xs" color="error"/>

              <template #content>
                <div class="flex items-center gap-4 mb-4">
                  <h3>
                    <UIcon name=""></UIcon>
                  </h3>
                </div>
              </template>
            </UPopover>
          </div> -->
            </div>

            <div class="xl:mt-auto max-xl:flex items-center justify-end max-xl:w-full">
                <img
                    src="/assets/aea63660-a483-4308-bd3c-0934bb1e3339"
                    class="max-xl:h-[40vh] xl:w-[20vw]"
                />
            </div>
        </div>

        <!--SuperCoolButCreepyVisualRecognitionRoboticHead: team2-->
    </div>

    <div
        id="team3"
        ref="team3Ref"
        class="bg-red-950 text-black min-h-screen flex flex-row max-2xl:flex-col items-center justify-between relative z-0"
    >
        <!--close to MIT color but darker for better visuals-->
        <Transition name="slide-left">
            <div
                v-if="team3Visible"
                class="metallic-bronze team3-background-number select-none transition-content team3-background-number-max-lg max-sm:hidden"
            >
                #3
            </div>
        </Transition>

        <div
            class="mx-4 sm:ml-24 sm:mr-24 max-sm:max-w-none sm:max-w-[50vw] max-2xl:p-16 max-2xl:bg-[#8C1515] rounded-lg max-2xl:my-16"
        >
            <h3 class="text-3xl bold glow text-white">Dysarthria Speech Classifier</h3>

            <p class="text-gray-300 mt-8">
                Dysarthria is a motor speech disorder that affects the muscles we use for speaking,
                making speech difficult to understand, especially for traditional speech systems
                like Apple Siri.
            </p>

            <p class="text-gray-300 mt-8">
                This project bridges the gap for speakers with dysarthria by using a fine-tuned
                HuBERT-large model to accurately classify essential voice commands.
            </p>

            <div class="z-0 mt-8">
                <ResultsProjectLinks
                    color="fill-gray-400"
                    github-link="https://github.com/FYC23/dysarthric-voice-command-classifier"
                    demo-link="https://huggingface.co/spaces/DNE58293/dysarthric-voice-cmds"
                    video-link="/assets/3f9cbe2c-c8ea-42f4-94f6-4a4a0cb01549"
                />
            </div>
        </div>

        <div
            class="bg-gray-300 rounded-lg ml-auto mr-48 mb-48 mt-auto max-2xl:mb-20 max-2xl:mx-auto max-sm:hidden"
        >
            <div class="m-2 flex items-center justify-start pr-auto gap-1">
                <UIcon name="i-material-symbols-circle" size="4em" class="text-red-500 h-4 w-4" />
                <UIcon
                    name="i-material-symbols-circle"
                    size="4em"
                    class="text-yellow-500 h-4 w-4"
                />
                <UIcon name="i-material-symbols-circle" size="4em" class="text-green-500 h-4 w-4" />
            </div>
            <div
                class="window-image w-[80vw] sm:w-lg h-72 lg:w-196 lg:h-108 rounded-lg mx-2 mb-2 select-none"
            />
        </div>
    </div>

    <div class="min-h-screen flex flex-col justify-center gap-8 py-16">
        <h2 class="text-center text-3xl font-bold mb-4">All Projects</h2>
        <p class="text-center">
            Submitted by over
            <span class="bold">28</span>
            enthusiastic teams!
        </p>

        <UMarquee :repeat="4" pause-on-hover :overlay="false" class="[--duration:160s] py-2">
            <ShowcaseMarqueeCard
                v-for="team in projectTeams"
                :key="team.id"
                :team="team"
                @click="openProject(team)"
            />
        </UMarquee>

        <UMarquee
            :repeat="4"
            reverse
            pause-on-hover
            :overlay="false"
            class="[--duration:160s] py-2"
        >
            <ShowcaseMarqueeCard
                v-for="team in [...projectTeams].reverse()"
                :key="team.id"
                :team="team"
                @click="openProject(team)"
            />
        </UMarquee>
    </div>

    <UModal v-model:open="modalOpen" :title="selectedTeam?.name || 'Project'">
        <template #body>
            <ProjectCard v-if="selectedTeam" :id="selectedTeam.id" />
        </template>
    </UModal>
</template>
<script setup>
definePageMeta({
    layout: "fullwidth-nostick",
    title: `Signal | ${WEBSITE_NAME}`,
});

useHead({
    title: `Signal | ${WEBSITE_NAME}`,
});

useHead({
    link: [
        {
            rel: "preload",
            as: "image",
            href: "/assets/c6c7b5b3-4256-4f9d-9899-15a7905a154c", // title image
        },
        {
            rel: "preload",
            as: "video",
            href: "/assets/8a214d32-c43d-4141-b534-5225722a4d2b", // syl intro
        },
        {
            rel: "preload",
            as: "image",
            href: "/assets/d3048fe7-b43b-4a95-a0a8-1d654819ddb3", // wojak left
        },
        {
            rel: "preload",
            as: "image",
            href: "/assets/aea63660-a483-4308-bd3c-0934bb1e3339", // wojak right
        },
        {
            rel: "preload",
            as: "video",
            href: "/assets/b1aee7a2-33fa-4681-bdbe-1fef3a481f0e", // team2 demo
        },
        {
            rel: "preload",
            as: "video",
            href: "/assets/3f9cbe2c-c8ea-42f4-94f6-4a4a0cb01549", // team3 demo
        },
        {
            rel: "preload",
            as: "video",
            href: "/assets/ee2c39cc-c590-4c36-a73e-43d335c76a86", // team3 demo
        },
    ],
});

const { data: teams } = await useFetch("/api/teams?season_id=2", { $fetch: globalThis.$fetch });
const modalOpen = ref(false);
const selectedTeam = ref(null);

const projectTeams = computed(() => {
    return (teams.value || []).filter((t) => t.project?.name);
});

function openProject(team) {
    selectedTeam.value = team;
    modalOpen.value = true;
}

const showScrollText = ref(true);
const videoRef = ref();
const team1showDescriptionRef = ref(false);
const team1Ref = ref();
const team2Ref = ref();
const team3Ref = ref();
const team2Visible = ref(false);
const team3Visible = ref(false);
const team1DescriptionWrapper = ref(null);
const team1NumberRef = ref(null);
const cursorAuraVisible = ref(false);
const cursorPosition = ref({ x: 0, y: 0 });
const team1Proximity = ref(0);
const dirtyLoading = ref(true);

const team1NumberStyle = computed(() => {
    const intensity = team1Proximity.value;
    const glow = 12 + intensity * 44;
    const alpha = 0.14 + intensity * 0.18;
    return {
        color: `rgba(255, 215, 0, ${alpha})`,
        textShadow: `0 0 ${glow}px rgba(255, 215, 0, ${0.55 * intensity})`,
        transition: "color 0.15s ease, text-shadow 0.15s ease",
    };
});

const team1AuraStyle = computed(() => {
    const intensity = team1Proximity.value;
    const size = 120 + intensity * 80;
    const opacity = 0.1 + intensity * 0.45;
    return {
        width: `${size}px`,
        height: `${size}px`,
        left: `${cursorPosition.value.x - size / 2}px`,
        top: `${cursorPosition.value.y - size / 2}px`,
        opacity,
        boxShadow: `0 0 ${size / 2}px rgba(255, 215, 0, ${opacity}), 0 0 ${size}px rgba(255, 215, 0, ${opacity * 0.35})`,
        transition:
            "width 0.12s ease, height 0.12s ease, opacity 0.12s ease, box-shadow 0.12s ease",
    };
});

const updateTeam1Cursor = (event) => {
    const wrapper = team1DescriptionWrapper.value;
    const numberEl = team1NumberRef.value;
    if (!wrapper || !numberEl) return;

    const rect = wrapper.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    cursorPosition.value = { x: cursorX, y: cursorY };
    cursorAuraVisible.value = true;

    const numRect = numberEl.getBoundingClientRect();
    const dx = event.clientX - (numRect.left + numRect.width / 2);
    const dy = event.clientY - (numRect.top + numRect.height / 2);
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = 280;
    team1Proximity.value = Math.max(0, 1 - Math.min(distance, maxDistance) / maxDistance);
};

const resetTeam1Cursor = () => {
    cursorAuraVisible.value = false;
    team1Proximity.value = 0;
};

let handleScroll;

onMounted(() => {
    console.log(
        "can u believe i actually wrote this by myself (well like 60% and the css)?? lol. if u can buy us infinite tokens that would be nice :)",
    );

    dirtyLoading.value = false;

    handleScroll = () => {
        const scrollThreshold = window.innerHeight * 0.25;
        if (showScrollText.value) showScrollText.value = window.scrollY < scrollThreshold;

        // Team 1 video scroll animation
        const element = team1Ref.value;
        if (element && videoRef.value) {
            const rect = element.getBoundingClientRect();

            const elementTop = rect.top + window.scrollY - window.innerHeight / 2; // preload twice height
            const elementHeight = rect.height * 0.5; // twice
            const scrollY = window.scrollY;

            if (scrollY >= elementTop && scrollY <= elementTop + elementHeight) {
                // also trigger description fade in
                if (!team1showDescriptionRef.value) team1showDescriptionRef.value = true;

                const progress = (scrollY - elementTop) / elementHeight;
                videoRef.value.currentTime = progress * videoRef.value.duration;
            }
        }

        // Team 2 animation trigger
        const team2Element = team2Ref.value;
        if (team2Element && !team2Visible.value) {
            const rect = team2Element.getBoundingClientRect();
            if (rect.top + rect.height / 1.5 < window.innerHeight && rect.bottom > 0) {
                team2Visible.value = true;
            }
        }

        // Team 3 animation trigger
        const team3Element = team3Ref.value;
        if (team3Element && !team3Visible.value) {
            const rect = team3Element.getBoundingClientRect();
            if (rect.top + rect.height / 1.5 < window.innerHeight && rect.bottom > 0) {
                team3Visible.value = true;
            }
        }
    };

    window.addEventListener("scroll", handleScroll);
});

onUnmounted(() => {
    if (handleScroll) window.removeEventListener("scroll", handleScroll);
});
</script>

<style scoped>
.window-image {
    background-image: url("/assets/fbc59d8a-a2ac-490b-83c2-af318e650cdc");
    background-repeat: no-repeat;
    background-position: center;
    background-size: cover;
}

.transition-content {
    animation: display 1.5s;
}

.landscape {
    background-image: url("/assets/c6c7b5b3-4256-4f9d-9899-15a7905a154c");
    background-size: cover;
    background-position: center;
}

.section-divider-number {
    font-size: 32rem;
    line-height: 0.85;
    font-weight: 900;
    letter-spacing: -0.08em;
    color: rgba(255, 255, 255, 0.12);
    white-space: nowrap;
}

.team1-description-wrapper {
    position: relative;
}

.team1-background-number {
    position: absolute;
    top: 50%;
    left: 0;
    transform: translate(-10%, -70%);
    font-size: 32rem;
    line-height: 0.8;
    font-weight: 900;
    color: rgba(255, 255, 255, 0.14);
    white-space: nowrap;
    pointer-events: none;
    z-index: 0;
    transition:
        color 0.15s ease,
        text-shadow 0.15s ease;
}

.team1-cursor-aura {
    position: absolute;
    pointer-events: none;
    border-radius: 9999px;
    background: rgba(255, 215, 0, 0.08);
    filter: blur(14px);
    z-index: 0;
}

.team1-description {
    position: relative;
    z-index: 1;
}

.team2-background-number {
    position: absolute;
    left: 50%;
    transform: translate(-50%, -10%);
    font-size: 32rem;
    line-height: 0.8;
    font-weight: 900;
    white-space: nowrap;
    pointer-events: none;
    z-index: 0;
    color: #c0c0c0;
}

.team3-background-number {
    position: absolute;

    top: -0.2em;
    right: 0.3em;

    font-size: 32rem;
    line-height: 0.8;
    font-weight: 900;
    white-space: nowrap;
    pointer-events: none;
    z-index: -1;
}

.team3-background-number-max-lg {
    @media (width < 64rem) {
        right: 0;
        font-size: 16rem;
    }
}

.neon {
    text-transform: uppercase;
    animation: flicker 1.5s infinite alternate;
}

@keyframes flicker {
    /* Fully On */
    0%,
    18%,
    22%,
    25%,
    53%,
    57%,
    100% {
        text-shadow:
            0 0 0.05em color-mix(in srgb, currentColor 75%, var(--background-color-default) 25%),
            0 0 0.1em color-mix(in srgb, currentColor 75%, var(--background-color-default) 25%);
        opacity: 1;
    }
    /* The "Broken" Moments (Dim/Off) */
    20%,
    24%,
    55% {
        text-shadow: none;
        opacity: 0.4;
    }
}

.fade-leave-to {
    opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.8s ease;
}

.slide-right-enter-active {
    transition: all 0.8s ease-out;
}

.slide-right-enter-from {
    transform: translateX(-25%);
    opacity: 0;
}

.slide-right-enter-to {
    transform: translateX(0);
    opacity: 1;
}

.slide-left-enter-active {
    transition: all 0.8s ease-out;
}

.slide-left-enter-from {
    transform: translateX(25%);
    opacity: 0;
}

.slide-left-enter-to {
    transform: translateX(0);
    opacity: 1;
}

.metallic-gold {
    background: linear-gradient(
        135deg,
        #ffd700 0%,
        #ffa500 25%,
        #ffd700 50%,
        #ffa500 75%,
        #ffd700 100%
    );
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
    animation: shimmer 3s ease-in-out infinite;
}

.metallic-silver {
    background: linear-gradient(
        135deg,
        #e8e8e8 0%,
        #c0c0c0 25%,
        #e8e8e8 50%,
        #c0c0c0 75%,
        #e8e8e8 100%
    );
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
    animation: shimmer 3s ease-in-out infinite;
}

.metallic-bronze {
    background: linear-gradient(
        135deg,
        #cd7f32 0%,
        #b87333 25%,
        #df9953 50%,
        #b87333 75%,
        #cd7f32 100%
    );
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: none;
    animation: shimmer 3s ease-in-out infinite;
}

/* Word animation for team2 */
.word {
    opacity: 0;
    animation: appearAndShake 0.01s ease-in-out forwards paused;
}

.animate .word {
    animation-play-state: running;
}

.word-1 {
    animation-delay: 0s;
}
.word-2 {
    animation-delay: 0.1s;
}
.word-3 {
    animation-delay: 0.2s;
}
.word-4 {
    animation-delay: 0.3s;
}
.word-5 {
    animation-delay: 0.4s;
}
.word-6 {
    animation-delay: 0.5s;
}
.word-7 {
    animation-delay: 0.6s;
}
.word-8 {
    animation-delay: 0.7s;
}

@keyframes appearAndShake {
    0% {
        opacity: 0;
        translate: 0 20px;
    }
    20% {
        opacity: 1;
        translate: 15px -20px;
    }
    40% {
        opacity: 1;
        translate: -14px 17px;
    }
    60% {
        opacity: 1;
        translate: 19px 15px;
    }
    80% {
        opacity: 1;
        translate: 8px -13px;
    }
    100% {
        opacity: 1;
        translate: 17px -2px;
    }
}
</style>
