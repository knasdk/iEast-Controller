#!/usr/bin/env bash
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
APP_PORT="${IEAST_PORT:-3000}"
APP_URL="http://127.0.0.1:$APP_PORT/"
CALLBACK_URL="${APP_URL}api/spotify/callback"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/ieast-controller"
BROWSER_DATA_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/ieast-controller/browser"
LOG_FILE="$STATE_DIR/server.log"

fail() {
  if command -v kdialog >/dev/null 2>&1; then
    kdialog --error "$1"
  else
    printf '%s\n' "$1" >&2
  fi
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js 18 eller nyere er ikke installeret."
command -v curl >/dev/null 2>&1 || fail "curl er ikke installeret."
[ "$(node -p 'Number(process.versions.node.split(".")[0]) >= 18')" = "true" ] || fail "Node.js 18 eller nyere er påkrævet."
case "$APP_PORT" in
  ''|*[!0-9]*) fail "IEAST_PORT skal være et gyldigt portnummer." ;;
esac
[ "$APP_PORT" -ge 1 ] && [ "$APP_PORT" -le 65535 ] || fail "IEAST_PORT skal være mellem 1 og 65535."

if [ -n "${IEAST_BROWSER:-}" ]; then
  command -v "$IEAST_BROWSER" >/dev/null 2>&1 || fail "Browseren '$IEAST_BROWSER' blev ikke fundet."
  browser="$IEAST_BROWSER"
  browser_type="command"
else
  browser=""
  browser_type="command"
  for candidate in chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      browser="$candidate"
      break
    fi
  done
  if [ -z "$browser" ] && command -v flatpak >/dev/null 2>&1 && flatpak info com.brave.Browser >/dev/null 2>&1; then
    browser="com.brave.Browser"
    browser_type="flatpak"
    BROWSER_DATA_DIR="$HOME/.var/app/com.brave.Browser/config/ieast-controller/browser"
  fi
  if [ -z "$browser" ]; then
    for candidate in google-chrome google-chrome-stable; do
      if command -v "$candidate" >/dev/null 2>&1; then
        browser="$candidate"
        break
      fi
    done
  fi
  [ -n "$browser" ] || fail "Installér Chromium eller Google Chrome for at bruge KDE-appen."
fi

mkdir -p "$STATE_DIR" "$BROWSER_DATA_DIR"
chmod 700 "$STATE_DIR" "$BROWSER_DATA_DIR"
: > "$LOG_FILE"

if curl --silent --fail --max-time 1 "$APP_URL" >/dev/null 2>&1; then
  fail "Port $APP_PORT bruges allerede af en webserver. Stop den før KDE-appen startes."
fi

HOST=127.0.0.1 \
PORT="$APP_PORT" \
STATE_DIR="$STATE_DIR" \
SPOTIFY_REDIRECT_URI="$CALLBACK_URL" \
node "$PROJECT_DIR/server.js" >"$LOG_FILE" 2>&1 &
server_pid=$!

cleanup() {
  trap - EXIT INT TERM
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

attempt=0
while [ "$attempt" -lt 50 ]; do
  if curl --silent --fail --max-time 1 "$APP_URL" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    fail "iEast Controller kunne ikke starte. Se loggen: $LOG_FILE"
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done

[ "$attempt" -lt 50 ] || fail "iEast Controller svarede ikke. Se loggen: $LOG_FILE"

browser_args=(
  "--app=$APP_URL"
  "--class=iEastController"
  "--no-first-run"
  "--ozone-platform=x11"
  "--user-data-dir=$BROWSER_DATA_DIR"
)

if [ "$browser_type" = "flatpak" ]; then
  flatpak run "$browser" "${browser_args[@]}"
else
  "$browser" "${browser_args[@]}"
fi
