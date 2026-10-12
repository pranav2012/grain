# Releasing Grain

Releases are built by [`dist`](https://opensource.axo.dev/cargo-dist/) (the tool uv and ruff use). The configuration is in `dist-workspace.toml`; `.github/workflows/release.yml` is generated from it. Don't edit that workflow by hand: change the config and run `dist generate`.

Pushing a version tag (`v0.1.0`) builds the UI and the binary for every target, creates a GitHub Release with archives, checksums and installers, then publishes to Homebrew and npm.

| Channel | Install command | Published by |
|---|---|---|
| curl (macOS, Linux) | `curl -LsSf https://github.com/pranav2012/grain/releases/latest/download/grain-installer.sh \| sh` | GitHub Release |
| PowerShell (Windows) | `powershell -c "irm https://github.com/pranav2012/grain/releases/latest/download/grain-installer.ps1 \| iex"` | GitHub Release |
| Homebrew | `brew install pranav2012/tap/grain` | `homebrew` publish job |
| npm, pnpm, yarn, bun | `npm i -g grain-ci` · `pnpm add -g grain-ci` · `yarn global add grain-ci` · `bun add -g grain-ci` | `npm` publish job |
| One-off run | `npx grain-ci` · `pnpm dlx grain-ci` · `bunx grain-ci` | `npm` publish job |

Targets: macOS (Apple Silicon, Intel), Linux (x64, arm64, glibc), Windows (x64).

## One-time setup (not done yet)

1. **Make the repository public** (`pranav2012/grain`). Installers download from GitHub Releases, which other people can't reach while the repo is private.
   - The current files contain no secrets or internal names. **Older commits still mention internal repo names** (test examples, spike notes; no code or credentials), about 26 places: see `git log --all -p | grep -iE "acme|widgets|storefront"`. Decide before going public whether that's fine, or start the public repo from a single squashed commit.
2. **Create the Homebrew tap**: an empty public repo `pranav2012/homebrew-tap`.
3. **npm name: `grain-ci`** (`grain` belongs to another author since 2010; `grain-ci` was free on 2026-10-13). Publish soon to hold it. To change it, edit `npm-package` in `dist-workspace.toml` and run `dist generate`. The installed command is `grain` regardless.
4. **Add repository secrets** (Settings → Secrets and variables → Actions):
   - `HOMEBREW_TAP_TOKEN`: a fine-grained token with *Contents: read and write* on `pranav2012/homebrew-tap`.
   - `NPM_TOKEN`: an npm *automation* token from the account that owns the package.

## Cutting a release

1. Make sure `main` is green (`scripts/check.sh`).
2. Bump `version` in the root `Cargo.toml` (`[workspace.package]`), run `cargo build`, and commit `Cargo.toml` and `Cargo.lock`.
3. If the engine's output changed since the last release, make sure `grain_engine::REVIEW_FORMAT` was bumped.
4. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
5. Watch the *Release* workflow. When it's done, try one channel from a clean machine: `grain --version`, then `grain doctor`.

## Trying the release locally

```bash
dist plan                                                      # what a release would contain
dist build --artifacts=all --target aarch64-apple-darwin      # build this machine's artifacts into target/distrib
tar -xJf target/distrib/grain-aarch64-apple-darwin.tar.xz -C /tmp && /tmp/grain-aarch64-apple-darwin/grain doctor
```

Installers built locally still download from the GitHub Release URL, so they only work end to end after a real release.
