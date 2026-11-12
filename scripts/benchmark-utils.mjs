export function maximum(values) {
    const numericValues = values.filter((value) => Number.isFinite(value));
    return numericValues.length ? Math.max(...numericValues) : null;
}
