const JSON_PARSE_ARGUMENT = /\bJSON\s*\.\s*parse\s*\(\s*("(?:\\.|[^"\\])*")\s*\)/gs;

export function parseNuxtIconCollections(bundleSource) {
    for (const match of bundleSource.matchAll(JSON_PARSE_ARGUMENT)) {
        try {
            const collectionSource = JSON.parse(match[1]);
            const collections = JSON.parse(collectionSource);
            if (
                Array.isArray(collections) &&
                collections.length > 0 &&
                collections.every(
                    (collection) =>
                        typeof collection?.prefix === "string" &&
                        collection.icons !== null &&
                        typeof collection.icons === "object" &&
                        !Array.isArray(collection.icons),
                )
            ) {
                return collections;
            }
        } catch {
            // Try the next JSON.parse call in the generated client bundle.
        }
    }

    throw new Error("Nuxt Icon client bundle did not contain a serialized icon collection array.");
}
