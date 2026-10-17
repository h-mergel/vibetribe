#!/usr/bin/env bash
# Copies the built plugin from the WSL repo into the Windows Stream Deck plugin folder. A junction
# cannot point at \\wsl.localhost, so the plugin is copied, not linked. Run from WSL after
# `pnpm plugin:build`; afterwards Stream Deck must be quit completely and started again
# (streamdeck://plugins/restart only works in developer mode).
#
# The new version is staged next to the target ($DEST.new) and swapped in with renames; the old
# files are only deleted after every new file is in place, and are put back if a step fails.
# logs/ (written by the SDK at runtime) is never touched.
#
# Test seams (the tests never touch the real %APPDATA%):
#   VIBETRIBE_DEPLOY_APPDATA_WIN  Windows path used instead of asking cmd.exe for %APPDATA%
#   VIBETRIBE_DEPLOY_SRC          plugin folder to deploy instead of ../dev.h2k.vibetribe.sdPlugin
set -euo pipefail
cd "$(dirname "$0")/.."
UUID=dev.h2k.vibetribe
SRC=${VIBETRIBE_DEPLOY_SRC:-$PWD/$UUID.sdPlugin}
FILES=(bin imgs ui manifest.json)

die() {
  echo "deploy: $*" >&2
  exit 1
}

[ -f "$SRC/bin/plugin.js" ] || die "$SRC/bin/plugin.js missing - run: pnpm plugin:build"
[ -d "$SRC/imgs" ] || die "$SRC/imgs missing - run: pnpm plugin:build"
[ -d "$SRC/ui" ] || die "$SRC/ui missing"
[ -f "$SRC/manifest.json" ] || die "$SRC/manifest.json missing"

if [ -n "${VIBETRIBE_DEPLOY_APPDATA_WIN:-}" ]; then
  APPDATA_WIN=$VIBETRIBE_DEPLOY_APPDATA_WIN
else
  command -v cmd.exe >/dev/null 2>&1 || die "cmd.exe not found - run this from WSL with Windows interop enabled"
  [ -d /mnt/c ] || die "/mnt/c is not mounted - cannot reach the Windows side"
  # cmd.exe refuses a WSL cwd; ask it from a Windows path
  APPDATA_WIN=$( (cd /mnt/c && cmd.exe /c 'echo %APPDATA%' 2>/dev/null) | tr -d '\r' || true)
fi
case $APPDATA_WIN in
  *$'\n'*) die "%APPDATA% is not a single line: refusing to deploy" ;;
  *..*) die "%APPDATA% contains '..': $APPDATA_WIN" ;;
esac
[[ $APPDATA_WIN =~ ^[A-Za-z]:\\ ]] || die "%APPDATA% is not an absolute Windows path (got: '$APPDATA_WIN')"
command -v wslpath >/dev/null 2>&1 || die "wslpath not found - run this from WSL"
PLUGINS="$(wslpath -u "$APPDATA_WIN")/Elgato/StreamDeck/Plugins"
[ -d "$PLUGINS" ] || die "$PLUGINS does not exist - Stream Deck not installed?"

DEST="$PLUGINS/$UUID.sdPlugin"
NEW="$DEST.new"
OLD="$DEST.old"
FIRST_INSTALL=0
[ -d "$DEST" ] || FIRST_INSTALL=1

has_files() { [ -n "$(ls -A "$1" 2>/dev/null)" ]; }

# a leftover $NEW is only ever our own staging; files in a leftover $OLD may be the only copy of
# the previous version (a restore that failed, or a run killed during the swap)
if has_files "$OLD"; then
  die "an earlier deploy left files in $OLD (the previous version): replace bin, imgs, ui and manifest.json in $DEST with those in $OLD, or delete $OLD and deploy again if you want the new build"
fi
rm -rf "${NEW:?}" "${OLD:?}"
# KEEP_OLD=1 while $DEST may be incomplete (from the start of the swap until it or the rollback is done)
KEEP_OLD=0
cleanup() {
  rm -rf "${NEW:?}"
  if [ "$KEEP_OLD" = 1 ] && has_files "$OLD"; then
    echo "deploy: the previous files are kept in $OLD - move them back into $DEST by hand" >&2
  else
    rm -rf "${OLD:?}"
  fi
}
trap cleanup EXIT

# 1. stage a full copy; a failure here leaves the installed version untouched
mkdir "$NEW"
cp -r "$SRC/bin" "$SRC/imgs" "$SRC/ui" "$SRC/manifest.json" "$NEW/" || die "copy failed - the installed plugin was not changed"

# 2. swap: old files out, new files in; every step is a rename
mkdir -p "$DEST"
mkdir "$OLD"
swap() {
  local f
  for f in "${FILES[@]}"; do
    if [ -e "$DEST/$f" ]; then mv "$DEST/$f" "$OLD/$f" || return 1; fi
  done
  for f in "${FILES[@]}"; do
    mv "$NEW/$f" "$DEST/$f" || return 1
  done
}
rollback() {
  local f
  # nothing was installed before: do not leave a half-filled plugin folder behind
  if [ "$FIRST_INSTALL" = 1 ]; then
    rm -rf "${DEST:?}"
    KEEP_OLD=0
    return 0
  fi
  local failed=0
  for f in "${FILES[@]}"; do
    if [ -e "$OLD/$f" ]; then
      rm -rf "${DEST:?}/$f"
      mv "$OLD/$f" "$DEST/$f" || {
        echo "deploy: could not restore $f from $OLD" >&2
        failed=1
      }
    fi
  done
  KEEP_OLD=$failed
}
KEEP_OLD=1
if ! swap; then
  rollback
  if [ "$KEEP_OLD" = 1 ]; then
    die "swapping the new files in failed and the previous version could not be fully restored"
  fi
  if [ "$FIRST_INSTALL" = 1 ]; then
    die "swapping the new files in failed - nothing was installed"
  fi
  die "swapping the new files in failed - the previous version was restored"
fi
KEEP_OLD=0
# 3. only now the old version goes
cleanup

echo "deployed to $DEST"
echo "Quit Stream Deck completely and start it again so the plugin reloads"
