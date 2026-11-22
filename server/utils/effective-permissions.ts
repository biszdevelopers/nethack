import type { PermissionRequirement } from "@basis/schema/permissions";
import {
    expandLegacyNethackPermissions,
    NethackPermissions,
    satisfiesNethackRequirement,
} from "~~/shared/permissions";
import { isInitialAdminEmail } from "./initial-admins";

export interface NethackPermissionUser {
    email?: string | null;
    is_admin?: boolean | number;
    is_judge?: boolean | number;
}

/**
 * A local administrator grant needs the stored flag. The configured allowlist
 * only fills in callers that carry no local admin state at all, so an
 * administrator demoted in the portal does not regain access from their email.
 */
function hasAdministratorGrant(user?: NethackPermissionUser): boolean {
    if (!user) return false;
    if (user.is_admin !== undefined) return Boolean(user.is_admin);
    return isInitialAdminEmail(user.email);
}

/** Add local administrator grants for designated or promoted users. */
export function effectiveNethackPermissions(
    permissions: Iterable<string> | undefined,
    user?: NethackPermissionUser,
): string[] {
    const effective = expandLegacyNethackPermissions(permissions);
    if (user?.is_judge) {
        for (const permission of [
            NethackPermissions.Judging.assignmentsRead,
            NethackPermissions.Judging.scoresWriteAssigned,
        ]) {
            const key = permission.toLocaleLowerCase("en-US");
            if (!effective.some((granted) => granted.toLocaleLowerCase("en-US") === key)) {
                effective.push(permission);
            }
        }
    }
    if (!hasAdministratorGrant(user)) return effective;

    const allKey = NethackPermissions.all.toLocaleLowerCase("en-US");
    if (!effective.some((permission) => permission.toLocaleLowerCase("en-US") === allKey)) {
        effective.push(NethackPermissions.all);
    }
    return effective;
}

export function hasEffectiveNethackPermission(
    permissions: Iterable<string> | undefined,
    requirement: PermissionRequirement,
    user?: NethackPermissionUser,
): boolean {
    return satisfiesNethackRequirement(effectiveNethackPermissions(permissions, user), requirement);
}
