import { ref } from "vue";

const trackNames = ref<Record<string, string>>({});
let loadPromise: Promise<void> | null = null;

function fallbackTrackLabel(value: string): string {
    return value
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
        .join(" ");
}

/**
 * Resolve a rubric track key to the organizer-defined track name. The rubric is
 * season-wide, so one client fetch is shared by every component on the page.
 */
export function useTrackLabel() {
    if (
        typeof window !== "undefined" &&
        typeof $fetch === "function" &&
        Object.keys(trackNames.value).length === 0 &&
        !loadPromise
    ) {
        loadPromise = $fetch<{ tracks?: Record<string, { name?: string }> }>(
            "/api/seasons/active/rubric",
        )
            .then((data) => {
                trackNames.value = Object.fromEntries(
                    Object.entries(data?.tracks ?? {}).map(([key, track]) => [
                        key,
                        track.name ?? fallbackTrackLabel(key),
                    ]),
                );
            })
            .catch(() => undefined)
            .finally(() => {
                loadPromise = null;
            });
    }

    return (value: string | null | undefined): string =>
        value ? (trackNames.value[value] ?? fallbackTrackLabel(value)) : "";
}
