#!/bin/bash
# =====================================================================
#  Local Glyph Picker - diagnostic collector (macOS)
#
#  HOW TO RUN: double-click this file.
#  If macOS refuses, right-click it > Open, or open Terminal and run:
#      bash ~/Downloads/glyph-diagnose.command
#
#  This script only READS. It changes nothing and installs nothing.
#  It writes one report file to your Desktop. Send that file back.
#
#  Optional - pass the font that is failing:
#      bash glyph-diagnose.command "Owners Round Text VF"
# =====================================================================

FONT_FAMILY="${1:-Owners Round Text VF}"
SERVER="${GLYPH_SERVER:-http://localhost:3000}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$HOME/Desktop/glyph-picker-diagnostic-$STAMP.txt"

# Loose grep needle: first word of the family, lowercased.
NEEDLE="$(printf '%s' "$FONT_FAMILY" | awk '{print tolower($1)}')"
[ -z "$NEEDLE" ] && NEEDLE="owners"
# Same family with spaces stripped, for filename matching.
SQUASHED="$(printf '%s' "$FONT_FAMILY" | tr -d ' ')"

exec 3>&1
exec >"$OUT" 2>&1

section() {
  echo ""
  echo "=============================================================="
  echo "  $1"
  echo "=============================================================="
}
note() { echo "   -> $1"; }

# ---------------------------------------------------------------------
section "0. REPORT HEADER"
echo "generated      : $(date)"
echo "font requested : $FONT_FAMILY"
echo "grep needle    : $NEEDLE"
echo "user           : $(whoami)"
echo "host           : $(hostname)"
echo ""
sw_vers 2>/dev/null
uname -m 2>/dev/null

# ---------------------------------------------------------------------
section "1. IS THE SERVER RUNNING, AND WHICH VERSION?"
HTTP_V="$(curl -s -m 5 -o /tmp/_gp_version.txt -w '%{http_code}' "$SERVER/version" 2>/dev/null)"
if [ "$HTTP_V" = "200" ]; then
  echo "server reachable : YES"
  echo "/version         : $(cat /tmp/_gp_version.txt 2>/dev/null)"
  note "This is the REAL server version."
  note "The version badge inside the plugin UI is hardcoded in the HTML"
  note "and does NOT reflect which server is actually running."
else
  echo "server reachable : NO   (curl status '$HTTP_V')"
  note "Nothing answered on $SERVER."
  note "Check for the Figma Glyph Font Server icon in the menu bar."
fi
rm -f /tmp/_gp_version.txt

echo ""
echo "--- process listening on port 3000 ---"
lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null || echo "(nothing listening on port 3000)"

