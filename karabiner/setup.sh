#!/bin/bash
# Usage: setup.sh [variant]   e.g. `setup.sh amzn` links karabiner.amzn.json
set -e
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$TOOL_DIR/../lib.sh"

if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "⊘ Skipping Karabiner (macOS only)"
    exit 0
fi

variant=${1:-}
config="$TOOL_DIR/karabiner${variant:+.$variant}.json"
if [ ! -f "$config" ]; then
    echo "✗ No Karabiner config for variant '$variant' ($config)"
    exit 1
fi

echo "Setting up Karabiner${variant:+ ($variant)}..."
mkdir -p ~/.config/karabiner
link_file "$config" ~/.config/karabiner/karabiner.json "Karabiner config"
