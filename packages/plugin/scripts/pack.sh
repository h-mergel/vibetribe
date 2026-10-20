#!/usr/bin/env bash
# Validates and packs the built plugin into dist/ for the Marketplace. `streamdeck pack` rewrites the
# manifest of the folder it packs, so it works on a copy in dist/stage, never on the source folder.
# Run from WSL after `pnpm plugin:build` (`pnpm plugin:pack` does both).
set -euo pipefail
cd "$(dirname "$0")/../../.."
UUID=dev.h2k.vibetribe
STAGE=dist/stage
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -r "packages/plugin/$UUID.sdPlugin" "$STAGE/"
streamdeck validate "$STAGE/$UUID.sdPlugin"
streamdeck pack --force --output dist "$STAGE/$UUID.sdPlugin"
