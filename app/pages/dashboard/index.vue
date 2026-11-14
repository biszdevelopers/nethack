<script setup lang="ts">
definePageMeta({
    layout: "dashboard",
    middleware: ["auth"],
});

useHead({
    title: `Dashboard | ${WEBSITE_NAME}`,
});

const { data: hackathon, error: hackathonError } = await useApiFetch("/api/seasons/active", {
    $fetch: globalThis.$fetch,
});
if (hackathonError.value) {
    throw hackathonError.value;
}

const { data, error, refresh } = await useApiUser();
if (error.value) {
    throw error.value;
}

const isDirty = ref(false);
const confettiTriggered = ref(false);

const rankColorClass = computed(() => {
    const rank = data.value?.team?.rank;
    if (rank == 1) return "text-yellow-400";
    if (rank == 2) return "text-gray-300";
    if (rank == 3) return "text-orange-600";
    return "text-ui-text";
});

const rankMetallicClass = computed(() => {
    const rank = data.value?.team?.rank;
    if (rank == 1) return "metallic-gold";
    if (rank == 2) return "metallic-silver";
    if (rank == 3) return "metallic-bronze";
    return "";
});

function confettiPride(confetti: any, color: Array<string>) {
    const end = Date.now() + 1 * 1000;
    (function frame() {
        confetti({
            particleCount: 3,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 1 },
            colors: color,
        });
        confetti({
            particleCount: 3,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 1 },
            colors: color,
        });

        if (Date.now() < end) {
            requestAnimationFrame(frame);
        }
    })();
}

function confettiFireworks(confetti: any, color: Array<string>) {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 20, spread: 360, ticks: 60, zIndex: 0, colors: color };

    function randomInRange(min: number, max: number) {
        return Math.random() * (max - min) + min;
    }

    var interval = setInterval(function () {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
            return clearInterval(interval);
        }

        const particleCount = 100;
        // since particles fall down, start a bit higher than random
        confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.1, 0.9), y: randomInRange(0.2, 0.9) },
        });
        //confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
    }, 500);
}

function triggerConfetti(force: boolean = false) {
    const rank = data.value?.team?.rank;
    if (!rank || rank > 10 || confettiTriggered.value) return;

    confettiTriggered.value = true;

    import("canvas-confetti").then((confettiModule) => {
        const confetti = (config: any) => {
            sessionStorage.setItem("confettiShown", "true"); // Set a flag in session storage to indicate confetti has been shown

            confettiModule.default({
                ...config,
            });
        };

        // go Buckeyes!

        if (rank === 1) {
            confettiPride(confetti, ["#FFD700", "#FFA500", "#FFFF00"]);
            confettiFireworks(confetti, ["#FFD700", "#FFA500", "#FFFF00"]);
        } else if (rank === 2) {
            confettiPride(confetti, ["#C0C0C0", "#E8E8E8", "#D3D3D3"]);
            confettiFireworks(confetti, ["#C0C0C0", "#E8E8E8", "#D3D3D3"]);
        } else if (rank === 3) {
            confettiPride(confetti, ["#CD7F32", "#B87333", "#A0522D"]);
            confettiFireworks(confetti, ["#CD7F32", "#B87333", "#A0522D"]);
        } else if (rank <= 10) {
            confettiPride(confetti, ["#FF0000", "#00FF00", "#0000FF"]);
        }
    });
}

// onMounted(() => {
//   triggerConfetti()
// })

async function refreshData() {
    await withLoadingIndicator(async () => {
        await refresh();
    });
    isDirty.value = false;
}

function dateUpdated(dirty: boolean) {
    isDirty.value = dirty;
}

onBeforeRouteLeave(() => {
    if (isDirty.value && !confirm("You have unsaved changes. Are you sure you want to leave?")) {
        return abortNavigation();
    }
});

function beforeUnload(event: BeforeUnloadEvent) {
    if (isDirty.value) {
        event.preventDefault();
        event.returnValue = true;
    }
}

watch(isDirty, (value) => {
    if (value) {
        window.addEventListener("beforeunload", beforeUnload);
    } else {
        window.removeEventListener("beforeunload", beforeUnload);
    }
});

onUnmounted(() => {
    window.removeEventListener("beforeunload", beforeUnload);
});

const actions = ref([
    {
        title: "Edit your project",
        description: "Make changes to your project details, add links, and more.",
        to: "/dashboard/general",
        icon: "i-heroicons-pencil-square-solid",
    },
    {
        title: "Manage your team",
        description: "Add or remove team member or change your team name.",
        to: "/dashboard/teams",
        icon: "i-heroicons-users-solid",
    },
    {
        title: "View your results",
        description: "View the results of the hackathon.",
        to: "/dashboard/results",
        icon: "i-lucide-trophy",
    },
]);
</script>

<template>
    <div>
        <div v-if="!data?.team">
            <p class="mb-4">
                Welcome
                <span class="bold">{{ data!.name || data!.email }}</span>
                ! You don't have a team yet. You can
                <ULink href="/dashboard/teams">create a team</ULink>
                or ask a member from another team to add you!
            </p>
            <p v-if="hackathon?.status === 'not_started'" class="mb-4">
                (Don't worry though, you can also create or join a team during the hackathon :)
            </p>
        </div>

        <template v-else>
            <p class="mb-4">
                Welcome
                <span class="bold">{{ data.name || data.email }}</span>
                !
                <template v-if="hackathon?.status === 'not_started'">
                    The hackathon hasn't started yet - please check the timer on the home page!
                </template>
                <template v-else-if="hackathon?.status === 'in_progress'">
                    The hackathon is in progress -
                    <span class="glow">HACK AWAY!</span>
                </template>
                <template v-else-if="hackathon?.status === 'voting'">
                    The hackathon is completed, and judging and peer voting is underway!
                </template>
                <template v-else-if="hackathon?.status === 'finished'">
                    The hackathon is completed, and the scores are released!
                </template>
                <template v-else-if="hackathon?.status === 'paused'">
                    The hackathon is paused as the organizers figure out the secrets of the
                    universe... Please check back later!
                </template>
            </p>
            <p class="mb-4">
                Please review the
                <ULink href="/rules">rules page</ULink>
                for the most up-to-date rules and requirements.
            </p>

            <h2 class="text-3xl bold mb-4">Your project</h2>

            <ProjectCard v-if="data.team_id" :id="data.team_id"></ProjectCard>

            <h2 class="text-3xl bold my-4">Continue...</h2>

            <UPageGrid>
                <UPageCard v-for="(card, index) in actions" :key="index" v-bind="card" />
            </UPageGrid>
        </template>
    </div>
</template>

<style scoped>
@keyframes shimmer {
    0% {
        background-position: 0% 50%;
    }
    50% {
        background-position: 100% 50%;
    }
    100% {
        background-position: 0% 50%;
    }
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
</style>
