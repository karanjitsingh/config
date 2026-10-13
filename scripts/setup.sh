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
    echo "ℹ  Run 'source ~/.zshrc' (or open a new terminal) to use them in your current shell"
fi

# Make the scripts available to this process and the rest of the setup run.
# (Also covers `source setup.sh` invocations, where the export reaches the
# caller's shell — a plain `bash setup.sh` child can't do that, and running
# `source ~/.zshrc` from bash would choke on zsh-specific syntax.)
export PATH="$HOME/code/config/scripts:$PATH"

echo ""
