import type { H3Event } from "h3";
import type { PermissionRequirement } from "@basis/schema/permissions";
import {
    effectiveNethackPermissions,
    hasEffectiveNethackPermission,
} from "~~/shared/permissions";
import { resolveOAuth2User, verifyOAuth2JWT } from "./oauth2-jwt";
import { readBasisAuthUserSession } from "./basis-auth-session";

export async function requireUser(event: H3Event, permissions?: PermissionRequirement) {
    const payload = event.context.oauth2?.payload ?? (await verifyOAuth2JWT(event));
    const user = event.context.oauth2?.user ?? (await resolveOAuth2User(event, payload));
    const effectivePermissions = effectiveNethackPermissions(payload.permissions, user);
    if (permissions && !hasEffectiveNethackPermission(payload.permissions, permissions, user)) {
        throw createError({
            statusCode: 403,
            statusMessage: "insufficient_permission",
            message: "The access token lacks a required permission",
        });
    }
    event.context.oauth2 = {
        payload,
        permissions: effectivePermissions,
        user,
    };
    return user;
}

export async function optionalUser(event: H3Event) {
    if (!getHeader(event, "authorization") && !readBasisAuthUserSession(event)) return undefined;
    return await requireUser(event);
}
