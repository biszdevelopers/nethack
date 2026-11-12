import { lookup as dnsLookup } from "node:dns/promises";
import { Agent as HttpAgent } from "node:http";
import { isIP, type LookupAddress, type LookupFunction } from "node:net";
import { Agent as HttpsAgent } from "node:https";
import fetch from "node-fetch";
import { URL } from "node:url";

const MAX_REDIRECTS = 5;
const MAX_EXTERNAL_HTML_BYTES = 15_000;

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
    if (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) return true;
    if (a === 192 && b === 88 && parts[2] === 99) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
    if (a === 203 && b === 0 && parts[2] === 113) return true;
    if (a === 0) return true;
    if (a >= 224 && a <= 239) return true; // multicast
    if (a >= 240) return true; // reserved and limited broadcast
    return false;
}

function isPrivateIpv6(ip: string): boolean {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (lower === "::" || lower === "::1") return true;

    // URL normalizes IPv4-mapped and IPv4-compatible IPv6 literals to two
    // hexadecimal groups (for example ::ffff:7f00:1). Apply the IPv4 policy
    // to the embedded address so loopback and private destinations are denied.
    const embeddedIpv4 = lower.match(/^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (embeddedIpv4) {
        const high = Number.parseInt(embeddedIpv4[1]!, 16);
        const low = Number.parseInt(embeddedIpv4[2]!, 16);
        return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff].join("."));
    }

    const groups = lower.split(":");
    const firstGroup = Number.parseInt(groups[0] ?? "", 16);
    if (!Number.isFinite(firstGroup) || firstGroup < 0x2000 || firstGroup > 0x3fff) return true;
    const secondGroup = Number.parseInt(groups[1] ?? "", 16) || 0;
    if (firstGroup === 0x2001 && secondGroup <= 0x01ff) return true;
    if (firstGroup === 0x2001 && secondGroup === 0x0db8) return true;
    if (firstGroup === 0x2002) return true;
    if (firstGroup === 0x3fff && secondGroup <= 0x0fff) return true;

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
    const family = isIP(ip);
    if ((family === 4 && isPrivateIpv4(ip)) || (family === 6 && isPrivateIpv6(ip))) return true;
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

    if (url.username || url.password) {
        throw new Error("URLs with embedded credentials are not allowed");
    }

    return url;
}

async function resolvePublicAddresses(url: URL): Promise<LookupAddress[]> {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let records: LookupAddress[];
    try {
        records = await dnsLookup(hostname, { all: true, verbatim: true });
    } catch {
        throw new Error("Unable to resolve the requested URL host");
    }

    if (
        records.length === 0 ||
        records.some((record) => {
            const family = isIP(record.address);
            return (
                family === 0 ||
                (family === 4 ? isPrivateIpv4(record.address) : isPrivateIpv6(record.address))
            );
        })
    ) {
        throw new Error("Private or loopback URLs are not allowed");
    }
    return records;
}

function createPinnedAgent(url: URL, records: LookupAddress[]) {
    const lookupPinned = ((
        _hostname: string,
        options: { all?: boolean; family?: number },
        callback: (
            error: NodeJS.ErrnoException | null,
            address: string | LookupAddress[],
            family?: number,
        ) => void,
    ) => {
        const addresses = options.family
            ? records.filter((record) => record.family === options.family)
            : records;
        if (addresses.length === 0) {
            callback(
                Object.assign(new Error("No validated address for host"), { code: "ENOTFOUND" }),
                "",
            );
            return;
        }
        if (options.all) {
            callback(null, addresses);
            return;
        }
        callback(null, addresses[0]!.address, addresses[0]!.family);
    }) as LookupFunction;

    return url.protocol === "https:"
        ? new HttpsAgent({ lookup: lookupPinned })
        : new HttpAgent({ lookup: lookupPinned });
}

export async function fetchExternalHtml(urlString: string, init?: RequestInit): Promise<string> {
    let current = validateExternalUrl(urlString).toString();
    let redirects = 0;

    while (redirects <= MAX_REDIRECTS) {
        const url = validateExternalUrl(current);
        const addresses = await resolvePublicAddresses(url);
        const agent = createPinnedAgent(url, addresses);
        let response: Awaited<ReturnType<typeof fetch>>;
        try {
            response = await fetch(current, { ...init, agent, redirect: "manual" });
        } catch (error) {
            agent.destroy();
            throw error;
        }

        if (response.status >= 300 && response.status < 400) {
            response.body?.destroy();
            agent.destroy();
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
            response.body?.destroy();
            agent.destroy();
            return `Error: Failed to fetch. Status: ${response.status}`;
        }

        try {
            const body = response.body;
            if (!body) return "";

            const chunks: Buffer[] = [];
            let totalBytes = 0;

            try {
                for await (const value of body as AsyncIterable<Buffer | Uint8Array | string>) {
                    // node-fetch emits Buffer chunks. Bound string chunks before encoding too,
                    // since tests or custom stream adapters may emit strings directly.
                    const chunk =
                        typeof value === "string"
                            ? Buffer.from(value.slice(0, MAX_EXTERNAL_HTML_BYTES))
                            : Buffer.isBuffer(value)
                              ? value
                              : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
                    const remainingBytes = MAX_EXTERNAL_HTML_BYTES - totalBytes;

                    if (chunk.byteLength >= remainingBytes) {
                        // Copy the bounded prefix. A subarray alone would retain the entire
                        // backing allocation when the source yields one very large chunk.
                        chunks.push(Buffer.from(chunk.subarray(0, remainingBytes)));
                        totalBytes = MAX_EXTERNAL_HTML_BYTES;
                        body.destroy();
                        break;
                    }

                    chunks.push(chunk);
                    totalBytes += chunk.byteLength;
                }
            } catch (error) {
                if (totalBytes < MAX_EXTERNAL_HTML_BYTES) throw error;
            }

            return new TextDecoder().decode(Buffer.concat(chunks, totalBytes));
        } finally {
            agent.destroy();
        }
    }

    return "Error: Too many redirects";
}
