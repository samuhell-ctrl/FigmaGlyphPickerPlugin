#!/bin/bash
# =====================================================================
#  Figma Glyph Font Server - macOS installer / updater
#
#  HOW TO RUN: double-click this file.
#
#  It will:
#    1. quit any running copy of the server
#    2. find every old copy on this Mac and remove it
#    3. install this version into ~/Applications
#    4. clear the quarantine flag so macOS does not block it
#    5. start it and confirm the version
#
#  Old copies matter: each one registers itself to launch at login, so a
#  stale copy can win the race for port 3000 and serve outdated fonts.
# =====================================================================

set -u

APP_NAME="Figma Glyph Font Server.app"
DEST_DIR="$HOME/Applications"
SERVER_URL="http://localhost:3000"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say()  { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
warn() { printf '    !! %s\n' "$*"; }

say "========================================================"
say "  Figma Glyph Font Server - installer"
say "========================================================"

# ---------------------------------------------------------------------
# Locate the .app shipped alongside this script.
# ---------------------------------------------------------------------
SOURCE_APP=""
for CANDIDATE in "$HERE/$APP_NAME" "$HERE/../$APP_NAME"; do
    if [ -d "$CANDIDATE" ]; then
        SOURCE_APP="$(cd "$CANDIDATE" && pwd)"
        break
    fi
done

if [ -z "$SOURCE_APP" ]; then
    warn "Could not find \"$APP_NAME\" next to this script."
    warn "Keep this file in the same folder as the app and run it again."
    say ""
    read -r -p "Press Return to close. " _
    exit 1
fi

NEW_VERSION="$(defaults read "$SOURCE_APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null)"
say "Installing version: ${NEW_VERSION:-unknown}"
say "Source:             $SOURCE_APP"

# ---------------------------------------------------------------------
step "1. Stopping any running server"
RUNNING_PIDS="$(pgrep -f "$APP_NAME/Contents/MacOS/" 2>/dev/null)"
if [ -n "$RUNNING_PIDS" ]; then
    osascript -e 'quit app "Figma Glyph Font Server"' 2>/dev/null
    sleep 2
    # Anything that ignored the polite request.
    STILL="$(pgrep -f "$APP_NAME/Contents/MacOS/" 2>/dev/null)"
    if [ -n "$STILL" ]; then
        say "    forcing stop"
        # shellcheck disable=SC2086
        kill $STILL 2>/dev/null
        sleep 1
    fi
    say "    stopped"
else
    say "    nothing was running"
fi

# Release port 3000 if something else is still holding it.
PORT_PID="$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null | head -1)"
if [ -n "$PORT_PID" ]; then
    PORT_CMD="$(ps -p "$PORT_PID" -o comm= 2>/dev/null)"
    warn "port 3000 is still held by PID $PORT_PID ($PORT_CMD)"
    warn "if that is not this app, close it before continuing"
fi

# ---------------------------------------------------------------------
step "2. Removing old copies"
FOUND_LIST="$(mdfind "kMDItemFSName == '$APP_NAME'" 2>/dev/null)"
# Spotlight misses unindexed locations, so check the usual spots directly.
for EXTRA in "$DEST_DIR/$APP_NAME" "/Applications/$APP_NAME"; do
    [ -d "$EXTRA" ] && FOUND_LIST="$FOUND_LIST
$EXTRA"
done

REMOVED=0
SEEN=""
while IFS= read -r OLD; do
    [ -z "$OLD" ] && continue
    [ ! -d "$OLD" ] && continue
    OLD_ABS="$(cd "$OLD" 2>/dev/null && pwd)" || continue
    # Never delete the copy we are installing from.
    [ "$OLD_ABS" = "$SOURCE_APP" ] && continue
    case "$SEEN" in *"[$OLD_ABS]"*) continue ;; esac
    SEEN="$SEEN[$OLD_ABS]"

    OLD_VER="$(defaults read "$OLD_ABS/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null)"
    say "    removing ${OLD_VER:-?}  $OLD_ABS"
    if rm -rf "$OLD_ABS" 2>/dev/null; then
        REMOVED=$((REMOVED + 1))
    else
        warn "could not remove $OLD_ABS (permission denied?)"
    fi
done <<EOF
$FOUND_LIST
EOF

if [ "$REMOVED" -eq 0 ]; then
    say "    no old copies found"
else
    say "    removed $REMOVED old copy/copies"
fi

# ---------------------------------------------------------------------
step "3. Installing to $DEST_DIR"
mkdir -p "$DEST_DIR"
TARGET="$DEST_DIR/$APP_NAME"
rm -rf "$TARGET" 2>/dev/null
# ditto preserves the symlinks inside the bundle; cp -R can mangle them.
if ditto "$SOURCE_APP" "$TARGET"; then
    say "    installed at $TARGET"
else
    warn "copy failed"
    read -r -p "Press Return to close. " _
    exit 1
fi

# ---------------------------------------------------------------------
step "4. Clearing the quarantine flag"
if xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null; then
    say "    cleared - no right-click-Open needed"
else
    say "    nothing to clear"
fi

# ---------------------------------------------------------------------
step "5. Starting the server"
open "$TARGET"
say "    waiting for it to come up..."

OK=""
for _ in $(seq 1 30); do
    RUNNING_VERSION="$(curl -s -m 2 "$SERVER_URL/version" 2>/dev/null)"
    if [ -n "$RUNNING_VERSION" ]; then OK="yes"; break; fi
    sleep 1
done

say ""
say "========================================================"
if [ -n "$OK" ]; then
    say "  Done. Server responding:"
    say "    $RUNNING_VERSION"
    case "$RUNNING_VERSION" in
        *"$NEW_VERSION"*) say "  Version matches the one just installed." ;;
        *) warn "expected $NEW_VERSION - another copy may still be running" ;;
    esac
else
    warn "The server did not respond on $SERVER_URL within 30s."
    warn "It may still be scanning fonts on first launch - try again shortly."
    warn "If macOS blocked it, open System Settings > Privacy & Security"
    warn "and allow \"Figma Glyph Font Server\", then run this script again."
fi
say "========================================================"
say ""
say "  Reminder: in Figma, re-import the plugin from this"
say "  bundle's figma-glyph-plugin/manifest.json so the plugin"
say "  files match the server."
say ""
read -r -p "Press Return to close. " _
