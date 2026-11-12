/**
 * Return true for relative paths rooted at `/` (but not protocol-relative `//`)
 * or for absolute http:// / https:// URLs.
 */
export function isSafeUrl(url: string): boolean {
    if (!url) return false;

    // Parse root-relative paths with the WHATWG URL parser too. Browsers treat
    // backslashes as slashes for special schemes, so a value such as `/\\\\evil.example`
    // can otherwise escape the current origin despite looking like a path.
    if (url.startsWith("/")) {
        if (url.startsWith("//")) return false;
        try {
            return (
                new URL(url, "https://basishacks.invalid").origin === "https://basishacks.invalid"
            );
        } catch {
            return false;
        }
    }

    try {
        const parsed = new URL(url);
        return (
            (parsed.protocol === "http:" || parsed.protocol === "https:") &&
            Boolean(parsed.hostname) &&
            !parsed.username &&
            !parsed.password
        );
    } catch {
        return false;
    }
}

/**
 * Return the URL unchanged if it is safe, otherwise undefined.
 */
export function safeUrl(url: string | null | undefined): string | undefined {
    if (!url) return undefined;
    return isSafeUrl(url) ? url : undefined;
}
