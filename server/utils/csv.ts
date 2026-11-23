/**
 * Serialize one CSV cell and neutralize spreadsheet formulas. Participant names
 * and project text reach exports, so a leading `=`, `+`, `-`, or `@` must never
 * be interpreted by a spreadsheet application.
 */
export function csvCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
    const hasFormulaPrefix = /^[\s\p{Cc}]*[=+\-@]/u.test(raw);
    const startsWithSpreadsheetControl = /^[\t\r]/.test(raw);
    const safe = hasFormulaPrefix || startsWithSpreadsheetControl ? `'${raw}` : raw;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
