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

# Setup functions for each config
setup_neovim() {
    echo "Setting up Neovim..."
    mkdir -p ~/.config/nvim
    copy_config "$(pwd)/neovim/init.lua" ~/.config/nvim/init.lua "Neovim"
}

setup_tmux() {
    echo "Setting up tmux..."
    copy_config "$(pwd)/tmux/.tmux.conf" ~/.tmux.conf "tmux"

    # Reload tmux if running
    if command -v tmux &> /dev/null && tmux info &> /dev/null; then
        tmux source ~/.tmux.conf
        echo "✓ tmux configuration reloaded"
    fi
}

setup_karabiner() {
    # Karabiner setup (macOS only)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Setting up Karabiner..."
        mkdir -p ~/.config/karabiner
        copy_config "$(pwd)/karabiner/karabiner.json" ~/.config/karabiner/karabiner.json "Karabiner"
    else
        echo "⊘ Skipping Karabiner (macOS only)"
    fi
}

setup_all() {
    setup_neovim
    setup_tmux
    setup_karabiner
}

show_usage() {
    echo "Usage: $0 [config...]"
    echo ""
    echo "Available configs: neovim, tmux, karabiner"
    echo "If no configs specified, all configs will be set up."
    echo ""
    echo "Examples:"
    echo "  $0              # Setup all configs"
    echo "  $0 neovim       # Setup only neovim"
    echo "  $0 neovim tmux  # Setup neovim and tmux"
}

# If no arguments, setup all
if [ $# -eq 0 ]; then
    setup_all
else
    for config in "$@"; do
        case "$config" in
            neovim)
                setup_neovim
                ;;
            tmux)
                setup_tmux
                ;;
            karabiner)
                setup_karabiner
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                echo "Unknown config: $config"
                show_usage
                exit 1
                ;;
        esac
    done
fi

echo ""
echo "Setup complete! 🎉"
