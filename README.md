# Dotfiles

Personal config for Linux/macOS development machines.

## Contents

- **neovim/** - Neovim config
- **tmux/** - tmux config, plugins, and the `claude-pane-track.sh` hook
- **karabiner/** - Karabiner-Elements keyboard config (macOS only)
- **pi/** - pi coding-agent settings, extensions, skills, themes
- **claude/** - Claude Code statusline
- **scripts/** - standalone commands (`svc`, `tmux-claude`, ...); the directory goes on `PATH`

## Install

```bash
./setup.sh all        # everything
./setup.sh tmux pi    # or pick components
./setup.sh --help     # list components
```

Each component's `setup.sh` symlinks its files into place, so edits here take effect immediately.

## Notes

- **tmux-claude:** restoring Claude sessions needs `claude-pane-track.sh` registered
  by hand in `~/.claude/settings.json` under `SessionStart`, `UserPromptSubmit` and
  `SessionEnd` (absolute path, `jq` required):

  ```json
  { "type": "command", "command": "/home/<you>/.tmux/claude-pane-track.sh", "async": true }
  ```
