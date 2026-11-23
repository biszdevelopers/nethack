/**
 * Built-in fallback for deployments that predate INITIAL_ADMIN_EMAILS. It is
 * only used while the environment variable is unset or empty so existing
 * installations keep their administrators.
 */
export const DEFAULT_INITIAL_ADMIN_EMAILS = [
    "zhiyu.jiang90454-bisz@basischina.com",
    "chunping.wong12024-bisz@basischina.com",
    "michael.davison@basis-global.com",
    "cindy.cheng-bisz@basischina.com",
] as const;

/** Parse a comma-separated allowlist, trimming and lowercasing every entry. */
export function parseInitialAdminEmails(value: string | null | undefined): string[] {
    const emails = (value ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0);
    return [...new Set(emails)];
}

const configuredInitialAdminEmails = process.env.INITIAL_ADMIN_EMAILS?.trim();

/** Configured initial administrators, or the built-in list when unset. */
export const INITIAL_ADMIN_EMAILS: readonly string[] =
    configuredInitialAdminEmails === undefined || configuredInitialAdminEmails === ""
        ? [...DEFAULT_INITIAL_ADMIN_EMAILS]
        : parseInitialAdminEmails(configuredInitialAdminEmails);

const INITIAL_ADMIN_EMAIL_SET = new Set<string>(INITIAL_ADMIN_EMAILS);

export function isInitialAdminEmail(email: string | null | undefined): boolean {
    const normalized = email?.trim().toLowerCase();
    return !!normalized && INITIAL_ADMIN_EMAIL_SET.has(normalized);
}
