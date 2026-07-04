# Dotfiles

Personal configuration files for consistent development environments across (Linux/Unix) systems.

## ⚙️ Pi Coding Agent

**Your pi configuration lives in `~/code/config/pi/` and is the source of truth.**

All pi settings, themes, extensions, and skills are:
- **Defined in:** `~/code/config/pi/`
- **Symlinked to:** `~/.pi/agent/` (live symlinks via `setup.sh`)
- **Git-tracked:** Changes should be committed to this repo

**See [`PI_SETUP.md`](./PI_SETUP.md) for complete documentation and troubleshooting.**

## Contents

- **neovim/** - Neovim configuration
- **tmux/** - tmux configuration
- **karabiner/** - Karabiner-Elements keyboard customization
- **pi/** - pi coding-agent configuration (settings, extensions)

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

### Karabiner

```bash
mkdir -p ~/.config/karabiner
ln -sf $(pwd)/karabiner/karabiner.json ~/.config/karabiner/karabiner.json
```

### pi (coding agent)

**Prerequisite** — install the pi binary globally first:
```bash
npm install -g @earendil-works/pi-coding-agent
```

Then link config and set your API key:
```bash
mkdir -p ~/.pi/agent/extensions
ln -sf $(pwd)/pi/settings.json ~/.pi/agent/settings.json
ln -sf $(pwd)/pi/extensions/steer-mode.ts ~/.pi/agent/extensions/steer-mode.ts
cp pi/auth.json.example ~/.pi/agent/auth.json
# Edit ~/.pi/agent/auth.json and replace the placeholder with your real Anthropic API key
```

Or use the setup script which handles the linking and auth scaffolding:
```bash
./setup.sh pi
```

> **Note:** `~/.pi/agent/auth.json` holds your API key and is never committed.
> `pi/auth.json.example` is the safe template (placeholder only).
> Packages (context-mode, pi-subagents, pi-web-access, etc.) are declared in
> `pi/settings.json` and installed automatically by pi on first startup.
