#!/usr/bin/env bash
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_FILE="$DESKTOP_DIR/ieast-controller.desktop"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$DESKTOP_FILE"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
  printf 'iEast Controller er fjernet fra programmenuen.\n'
  exit 0
fi

mkdir -p "$DESKTOP_DIR"
printf '%s\n' \
  '[Desktop Entry]' \
  'Type=Application' \
  'Version=1.0' \
  'Name=iEast Controller' \
  'Comment=Styr iEast og Spotify fra KDE' \
  "Exec=\"$PROJECT_DIR/scripts/launch-kde.sh\"" \
  "Icon=$PROJECT_DIR/public/ieast-controller.svg" \
  'Terminal=false' \
  'Categories=AudioVideo;Audio;Player;' \
  'StartupNotify=true' \
  'StartupWMClass=iEastController' \
  > "$DESKTOP_FILE"
chmod 644 "$DESKTOP_FILE"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
command -v kbuildsycoca6 >/dev/null 2>&1 && kbuildsycoca6 >/dev/null 2>&1 || true
command -v kbuildsycoca5 >/dev/null 2>&1 && kbuildsycoca5 >/dev/null 2>&1 || true

printf 'iEast Controller er installeret. Start den fra KDE-programmenuen.\n'
printf 'Spotify callback: http://127.0.0.1:3000/api/spotify/callback\n'
