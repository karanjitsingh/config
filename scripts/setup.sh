#!/bin/bash
set -e
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$TOOL_DIR/../lib.sh"

echo "Setting up PATH..."

ZSHRC="$HOME/.zshrc"
PATH_LINE='export PATH="$HOME/code/config/scripts:$PATH"'

touch "$ZSHRC"

# Match on the repo-relative suffix so this works whether the line uses
# $HOME, ~, or an absolute path.
if grep -qsF "code/config/scripts" "$ZSHRC"; then
    echo "✓ ~/.zshrc already has config/scripts on PATH"
else
    {
        echo ""
        echo "# Added by config/setup.sh (path)"
        echo "$PATH_LINE"
    } >> "$ZSHRC"
    echo "✓ Added config/scripts to PATH in ~/.zshrc"
fi
echo ""
