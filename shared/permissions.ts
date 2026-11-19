import type { PermissionRequirement } from "@basis/schema/permissions";

/** Canonical permissions issued by basis-auth for the nethack resource. */
export const NethackPermissions = {
    all: "nethack.all",
    Profile: { updateSelf: "nethack.Profile.updateSelf" },
    Teams: {
        create: "nethack.Teams.create",
        membersAddOwn: "nethack.Teams.membersAddOwn",
        membersRemoveOwn: "nethack.Teams.membersRemoveOwn",
        list: "nethack.Teams.list",
        delete: "nethack.Teams.delete",
    },
    Projects: {
        updateOwn: "nethack.Projects.updateOwn",
        submitOwn: "nethack.Projects.submitOwn",
    },
    Voting: { readOwn: "nethack.Voting.readOwn", submitOwn: "nethack.Voting.submitOwn" },
    Judging: {
        assignmentsRead: "nethack.Judging.assignmentsRead",
        scoresWriteAssigned: "nethack.Judging.scoresWriteAssigned",
        resultsRead: "nethack.Judging.resultsRead",
        resultsCompute: "nethack.Judging.resultsCompute",
    },
    Seasons: {
        create: "nethack.Seasons.create",
        update: "nethack.Seasons.update",
        delete: "nethack.Seasons.delete",
        activate: "nethack.Seasons.activate",
    },
    Hackathon: { read: "nethack.Hackathon.read", update: "nethack.Hackathon.update" },
    Users: { list: "nethack.Users.list", delete: "nethack.Users.delete" },
    Debug: {
        filesRead: "nethack.Debug.filesRead",
        filesWrite: "nethack.Debug.filesWrite",
        deepseekRead: "nethack.Debug.deepseekRead",
        deepseekWrite: "nethack.Debug.deepseekWrite",
    },
    Chatbot: { use: "nethack.Chatbot.use" },
    Database: { export: "nethack.Database.export" },
} as const;

/**
 * Temporary compatibility grants for accounts created before nethack moved
 * from role strings to granular basis-auth permissions.
 */
const LEGACY_PARTICIPANT_PERMISSIONS = [
    NethackPermissions.Profile.updateSelf,
    NethackPermissions.Teams.create,
    NethackPermissions.Teams.membersAddOwn,
    NethackPermissions.Teams.membersRemoveOwn,
    NethackPermissions.Projects.updateOwn,
    NethackPermissions.Projects.submitOwn,
    NethackPermissions.Voting.readOwn,
    NethackPermissions.Voting.submitOwn,
    NethackPermissions.Chatbot.use,
] as const;

const LEGACY_JUDGE_PERMISSIONS = [
    ...LEGACY_PARTICIPANT_PERMISSIONS,
    NethackPermissions.Judging.assignmentsRead,
    NethackPermissions.Judging.scoresWriteAssigned,
] as const;

export function expandLegacyNethackPermissions(
    permissions: Iterable<string> | undefined,
): string[] {
    const effective = new Map<string, string>();
    const add = (permission: string) => {
        const key = permission.toLocaleLowerCase("en-US");
        if (!effective.has(key)) effective.set(key, permission);
    };

    let hasGranularNethackGrant = false;
    for (const permission of permissions ?? []) {
        const normalized = permission.toLocaleLowerCase("en-US");
        if (normalized.startsWith("nethack.")) hasGranularNethackGrant = true;
        add(permission);
        switch (normalized) {
            case "participant":
                LEGACY_PARTICIPANT_PERMISSIONS.forEach(add);
                break;
            case "judge":
                LEGACY_JUDGE_PERMISSIONS.forEach(add);
                break;
            case "admin":
                add(NethackPermissions.all);
                break;
        }
    }

    // Clients that only issue identity scopes still get normal participant
    // capabilities. Elevated judge/admin access still requires an explicit grant.
    if (!hasGranularNethackGrant) {
        LEGACY_PARTICIPANT_PERMISSIONS.forEach(add);
    }

    return [...effective.values()];
}

/** Case-insensitive permission match with `namespace.all` wildcard support. */
function permissionSatisfiedBy(permissions: Iterable<string>, required: string): boolean {
    const requiredKey = required.trim().toLocaleLowerCase("en-US");
    for (const permission of permissions) {
        const grantedKey = permission.trim().toLocaleLowerCase("en-US");
        if (grantedKey === requiredKey) return true;
        if (
            grantedKey.endsWith(".all") &&
            requiredKey.startsWith(`${grantedKey.slice(0, -".all".length)}.`)
        ) {
            return true;
        }
    }
    return false;
}

/** Evaluate a basis-auth permission requirement without a runtime schema dependency. */
export function satisfiesNethackRequirement(
    permissions: Iterable<string>,
    requirement?: PermissionRequirement,
): boolean {
    if (!requirement) return true;
    if (typeof requirement === "string") return permissionSatisfiedBy(permissions, requirement);
    if ("allOf" in requirement) {
        return requirement.allOf.every((permission) =>
            permissionSatisfiedBy(permissions, permission),
        );
    }
    return requirement.anyOf.some((permission) => permissionSatisfiedBy(permissions, permission));
}

export function hasNethackPermission(
    permissions: Iterable<string> | undefined,
    requirement: PermissionRequirement,
): boolean {
    return satisfiesNethackRequirement(expandLegacyNethackPermissions(permissions), requirement);
}
