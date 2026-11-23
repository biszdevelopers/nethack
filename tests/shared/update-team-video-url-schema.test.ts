import { describe, expect, it } from "vitest";
import { UpdateTeamRequest } from "~~/shared/schemas";

describe("team video URL normalization", () => {
    it("normalizes an empty video URL to null", () => {
        const parsed = UpdateTeamRequest.parse({ project: { video_url: "" } });

        expect(parsed.project?.video_url).toBeNull();
    });

    it("keeps a valid video URL and an explicit null", () => {
        expect(
            UpdateTeamRequest.parse({
                project: { video_url: "https://youtu.be/example" },
            }).project?.video_url,
        ).toBe("https://youtu.be/example");
        expect(UpdateTeamRequest.parse({ project: { video_url: null } }).project?.video_url).toBe(
            null,
        );
    });
});
