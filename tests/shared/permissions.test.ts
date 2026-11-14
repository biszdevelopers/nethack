import { describe, expect, it } from "vitest";
import {
    expandLegacyNethackPermissions,
    hasNethackPermission,
    NethackPermissions,
} from "~~/shared/permissions";

describe("nethack permission helpers", () => {
    it("grants participant capabilities when the token has no granular nethack grant", () => {
        const effective = expandLegacyNethackPermissions(undefined);
        expect(effective).toEqual(
            expect.arrayContaining([
                NethackPermissions.Profile.updateSelf,
                NethackPermissions.Teams.create,
                NethackPermissions.Projects.submitOwn,
                NethackPermissions.Voting.submitOwn,
            ]),
        );
        expect(hasNethackPermission(undefined, NethackPermissions.Profile.updateSelf)).toBe(true);
        expect(hasNethackPermission([], NethackPermissions.Users.delete)).toBe(false);
    });

    it("does not expand participant permissions when only an explicit granular grant exists", () => {
        expect(
            expandLegacyNethackPermissions([NethackPermissions.Voting.readOwn]),
        ).toEqual([NethackPermissions.Voting.readOwn]);
    });

    it("matches permissions case-insensitively", () => {
        expect(
            hasNethackPermission(
                ["NETHACK.PROFILE.UPDATESELF"],
                NethackPermissions.Profile.updateSelf,
            ),
        ).toBe(true);
    });

    it("supports all-of permission requirements", () => {
        expect(
            hasNethackPermission([NethackPermissions.Teams.list, NethackPermissions.Teams.delete], {
                allOf: [NethackPermissions.Teams.list, NethackPermissions.Teams.delete],
            }),
        ).toBe(true);
    });

    it("does not let participant compatibility grants satisfy administrative permissions", () => {
        expect(hasNethackPermission(["participant"], NethackPermissions.Users.delete)).toBe(false);
    });

    it("lets the legacy admin grant satisfy every nethack leaf", () => {
        expect(hasNethackPermission(["admin"], NethackPermissions.Seasons.delete)).toBe(true);
    });
});
