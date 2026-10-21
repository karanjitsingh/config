#!/bin/bash
set -e
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$TOOL_DIR/../lib.sh"

echo "Setting up zsh..."

P10K_DIR="$HOME/.local/share/powerlevel10k"
ZSHRC="$HOME/.zshrc"
SOURCE_LINE='source ~/code/config/zsh/zshrc'

# --- zsh ----------------------------------------------------------------------
if command -v zsh >/dev/null 2>&1; then
    echo "✓ zsh $(zsh --version | cut -d' ' -f2)"
else
    # No sudo from a setup script: print the command and let the user run it.
    if command -v brew >/dev/null 2>&1; then
        brew install zsh
        echo "✓ zsh installed via brew"
    else
        echo "✗ zsh not installed, and no brew to install it without sudo."
        echo "  Debian/Ubuntu: sudo apt-get install zsh"
        echo "  Fedora/AL2:    sudo yum install zsh"
        echo "  macOS:         already present, or brew install zsh"
        exit 1
    fi
fi

if [ "$(basename "${SHELL:-}")" != zsh ]; then
    echo "⚠  Login shell is ${SHELL:-unset}, not zsh — run: chsh -s \"\$(command -v zsh)\""
fi
echo ""

# --- powerlevel10k ------------------------------------------------------------
# Presence is judged on the theme file, not the directory: an interrupted clone
# leaves a directory behind that would otherwise count as installed.
THEME=powerlevel10k.zsh-theme

if [ -r "$P10K_DIR/$THEME" ]; then
    echo "✓ powerlevel10k already installed"
elif [ -e "$P10K_DIR" ] && [ ! -L "$P10K_DIR" ]; then
    echo "✗ $P10K_DIR exists but has no $THEME — likely an interrupted clone."
    echo "  Remove it and re-run: rm -rf $P10K_DIR"
    exit 1
else
    # Reuse a clone from a previous setup rather than downloading a second copy.
    found=""
    for dir in "$HOME/github/powerlevel10k" "$HOME/powerlevel10k" \
               "$HOME/.oh-my-zsh/custom/themes/powerlevel10k"; do
        [ -r "$dir/$THEME" ] && found="$dir" && break
    done

    mkdir -p "$(dirname "$P10K_DIR")"
    if [ -n "$found" ]; then
        ln -sfn "$found" "$P10K_DIR"
        echo "✓ powerlevel10k found at $found, linked instead of re-cloning"
    else
        git clone --depth 1 https://github.com/romkatv/powerlevel10k.git "$P10K_DIR"
        echo "✓ powerlevel10k cloned"
    fi
fi
echo ""

# --- p10k settings ------------------------------------------------------------
# ~/.p10k.zsh is deliberately NOT tracked: the prompt is picked per machine, and
# the wizard asks about the font and terminal in front of you.
if [ -r "$HOME/.p10k.zsh" ]; then
    echo "✓ ~/.p10k.zsh present, leaving it alone"
else
    echo "⚠  No ~/.p10k.zsh yet — run \`p10k configure\` in a new shell"
fi
echo ""

# --- ~/.zshrc pointer ---------------------------------------------------------
# ~/.zshrc stays untracked and machine-specific; it only needs to source the
# generic config. Prepended, not appended: the instant prompt in zsh/zshrc has to
# run before anything writes to the terminal.
touch "$ZSHRC"
if grep -qsF "config/zsh/zshrc" "$ZSHRC"; then
    echo "✓ ~/.zshrc already sources the generic config"
else
    tmp=$(mktemp)
    {
        echo "# Generic, shared zsh config (git-tracked). Machine-specific settings go below."
        echo "$SOURCE_LINE"
        echo ""
        cat "$ZSHRC"
    } > "$tmp"
    mv "$tmp" "$ZSHRC"
    echo "✓ Added the generic config source line to the top of ~/.zshrc"
fi
echo ""
