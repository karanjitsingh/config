# Dotfiles

Personal config for Linux/macOS development machines.

## Contents

- **neovim/** - Neovim config
- **zsh/** - generic zsh config + powerlevel10k prompt
- **tmux/** - tmux config, plugins, and the opt-in `claude-pane-track.sh` hook
- **karabiner/** - Karabiner-Elements keyboard config (macOS only)
- **pi/** - pi coding-agent settings, extensions, skills, themes
- **claude/** - Claude Code statusline
- **scripts/** - standalone commands (`svc`, `tmux-claude`, ...); the directory goes on `PATH`

## Install

```bash
./setup.sh all        # everything
./setup.sh tmux pi    # or pick components
./setup.sh --help     # list components
./setup.sh karabiner amzn  # work variant (karabiner/karabiner.amzn.json)
```

Each component's `setup.sh` symlinks its files into place, so edits here take effect immediately.

## Notes

- **zsh:** `~/.zshrc` stays untracked (public remote) and sources `zsh/zshrc` first.
  `~/.p10k.zsh` isn't tracked either — run `p10k configure` on a fresh machine.
- **tmux-claude:** opt-in, not part of `./setup.sh tmux`. Run `tmux-claude install`
  to link `claude-pane-track.sh` into `~/.tmux` and register it in
  `~/.claude/settings.json` (`jq` required).
