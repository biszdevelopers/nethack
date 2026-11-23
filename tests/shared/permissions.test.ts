import { describe, expect, it } from "vitest";
import {
    expandLegacyNethackPermissions,
    hasNethackPermission,
    NethackPermissions,
    satisfiesNethackRequirement,
} from "~~/shared/permissions";
import {
    effectiveNethackPermissions,
    hasEffectiveNethackPermission,
} from "~~/server/utils/effective-permissions";
import { isInitialAdminEmail } from "~~/server/utils/initial-admins";

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
        // Identity-only requests are anonymous for permission checks; call
        // sites must authenticate before asking for a grant.
        expect(hasNethackPermission(undefined, NethackPermissions.Profile.updateSelf)).toBe(false);
        expect(hasNethackPermission([], NethackPermissions.Users.delete)).toBe(false);
    });

    it("does not expand participant permissions when only an explicit granular grant exists", () => {
        expect(expandLegacyNethackPermissions([NethackPermissions.Voting.readOwn])).toEqual([
            NethackPermissions.Voting.readOwn,
        ]);
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
        expect(
            hasNethackPermission([NethackPermissions.Teams.list], {
                allOf: [NethackPermissions.Teams.list, NethackPermissions.Teams.delete],
            }),
        ).toBe(false);
    });

    it("supports any-of requirements and an empty requirement", () => {
        expect(
            hasNethackPermission([NethackPermissions.Teams.delete], {
                anyOf: [NethackPermissions.Teams.list, NethackPermissions.Teams.delete],
            }),
        ).toBe(true);
        expect(
            hasNethackPermission([], {
                anyOf: [NethackPermissions.Teams.list, NethackPermissions.Teams.delete],
            }),
        ).toBe(false);
        expect(satisfiesNethackRequirement([])).toBe(true);
    });

    it("matches wildcard grants only inside their own namespace", () => {
        expect(satisfiesNethackRequirement(["nethack.Teams.all"], "nethack.Teams.list")).toBe(true);
        expect(satisfiesNethackRequirement(["nethack.Teams.all"], "nethack.Users.list")).toBe(
            false,
        );
        expect(satisfiesNethackRequirement([" NETHACK.TEAMS.ALL "], "nethack.Teams.list")).toBe(
            true,
        );
    });

    it("does not let participant compatibility grants satisfy administrative permissions", () => {
        expect(hasNethackPermission(["participant"], NethackPermissions.Users.delete)).toBe(false);
    });

    it("lets the legacy admin grant satisfy every nethack leaf", () => {
        expect(hasNethackPermission(["admin"], NethackPermissions.Seasons.delete)).toBe(true);
    });

    it("matches initial administrator emails case-insensitively", () => {
        expect(isInitialAdminEmail(" ZHIYU.JIANG90454-BISZ@BASISCHINA.COM ")).toBe(true);
        expect(isInitialAdminEmail("someone@example.test")).toBe(false);
    });

    it("adds the administrative grant for initial and promoted local admins", () => {
        expect(
            hasEffectiveNethackPermission([], NethackPermissions.Seasons.delete, {
                email: "cindy.cheng-bisz@basischina.com",
            }),
        ).toBe(true);
        expect(
            hasEffectiveNethackPermission([], NethackPermissions.Seasons.delete, {
                email: "user@example.test",
                is_admin: 1,
            }),
        ).toBe(true);
        expect(
            effectiveNethackPermissions([], {
                email: "user@example.test",
                is_admin: false,
            }),
        ).toContain(NethackPermissions.Profile.updateSelf);
    });

    it("grants judging permissions to locally promoted judges", () => {
        const promoted = effectiveNethackPermissions([], {
            email: "judge@example.test",
            is_judge: 1,
        });
        expect(promoted).toContain(NethackPermissions.Judging.assignmentsRead);
        expect(promoted).toContain(NethackPermissions.Judging.scoresWriteAssigned);

        const alreadyGranted = effectiveNethackPermissions(
            [NethackPermissions.Judging.assignmentsRead],
            { email: "judge@example.test", is_judge: 1 },
        );
        expect(
            alreadyGranted.filter(
                (permission) =>
                    permission.toLocaleLowerCase("en-US") ===
                    NethackPermissions.Judging.assignmentsRead.toLocaleLowerCase("en-US"),
            ),
        ).toHaveLength(1);

        const participant = effectiveNethackPermissions([], {
            email: "participant@example.test",
            is_judge: 0,
        });
        expect(participant).not.toContain(NethackPermissions.Judging.assignmentsRead);
        expect(participant).not.toContain(NethackPermissions.Judging.scoresWriteAssigned);
    });

    it("does not duplicate an administrative grant that is already present", () => {
        const effective = effectiveNethackPermissions(["NETHACK.ALL"], {
            email: "admin@example.test",
            is_admin: 1,
        });

        expect(effective.filter((permission) => /^nethack\.all$/i.test(permission))).toHaveLength(
            1,
        );
    });
});
