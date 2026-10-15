#!/usr/bin/env bash
# Prints the homebrew-core formula for a released version, with the version and the
# source tarball's checksum from the GitHub Release filled in. Usage: formula.sh 0.4.0
set -euo pipefail
version="${1:?usage: formula.sh <version, e.g. 0.4.0>}"
url="https://github.com/pranav2012/grain/releases/download/v${version}/grain-${version}-source.tar.gz"
sha=$(curl -fsSL "$url" | shasum -a 256 | cut -d' ' -f1)
sed -e "s/@VERSION@/${version}/g" -e "s/@SHA256@/${sha}/" "$(dirname "$0")/grain.rb.in"
