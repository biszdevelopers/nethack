import { describe, expect, it } from "vitest";
import { getJudgingQueueScanRanges } from "../../app/utils/judging-queue";

describe("getJudgingQueueScanRanges", () => {
    it("scans forward from the current page, then wraps through earlier pages", () => {
        expect(getJudgingQueueScanRanges(2, 3, 4)).toEqual([
            { page: 2, fromIndex: 3 },
            { page: 3, fromIndex: 0 },
            { page: 4, fromIndex: 0 },
            { page: 1, fromIndex: 0 },
            { page: 2, fromIndex: 0, untilIndex: 3 },
        ]);
    });

    it("scans the current page from its first project when starting at index zero", () => {
        expect(getJudgingQueueScanRanges(1, 0, 1)).toEqual([{ page: 1, fromIndex: 0 }]);
    });

    it.each([
        [
            0,
            0,
            3,
            [
                { page: 1, fromIndex: 0 },
                { page: 2, fromIndex: 0 },
                { page: 3, fromIndex: 0 },
            ],
        ],
        [
            7,
            1,
            3,
            [
                { page: 3, fromIndex: 1 },
                { page: 1, fromIndex: 0 },
                { page: 2, fromIndex: 0 },
                { page: 3, fromIndex: 0, untilIndex: 1 },
            ],
        ],
    ])("normalizes start page %i and index %i", (startPage, startIndex, pages, expected) => {
        expect(getJudgingQueueScanRanges(startPage, startIndex, pages)).toEqual(expected);
    });

    it.each([0, -1, 1.5])("returns no ranges for an invalid page count: %s", (pages) => {
        expect(getJudgingQueueScanRanges(1, 0, pages)).toEqual([]);
    });
});
