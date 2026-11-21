export type DateInput = Date | string | number | null | undefined;

/** Every participant-facing timestamp is rendered in this zone. */
export const DISPLAY_TIME_ZONE = "Asia/Shanghai";
/** Short label shown next to rendered timestamps. */
export const DISPLAY_TIME_ZONE_LABEL = "UTC+8";
/** Asia/Shanghai has no DST, so a fixed offset keeps form conversions exact. */
const DISPLAY_UTC_OFFSET = "+08:00";

/**
 * Converts values commonly returned by APIs and form controls into a valid
 * native Date. Invalid or missing values are represented as null so callers
 * never invoke Date methods on an incompatible value.
 */
export function toValidDate(value: DateInput): Date | null {
    if (value === null || value === undefined || value === "") return null;

    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Formats a timestamp in the display zone so server and browser agree. */
export function formatDateTime(value: DateInput): string {
    const date = toValidDate(value);
    if (!date) return "Date unavailable";

    return toDateTimeLocalString(date).replace("T", " ");
}

/** Builds a `datetime-local` value from the display zone, not the browser zone. */
export function toDateTimeLocalString(value: DateInput): string {
    const date = toValidDate(value);
    if (!date) return "";

    // sv-SE formats as `YYYY-MM-DD HH:mm`, so only the separator needs swapping.
    return new Intl.DateTimeFormat("sv-SE", {
        timeZone: DISPLAY_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    })
        .format(date)
        .replace(/\s/, "T");
}

/** Parses a `datetime-local` value as display-zone time and returns epoch ms. */
export function fromDateTimeLocalString(value: string): number {
    if (!value) return 0;

    // `datetime-local` omits seconds by default, but a browser may include them.
    const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
    const timestamp = Date.parse(`${withSeconds}${DISPLAY_UTC_OFFSET}`);
    return Number.isNaN(timestamp) ? 0 : timestamp;
}
