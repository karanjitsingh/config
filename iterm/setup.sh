#!/bin/bash
set -e
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$TOOL_DIR/../lib.sh"

if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "⊘ Skipping iTerm2 (macOS only)"
    exit 0
fi

echo "Setting up iTerm2..."

# Ctrl+Cmd+V -> paste clipboard files/images, uploading them first when the tab is in ssh
script=~/.local/share/iterm-paste/paste_image.py
mkdir -p "$(dirname "$script")"
link_file "$TOOL_DIR/paste_image.py" "$script" "iTerm paste-image script"

key="0x76-0x140000-0x9-0x1"  # 'v' + Ctrl+Cmd
binding="<dict><key>Action</key><integer>35</integer><key>Text</key><string>$script</string></dict>"  # 35 = Run Coprocess
current=$(defaults export com.googlecode.iterm2 - 2>/dev/null \
    | plutil -extract "GlobalKeyMap.$key.Text" raw -o - - 2>/dev/null || true)
if [ "$current" = "$script" ]; then
    echo "✓ Ctrl+Cmd+V binding already set"
else
    defaults write com.googlecode.iterm2 GlobalKeyMap -dict-add "$key" "$binding"
    echo "✓ Ctrl+Cmd+V bound to paste_image.py"
    if pgrep -xq iTerm2; then
        echo "  Restart iTerm2 (Cmd+Q, reopen) to pick up the new binding"
    fi
fi
