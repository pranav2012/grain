# Releasing Grain

Releases are built by [`dist`](https://opensource.axo.dev/cargo-dist/) (the tool uv and ruff use). The configuration is in `dist-workspace.toml`; `.github/workflows/release.yml` is generated from it. Don't edit that workflow by hand: change the config and run `dist generate`.

Releases are automatic. When CI passes on `main` and the new commits include a `feat`, `fix`, `perf`, `revert` or breaking change (Conventional Commits), the `release` job in `ci.yml` bumps the version, prepends the section to `CHANGELOG.md`, commits `chore(release): vX.Y.Z`, tags it, and starts the *Release* workflow. That builds the UI and the binary for every target, creates a GitHub Release (notes from `CHANGELOG.md`) with archives, checksums and installers, then publishes to Homebrew and npm. Commits that are only `docs`, `chore`, `refactor`, `test`, `ci`, `build` or `style` never release.

Version bumps (before 1.0): `fix`/`perf` → patch (0.1.0 → 0.1.1); `feat` or breaking (`feat!:`) → minor (0.1.1 → 0.2.0). Rules live in `cliff.toml`; `scripts/next-release.sh` prints what the next release would be.

| Channel | Install command | Published by |
|---|---|---|
| curl (macOS, Linux) | `curl -LsSf https://github.com/pranav2012/grain/releases/latest/download/grain-installer.sh \| sh` | GitHub Release |
| PowerShell (Windows) | `powershell -c "irm https://github.com/pranav2012/grain/releases/latest/download/grain-installer.ps1 \| iex"` | GitHub Release |
| Homebrew | `brew install pranav2012/tap/grain` | `homebrew` publish job |
| npm | `npm i -g grain-ci` | `npm` publish job |
| pnpm | `pnpm add -g grain-ci` | `npm` publish job |
| yarn (Yarn 1) | `yarn global add grain-ci` | `npm` publish job |
| bun | `bun add -g grain-ci` | `npm` publish job |
| One-off run | `npx grain-ci` · `pnpm dlx grain-ci` · `yarn dlx grain-ci` · `bunx grain-ci` | `npm` publish job |

Targets: macOS (Apple Silicon, Intel), Linux (x64, arm64, glibc), Windows (x64).

Each release also attaches `grain-<version>-source.tar.gz` (built by `.github/workflows/source-tarball.yml`): the source plus the built UI, so building it needs only Rust, no Node. It is what the homebrew-core formula builds; see `packaging/homebrew-core/README.md`.

## One-time setup (done on 2026-10-13)

- Repository public; history checked for internal names before going public.
- Homebrew tap: public repo `pranav2012/homebrew-tap`.
- npm package: `grain-ci` (`grain` belongs to another author). The installed command is `grain` regardless.
- Repository secrets: `HOMEBREW_TAP_TOKEN` (fine-grained, *Contents: read and write* on the tap) and `NPM_TOKEN` (npm granular token, expires 2027-01-11; rotate it, or move to npm trusted publishing).

## Releasing by hand

Normally nothing is needed. To re-run a release (for example after a failed publish), start the *Release* workflow from the Actions tab with the existing tag (`v0.2.0`), or run `gh workflow run release.yml --ref v0.2.0 -f tag=v0.2.0`. If the engine's output changed, make sure `grain_engine::REVIEW_FORMAT` was bumped in the same change.

## Trying the release locally

```bash
dist plan                                                      # what a release would contain
dist build --artifacts=all --target aarch64-apple-darwin      # build this machine's artifacts into target/distrib
tar -xJf target/distrib/grain-aarch64-apple-darwin.tar.xz -C /tmp && /tmp/grain-aarch64-apple-darwin/grain doctor
```

Installers built locally still download from the GitHub Release URL, so they only work end to end after a real release.
