#!/bin/bash
set -e
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$TOOL_DIR/../lib.sh"

PI_DIR="$HOME/.pi/agent"

echo "Setting up pi (coding agent)..."

# --- Node.js ---
if ! command -v node &> /dev/null; then
    echo "✗ Node.js not found. Install Node.js v18+ before continuing."
    echo "  https://nodejs.org or: nvm install --lts"
    exit 1
fi
node_major=$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')
if [ "$node_major" -lt 18 ]; then
    echo "✗ Node.js v$node_major detected — pi requires v18+. Please upgrade."
    exit 1
fi
echo "✓ Node.js v$(node --version | tr -d v) detected"
echo ""

# --- npm global prefix ---
# NOTE: a `prefix` entry in ~/.npmrc is incompatible with nvm (nvm manages the
# prefix per Node version). Only force ~/.npm-global when NOT running under nvm.
if [[ -n "$NVM_DIR" && "$(command -v node)" == "$NVM_DIR"/* ]]; then
	echo "ℹ  nvm detected (node under $NVM_DIR) — leaving npm prefix untouched to avoid nvm conflict."
	if grep -qsE '^(globalconfig|prefix)\b' "$HOME/.npmrc" 2>/dev/null; then
		echo "⚠  ~/.npmrc has a prefix/globalconfig setting that will break nvm. Run:"
		echo "     nvm use --delete-prefix $(node -v) --silent"
	fi
else
	npm config set prefix "$HOME/.npm-global"
	mkdir -p "$HOME/.npm-global/bin"
	echo "✓ npm global prefix set to ~/.npm-global"
	if [[ ":$PATH:" != *":$HOME/.npm-global/bin:"* ]]; then
		echo "⚠  ~/.npm-global/bin is not in your PATH."
		echo '   Add to your ~/.zshrc or ~/.bashrc: export PATH="$HOME/.npm-global/bin:$PATH"'
	fi
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

# --- Live symlinks into this repo ---
link_file "$TOOL_DIR/settings.json" "$PI_DIR/settings.json" "pi settings.json"

for dir in extensions skills prompts themes; do
    link_dir "$TOOL_DIR/$dir" "$PI_DIR/$dir" "pi $dir/"
done

# --- Secrets (scaffold from .example, never overwrite) ---
scaffold_file \
    "$TOOL_DIR/auth.json.example" \
    "$PI_DIR/auth.json" \
    "Replace YOUR_ANTHROPIC_API_KEY_HERE with your real key."

scaffold_file \
    "$TOOL_DIR/web-search.json.example" \
    "$HOME/.pi/web-search.json" \
    "Fill in whichever search provider keys you want to use."

scaffold_file \
    "$TOOL_DIR/notify-config.json.example" \
    "$HOME/.unipi/config/notify/config.json" \
    "Configure Gotify/Telegram/ntfy if needed."

echo "ℹ  Packages auto-install on first pi startup (declared in settings.json)."
echo ""
