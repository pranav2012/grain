# grain website

Landing page and docs, built with [Fumadocs](https://fumadocs.dev) (Next.js, static export). Docs pages live in `content/docs/` (sidebar order in each `meta.json`); the home page is `app/(home)/page.tsx`.

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build    # static site in out/
```

Pushes to `main` that touch `website/` deploy to Cloudflare Pages (`.github/workflows/website.yml`). Website-only changes skip the Rust and UI checks and never cut a grain release.
