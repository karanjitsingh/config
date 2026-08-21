#!/bin/bash
set -e
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$TOOL_DIR/../lib.sh"

echo "Setting up tmux..."
link_file "$TOOL_DIR/.tmux.conf" ~/.tmux.conf "tmux config"

# Linked rather than referenced in-place so .tmux.conf needn't know where this
# repo was cloned.
mkdir -p ~/.tmux
link_file "$TOOL_DIR/window-picker.sh" ~/.tmux/window-picker.sh "window picker"

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

# fzf is required by the `prefix + f` fuzzy window switcher.
#
# NOT HANDLED HERE, but needed on a fresh machine: display-popup runs its command
# through default-shell as a non-interactive `zsh -c`, which reads ~/.zshenv and
# never ~/.zshrc. With brew set up only in .zshrc, the popup gets a PATH without
# /home/linuxbrew/.linuxbrew/bin, fzf isn't found, and the popup opens and shuts
# instantly. ~/.zshenv is deliberately not tracked in this repo, so add by hand:
#
#     if [ -z "${HOMEBREW_PREFIX:-}" ] && [ -x /home/linuxbrew/.linuxbrew/bin/brew ]; then
#         eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
#     fi
#
# The HOMEBREW_PREFIX guard leaves interactive PATH ordering to .zshrc as before.
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
