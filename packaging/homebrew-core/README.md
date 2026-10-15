# homebrew-core formula

`brew install grain` (without the tap) needs Grain in [homebrew-core](https://github.com/Homebrew/homebrew-core),
which builds every formula from source on Homebrew's own CI. Each release attaches
`grain-<version>-source.tar.gz`: the source plus the built UI, so that build needs only Rust (no Node),
and users get Homebrew's prebuilt bottle.

To submit or update it after a release:

```bash
packaging/homebrew-core/formula.sh 0.4.0 > grain.rb
brew install --build-from-source ./grain.rb && brew test grain && brew audit --new --formula ./grain.rb
```

Then open a pull request to Homebrew/homebrew-core adding `Formula/g/grain.rb`.

homebrew-core only accepts projects that are reasonably well known (roughly 75+ stars, or 30+ forks or
watchers), so submit once Grain is there. Until then, `brew install pranav2012/tap/grain` (prebuilt
binaries from `dist`) is the Homebrew install.
