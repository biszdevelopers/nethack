import type { DrizzleDatabase } from "~~/server/database";
import type { Hackathon, User } from "~~/shared/database";

declare module "h3" {
    interface H3EventContext {
        /** Process-wide PostgreSQL Drizzle instance. */
        drizzle: DrizzleDatabase;
        /** Per-response nonce shared by the CSP header and Nuxt SSR scripts. */
        cspNonce?: string;
        /** Local user row resolved once while validating the current access token. */
        basisAuthValidatedUser?: { subject: string; user: User };
        /** Per-request merged hackathon state, reused by repeated read helpers. */
        cachedHackathon?: Hackathon | null;
    }
}

export default {};
