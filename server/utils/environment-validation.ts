export function isValidProductionOrigin(value: string | undefined): boolean {
    if (!value?.trim()) return false;
    try {
        const origin = new URL(value.trim());
        return (
            origin.protocol === "https:" &&
            Boolean(origin.hostname) &&
            !origin.username &&
            !origin.password &&
            origin.pathname === "/" &&
            !origin.search &&
            !origin.hash
        );
    } catch {
        return false;
    }
}

export function isValidE2ELoopbackOrigin(
    value: string | undefined,
    host: string | undefined,
    port: string | undefined,
    unixSocket: string | undefined,
): boolean {
    if (host !== "127.0.0.1" || unixSocket || !port || !/^\d+$/.test(port)) return false;
    const numericPort = Number(port);
    if (!Number.isSafeInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
        return false;
    }

    try {
        const origin = new URL(value?.trim() ?? "");
        return (
            origin.protocol === "http:" &&
            origin.hostname === "127.0.0.1" &&
            origin.port === String(numericPort) &&
            !origin.username &&
            !origin.password &&
            origin.pathname === "/" &&
            !origin.search &&
            !origin.hash
        );
    } catch {
        return false;
    }
}

export function isValidTrustedProxyHops(value: string | undefined): boolean {
    if (value === undefined || value === "") return true;
    if (!/^\d+$/.test(value)) return false;
    const hops = Number(value);
    return Number.isSafeInteger(hops) && hops >= 0 && hops <= 10;
}
