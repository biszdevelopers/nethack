import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("jdenticon", () => ({
    default: {
        toPng: vi.fn().mockReturnValue(Buffer.from("fake-png")),
    },
}));

import jdenticon from "jdenticon";
import { generateIdenticonPNG } from "~~/server/utils/profile";

beforeEach(() => {
    vi.mocked(jdenticon.toPng).mockReset();
    vi.mocked(jdenticon.toPng).mockReturnValue(Buffer.from("fake-png"));
});

describe("generateIdenticonPNG", () => {
    it("returns the PNG buffer produced by jdenticon", async () => {
        const png = Buffer.from("generated-png");
        vi.mocked(jdenticon.toPng).mockReturnValueOnce(png);

        await expect(generateIdenticonPNG("bob", 100)).resolves.toBe(png);
    });

    it("passes the original name and requested size through unchanged", async () => {
        await generateIdenticonPNG("user@domain.com", 200);

        expect(jdenticon.toPng).toHaveBeenCalledWith("user@domain.com", 200);
    });

    it("uses 100 pixels when no size is supplied", async () => {
        await generateIdenticonPNG("default");

        expect(jdenticon.toPng).toHaveBeenCalledWith("default", 100);
    });

    it("does not persist arbitrary user-named files", async () => {
        await generateIdenticonPNG("../../profile");

        expect(jdenticon.toPng).toHaveBeenCalledWith("../../profile", 100);
    });

    it("propagates PNG generation failures", async () => {
        vi.mocked(jdenticon.toPng).mockImplementationOnce(() => {
            throw new Error("PNG generation failed");
        });

        await expect(generateIdenticonPNG("crash")).rejects.toThrow("PNG generation failed");
    });
});
