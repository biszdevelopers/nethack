import type { DrizzleDatabase } from "~~/server/database";

declare module "h3" {
    interface H3EventContext {
        /** Process-wide PostgreSQL Drizzle instance. */
        drizzle: DrizzleDatabase;
        /** Per-response nonce shared by the CSP header and Nuxt SSR scripts. */
        cspNonce?: string;
    }
}

export default {};
