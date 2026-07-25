#!/bin/bash
set -e
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$TOOL_DIR/../lib.sh"

echo "Setting up tmux..."
link_file "$TOOL_DIR/.tmux.conf" ~/.tmux.conf "tmux config"

if [ ! -d ~/.tmux/plugins/tpm ]; then
    echo "Installing TPM..."
    git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
    echo "✓ TPM installed"
fi

for plugin in tmux-resurrect tmux-continuum; do
    if [ ! -d ~/.tmux/plugins/$plugin ]; then
        git clone https://github.com/tmux-plugins/$plugin ~/.tmux/plugins/$plugin
        echo "✓ $plugin installed"
    fi
done

# fzf is required by the `prefix + f` fuzzy window switcher
if ! command -v fzf &> /dev/null; then
    if command -v brew &> /dev/null; then
        echo "Installing fzf via Homebrew..."
        brew install fzf
        echo "✓ fzf installed"
    else
        echo "⚠  fzf not found and Homebrew unavailable — install fzf to enable 'prefix + f'"
    fi
fi

if command -v tmux &> /dev/null && tmux info &> /dev/null 2>&1; then
    tmux source ~/.tmux.conf
    echo "✓ tmux config reloaded"
fi
