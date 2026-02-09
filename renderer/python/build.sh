#!/usr/bin/env bash
set -euo pipefail

NAME="${NAME:-vizmatic-renderer}"
ONEFILE="${ONEFILE:-1}"

info() { printf "[render-build] %s\n" "$1"; }

if ! command -v pyinstaller >/dev/null 2>&1; then
  echo "pyinstaller not found. Install with: pip install pyinstaller" >&2
fi

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
ENTRY="$ROOT_DIR/main.py"
DIST_DIR="$ROOT_DIR/dist"

info "Entry: $ENTRY"
info "Output: $DIST_DIR"

ARGS=(--noconfirm --name "$NAME" --distpath "$DIST_DIR" --workpath "$ROOT_DIR/build" --specpath "$ROOT_DIR")
if [[ "$ONEFILE" == "1" ]]; then ARGS+=(--onefile); fi
[[ -n "${FFMPEG_BIN:-}" ]] && ARGS+=(--add-binary "$FFMPEG_BIN:.")
[[ -n "${FFPROBE_BIN:-}" ]] && ARGS+=(--add-binary "$FFPROBE_BIN:.")

ARGS+=("$ENTRY")

info "pyinstaller ${ARGS[*]}"
( cd "$ROOT_DIR" && pyinstaller "${ARGS[@]}" )

info "Done. Artifacts in $DIST_DIR"
