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
}

/** Add local administrator grants for designated or promoted users. */
export function effectiveNethackPermissions(
    permissions: Iterable<string> | undefined,
    user?: NethackPermissionUser,
): string[] {
    const effective = expandLegacyNethackPermissions(permissions);
    if (!user?.is_admin && !isInitialAdminEmail(user?.email)) return effective;

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
