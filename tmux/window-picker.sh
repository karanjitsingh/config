#!/usr/bin/env bash
# Fuzzy window switcher across all sessions. Bound to `prefix + f` in .tmux.conf,
# which runs it inside a display-popup.
#
# Each line carries three tab-separated fields:
#   1. pane id      -- the switch-client target, never displayed
#   2. tree form    -- windows grouped under a session header
#   3. flat form    -- every row prefixed with `session:index`
#
# fzf can only match against what it displays, so the two display forms are
# swapped on the fly: the tree reads well while browsing, but as soon as there's
# a query we switch to the flat form so session names are searchable.
#
# If the popup ever opens and closes instantly, fzf is missing from the popup's
# PATH -- see the ~/.zshenv note in setup.sh.
#
# The target is a pane id, not a window id, because only a target containing
# ':', '.' or '%' makes switch-client change window as well as session. A
# '=session' target would work for switch-client but not for capture-pane, so
# session headers carry the pane id of that session's *current* window --
# selecting one goes there, and the preview works with no special casing.
set -uo pipefail

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
TAB=$'\t'

# Where the key binding leaves the pane id we were called from. It cannot be
# discovered from in here: a popup counts as a window in its session and takes
# over the window_active flag, and list-clients reports the popup's own pane.
FROM_FILE="$HOME/.tmux/window-picker.from"

HDR=$'\033[1;38;5;220m'
DIM=$'\033[38;5;244m'
RST=$'\033[0m'

# Drop trailing blank lines so stacked panes stay compact.
trim_blanks() {
    awk '{ buf[NR] = $0; if ($0 ~ /[^[:space:]]/) last = NR }
         END { for (i = 1; i <= last; i++) print buf[i] }'
}

# fzf calls back in here rather than running capture-pane directly, so anything
# unexpected in the target field renders blank instead of an error.
if [ "${1:-}" = "--preview" ]; then
    case "${2:-}" in
        %*) ;;
        *) exit 0 ;;
    esac

    panes=$(tmux list-panes -t "$2" \
        -F "#{pane_id}${TAB}#{pane_index}${TAB}#{pane_width}x#{pane_height}${TAB}#{pane_current_command}${TAB}#{?pane_active,active,}" 2>/dev/null)

    # The window may have closed between listing and previewing.
    [ -n "$panes" ] || exit 0

    # A single pane needs no labelling; splits get a header each so it's clear
    # where one ends and the next begins.
    if [ "$(printf '%s\n' "$panes" | wc -l)" -le 1 ]; then
        tmux capture-pane -ep -t "$2" | trim_blanks
        exit 0
    fi

    printf '%s\n' "$panes" | while IFS="$TAB" read -r pid idx dims cmd active; do
        printf '%s── pane %s  %s  %s%s%s\n' \
            "$DIM" "$idx" "$cmd" "$dims" "${active:+  ← active}" "$RST"
        tmux capture-pane -ep -t "$pid" | trim_blanks
        printf '\n'
    done
    exit 0
fi

# Read once, up front, so the repeated --preview calls above never touch it.
here=""
if [ -r "$FROM_FILE" ]; then
    here=$(cat "$FROM_FILE")
    rm -f "$FROM_FILE"
fi

list_windows() {
    tmux list-windows -a -F \
        "#{pane_id}${TAB}#{session_name}${TAB}#{window_index}${TAB}#{window_name}${TAB}#{pane_current_command}${TAB}#{window_active}" |
        awk -F"$TAB" \
            -v here="$here" \
            -v hdr="$HDR" -v dim="$DIM" -v rst="$RST" \
            -v tab="$TAB" '
        {
            n++
            pid[n] = $1; sess[n] = $2; idx[n] = $3; name[n] = $4; cmd[n] = $5
            if (!($2 in count)) {
                order[++sessions] = $2
                current[$2] = $1          # fallback if no window reports active
            }
            count[$2]++
            if ($6 == 1) current[$2] = $1
        }
        END {
            # Pad against the plain text, before any colour is added. The two
            # display forms need their own left-column widths.
            for (i = 1; i <= n; i++) {
                flat[i] = sess[i] ":" idx[i]
                tree[i] = (count[sess[i]] == 1) ? flat[i] : "   " idx[i]
                if (length(tree[i]) > wtree) wtree = length(tree[i])
                if (length(flat[i]) > wflat) wflat = length(flat[i])
                if (length(name[i]) > wname) wname = length(name[i])
            }
            treefmt = "%-" wtree "s  %-" wname "s  %s(%s)%s"
            flatfmt = "%-" wflat "s  %-" wname "s  %s(%s)%s"

            # Buffered so the row number of the window we were called from can
            # be reported on the first line, before the rows themselves.
            for (s = 1; s <= sessions; s++) {
                session = order[s]
                if (count[session] > 1) {
                    # Tagged "(session)" in the flat form only, where it would
                    # otherwise be indistinguishable from a window row.
                    out[++rows] = current[session] tab \
                                  hdr session rst tab \
                                  hdr session rst "  " dim "(session)" rst
                }
                for (i = 1; i <= n; i++) {
                    if (sess[i] != session) continue
                    if (here != "" && pid[i] == here) activerow = rows + 1
                    out[++rows] = pid[i] tab \
                                  sprintf(treefmt, tree[i], name[i], dim, cmd[i], rst) tab \
                                  sprintf(flatfmt, flat[i], name[i], dim, cmd[i], rst)
                }
            }

            print activerow + 0
            for (i = 1; i <= rows; i++) print out[i]
        }
    '
}

# Field 2 (tree) while the query is empty, field 3 (flat) once it isn't.
retransform='transform:[ -n {q} ] && echo "change-with-nth(3)" || echo "change-with-nth(2)"'

# First line is the row holding the window we were called from, 0 if unknown.
listing=$(list_windows)
active_row=${listing%%$'\n'*}
listing=${listing#*$'\n'}

# The blue bar for that window is fzf's marker, which shares the gutter with the
# red pointer, rather than a column of our own further right. Markers need
# --multi, so Enter drops the selection first to keep returning the cursor item,
# and the selection keys are disabled to stop stray bars appearing.
fzf_args=(
    --ansi
    --reverse
    --sync
    --multi
    --marker='▌'
    --color=marker:39
    --delimiter="$TAB"
    --with-nth=2
    --accept-nth=1
    --bind "change:$retransform"
    --bind 'enter:clear-selection+accept'
    --bind 'tab:ignore,btab:ignore'
    --prompt='go> '
    --preview="'$SELF' --preview {1}"
    --preview-window='right,65%,border-left'
)

# --sync is what makes a start binding take effect.
if [ "${active_row:-0}" -gt 0 ] 2>/dev/null; then
    fzf_args+=( --bind "start:pos($active_row)+select+first" )
fi

selection=$(printf '%s\n' "$listing" | fzf "${fzf_args[@]}") || exit 0

case "$selection" in
    %*) tmux switch-client -t "$selection" ;;
esac
