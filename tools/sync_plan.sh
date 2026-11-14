#!/bin/bash
# Copies Keli's plan from the vault into the app and checks it. Doesn't publish:
# commit and push yourself once the check says OK.
#   bash tools/sync_plan.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="$HOME/Obsidian/YT - Remote/business/client-plans/muscle-up.md"
node tools/check_plan.mjs "$SRC"
cp "$SRC" plans/muscle-up.md
echo "Copied into plans/muscle-up.md"
