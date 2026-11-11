import { URL } from "node:url";

const MAX_REDIRECTS = 5;

function parseIpv4(ip: string): number[] | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    const nums = parts.map((p) => Number.parseInt(p, 10));
    if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
    return nums;
}

function isPrivateIpv4(ip: string): boolean {
    const parts = parseIpv4(ip);
    if (!parts) return false;
    const a = parts[0]!;
    const b = parts[1]!;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    if (a >= 224 && a <= 239) return true; // multicast
    return false;
}

function isPrivateIpv6(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (
        lower.startsWith("fe8") ||
        lower.startsWith("fe9") ||
        lower.startsWith("fea") ||
        lower.startsWith("feb")
    )
        return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("ff")) return true; // multicast
    return false;
}

function isPrivateHost(host: string): boolean {
    const lower = host.toLowerCase();
    if (lower === "localhost" || lower.startsWith("localhost.")) return true;
    // Strip IPv6 brackets for comparison
    const ip = lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
    if (isPrivateIpv4(ip) || isPrivateIpv6(ip)) return true;
    return false;
}

export function validateExternalUrl(urlString: string): URL {
    let url: URL;
    try {
        url = new URL(urlString);
    } catch {
        throw new Error("Invalid URL");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Only HTTP and HTTPS URLs are allowed");
    }

    if (isPrivateHost(url.hostname)) {
        throw new Error("Private or loopback URLs are not allowed");
    }

    return url;
}

export async function fetchExternalHtml(urlString: string, init?: RequestInit): Promise<string> {
    let current = validateExternalUrl(urlString).toString();
    let redirects = 0;

    while (redirects <= MAX_REDIRECTS) {
        const response = await fetch(current, {
            ...init,
            redirect: "manual",
        });

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location) {
                return `Error: Redirect without Location header. Status: ${response.status}`;
            }
            redirects++;
            if (redirects > MAX_REDIRECTS) {
                break;
            }
            current = validateExternalUrl(new URL(location, current).toString()).toString();
            continue;
        }

        if (!response.ok) {
            return `Error: Failed to fetch. Status: ${response.status}`;
        }

        const html = await response.text();
        return html.substring(0, 15000);
    }

    return "Error: Too many redirects";
}
