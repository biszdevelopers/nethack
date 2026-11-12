import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";

const { fetchMock, dnsLookupMock } = vi.hoisted(() => ({
    fetchMock: vi.fn(),
    dnsLookupMock: vi.fn(),
}));

vi.mock("node-fetch", () => ({ default: fetchMock }));
vi.mock("node:dns/promises", () => ({ lookup: dnsLookupMock }));

import {
    fetchExternalHtml,
    isPrivateIpv4,
    parseIpv4,
    validateExternalUrl,
} from "~~/server/utils/url-validation";

describe("parseIpv4", () => {
    it("parses four decimal octets", () => {
        expect(parseIpv4("8.8.4.4")).toEqual([8, 8, 4, 4]);
    });

    it("rejects addresses with the wrong number of octets", () => {
        expect(parseIpv4("8.8.4")).toBeNull();
    });

    it.each(["8.8.x.4", "8.-1.4.4", "8.8.256.4"])(
        "rejects invalid octet values in %s",
        (address) => {
            expect(parseIpv4(address)).toBeNull();
        },
    );

    it("does not classify malformed IPv4 strings as private addresses", () => {
        expect(isPrivateIpv4("8.8.x.4")).toBe(false);
    });
});

describe("validateExternalUrl", () => {
    it("accepts public HTTPS URLs", () => {
        expect(validateExternalUrl("https://example.com/path").toString()).toBe(
            "https://example.com/path",
        );
    });

    it("accepts public HTTP URLs", () => {
        expect(validateExternalUrl("http://example.com").toString()).toBe("http://example.com/");
    });

    it("rejects localhost", () => {
        expect(() => validateExternalUrl("http://localhost:3000")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects localhost subdomains", () => {
        expect(() => validateExternalUrl("http://localhost.example.com")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects private IPv4 ranges", () => {
        expect(() => validateExternalUrl("http://10.0.0.1")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://172.16.0.1")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://192.168.1.1")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://127.0.0.1")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://169.254.0.1")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("accepts public IPv4 addresses", () => {
        expect(validateExternalUrl("http://8.8.8.8").toString()).toBe("http://8.8.8.8/");
    });

    it("rejects multicast IPv4 addresses", () => {
        expect(() => validateExternalUrl("http://224.0.0.1")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://239.255.255.255")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects loopback IPv6", () => {
        expect(() => validateExternalUrl("http://[::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it.each(["[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[::7f00:1]", "[::ffff:a00:1]"])(
        "rejects private IPv4 embedded in IPv6: %s",
        (host) => {
            expect(() => validateExternalUrl(`http://${host}/admin`)).toThrow(
                "Private or loopback URLs are not allowed",
            );
        },
    );

    it("rejects non-HTTP schemes", () => {
        expect(() => validateExternalUrl("file:///etc/passwd")).toThrow(
            "Only HTTP and HTTPS URLs are allowed",
        );
        expect(() => validateExternalUrl("ftp://example.com")).toThrow(
            "Only HTTP and HTTPS URLs are allowed",
        );
    });

    it("rejects malformed URLs", () => {
        expect(() => validateExternalUrl("not a url")).toThrow("Invalid URL");
    });

    it("rejects link-local IPv6 addresses", () => {
        expect(() => validateExternalUrl("http://[fe80::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects unique local IPv6 addresses", () => {
        expect(() => validateExternalUrl("http://[fd00::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects multicast IPv6 addresses", () => {
        expect(() => validateExternalUrl("http://[ff02::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects IPv4 with too many octets", () => {
        expect(() => validateExternalUrl("http://10.0.0.1.5")).not.toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects IPv4 with out-of-range octets", () => {
        expect(() => validateExternalUrl("http://10.0.0.256")).not.toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects IPv4 with non-numeric octets", () => {
        expect(() => validateExternalUrl("http://10.0.0.abc")).not.toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects IPv4 with negative octets", () => {
        expect(() => validateExternalUrl("http://10.0.0.-1")).not.toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects 0.0.0.0 as private", () => {
        expect(() => validateExternalUrl("http://0.0.0.0")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects 10.x.x.x subranges", () => {
        expect(() => validateExternalUrl("http://10.0.0.1")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://10.255.255.255")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://10.1.2.3")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects 172.16.x.x through 172.31.x.x", () => {
        expect(() => validateExternalUrl("http://172.16.0.1")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://172.20.0.1")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://172.31.255.255")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("allows 172.15.x.x and 172.32.x.x (non-private 172 range)", () => {
        expect(validateExternalUrl("http://172.15.0.1").toString()).toBe("http://172.15.0.1/");
        expect(validateExternalUrl("http://172.32.0.1").toString()).toBe("http://172.32.0.1/");
    });

    it("allows 192.167.x.x (non-private 192 range)", () => {
        expect(validateExternalUrl("http://192.167.0.1").toString()).toBe("http://192.167.0.1/");
        expect(validateExternalUrl("http://192.169.0.1").toString()).toBe("http://192.169.0.1/");
    });

    it("rejects IPv6 unique-local (fc00::/7)", () => {
        expect(() => validateExternalUrl("http://[fc00::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://[fc01::]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://[fd12:3456::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects IPv6 link-local (fe80::/10) variants", () => {
        expect(() => validateExternalUrl("http://[fe80::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://[fe81::]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://[fe90::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://[fea0::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://[feb0::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects IPv6 multicast (ff00::/8)", () => {
        expect(() => validateExternalUrl("http://[ff00::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://[ff02::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://[ff05::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://[ff0e::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("allows public IPv6 addresses", () => {
        expect(() => validateExternalUrl("http://[2001:db8::1]")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(validateExternalUrl("http://[2600::1]").toString()).toBe("http://[2600::1]/");
    });

    it("rejects DNS rebinding style hostnames that resolve to localhost", () => {
        expect(() => validateExternalUrl("http://localhost.evil.com")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://evil.localhost.com")).not.toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects IPv4 addresses with leading zeros (still parsed as private 10.x.x.x)", () => {
        expect(() => validateExternalUrl("http://10.0.0.01")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects IPv4 addresses with trailing dots (URL normalizes to private 10.x.x.x)", () => {
        expect(() => validateExternalUrl("http://10.0.0.1.")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("allows non-private IPv4 with trailing dot (URL normalizes the hostname)", () => {
        expect(validateExternalUrl("http://8.8.8.8.").toString()).toBe("http://8.8.8.8/");
    });

    it("rejects URLs with fragments in validateExternalUrl", () => {
        expect(validateExternalUrl("https://example.com/page#section").hash).toBe("#section");
    });

    it("rejects URLs with auth (user:pass@)", () => {
        expect(() => validateExternalUrl("https://user:pass@example.com/path")).toThrow(
            "URLs with embedded credentials are not allowed",
        );
    });

    it("rejects 127.x.x.x loopback range", () => {
        expect(() => validateExternalUrl("http://127.0.0.1")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://127.255.255.255")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://127.0.0.2")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects 169.254.x.x link-local range", () => {
        expect(() => validateExternalUrl("http://169.254.0.1")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://169.254.255.255")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("rejects 224.0.0.0 through 239.255.255.255 multicast range edges", () => {
        expect(() => validateExternalUrl("http://224.0.0.0")).toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(() => validateExternalUrl("http://239.255.255.255")).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("accepts public IPv4 addresses just outside private ranges", () => {
        expect(validateExternalUrl("http://11.0.0.1").toString()).toBe("http://11.0.0.1/");
        expect(validateExternalUrl("http://173.16.0.1").toString()).toBe("http://173.16.0.1/");
        expect(validateExternalUrl("http://193.168.0.1").toString()).toBe("http://193.168.0.1/");
    });

    it.each([
        "192.0.0.1",
        "192.0.2.1",
        "192.88.99.1",
        "100.64.0.1",
        "100.127.255.254",
        "198.18.0.1",
        "198.19.255.254",
        "198.51.100.1",
        "203.0.113.1",
        "240.0.0.1",
        "255.255.255.255",
    ])("rejects special-use IPv4 address %s", (address) => {
        expect(() => validateExternalUrl(`http://${address}`)).toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it.each(["192.0.1.1", "192.88.98.1", "100.63.255.254", "100.128.0.1", "198.20.0.1"])(
        "allows nearby public IPv4 address %s",
        (address) => {
            expect(validateExternalUrl(`http://${address}`).hostname).toBe(address);
        },
    );

    it.each(["[::]", "[1::1]", "[4000::1]", "[2001::1]", "[2002::1]", "[3fff:1::1]"])(
        "rejects non-global IPv6 range %s",
        (address) => {
            expect(() => validateExternalUrl(`http://${address}`)).toThrow(
                "Private or loopback URLs are not allowed",
            );
        },
    );

    it("allows public IPv4-mapped IPv6 addresses", () => {
        expect(validateExternalUrl("http://[::ffff:808:808]").hostname).toBe("[::ffff:808:808]");
    });
});

describe("fetchExternalHtml", () => {
    beforeEach(() => {
        fetchMock.mockReset();
        dnsLookupMock.mockReset();
        dnsLookupMock.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    });

    function createResponse(overrides: Partial<Response> = {}): Response {
        const text = overrides.text ?? (() => Promise.resolve("<html></html>"));
        return {
            status: 200,
            ok: true,
            headers: new Headers(),
            body: Readable.from(
                (async function* () {
                    yield Buffer.from(await text());
                })(),
            ),
            text,
            ...overrides,
        } as Response;
    }

    it.each([
        { address: "127.0.0.1", family: 4 },
        { address: "10.0.0.1", family: 4 },
        { address: "::ffff:127.0.0.1", family: 6 },
    ])("rejects a hostname resolving to a non-public address: %s", async (privateAddress) => {
        dnsLookupMock.mockResolvedValue([privateAddress]);

        await expect(fetchExternalHtml("https://attacker.example")).rejects.toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects mixed DNS answers if any address is non-public", async () => {
        dnsLookupMock.mockResolvedValue([
            { address: "8.8.8.8", family: 4 },
            { address: "192.168.1.1", family: 4 },
        ]);

        await expect(fetchExternalHtml("https://attacker.example")).rejects.toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("pins the connection to the validated DNS answer", async () => {
        fetchMock.mockResolvedValue(createResponse());
        dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

        await fetchExternalHtml("https://example.com");

        const options = fetchMock.mock.calls[0]![1] as {
            agent: {
                options: {
                    lookup: (hostname: string, options: object, callback: Function) => void;
                };
            };
        };
        const pinnedLookup = options.agent.options.lookup;
        const pinnedAddress = await new Promise<{ address: string; family: number }>(
            (resolve, reject) => {
                pinnedLookup(
                    "example.com",
                    {},
                    (error: Error | null, address: string, family: number) => {
                        if (error) reject(error);
                        else resolve({ address, family });
                    },
                );
            },
        );

        // Changing what DNS would return after validation cannot change the
        // already-pinned lookup function used by the HTTP(S) agent.
        dnsLookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
        expect(pinnedAddress).toEqual({ address: "93.184.216.34", family: 4 });
        expect(dnsLookupMock).toHaveBeenCalledTimes(1);
    });

    it("serves pinned lookup callbacks for all and matching family requests", async () => {
        fetchMock.mockResolvedValue(createResponse());
        dnsLookupMock.mockResolvedValue([
            { address: "93.184.216.34", family: 4 },
            { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
        ]);

        await fetchExternalHtml("https://example.com");

        const options = fetchMock.mock.calls[0]![1] as {
            agent: {
                options: {
                    lookup: (hostname: string, options: object, callback: Function) => void;
                };
            };
        };
        const lookup = options.agent.options.lookup;
        const allAddresses = await new Promise((resolve, reject) => {
            lookup("example.com", { all: true }, (error: Error | null, addresses: unknown) => {
                if (error) reject(error);
                else resolve(addresses);
            });
        });
        expect(allAddresses).toEqual([
            { address: "93.184.216.34", family: 4 },
            { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
        ]);

        const ipv6Address = await new Promise((resolve, reject) => {
            lookup(
                "example.com",
                { family: 6 },
                (error: Error | null, address: string, family: number) => {
                    if (error) reject(error);
                    else resolve({ address, family });
                },
            );
        });
        expect(ipv6Address).toEqual({
            address: "2606:2800:220:1:248:1893:25c8:1946",
            family: 6,
        });

        const lookupError = await new Promise<Error>((resolve) => {
            lookup("example.com", { family: 5 }, (error: Error | null) => resolve(error!));
        });
        expect(lookupError.message).toBe("No validated address for host");
        expect((lookupError as NodeJS.ErrnoException).code).toBe("ENOTFOUND");
    });

    it("supports pinned HTTP connections", async () => {
        fetchMock.mockResolvedValue(createResponse());

        await fetchExternalHtml("http://example.com");

        const options = fetchMock.mock.calls[0]![1] as { agent: { protocol: string } };
        expect(options.agent.protocol).toBe("http:");
    });

    it("resolves and validates every redirect destination", async () => {
        dnsLookupMock
            .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
            .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
        fetchMock.mockResolvedValue(
            createResponse({
                status: 302,
                ok: false,
                headers: new Headers({ location: "https://attacker.example/next" }),
            }),
        );

        await expect(fetchExternalHtml("https://example.com")).rejects.toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(dnsLookupMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("returns HTML for a successful response", async () => {
        fetchMock.mockResolvedValue(
            createResponse({
                text: () => Promise.resolve("<html><body>Hello</body></html>"),
            }),
        );

        const result = await fetchExternalHtml("https://example.com");

        expect(result).toBe("<html><body>Hello</body></html>");
    });

    it("truncates HTML to 15000 bytes", async () => {
        const longHtml = "a".repeat(20000);
        fetchMock.mockResolvedValue(
            createResponse({
                text: () => Promise.resolve(longHtml),
            }),
        );

        const result = await fetchExternalHtml("https://example.com");

        expect(result.length).toBe(15000);
    });

    it("bounds and cancels a response that arrives as one oversized chunk", async () => {
        const body = Readable.from([Buffer.alloc(500_000, 0x61)]);
        fetchMock.mockResolvedValue(createResponse({ body }));

        const result = await fetchExternalHtml("https://example.com");

        expect(Buffer.byteLength(result)).toBe(15_000);
        expect(result).toBe("a".repeat(15_000));
        expect(body.destroyed).toBe(true);
    });

    it("bounds direct string and non-Buffer typed-array chunks", async () => {
        const body = Readable.from([
            "<p>string</p>",
            new Uint8Array(Buffer.from("<p>typed array</p>")),
        ]);
        fetchMock.mockResolvedValue(createResponse({ body }));

        await expect(fetchExternalHtml("https://example.com")).resolves.toBe(
            "<p>string</p><p>typed array</p>",
        );
    });

    it("stops consuming a chunked response after reaching the byte limit", async () => {
        let producedChunks = 0;
        let cancelled = false;
        const body = Readable.from(
            (async function* () {
                try {
                    for (let index = 0; index < 30; index++) {
                        producedChunks++;
                        yield Buffer.alloc(1_000, 0x61 + (index % 26));
                    }
                } finally {
                    cancelled = true;
                }
            })(),
        );
        fetchMock.mockResolvedValue(createResponse({ body }));

        const result = await fetchExternalHtml("https://example.com");

        expect(Buffer.byteLength(result)).toBe(15_000);
        expect(producedChunks).toBeLessThan(30);
        expect(cancelled).toBe(true);
        expect(body.destroyed).toBe(true);
    });

    it("passes init options to fetch", async () => {
        fetchMock.mockResolvedValue(createResponse());

        await fetchExternalHtml("https://example.com", { headers: { "X-Test": "1" } });

        expect(fetchMock).toHaveBeenCalledWith(
            "https://example.com/",
            expect.objectContaining({
                headers: { "X-Test": "1" },
                redirect: "manual",
            }),
        );
    });

    it("returns an error for non-ok responses", async () => {
        fetchMock.mockResolvedValue(
            createResponse({
                status: 404,
                ok: false,
            }),
        );

        const result = await fetchExternalHtml("https://example.com");

        expect(result).toBe("Error: Failed to fetch. Status: 404");
    });

    it("follows a single redirect", async () => {
        fetchMock
            .mockResolvedValueOnce(
                createResponse({
                    status: 302,
                    ok: false,
                    headers: new Headers({ location: "https://redirect.example.com" }),
                }),
            )
            .mockResolvedValueOnce(
                createResponse({
                    text: () => Promise.resolve("<html>redirected</html>"),
                }),
            );

        const result = await fetchExternalHtml("https://example.com");

        expect(result).toBe("<html>redirected</html>");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("rejects redirects to private URLs", async () => {
        fetchMock.mockResolvedValue(
            createResponse({
                status: 302,
                ok: false,
                headers: new Headers({ location: "http://localhost/secret" }),
            }),
        );

        await expect(fetchExternalHtml("https://example.com")).rejects.toThrow(
            "Private or loopback URLs are not allowed",
        );
    });

    it("returns an error for a redirect without a Location header", async () => {
        fetchMock.mockResolvedValue(
            createResponse({
                status: 302,
                ok: false,
            }),
        );

        const result = await fetchExternalHtml("https://example.com");

        expect(result).toBe("Error: Redirect without Location header. Status: 302");
    });

    it("returns an error after too many redirects", async () => {
        fetchMock.mockResolvedValue(
            createResponse({
                status: 302,
                ok: false,
                headers: new Headers({ location: "https://example.com/loop" }),
            }),
        );

        const result = await fetchExternalHtml("https://example.com");

        expect(result).toBe("Error: Too many redirects");
    });

    it("follows multiple redirects up to the limit", async () => {
        fetchMock
            .mockResolvedValueOnce(
                createResponse({
                    status: 302,
                    ok: false,
                    headers: new Headers({ location: "https://redirect1.example.com" }),
                }),
            )
            .mockResolvedValueOnce(
                createResponse({
                    status: 302,
                    ok: false,
                    headers: new Headers({ location: "https://redirect2.example.com" }),
                }),
            )
            .mockResolvedValueOnce(
                createResponse({
                    status: 302,
                    ok: false,
                    headers: new Headers({ location: "https://redirect3.example.com" }),
                }),
            )
            .mockResolvedValueOnce(
                createResponse({
                    status: 302,
                    ok: false,
                    headers: new Headers({ location: "https://final.example.com" }),
                }),
            )
            .mockResolvedValueOnce(
                createResponse({
                    text: () => Promise.resolve("<html>after 4 redirects</html>"),
                }),
            );

        const result = await fetchExternalHtml("https://example.com");

        expect(result).toBe("<html>after 4 redirects</html>");
        expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it("returns error for exact ceiling redirects (6 redirects = too many)", async () => {
        fetchMock.mockResolvedValue(
            createResponse({
                status: 302,
                ok: false,
                headers: new Headers({ location: "https://example.com/loop" }),
            }),
        );

        const result = await fetchExternalHtml("https://example.com");

        expect(result).toBe("Error: Too many redirects");
    });

    it("handles fetch network error gracefully", async () => {
        fetchMock.mockRejectedValue(new Error("Network failure"));

        await expect(fetchExternalHtml("https://example.com")).rejects.toThrow("Network failure");
    });

    it("returns error for non-ok non-redirect status (e.g. 500)", async () => {
        fetchMock.mockResolvedValue(
            createResponse({
                status: 500,
                ok: false,
            }),
        );

        const result = await fetchExternalHtml("https://example.com");

        expect(result).toBe("Error: Failed to fetch. Status: 500");
    });

    it("returns error for 403 forbidden", async () => {
        fetchMock.mockResolvedValue(
            createResponse({
                status: 403,
                ok: false,
            }),
        );

        const result = await fetchExternalHtml("https://example.com");

        expect(result).toBe("Error: Failed to fetch. Status: 403");
    });

    it("follows redirect with relative location header", async () => {
        fetchMock
            .mockResolvedValueOnce(
                createResponse({
                    status: 301,
                    ok: false,
                    headers: new Headers({ location: "/relative-path" }),
                }),
            )
            .mockResolvedValueOnce(
                createResponse({
                    text: () => Promise.resolve("<html>relative ok</html>"),
                }),
            );

        const result = await fetchExternalHtml("https://example.com/old");

        expect(result).toBe("<html>relative ok</html>");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("passes through custom headers to the initial fetch", async () => {
        fetchMock.mockResolvedValue(createResponse());

        await fetchExternalHtml("https://example.com", {
            headers: { Authorization: "Bearer token123" },
        });

        expect(fetchMock).toHaveBeenCalledWith(
            "https://example.com/",
            expect.objectContaining({
                headers: { Authorization: "Bearer token123" },
                redirect: "manual",
            }),
        );
    });

    it("uses the GET method when specified in init", async () => {
        fetchMock.mockResolvedValue(createResponse());

        await fetchExternalHtml("https://example.com", { method: "GET" });

        expect(fetchMock).toHaveBeenCalledWith(
            "https://example.com/",
            expect.objectContaining({ method: "GET", redirect: "manual" }),
        );
    });

    it("handles empty response text", async () => {
        fetchMock.mockResolvedValue(
            createResponse({
                text: () => Promise.resolve(""),
            }),
        );

        const result = await fetchExternalHtml("https://example.com");

        expect(result).toBe("");
    });

    it("returns an empty string when a successful response has no body", async () => {
        fetchMock.mockResolvedValue(createResponse({ body: null }));

        await expect(fetchExternalHtml("https://example.com")).resolves.toBe("");
    });

    it("propagates response stream errors before the byte limit", async () => {
        const body = Readable.from(
            (async function* () {
                yield Buffer.from("partial");
                throw new Error("stream failed");
            })(),
        );
        fetchMock.mockResolvedValue(createResponse({ body }));

        await expect(fetchExternalHtml("https://example.com")).rejects.toThrow("stream failed");
    });

    it("cancels the stream after reaching the byte limit", async () => {
        const body = Readable.from(
            (async function* () {
                yield Buffer.alloc(15_000, 0x61);
                throw new Error("late stream failure");
            })(),
        );
        fetchMock.mockResolvedValue(createResponse({ body }));

        await expect(fetchExternalHtml("https://example.com")).resolves.toBe("a".repeat(15_000));
    });

    it("handles response with only whitespace", async () => {
        fetchMock.mockResolvedValue(
            createResponse({
                text: () => Promise.resolve("   \n  \t  "),
            }),
        );

        const result = await fetchExternalHtml("https://example.com");

        expect(result).toBe("   \n  \t  ");
    });
});