# ---------------------------------------------------------------------
section "2. WHAT THE SERVER HAS INDEXED"
curl -s -m 60 "$SERVER/fonts" -o /tmp/_gp_fonts.json 2>/dev/null
if [ -s /tmp/_gp_fonts.json ]; then
  TOTAL="$(grep -o '"totalFamilies":[0-9]*' /tmp/_gp_fonts.json | head -1 | cut -d: -f2)"
  echo "totalFamilies indexed : ${TOTAL:-unknown}"
  echo ""
  echo "--- indexed families matching '$NEEDLE' ---"
  MATCHES="$(grep -o '"[^"]*":{' /tmp/_gp_fonts.json | sed 's/":{$//' | sed 's/^"//' | grep -i "$NEEDLE")"
  if [ -n "$MATCHES" ]; then
    echo "$MATCHES"
    echo ""
    echo "--- styles and file paths for those families ---"
    tr '}' '\n' < /tmp/_gp_fonts.json | grep -i "$NEEDLE" | head -40
  else
    echo "(NONE)"
    note "Not in the startup index. The server may still find it via its"
    note "on-demand fallback scan - section 3 and 3b below settle that."
  fi
else
  echo "(could not read $SERVER/fonts)"
fi

# ---------------------------------------------------------------------
section "3. ASKING THE SERVER FOR THE FAILING FONT"
for STYLE in "770" "Regular" "Bold" "Black"; do
  CODE="$(curl -s -m 60 -G -o /tmp/_gp_glyphs.json -w '%{http_code}' \
          --data-urlencode "family=$FONT_FAMILY" \
          --data-urlencode "style=$STYLE" \
          "$SERVER/get-glyphs" 2>/dev/null)"
  echo ""
  echo "request style='$STYLE'  ->  HTTP $CODE"
  if [ -s /tmp/_gp_glyphs.json ]; then
    GCOUNT="$(grep -o '"unicode":' /tmp/_gp_glyphs.json | wc -l | tr -d ' ')"
    ERRMSG="$(grep -o '"error":"[^"]*"' /tmp/_gp_glyphs.json | head -1)"
    RESF="$(grep -o '"fontFamily":"[^"]*"' /tmp/_gp_glyphs.json | head -1)"
    RESS="$(grep -o '"style":"[^"]*"' /tmp/_gp_glyphs.json | head -1)"
    [ -n "$ERRMSG" ] && echo "   $ERRMSG"
    [ -n "$RESF" ]   && echo "   served $RESF"
    [ -n "$RESS" ]   && echo "   served $RESS"
    echo "   glyphs returned : $GCOUNT"
  fi
done
rm -f /tmp/_gp_glyphs.json

# ---------------------------------------------------------------------
section "3b. VERDICT ON THE LOOKUP"
# The on-demand fallback mutates the dictionary, so re-check after asking.
curl -s -m 60 "$SERVER/fonts" -o /tmp/_gp_fonts2.json 2>/dev/null
AFTER="$(grep -o '"[^"]*":{' /tmp/_gp_fonts2.json 2>/dev/null | sed 's/":{$//' | sed 's/^"//' | grep -i "$NEEDLE")"
if [ -n "$AFTER" ]; then
  echo "After the requests, the server DOES know these families:"
  echo "$AFTER"
  echo ""
  if [ -n "$MATCHES" ]; then
    note "It was already in the startup index. Lookup is fine."
  else
    note "It was NOT in the startup index, but the on-demand fallback"
    note "scan found it. That fallback only looks in ~/Library/Fonts"
    note "and one iCloud folder - so this works by luck, not design."
  fi
  note "If the plugin still errors, the problem is NOT the lookup."
else
  echo "The server still cannot resolve '$FONT_FAMILY'."
  note "CONFIRMED: this is the cause of 'Cannot load local file'."
  note "The font is not in any folder the server can reach."
  note "Sections 5 to 7 show where it actually lives."
fi
rm -f /tmp/_gp_fonts2.json

# ---------------------------------------------------------------------
section "4. STANDARD macOS FONT FOLDERS"
echo "(these are the only places the server knows how to look)"
for DIR in "$HOME/Library/Fonts" "/Library/Fonts" "/System/Library/Fonts" "/Network/Library/Fonts"; do
  echo ""
  echo "--- $DIR ---"
  if [ -d "$DIR" ]; then
    COUNT="$(ls -1 "$DIR" 2>/dev/null | wc -l | tr -d ' ')"
    echo "(total files: $COUNT)"
    FOUND="$(ls -1 "$DIR" 2>/dev/null | grep -i "$NEEDLE")"
    if [ -n "$FOUND" ]; then echo "$FOUND"; else echo "(no '$NEEDLE' files here)"; fi
  else
    echo "(directory does not exist)"
  fi
done

# ---------------------------------------------------------------------
section "5. EXTENSIS CONNECT FONTS / SUITCASE FUSION"
echo "(Connect Fonts keeps fonts in its own vault and activates them"
echo " through CoreText. Figma sees those fonts. The glyph server,"
echo " which only walks the folders in section 4, does NOT.)"
echo ""
echo "--- Extensis processes running ---"
EXT_PS="$(ps aux 2>/dev/null | grep -iE "extensis|connect ?fonts|suitcase|fmcore|type ?core" | grep -v grep)"
if [ -n "$EXT_PS" ]; then
  echo "$EXT_PS" | sed 's/^\([^ ]*\) *\([0-9]*\).*\(\/.*\)$/   pid \2  \3/' | head -20
else
  echo "(no Extensis process detected)"
fi

echo ""
echo "--- Extensis support / vault directories ---"
for D in \
  "$HOME/Library/Application Support/Extensis" \
  "$HOME/Library/Extensis" \
  "/Library/Application Support/Extensis" \
  "$HOME/Library/Application Support/Celartem" \
  "$HOME/Library/Containers/com.extensis.ConnectFonts" \
  "$HOME/Library/Group Containers"
do
  if [ -d "$D" ]; then
    echo ""
    echo "FOUND: $D"
    find "$D" -maxdepth 3 -type d 2>/dev/null | head -20 | sed 's/^/     /'
    NFONTS="$(find "$D" -type f \( -iname '*.otf' -o -iname '*.ttf' -o -iname '*.ttc' -o -iname '*.dfont' \) 2>/dev/null | wc -l | tr -d ' ')"
    echo "     font files inside: $NFONTS"
    if [ "$NFONTS" != "0" ]; then
      echo "     sample paths:"
      find "$D" -type f \( -iname '*.otf' -o -iname '*.ttf' \) 2>/dev/null | head -5 | sed 's/^/       /'
      echo "     matching '$NEEDLE' by filename:"
      VAULTHIT="$(find "$D" -type f \( -iname '*.otf' -o -iname '*.ttf' \) 2>/dev/null | grep -i "$NEEDLE" | head -10)"
      if [ -n "$VAULTHIT" ]; then
        echo "$VAULTHIT" | sed 's/^/       /'
      else
        echo "       (none by filename - vaults store fonts under opaque"
        echo "        names, so this is expected and not a problem)"
      fi
    fi
  fi
done

echo ""
echo "--- other font managers, just in case ---"
ps aux 2>/dev/null | grep -iE "fontbase|rightfont|typeface|fontexplorer|fontagent|monotype" | grep -v grep || echo "(none)"
ls -1 /Applications 2>/dev/null | grep -iE "font|suitcase|extensis|typeface" || echo "(no font apps in /Applications)"

# ---------------------------------------------------------------------
section "6. WHERE THE FONT FILES ACTUALLY LIVE (SPOTLIGHT)"
echo "--- mdfind by squashed name '$SQUASHED' ---"
mdfind -name "$SQUASHED" 2>/dev/null | head -25 || true
echo ""
echo "--- mdfind any .otf/.ttf containing '$NEEDLE' ---"
mdfind "kMDItemFSName == '*${NEEDLE}*'c" 2>/dev/null | grep -iE '\.(otf|ttf|ttc)$' | head -25 || true
echo ""
note "If files show up HERE but not in section 4, the server cannot"
note "reach them. That is the bug."

# ---------------------------------------------------------------------
section "7. WHAT macOS / CORETEXT ACTUALLY HAS ACTIVE"
echo "(this is what Figma sees - compare against section 2)"
echo "collecting, may take ~30s..."
TMPF=/tmp/_gp_sysprofile.txt
rm -f "$TMPF"
system_profiler SPFontsDataType >"$TMPF" 2>/dev/null &
SPPID=$!
WAITED=0
while kill -0 $SPPID 2>/dev/null && [ $WAITED -lt 90 ]; do
  sleep 2
  WAITED=$((WAITED + 2))
done
kill $SPPID 2>/dev/null
wait $SPPID 2>/dev/null
if [ -s "$TMPF" ]; then
  echo "total font faces known to macOS: $(grep -c 'Full Name:' "$TMPF" 2>/dev/null)"
  echo ""
  echo "--- entries matching '$NEEDLE' ---"
  grep -i -B3 -A8 "$NEEDLE" "$TMPF" 2>/dev/null | head -100 || echo "(no match)"
else
  echo "(system_profiler timed out or returned nothing)"
fi
rm -f "$TMPF"

# ---------------------------------------------------------------------
section "8. THE SERVER APP"
APP="$(mdfind "kMDItemFSName == 'Figma Glyph Font Server.app'" 2>/dev/null | head -1)"
if [ -n "$APP" ]; then
  echo "location : $APP"
  PL="$APP/Contents/Info.plist"
  if [ -f "$PL" ]; then
    echo "version  : $(defaults read "$PL" CFBundleShortVersionString 2>/dev/null)"
    echo "bundle id: $(defaults read "$PL" CFBundleIdentifier 2>/dev/null)"
  fi
  echo ""
  echo "--- quarantine flag ---"
  xattr -l "$APP" 2>/dev/null | grep -i quarantine || echo "(not quarantined - good)"
else
  echo "(app bundle not found by Spotlight)"
fi
echo ""
echo "--- other copies of the app on disk ---"
mdfind "kMDItemFSName == 'Figma Glyph Font Server.app'" 2>/dev/null | head -10 || echo "(none)"

# ---------------------------------------------------------------------
section "9. SUMMARY - WHAT MATTERS"
echo "Send this entire file back."
echo ""
echo "Key questions it answers:"
echo "  section 1 - the REAL server version (not the UI badge)"
echo "  section 2 - is '$FONT_FAMILY' indexed at all?"
echo "  section 4 - is the font in a standard macOS font folder?"
echo "  section 5 - is Connect Fonts holding it in a vault instead?"
echo "  section 7 - does macOS/Figma see it even though the server does not?"
echo ""
echo "END OF REPORT"

# ---------------------------------------------------------------------
exec 1>&3 3>&-
echo ""
echo "  Done."
echo ""
echo "  Report saved to your Desktop:"
echo "    $(basename "$OUT")"
echo ""
echo "  Nothing on your Mac was changed. No passwords are in the file."
echo "  Please send that file back."
echo ""
open -R "$OUT" 2>/dev/null
echo "  (Press Return to close this window.)"
read -r _
