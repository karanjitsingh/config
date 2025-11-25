#!/bin/bash

set -e

echo "Setting up dotfiles..."

# Neovim setup
echo "Setting up Neovim..."
mkdir -p ~/.config/nvim
if [ -f ~/.config/nvim/init.lua ] || [ -L ~/.config/nvim/init.lua ]; then
    read -p "~/.config/nvim/init.lua already exists. Overwrite? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ln -sf "$(pwd)/neovim/init.lua" ~/.config/nvim/init.lua
        echo "✓ Neovim configuration linked"
    else
        echo "⊘ Skipped Neovim configuration"
    fi
else
    ln -sf "$(pwd)/neovim/init.lua" ~/.config/nvim/init.lua
    echo "✓ Neovim configuration linked"
fi

# tmux setup
echo "Setting up tmux..."
if [ -f ~/.tmux.conf ] || [ -L ~/.tmux.conf ]; then
    read -p "~/.tmux.conf already exists. Overwrite? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ln -sf "$(pwd)/tmux/.tmux.conf" ~/.tmux.conf
        echo "✓ tmux configuration linked"
    else
        echo "⊘ Skipped tmux configuration"
    fi
else
    ln -sf "$(pwd)/tmux/.tmux.conf" ~/.tmux.conf
    echo "✓ tmux configuration linked"
fi

# Reload tmux if running
if command -v tmux &> /dev/null && tmux info &> /dev/null; then
    tmux source ~/.tmux.conf
    echo "✓ tmux configuration reloaded"
fi

echo ""
echo "Setup complete! 🎉"
