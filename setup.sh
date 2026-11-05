#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

run() {
    local tool=$1; shift
    bash "$SCRIPT_DIR/$tool/setup.sh" "$@"
}

show_usage() {
    echo "Usage: $0 <command> [command...]"
    echo ""
    echo "Commands:"
    echo "  all         Set up everything"
    echo "  neovim      Neovim config"
    echo "  zsh         zsh + powerlevel10k, generic shell config"
    echo "  scripts     Standalone commands on PATH (subset of zsh)"
    echo "  tmux        tmux config + plugins"
    echo "  karabiner   Karabiner-Elements config (macOS only)"
    echo "              add 'amzn' for the work variant: $0 karabiner amzn"
    echo "  pi          pi coding-agent"
    echo "  claude      Claude Code statusline"
    echo ""
}

if [ $# -eq 0 ]; then
    show_usage
    exit 0
fi

while [ $# -gt 0 ]; do
    cmd=$1; shift
    case "$cmd" in
        all)        run neovim; run zsh; run tmux; run karabiner; run pi; run claude ;;
        neovim)     run neovim ;;
        zsh)        run zsh ;;
        scripts)    run scripts ;;
        tmux)       run tmux ;;
        karabiner)
            # Optional variant arg, e.g. `karabiner amzn` -> karabiner/karabiner.amzn.json
            if [ -n "${1:-}" ] && [ -f "$SCRIPT_DIR/karabiner/karabiner.$1.json" ]; then
                run karabiner "$1"; shift
            else
                run karabiner
            fi
            ;;
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
