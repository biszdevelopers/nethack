---
title: Protected Documentation
description: Build, package, and authorize the internal VitePress site at /docs/.
---

# Protected Documentation

The VitePress site builds as part of `bun run build` and is served under `/docs/` by private Nitro routes. The output stays outside Nuxt's `public/` directory. The VPS release packager copies it to the release's `docs/` directory, and a source checkout serves `documentation/.vitepress/dist/`.

Every `/docs` request, including HTML pages, stylesheets, scripts, images, fonts, and deep links, requires `nethack.Judging.assignmentsRead` or the administrator grant `nethack.all`. A judge can navigate directly to `/docs/`. Only administrator portal navigation exposes the docs link; public navigation does not.

The administrator portal embeds the same protected site at `/developers/docs` in a full-height same-origin iframe. The docs routes therefore send `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` instead of `DENY`/`'none'`; every other application route keeps the strict frame-deny policy. The docs theme detects whether it is inside a frame and shows **Portal** (`/developers`, `target="_top"`) when embedded or **Home** (`/`) when opened directly, so the action returns the outer window instead of loading a frame-denied route inside the iframe. The `/developers/docs` page offers **Open in new tab** for the standalone `/docs/` experience.

The routes set `Cache-Control: private, no-store` and reject path traversal. Do not publish the VitePress output under Nuxt `public/` or a separate web server path, since those paths would not pass through the permission check.

VitePress uses `base: "/docs/"`; its generated asset URLs therefore remain inside the protected route. Deployments must build docs before packaging and keep the `docs/` directory beside `.output/` in the release bundle.
