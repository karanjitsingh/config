#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

run() {
    bash "$SCRIPT_DIR/$1/setup.sh"
}

show_usage() {
    echo "Usage: $0 <command> [command...]"
    echo ""
    echo "Commands:"
    echo "  all         Set up everything"
    echo "  neovim      Neovim config"
    echo "  scripts     Standalone commands on PATH"
    echo "  tmux        tmux config + plugins"
    echo "  karabiner   Karabiner-Elements config (macOS only)"
    echo "  pi          pi coding-agent"
    echo "  claude      Claude Code statusline"
    echo ""
}

if [ $# -eq 0 ]; then
    show_usage
    exit 0
fi

for cmd in "$@"; do
    case "$cmd" in
        all)        run neovim; run tmux; run karabiner; run pi; run claude; run scripts ;;
        neovim)     run neovim ;;
        scripts)    run scripts ;;
        tmux)       run tmux ;;
        karabiner)  run karabiner ;;
        pi)         run pi ;;
        claude)     run claude ;;
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
