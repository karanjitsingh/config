#!/bin/bash
# Shared helpers sourced by each tool's setup.sh

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

link_dir() {
    # Symlink a whole directory, replacing it if it exists as a real dir.
    local source=$1
    local target=$2
    local name=$3

    if [ -d "$target" ] && [ ! -L "$target" ]; then
        echo "⚠  $target is a real directory — replacing with symlink..."
        rm -rf "$target"
    fi
    link_file "$source" "$target" "$name"
}

scaffold_file() {
    # Copy an .example template to $target only if $target doesn't exist yet.
    local example=$1
    local target=$2
    local hint=$3

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
