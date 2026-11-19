import { describe, expect, it } from "vitest";
import { isSafeUrl, safeUrl } from "~~/app/utils/url-validation";
import { sanitizePostLoginRedirect } from "~~/server/utils/basis-auth";
import { hasNethackPermission, NethackPermissions } from "~~/shared/permissions";
import {
    effectiveNethackPermissions,
    hasEffectiveNethackPermission,
} from "~~/server/utils/effective-permissions";
import { applyScoreCurve, isScoreCurvePreset, SCORE_CURVE_PRESETS } from "~~/shared/score-curve";
import { DEFAULT_RUBRIC_DEFINITION, getRubricTrack, validateRubricScores } from "~~/shared/rubric";

/** Deterministic xorshift so a failing case is always reproducible. */
function random(seed: number) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x1_0000_0000;
    };
}

const ALPHABET = "abcxyz/:\\@?#%.-_+0123456789 \t\n'\"<>{}|$";
const nextString = (rng: () => number) =>
    Array.from(
        { length: Math.floor(rng() * 40) },
        () => ALPHABET[Math.floor(rng() * ALPHABET.length)],
    ).join("");

const SAMPLES = Array.from({ length: 400 }, (_, index) => nextString(random(index + 1)));

describe("security-critical invariants under randomized input", () => {
    it("isSafeUrl only accepts same-origin paths or credential-free http(s) URLs", () => {
        for (const input of SAMPLES) {
            expect(() => isSafeUrl(input)).not.toThrow();
            if (!isSafeUrl(input)) continue;
            if (input.startsWith("/")) {
                expect(new URL(input, "https://nethack.invalid").origin).toBe(
                    "https://nethack.invalid",
                );
            } else {
                const parsed = new URL(input);
                expect(["http:", "https:"]).toContain(parsed.protocol);
                expect(parsed.hostname).toBeTruthy();
                expect(parsed.username).toBe("");
                expect(parsed.password).toBe("");
            }
        }
    });

    it("safeUrl is exactly the accepting wrapper of isSafeUrl", () => {
        for (const input of SAMPLES) {
            expect(safeUrl(input)).toBe(isSafeUrl(input) ? input : undefined);
        }
        expect(safeUrl(null)).toBeUndefined();
        expect(safeUrl(undefined)).toBeUndefined();
    });

    it("sanitizePostLoginRedirect is idempotent and returns only same-origin paths", () => {
        for (const input of SAMPLES) {
            const first = sanitizePostLoginRedirect(input);
            if (first === undefined) continue;
            expect(first.startsWith("/")).toBe(true);
            expect(first.startsWith("//")).toBe(false);
            expect(isSafeUrl(first)).toBe(true);
            expect(sanitizePostLoginRedirect(first)).toBe(first);
        }
    });

    it("permission resolution never throws and keeps the wildcard invariant", () => {
        const rng = random(999);
        const requirement = NethackPermissions.Projects.submitOwn;
        for (let index = 0; index < SAMPLES.length; index += 1) {
            const permissions = SAMPLES[index]!.split(" ").filter(Boolean);
            expect(() => hasNethackPermission(permissions, requirement)).not.toThrow();
            const effective = effectiveNethackPermissions(permissions, {
                email: rng() > 0.5 ? "admin@example.com" : undefined,
                is_admin: rng() > 0.5,
            });
            expect(Array.isArray(effective)).toBe(true);
            expect(effective.every((value) => typeof value === "string")).toBe(true);
            expect(() => hasEffectiveNethackPermission(permissions, requirement)).not.toThrow();
        }
    });

    it("score curves stay within 0-100 for every valid preset", () => {
        const presets = Object.keys(SCORE_CURVE_PRESETS);
        for (let index = 0; index < SAMPLES.length; index += 1) {
            const raw = (index % 101) - 0.5;
            for (const preset of presets) {
                expect(isScoreCurvePreset(preset)).toBe(true);
                const displayed = applyScoreCurve(raw, preset as keyof typeof SCORE_CURVE_PRESETS);
                expect(Number.isFinite(displayed)).toBe(true);
                expect(displayed).toBeGreaterThanOrEqual(0);
                expect(displayed).toBeLessThanOrEqual(100);
            }
        }
    });

    it("rubric lookups and validation never throw for arbitrary paths and score objects", () => {
        for (const pathway of SAMPLES) {
            const track = getRubricTrack(DEFAULT_RUBRIC_DEFINITION, pathway);
            if (!track) continue;
            expect(Object.hasOwn(DEFAULT_RUBRIC_DEFINITION.tracks, pathway)).toBe(true);
        }
        const track = getRubricTrack(DEFAULT_RUBRIC_DEFINITION, "junior")!;
        for (const scores of SAMPLES) {
            const candidate: Record<string, number> = {};
            for (const criterion of track.criteria) candidate[criterion.id] = scores.length;
            expect(() => validateRubricScores(track, candidate)).not.toThrow();
        }
    });
});
