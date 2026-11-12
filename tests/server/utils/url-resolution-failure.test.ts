import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, dnsLookupMock } = vi.hoisted(() => ({
    fetchMock: vi.fn(),
    dnsLookupMock: vi.fn(),
}));

vi.mock("node-fetch", () => ({ default: fetchMock }));
vi.mock("node:dns/promises", () => ({ lookup: dnsLookupMock }));

import { fetchExternalHtml } from "~~/server/utils/url-validation";

describe("fetchExternalHtml DNS failure boundaries", () => {
    beforeEach(() => {
        fetchMock.mockReset();
        dnsLookupMock.mockReset();
    });

    it("fails closed when DNS cannot resolve the host", async () => {
        dnsLookupMock.mockRejectedValue(new Error("resolver unavailable"));

        await expect(fetchExternalHtml("https://example.com")).rejects.toThrow(
            "Unable to resolve the requested URL host",
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fails closed when DNS returns no addresses", async () => {
        dnsLookupMock.mockResolvedValue([]);

        await expect(fetchExternalHtml("https://example.com")).rejects.toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fails closed when a DNS answer is not a valid IP address", async () => {
        dnsLookupMock.mockResolvedValue([{ address: "not-an-ip", family: 4 }]);

        await expect(fetchExternalHtml("https://example.com")).rejects.toThrow(
            "Private or loopback URLs are not allowed",
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
