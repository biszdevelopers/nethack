export interface JudgingQueueScanRange {
    page: number;
    fromIndex: number;
    untilIndex?: number;
}

/** List page slices after the current project, then wrap to earlier unfinished queue entries. */
export function getJudgingQueueScanRanges(
    startPage: number,
    startIndex: number,
    totalPages: number,
): JudgingQueueScanRange[] {
    if (!Number.isInteger(totalPages) || totalPages < 1) return [];

    const firstPage = Math.min(Math.max(Math.trunc(startPage), 1), totalPages);
    const firstIndex = Math.max(Math.trunc(startIndex), 0);
    const ranges: JudgingQueueScanRange[] = [];

    for (let page = firstPage; page <= totalPages; page += 1) {
        ranges.push({ page, fromIndex: page === firstPage ? firstIndex : 0 });
    }

    for (let page = 1; page <= firstPage; page += 1) {
        if (page === firstPage && firstIndex === 0) continue;
        ranges.push({
            page,
            fromIndex: 0,
            ...(page === firstPage ? { untilIndex: firstIndex } : {}),
        });
    }

    return ranges;
}
