#!/usr/bin/env bash
# Claude Code hook: record which claude session id is running in which tmux pane.
#
# `tmux-claude install` links this to ~/.tmux/claude-pane-track.sh and registers
# that path under SessionStart / UserPromptSubmit / SessionEnd in
# ~/.claude/settings.json. `./setup.sh tmux` deliberately leaves it alone.
# `tmux-claude` reads what this writes.
#
# SessionStart alone is not enough: it fires before the conversation has an
# ai-title, and it misses panes moved to another window later. UserPromptSubmit
# re-stamps both every turn.
#
# One JSON object per line, appended. An append under 4 KB is atomic on Linux, so
# concurrent claude sessions cannot interleave a line.
set -uo pipefail

REGISTRY="${CLAUDE_TMUX_REGISTRY:-$HOME/.tmux/claude-panes.jsonl}"
MAX_LINES=4000

# TMUX_PANE is inherited from the pane's shell, so claude and its hooks see it.
[ -n "${TMUX:-}" ] && [ -n "${TMUX_PANE:-}" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)

# Every field arrives on its own line, and is read one line at a time. The two
# obvious shortcuts are both wrong here:
#
#   `IFS=$TAB read -r a b c`     tab is whitespace, and read collapses runs of
#                                whitespace IFS, so a single empty field -- a pane
#                                with no title, a payload with no transcript_path
#                                -- shifts every later field left. That is how
#                                $event came out empty and SessionEnd got recorded
#                                as a live record, leaving closed panes looking as
#                                though they still held their session.
#   a unit separator (\x1f)      survives on the dev box but not on the mac, where
#                                tmux 3.5a rewrites the control byte in its own
#                                output as the four literal characters \037. The
#                                whole format then lands in the first variable,
#                                window_index and pane_index fall back to -1, and
#                                no coordinate lookup can ever match again.
#
# Newline is the one delimiter tmux passes through untouched, and `IFS= read -r`
# per line keeps empty fields in place. mapfile would be tidier but macOS still
# ships bash 3.2.
read_lines() {
    local __names="$*" __line
    for __line in $__names; do eval "$__line="; done  # set -u safe when short
    set -- $__names
    while IFS= read -r __line; do
        [ "$#" -gt 0 ] || break
        eval "$1=\$__line"  # deferred, so a value with quotes cannot re-parse
        shift
    done
}

read_lines session_id transcript cwd event <<EOF
$(jq -r '.session_id // "", .transcript_path // "", .cwd // "",
         .hook_event_name // ""' <<<"$input")
EOF
[ -n "$session_id" ] || exit 0

read_lines pane_pid tmux_session window_index window_name pane_index pane_title <<EOF
$(tmux display-message -p -t "$TMUX_PANE" '#{pane_pid}
#{session_name}
#{window_index}
#{window_name}
#{pane_index}
#{pane_title}' 2>/dev/null)
EOF
[ -n "$pane_pid" ] || exit 0

# $TMUX is "socket,server-pid,session-id".
IFS=, read -r _ server_pid _ <<<"$TMUX"

# Only the claude that owns the pane may claim it. A nested claude -- `claude -p`
# from a Bash tool call, a background agent, a script -- fires these same hooks
# with the same TMUX_PANE, and its throwaway session id would overwrite the
# mapping.
#
# Walk from this hook up to the pane's own shell. Claude Code is several nested
# `claude` processes deep and the hook runs under a wrapper shell, so the test is
# not "claude's parent is the pane shell": leading non-claude levels are the
# wrapper, but a shell appearing *after* a claude is the Bash tool call that
# spawned a nested claude -- reject those.
#
# SessionEnd is exempt: by teardown the intervening claude processes are gone, so
# the walk can never reach the pane shell. A nested session's end record is
# harmless -- tmux-claude only treats an `end` as closing a pane when it names
# that pane's newest live session, and a nested session never gets a live record.
if [ "$event" != SessionEnd ]; then
    pid=$PPID
    seen_claude=""
    owner=""
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
        [ "${pid:-0}" -gt 1 ] 2>/dev/null || break
        if [ "$pid" = "$pane_pid" ]; then owner=yes; break; fi
        # Separate -o flags: `-o ppid=,comm=` makes ps read ",comm=" as ppid's header.
        ps_line=$(ps -o ppid= -o comm= -p "$pid" 2>/dev/null) || break
        read -r parent comm <<<"$ps_line"
        [ -n "${parent:-}" ] || break
        if [ "$comm" = claude ]; then
            seen_claude=yes
        elif [ -n "$seen_claude" ]; then
            break
        fi
        pid="$parent"
    done
    [ -n "$owner" ] || exit 0
fi

status=live
[ "$event" = SessionEnd ] && status=end

# Skip an append that would only repeat this pane's last record. UserPromptSubmit
# fires every turn and nearly always says exactly what the line before it said,
# which is how a registry covering a dozen panes reaches thousands of lines and
# makes every read slower. Everything that matters -- a new session id after
# /clear, a pane moved to another window, a retitled conversation, a teardown --
# changes the key below and is still written.
key="$status|$session_id|$tmux_session|$window_index|$pane_index|$pane_title|$server_pid"
if [ -f "$REGISTRY" ]; then
    last=$(jq -rc --arg p "$TMUX_PANE" --arg s "$server_pid" \
        'select(.pane_id == $p and .server_pid == $s)
         | [.status, .session_id, .tmux_session, (.window_index | tostring),
            (.pane_index | tostring), .pane_title, .server_pid] | join("|")' \
        "$REGISTRY" 2>/dev/null | tail -1)
    [ "$last" = "$key" ] && exit 0
fi

mkdir -p "$(dirname "$REGISTRY")" 2>/dev/null

jq -nc \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg status "$status" \
    --arg event "$event" \
    --arg session_id "$session_id" \
    --arg transcript "$transcript" \
    --arg cwd "$cwd" \
    --arg tmux_session "$tmux_session" \
    --arg window_index "$window_index" \
    --arg window_name "$window_name" \
    --arg pane_index "$pane_index" \
    --arg pane_id "$TMUX_PANE" \
    --arg pane_title "$pane_title" \
    --arg server_pid "$server_pid" \
    '{$at, $status, $event, $session_id, $transcript, $cwd, $tmux_session,
      window_index: ($window_index | tonumber? // -1),
      $window_name,
      pane_index: ($pane_index | tonumber? // -1),
      $pane_id, $pane_title, $server_pid}' >> "$REGISTRY" 2>/dev/null

# Bound the file. Cheap to check on every event now that near-duplicate appends
# are dropped above, so this no longer has to skip the per-turn hook.
if [ -f "$REGISTRY" ]; then
    lines=$(wc -l < "$REGISTRY" 2>/dev/null || echo 0)
    if [ "$lines" -gt "$MAX_LINES" ]; then
        tail -n $((MAX_LINES / 2)) "$REGISTRY" > "$REGISTRY.tmp" 2>/dev/null &&
            mv "$REGISTRY.tmp" "$REGISTRY"
    fi
fi

exit 0
