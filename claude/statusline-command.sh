#!/bin/bash
# Claude Code status line: model, cwd, git branch, context usage.

input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name')
cwd=$(echo "$input" | jq -r '.workspace.current_dir')
dir=$(basename "$cwd")

# Git branch (skip optional locks so we never block on/contend with other git ops)
branch=""
if git -C "$cwd" --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch=$(git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null)
fi

# Context window usage
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
total_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')

ctx_info=""
if [ -n "$used_pct" ]; then
  if [ -n "$total_tokens" ] && [ -n "$ctx_size" ]; then
    ctx_tokens_fmt=$(awk -v t="$total_tokens" 'BEGIN { printf "%.1fk", t/1000 }')
    ctx_size_fmt=$(awk -v s="$ctx_size" 'BEGIN { printf "%.0fk", s/1000 }')
    ctx_info=$(printf "ctx: %s%% (%s/%s)" "$(printf '%.0f' "$used_pct")" "$ctx_tokens_fmt" "$ctx_size_fmt")
  else
    ctx_info=$(printf "ctx: %s%%" "$(printf '%.0f' "$used_pct")")
  fi
fi

# Claude subscription rate limits, if available
five=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
rl_info=""
if [ -n "$five" ]; then
  rl_info=$(printf "5h:%.0f%%" "$five")
fi

out="\033[1;36m${model}\033[0m \033[1;37m${dir}\033[0m"
[ -n "$branch" ] && out="${out} \033[1;33m(${branch})\033[0m"
[ -n "$ctx_info" ] && out="${out} \033[1;35m${ctx_info}\033[0m"
[ -n "$rl_info" ] && out="${out} \033[1;34m${rl_info}\033[0m"

printf "%b\n" "$out"
