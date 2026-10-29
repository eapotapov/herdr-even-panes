#!/bin/sh
# Installs the even-panes mod into the running Herdr desktop app.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
HOME_DIR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
MOD=even-panes
KEY="${EVEN_PANES_KEY:-cmd-shift-v}"
ACTION="${EVEN_PANES_ACTION:-even-panes.equalize-tab}"

command -v herdr-app >/dev/null || { echo "herdr-app not found on PATH; is the Herdr app installed?" >&2; exit 1; }
herdr-app status >/dev/null 2>&1 || { echo "the Herdr app is not running; open it first" >&2; exit 1; }

echo "1. mod -> $HOME_DIR/mods/$MOD"
mkdir -p "$HOME_DIR/mods"
rm -rf "$HOME_DIR/mods/$MOD"
cp -R "$HERE/mods/$MOD" "$HOME_DIR/mods/$MOD"

LAYOUT=$(herdr-app status | python3 -c 'import json,sys; print(json.load(sys.stdin)["layout"])')
case "$LAYOUT" in
  main|terminals|win98)
    TARGET="$LAYOUT-even"
    if [ ! -f "$HOME_DIR/layouts/$TARGET.json" ]; then
      echo "2. layout: '$LAYOUT' is shipped and cannot hold mods; cloning it as '$TARGET'"
      herdr-app do layout.clone --name "$LAYOUT" --as "$TARGET" >/dev/null
    else
      echo "2. layout: switching to your existing '$TARGET'"
      herdr-app do layout.switch --name "$TARGET" >/dev/null
    fi
    LAYOUT="$TARGET"
    ;;
  *) echo "2. layout: '$LAYOUT' is personal, using it" ;;
esac

echo "3. floating slot for the mod in layouts/$LAYOUT.json"
python3 - "$HOME_DIR/layouts/$LAYOUT.json" "$MOD" <<'PY'
import json, sys
path, mod = sys.argv[1], sys.argv[2]
layout = json.load(open(path))
floats = layout.setdefault("floating", [])
if not any(f.get("id") == mod for f in floats):
    floats.append({"id": mod, "content": {"mod": mod}, "edge": "bottom", "align": "end"})
    json.dump(layout, open(path, "w"), indent=2)
    print("   added")
else:
    print("   already there")
PY

echo "4. key: $KEY -> $ACTION"
python3 - "$HOME_DIR/keys.json" "$KEY" "$ACTION" <<'PY'
import json, sys
path, key, action = sys.argv[1], sys.argv[2], sys.argv[3]
keys = json.load(open(path))
section = keys.setdefault("global", {})
current = section.get(key)
if current is None:
    section[key] = action
    json.dump(keys, open(path, "w"), indent=2)
    print("   bound")
elif current == action:
    print("   already bound")
else:
    print(f"   left alone: {key} is already {current!r}; bind another key by hand")
PY

echo "5. herdr-app check"
herdr-app check "$HOME_DIR/mods/$MOD"
echo "done. split with cmd-d as usual: panes stay equal. $KEY evens out the current tab."
