import { performance } from "node:perf_hooks";

export function maximum(values) {
    const numericValues = values.filter((value) => Number.isFinite(value));
    return numericValues.length ? Math.max(...numericValues) : null;
}

export async function sampleAtInterval({
    durationMs,
    intervalMs = 1_000,
    sample,
    onSample,
    onError,
    shouldStop = () => false,
    now = () => performance.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
    const deadline = now() + durationMs;
    let nextSampleAt = now();

    while (now() < deadline && !shouldStop()) {
        try {
            onSample(await sample());
        } catch (error) {
            onError(error);
        }

        nextSampleAt += intervalMs;
        const delay = nextSampleAt - now();
        if (delay > 0) {
            await sleep(delay);
        } else {
            nextSampleAt = now();
        }
    }
}
