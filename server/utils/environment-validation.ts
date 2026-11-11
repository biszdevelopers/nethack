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

export function isValidTrustedProxyHops(value: string | undefined): boolean {
    if (value === undefined || value === "") return true;
    if (!/^\d+$/.test(value)) return false;
    const hops = Number(value);
    return Number.isSafeInteger(hops) && hops >= 0 && hops <= 10;
}
