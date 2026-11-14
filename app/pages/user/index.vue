<script lang="ts" setup>
definePageMeta({
    middleware: "auth",
});

const { user: userRef } = useBasisAuthSession();
const userID = computed(() => userRef.value?.id);

if (!userID.value) {
    throw await navigateTo(`/api/login?redirect=${encodeURIComponent("/user")}`, {
        external: true,
    });
}

throw await navigateTo("/user/" + userID.value);
</script>
