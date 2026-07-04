#!/bin/bash
set -e
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$TOOL_DIR/../lib.sh"

echo "Setting up Neovim..."
mkdir -p ~/.config/nvim
link_file "$TOOL_DIR/init.lua" ~/.config/nvim/init.lua "Neovim config"
