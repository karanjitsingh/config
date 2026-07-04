#!/bin/bash
set -e
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$TOOL_DIR/../lib.sh"

if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "⊘ Skipping Karabiner (macOS only)"
    exit 0
fi

echo "Setting up Karabiner..."
mkdir -p ~/.config/karabiner
link_file "$TOOL_DIR/karabiner.json" ~/.config/karabiner/karabiner.json "Karabiner config"
