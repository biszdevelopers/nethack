import type { H3Event } from "h3";
import type { PermissionRequirement } from "@basis/schema/permissions";
import {
    effectiveNethackPermissions,
    hasEffectiveNethackPermission,
} from "./effective-permissions";
import { resolveOAuth2User, verifyOAuth2JWT } from "./oauth2-jwt";
import { clearBasisAuthUserSession, readBasisAuthUserSession } from "./basis-auth-session";

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
    const hasBearer = Boolean(getHeader(event, "authorization"));
    if (!hasBearer && !readBasisAuthUserSession(event)) return undefined;
    try {
        return await requireUser(event);
    } catch (error) {
        // A stale cookie must not turn a public read into a 401. Explicit
        // bearer failures still propagate so API clients see their mistake.
        if (!hasBearer && (error as { statusCode?: number }).statusCode === 401) {
            clearBasisAuthUserSession(event);
            return undefined;
        }
        throw error;
    }
}
