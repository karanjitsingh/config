# Pi Coding Agent Setup

**Configuration Location:** `~/code/config/pi/` (source of truth, git-tracked)

**Installed At:** `~/.pi/agent/` (symlinked from config repo via `setup.sh`)

## Quick Setup

```bash
# Run the setup script to initialize symlinks
~/code/config/setup.sh

# Verify installation
ls -la ~/.pi/agent/
pi --version
```

## Key Files

| File/Dir | Purpose |
|----------|---------|
| `pi/settings.json` | Packages, theme, model defaults |
| `pi/themes/` | Custom themes (tailwind-night.json) |
| `pi/extensions/` | Custom pi extensions |
| `pi/skills/` | Custom skills & tools |
| `pi/prompts/` | Slash command templates |
| `lib.sh` | Symlink/setup helpers |
| `setup.sh` | Main setup script |

## Packages Installed

See `pi/settings.json` for the full list. Key packages:
- **context-mode** — Knowledge base indexing & searching
- **pi-subagents** — Multi-agent coordination
- **pi-web-access** — Web research & content fetching
- **pi-codegraph** — Code navigation & impact analysis
- **@hypabolic/pi-hypa** — Compression for large outputs
- Plus theme, notification, and intercom support

## Troubleshooting

### "hypa: command not found"

If bash commands fail with this error:
1. Ensure hypa is installed: `npm list -g @hypabolic/pi-hypa`
2. Use context-mode sandbox tools instead: `ctx_execute`, `ctx_execute_file`

### Symlink broken

Re-run setup:
```bash
~/code/config/setup.sh
```

### Pi not picking up config changes

Reload pi settings in the TUI or restart the session.

## Architecture

```
~/code/config/                 # Your git repo
└── pi/                         # Source of truth
    ├── settings.json          # Packages & config
    ├── themes/                # Live symlink
    ├── extensions/            # Live symlink
    ├── skills/                # Live symlink
    └── prompts/               # Live symlink
        └── system-context.md  # Environment documentation

~/.pi/agent/                    # Pi's runtime location
└── [All of the above symlinked from ~/code/config/pi/]
```

All changes should be made in `~/code/config/pi/` and committed to git.

---

**For pi session awareness of this setup, see `pi/prompts/system-context.md`**
