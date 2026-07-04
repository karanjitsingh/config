---
description: System context for pi — developer environment setup
---

# Pi System Context

## Configuration Source

Your pi configuration is managed via **`~/code/config/pi/`** (git-tracked):

- **Source of truth:** `~/code/config/`
- **Symlinked to:** `~/.pi/agent/` (live symlinks via setup.sh)
- Both paths refer to the same files; prefer `~/code/config/pi/` in documentation

## Key Directories

```
~/code/config/pi/
├── settings.json          # Pi packages, theme, default provider/model
├── themes/                # Custom themes (e.g., tailwind-night.json)
├── extensions/            # Custom pi extensions
├── skills/                # Custom skills & prompt templates
├── prompts/               # Slash command templates (this file is here)
└── setup.sh               # Initialization script
```

## Symlink Setup

Run this to re-establish symlinks:
```bash
~/code/config/setup.sh
```

This links:
- `~/code/config/pi/settings.json` → `~/.pi/agent/settings.json`
- `~/code/config/pi/{extensions,skills,prompts,themes}/` → `~/.pi/agent/`

## Important Notes

1. **hypa is installed** via `@hypabolic/pi-hypa` package in settings.json
   - If bash commands fail with "hypa: command not found", use `ctx_execute` sandbox tools instead
   - hypa provides compression for large outputs

2. **Config is git-tracked** at `~/code/config/`
   - Commit changes to `~/code/config/pi/` to persist across sessions
   - `.gitignore` protects secrets (auth.json, web-search.json)

3. **Working directory context**
   - User's cwd: `~/.pi/` and code projects
   - Config repo: `~/code/config/`
   - Always reference `~/code/config/pi/` as the canonical location

## For Future Sessions

When initializing or troubleshooting pi setup:
1. Check `~/code/config/setup.sh` was run
2. Verify symlinks exist: `ls -la ~/.pi/agent/`
3. Confirm settings loaded: `pi --settings` or check pi TUI

---

*This file auto-documents your pi setup for reproducibility.*
