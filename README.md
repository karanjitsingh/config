# Dotfiles

Personal configuration files for consistent development environments across systems.

## Contents

- **neovim/** - Neovim configuration
- **tmux/** - tmux configuration

## Installation

Run the setup script to automatically link all configurations:

```bash
./setup.sh
```

Or manually link individual configs:

### Neovim

```bash
mkdir -p ~/.config/nvim
ln -sf $(pwd)/neovim/init.lua ~/.config/nvim/init.lua
```

### tmux

```bash
ln -sf $(pwd)/tmux/.tmux.conf ~/.tmux.conf
tmux source ~/.tmux.conf  # reload if tmux is running
```
