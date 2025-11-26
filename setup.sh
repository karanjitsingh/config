#!/bin/bash

set -e

# Function to copy config with confirmation
copy_config() {
    local source=$1
    local target=$2
    local name=$3
    
    if [ -f "$target" ] || [ -L "$target" ]; then
        read -p "$target already exists. Overwrite? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            ln -sf "$source" "$target"
            echo "✓ $name configuration linked"
        else
            echo "⊘ Skipped $name configuration"
        fi
    else
        ln -sf "$source" "$target"
        echo "✓ $name configuration linked"
    fi
    echo ""
}

echo "Setting up dotfiles..."
echo ""

# Neovim setup
echo "Setting up Neovim..."
mkdir -p ~/.config/nvim
copy_config "$(pwd)/neovim/init.lua" ~/.config/nvim/init.lua "Neovim"

# tmux setup
echo "Setting up tmux..."
copy_config "$(pwd)/tmux/.tmux.conf" ~/.tmux.conf "tmux"

# Reload tmux if running
if command -v tmux &> /dev/null && tmux info &> /dev/null; then
    tmux source ~/.tmux.conf
    echo "✓ tmux configuration reloaded"
fi

# Karabiner setup (macOS only)
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Setting up Karabiner..."
    mkdir -p ~/.config/karabiner
    copy_config "$(pwd)/karabiner/karabiner.json" ~/.config/karabiner/karabiner.json "Karabiner"
fi

echo ""
echo "Setup complete! 🎉"
