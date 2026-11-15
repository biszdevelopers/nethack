import { safeUrl } from "./url-validation";

export function getProfileThemeUrl(theme: ProfileTheme | null | undefined): string | undefined {
    if (theme?.mode !== "url" || !theme.value) return undefined;
    return (
        safeUrl(theme.value) ??
        `/userast/${theme.value.split("/").map(encodeURIComponent).join("/")}`
    );
}
