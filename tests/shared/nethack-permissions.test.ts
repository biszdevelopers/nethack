import { describe, expect, it } from "vitest";
import {
    expandLegacyNethackPermissions,
    hasNethackPermission,
    NethackPermissions,
} from "~~/shared/permissions";

describe("NethackPermissions", () => {
    it("uses canonical least-privilege JWT permission names", () => {
        expect(NethackPermissions.Projects.submitOwn).toBe("nethack.Projects.submitOwn");
        expect(NethackPermissions.Judging.resultsCompute).toBe("nethack.Judging.resultsCompute");
    });

    it("requires an exact leaf permission", () => {
        expect(
            hasNethackPermission(
                [NethackPermissions.Projects.updateOwn],
                NethackPermissions.Projects.submitOwn,
            ),
        ).toBe(false);
    });

    it("lets the explicit nethack.all administrative grant satisfy leaves", () => {
        expect(
            hasNethackPermission([NethackPermissions.all], NethackPermissions.Database.export),
        ).toBe(true);
    });

    it("maps a legacy participant grant to self-service permissions", () => {
        const effective = expandLegacyNethackPermissions(["participant"]);

        expect(effective).toContain(NethackPermissions.Profile.updateSelf);
        expect(effective).toContain(NethackPermissions.Projects.submitOwn);
        expect(effective).not.toContain(NethackPermissions.Users.list);
        expect(hasNethackPermission(["participant"], NethackPermissions.Voting.submitOwn)).toBe(
            true,
        );
    });

    it("maps a legacy judge grant to participant and judging permissions", () => {
        const effective = expandLegacyNethackPermissions(["judge"]);

        expect(effective).toContain(NethackPermissions.Profile.updateSelf);
        expect(effective).toContain(NethackPermissions.Judging.assignmentsRead);
        expect(effective).toContain(NethackPermissions.Judging.scoresWriteAssigned);
        expect(effective).not.toContain(NethackPermissions.Judging.resultsRead);
        expect(effective).not.toContain(NethackPermissions.Judging.resultsCompute);
    });

    it("maps a legacy admin grant to nethack.all", () => {
        expect(expandLegacyNethackPermissions(["admin"])).toContain(NethackPermissions.all);
        expect(hasNethackPermission(["admin"], NethackPermissions.Database.export)).toBe(true);
    });

    it("preserves granular and unknown permissions while removing duplicates", () => {
        expect(
            expandLegacyNethackPermissions([
                NethackPermissions.Chatbot.use,
                "NETHACK.CHATBOT.USE",
                "another.application.permission",
            ]),
        ).toEqual([NethackPermissions.Chatbot.use, "another.application.permission"]);
    });
});
