#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

link_file() {
    local source=$1
    local target=$2
    local name=$3

    if [ -f "$target" ] || [ -L "$target" ]; then
        read -p "$target already exists. Overwrite? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            ln -sf "$source" "$target"
            echo "✓ $name linked"
        else
            echo "⊘ Skipped $name"
        fi
    else
        ln -sf "$source" "$target"
        echo "✓ $name linked"
    fi
    echo ""
}

scaffold_file() {
    # Copy an .example template to $target only if $target doesn't exist yet.
    local example=$1
    local target=$2
    local label=$3
    local hint=$4

    if [ ! -f "$target" ]; then
        mkdir -p "$(dirname "$target")"
        cp "$example" "$target"
        echo "⚠  Created $target"
        echo "   $hint"
        echo ""
    else
        echo "✓ $target already exists, skipping"
        echo ""
    fi
}

# ---------------------------------------------------------------------------
# Per-tool setup
# ---------------------------------------------------------------------------

setup_neovim() {
    echo "Setting up Neovim..."
    mkdir -p ~/.config/nvim
    link_file "$SCRIPT_DIR/neovim/init.lua" ~/.config/nvim/init.lua "Neovim config"
}

setup_tmux() {
    echo "Setting up tmux..."
    link_file "$SCRIPT_DIR/tmux/.tmux.conf" ~/.tmux.conf "tmux config"

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

    if command -v tmux &> /dev/null && tmux info &> /dev/null 2>&1; then
        tmux source ~/.tmux.conf
        echo "✓ tmux config reloaded"
    fi
}

setup_karabiner() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Setting up Karabiner..."
        mkdir -p ~/.config/karabiner
        link_file "$SCRIPT_DIR/karabiner/karabiner.json" ~/.config/karabiner/karabiner.json "Karabiner config"
    else
        echo "⊘ Skipping Karabiner (macOS only)"
        echo ""
    fi
}

setup_pi() {
    echo "Setting up pi (coding agent)..."
    local PI_DIR="$HOME/.pi/agent"
    local REPO_PI="$SCRIPT_DIR/pi"

    # --- Node.js ---
    if ! command -v node &> /dev/null; then
        echo "✗ Node.js not found. Install Node.js v18+ before continuing."
        echo "  https://nodejs.org or: nvm install --lts"
        return 1
    fi
    local node_major
    node_major=$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')
    if [ "$node_major" -lt 18 ]; then
        echo "✗ Node.js v$node_major detected — pi requires v18+. Please upgrade."
        return 1
    fi
    echo "✓ Node.js v$(node --version | tr -d v) detected"
    echo ""

    # --- npm global prefix (~/.npm-global) ---
    npm config set prefix "$HOME/.npm-global"
    mkdir -p "$HOME/.npm-global/bin"
    echo "✓ npm global prefix set to ~/.npm-global"

    # Warn if ~/.npm-global/bin isn't in PATH yet
    if [[ ":$PATH:" != *":$HOME/.npm-global/bin:"* ]]; then
        echo "⚠  ~/.npm-global/bin is not in your PATH."
        echo "   Add this to your ~/.zshrc or ~/.bashrc:"
        echo '   export PATH="$HOME/.npm-global/bin:$PATH"'
        echo ""
    fi
    echo ""

    # --- Install pi ---
    if command -v pi &> /dev/null; then
        echo "✓ pi already installed ($(pi --version 2>/dev/null))"
    else
        echo "Installing pi..."
        npm install -g @earendil-works/pi-coding-agent
        echo "✓ pi installed ($(pi --version 2>/dev/null))"
    fi
    echo ""

    # --- Config (live symlinks into this repo) ---
    mkdir -p "$PI_DIR/extensions"
    link_file "$REPO_PI/settings.json"            "$PI_DIR/settings.json"            "pi settings.json"
    link_file "$REPO_PI/extensions/steer-mode.ts" "$PI_DIR/extensions/steer-mode.ts" "pi steer-mode extension"

    # --- Secrets (scaffold from .example, never overwrite) ---
    scaffold_file \
        "$REPO_PI/auth.json.example" \
        "$PI_DIR/auth.json" \
        "Anthropic API key" \
        "Replace YOUR_ANTHROPIC_API_KEY_HERE with your real key."

    scaffold_file \
        "$REPO_PI/web-search.json.example" \
        "$HOME/.pi/web-search.json" \
        "Search provider API keys (pi-web-access)" \
        "Fill in whichever search provider keys you want to use."

    scaffold_file \
        "$REPO_PI/notify-config.json.example" \
        "$HOME/.unipi/config/notify/config.json" \
        "Notification config (@pi-unipi/notify)" \
        "Configure Gotify/Telegram/ntfy if needed."

    echo "ℹ  Packages auto-install on first pi startup (declared in settings.json)."
    echo ""
}

setup_all() {
    setup_neovim
    setup_tmux
    setup_karabiner
    setup_pi
}

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------

show_usage() {
    echo "Usage: $0 <command> [command...]"
    echo ""
    echo "Commands:"
    echo "  all         Set up everything"
    echo "  neovim      Neovim config"
    echo "  tmux        tmux config + plugins"
    echo "  karabiner   Karabiner-Elements config (macOS only)"
    echo "  pi          pi coding-agent config, extensions, and secret scaffolding"
    echo ""
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

if [ $# -eq 0 ]; then
    show_usage
    exit 0
fi

for cmd in "$@"; do
    case "$cmd" in
        all)        setup_all ;;
        neovim)     setup_neovim ;;
        tmux)       setup_tmux ;;
        karabiner)  setup_karabiner ;;
        pi)         setup_pi ;;
        -h|--help)  show_usage; exit 0 ;;
        *)
            echo "Unknown command: $cmd"
            echo ""
            show_usage
            exit 1
            ;;
    esac
done

echo ""
echo "Done! 🎉"
