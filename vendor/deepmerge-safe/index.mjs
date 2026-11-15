const isPlainObject = (value) => {
    if (value === null || typeof value !== "object") return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

const setOwn = (target, key, value) => {
    Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
    });
};

const clone = (value) => {
    if (Array.isArray(value)) return value.map(clone);
    if (!isPlainObject(value)) return value;

    const result = Object.create(Object.getPrototypeOf(value));
    for (const key of Object.keys(value)) setOwn(result, key, clone(value[key]));
    return result;
};

function deepmerge(target, source) {
    if (Array.isArray(target) && Array.isArray(source)) {
        return [...target.map(clone), ...source.map(clone)];
    }
    if (!isPlainObject(target) || !isPlainObject(source)) return clone(source);

    const result = Object.create(Object.getPrototypeOf(target));
    for (const key of Object.keys(target)) setOwn(result, key, clone(target[key]));
    for (const key of Object.keys(source)) {
        const value =
            Object.hasOwn(target, key) &&
            ((isPlainObject(target[key]) && isPlainObject(source[key])) ||
                (Array.isArray(target[key]) && Array.isArray(source[key])))
                ? deepmerge(target[key], source[key])
                : clone(source[key]);
        setOwn(result, key, value);
    }
    return result;
}

export default deepmerge;
