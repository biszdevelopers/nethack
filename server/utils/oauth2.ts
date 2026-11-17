import { createError } from "h3";

export function getPublicOrigin(): string {
    const origin = process.env.CURRENT_URL_ORIGIN?.trim();
    if (!origin) {
        throw createError({
            statusCode: 500,
            statusMessage: "missing_public_origin",
            message: "CURRENT_URL_ORIGIN must be set before generating public callback URLs.",
        });
    }
    return origin.replace(/\/+$/, "");
}
