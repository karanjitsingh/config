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

## CodeGraph Autodetection & Setup

CodeGraph should automatically detect your project root when pi is launched from within a project directory.

**How it works:**
- A `.zshrc` function automatically finds the nearest git root
- Pi is launched from that project root
- CodeGraph MCP server detects the project and indexes it

**To use:** Just run `pi` from anywhere in a git project — it will automatically cd to the root.

**Initial setup per project:**
```bash
cd /path/to/your/project
codegraph init  # Creates .codegraph/ with local index
```

### What to commit

✅ **DO commit:** `.codegraph/.gitignore` (explains what CodeGraph generates)  
❌ **DON'T commit:** `.codegraph/codegraph.db*`, `.codegraph/cache/`, `.codegraph/*.log`

CodeGraph is like `node_modules/` or `build/` — generated, local, regenerated with `codegraph init`. Add to your project's `.gitignore`:

```gitignore
# CodeGraph (local index, regenerate with `codegraph init`)
.codegraph/codegraph.db*
.codegraph/cache/
.codegraph/*.log
.codegraph/.dirty
```

## Troubleshooting

### "hypa: command not found"

If bash commands fail with this error:
1. Ensure hypa is installed: `npm list -g @hypabolic/pi-hypa`
2. Use context-mode sandbox tools instead: `ctx_execute`, `ctx_execute_file`

### CodeGraph autodetection not working

1. Verify you're in a git repo: `git status`
2. Ensure CodeGraph is initialized: `codegraph init`
3. Verify the .zshrc function exists: `which pi` should show a function, not just the binary
4. Manually specify project path if needed: `codegraph_files(projectPath: "/path/to/project")`

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
