---
title: Documentation Site
description: Theme, interactive components, and live dependency tables for the nethack VitePress docs.
---

# Documentation Site

This site is built with [VitePress](https://vitepress.dev) and a custom theme that mirrors the main application. The theme lives in `documentation/.vitepress/theme/`.

## Typography and Color

The docs use the same **Monaspace Neon** webfont as the application. The font file in `documentation/public/fonts/` is served under `/docs/fonts/` and declared with `@font-face` in `documentation/.vitepress/theme/style.css`. The `--bh-font-mono` and `--bh-font-display` tokens therefore match the app shell, and VitePress's own `--vp-font-family-base` / `--vp-font-family-mono` variables point at the same stack.

The dark palette mirrors the application surface (`#0a0f1a` background, `#111827` panels, `#22c55e` primary). All colors are exposed as `--bh-*` custom properties so both light and dark modes stay consistent.

## Theme Components

Components are registered globally, so any markdown page can use them.

### StatusBadge

Show a colored status pill:

```md
<StatusBadge status="online" text="System Online" />
<StatusBadge status="warn" text="Deprecated" />
<StatusBadge status="error" text="Offline" />
<StatusBadge status="info" text="Beta" />
```

### TerminalWindow

Wrap shell snippets in a terminal chrome:

````md
<TerminalWindow title="nethack@api-test:~" prompt="$">

```bash
curl -s https://localhost:24598/api/health
```

</TerminalWindow>
````

### CopyButton

Add a copy-to-clipboard button next to a command:

```md
<CopyButton content="bun i" label="copy install command" />
```

### CollapsibleDetails

Hide extra detail behind an animated disclosure:

```md
<CollapsibleDetails summary="Expand: advanced options">

Hidden content goes here.

</CollapsibleDetails>
```

### AnimatedCounter

Animate a number on page load:

```md
<AnimatedCounter :target="54" suffix="endpoints" />
```

### QuoteCycler

Click to cycle through programming and hackathon quotes:

```md
<QuoteCycler />
```

### PackageVersions

Render live dependency tables parsed from the root `package.json`. The data is loaded at build time by `documentation/.vitepress/data/packageVersions.data.ts`, so the tables update automatically whenever `package.json` changes and the documentation is rebuilt or the dev server restarts.

```md
<PackageVersions />
```

### TestCount

Render the authoritative test count from `tests/.test-meta.json`:

```md
<TestCount />
```

The value is loaded by `documentation/.vitepress/data/tests.data.ts` and refreshes when the metadata file changes.

The component displays:

- Production dependencies
- Development dependencies
- npm `overrides` (if any)
- A timestamp showing when the data was generated
- A search field for filtering packages by name or version

## Customizing the Theme

- Global styles: `documentation/.vitepress/theme/style.css`
- Component source: `documentation/.vitepress/theme/components/`
- Component registration: `documentation/.vitepress/theme/index.ts`

The CSS uses CSS custom properties prefixed with `--bh-*` and overrides VitePress's own variables for consistent light/dark modes.

## Live Dependency Data

Dependency versions are not hard-coded in the documentation. Instead, VitePress's [data loaders](https://vitepress.dev/guide/data-loaders) read the repository's `package.json` at build time.

The loader is defined in `documentation/.vitepress/data/packageVersions.data.ts`:

```ts
export default defineLoader({
    watch: [resolve(import.meta.dirname, "../../../package.json")],
    load(): PackageVersionsData {
        // Read and parse package.json
        // Return dependencies, devDependencies, overrides, and generatedAt
    },
});
```

Because the `watch` array includes `package.json`, VitePress reloads the data whenever the file changes during `npm run dev` and re-reads it during `npm run build`.
