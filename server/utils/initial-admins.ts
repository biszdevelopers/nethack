/** Accounts that always retain administrator access and cannot be demoted. */
export const INITIAL_ADMIN_EMAILS = [
    "zhiyu.jiang90454-bisz@basischina.com",
    "chunping.wong12024-bisz@basischina.com",
    "michael.davison@basis-global.com",
    "cindy.cheng-bisz@basischina.com",
] as const;

const INITIAL_ADMIN_EMAIL_SET = new Set<string>(INITIAL_ADMIN_EMAILS);

export function isInitialAdminEmail(email: string | null | undefined): boolean {
    const normalized = email?.trim().toLowerCase();
    return !!normalized && INITIAL_ADMIN_EMAIL_SET.has(normalized);
}
