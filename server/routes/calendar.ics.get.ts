import { getEventState } from "~~/server/utils/event-state";

const encoder = new TextEncoder();

/** RFC 5545 TEXT escaping. */
function escapeIcsText(value: string): string {
    return value
        .replaceAll("\\", "\\\\")
        .replaceAll(";", "\\;")
        .replaceAll(",", "\\,")
        .replace(/\r?\n/g, "\\n");
}

/** UTC DATE-TIME form: YYYYMMDDTHHMMSSZ. */
function formatIcsDate(timestamp: number): string {
    return new Date(timestamp)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
}

/** Fold content lines at 75 UTF-8 octets, never splitting a code point. */
function foldLine(line: string): string {
    let output = "";
    let current = "";
    let octets = 0;
    for (const character of line) {
        const size = encoder.encode(character).length;
        if (octets + size > 75) {
            output += `${current}\r\n `;
            current = character;
            octets = 1 + size;
        } else {
            current += character;
            octets += size;
        }
    }
    return output + current;
}

export default defineEventHandler(async (event) => {
    const state = await getEventState(event);
    const hackathon = state.hackathon;
    const seasonName = state.season?.name?.trim() || "The hackathon";

    const milestones = hackathon
        ? [
              {
                  suffix: "event-start",
                  summary: `${seasonName}: event starts`,
                  timestamp: hackathon.start_timestamp,
              },
              {
                  suffix: "submissions-close",
                  summary: `${seasonName}: submissions close`,
                  timestamp: hackathon.end_timestamp,
              },
              {
                  suffix: "voting-start",
                  summary: `${seasonName}: peer voting opens`,
                  timestamp: hackathon.voting_start_timestamp,
              },
              {
                  suffix: "voting-end",
                  summary: `${seasonName}: peer voting closes`,
                  timestamp: hackathon.voting_end_timestamp,
              },
              {
                  suffix: "results-open",
                  summary: `${seasonName}: results published`,
                  timestamp: hackathon.results_open_timestamp,
              },
          ]
        : [];

    const dtstamp = formatIcsDate(Date.now());
    const eventLines = milestones
        .filter((milestone) => Number.isFinite(milestone.timestamp) && milestone.timestamp > 0)
        .flatMap((milestone) => {
            const uid = `basishacks-season-${state.season?.id ?? "none"}-${milestone.suffix}`;
            return [
                "BEGIN:VEVENT",
                `UID:${escapeIcsText(uid)}`,
                `DTSTAMP:${dtstamp}`,
                `DTSTART:${formatIcsDate(milestone.timestamp)}`,
                `DTEND:${formatIcsDate(milestone.timestamp + 30 * 60 * 1000)}`,
                `SUMMARY:${escapeIcsText(milestone.summary)}`,
                "END:VEVENT",
            ];
        });

    const body = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//basishacks//Event Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        ...eventLines,
        "END:VCALENDAR",
    ]
        .map(foldLine)
        .join("\r\n");

    setHeader(event, "content-type", "text/calendar; charset=utf-8");
    setHeader(event, "cache-control", "no-store");
    return `${body}\r\n`;
});
