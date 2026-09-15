#!/usr/bin/env bash
# Claude Code hook: record which claude session id is running in which tmux pane.
#
# Wired into SessionStart / UserPromptSubmit / SessionEnd in ~/.claude/settings.json.
# `tmux-claude` reads what this writes. SessionStart alone is not enough: it fires
# before the conversation has an ai-title, and it misses panes moved to another
# window later. UserPromptSubmit re-stamps both every turn.
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

TAB=$'\t'
# Unit separator, not tab: tab is whitespace, and `read` collapses runs of
# whitespace IFS, so one empty field (a pane with no title) would shift every
# later field left.
US=$'\x1f'

IFS=$TAB read -r session_id transcript cwd event \
    <<<"$(jq -r '[.session_id // "", .transcript_path // "", .cwd // "", .hook_event_name // ""] | @tsv' <<<"$input")"
[ -n "$session_id" ] || exit 0

fmt="#{pane_pid}${US}#{session_name}${US}#{window_index}${US}#{window_name}${US}#{pane_index}${US}#{pane_title}"
IFS=$US read -r pane_pid tmux_session window_index window_name pane_index pane_title \
    <<<"$(tmux display-message -p -t "$TMUX_PANE" "$fmt" 2>/dev/null)"
[ -n "${pane_pid:-}" ] || exit 0

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

# Bound the file, but never on the per-turn hook.
if [ "$event" != UserPromptSubmit ] && [ -f "$REGISTRY" ]; then
    lines=$(wc -l < "$REGISTRY" 2>/dev/null || echo 0)
    if [ "$lines" -gt "$MAX_LINES" ]; then
        tail -n $((MAX_LINES / 2)) "$REGISTRY" > "$REGISTRY.tmp" 2>/dev/null &&
            mv "$REGISTRY.tmp" "$REGISTRY"
    fi
fi

exit 0
