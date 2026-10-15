# grain website

The landing page and docs at https://grain.pranav-agarwal.com.

- Built with [Fumadocs](https://fumadocs.dev) on Next.js, exported as static HTML to `out/`.
- Docs pages live in `content/docs/` (sidebar order in each `meta.json`); the home page is `app/(home)/page.tsx`.
- `public/` is copied as is: icons, the social image and `_headers`.
- `scripts/csp.mjs` runs after `next build`: the Content-Security-Policy allows inline scripts only by hash, so it hashes every inline script in `out/` and fills them into `out/_headers`.

## Local development

The site is its own pnpm project (`pnpm-workspace.yaml` and `pnpm-lock.yaml` live here). In `website/`, run `pnpm install` once, then:

```sh
pnpm dev          # Next dev server
pnpm build        # out/, with the CSP hashes filled in
pnpm preview      # wrangler dev: the built site as Cloudflare serves it; no Cloudflare login needed
pnpm types:check
```

## Deploying

The site is the `grain-site` Cloudflare Worker, serving `out/` as static assets (`wrangler.toml` holds the custom domain and the assets setup).

Deploy from your machine (needs `npx wrangler login` once):

```sh
pnpm run deploy   # builds, then uploads the grain-site Worker and its assets
```

The Worker is also connected to GitHub (Workers Builds), which only builds `main`. Its settings: root directory `website`, build command `pnpm install --frozen-lockfile && pnpm build`, deploy command `npx wrangler deploy`, build watch path `website/*`, build variables `SKIP_DEPENDENCY_INSTALL=1`, `NODE_VERSION=24`, `PNPM_VERSION=12.8.1`.

Website-only changes skip grain's Rust and UI checks and never cut a grain release. PRs that touch `website/` get a build check (`.github/workflows/website.yml`).
