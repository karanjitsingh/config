#!/bin/bash
set -e
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$TOOL_DIR/../lib.sh"

echo "Setting up Claude Code statusline..."

if ! command -v jq &> /dev/null; then
    echo "✗ jq not found — required by both this setup script and the statusline itself."
    exit 1
fi

link_file "$TOOL_DIR/statusline-command.sh" ~/.claude/statusline-command.sh "Claude Code statusline"

mkdir -p ~/.claude
settings=~/.claude/settings.json
[ -f "$settings" ] || echo '{}' > "$settings"

if jq -e '.statusLine.command == "bash ~/.claude/statusline-command.sh"' "$settings" > /dev/null 2>&1; then
    echo "✓ ~/.claude/settings.json already wired up"
else
    tmp=$(mktemp)
    jq '.statusLine = {"type": "command", "command": "bash ~/.claude/statusline-command.sh"}' "$settings" > "$tmp" && mv "$tmp" "$settings"
    echo "✓ statusLine added to ~/.claude/settings.json"
fi
