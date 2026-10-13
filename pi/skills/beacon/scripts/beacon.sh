#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/beacon"
CONFIG_FILE="$CONFIG_DIR/config.json"
DEFAULT_CHANNEL="pi"

get_url() {
  if [ -n "${BEACON_URL:-}" ]; then
    echo "$BEACON_URL"
    return 0
  fi
  if [ -f "$CONFIG_FILE" ]; then
    python3 -c "import json, sys; d=json.load(open('$CONFIG_FILE')); print(d.get('url',''))" 2>/dev/null || true
  fi
}

get_channel() {
  if [ -n "${BEACON_CHANNEL:-}" ]; then
    echo "$BEACON_CHANNEL"
    return 0
  fi
  if [ -f "$CONFIG_FILE" ]; then
    # Use the pi-specific channel key so we never clobber the
    # shared "channel" entry used by other agents (e.g. claude-code).
    python3 -c "import json, sys; d=json.load(open('$CONFIG_FILE')); print(d.get('pi_channel', '$DEFAULT_CHANNEL'))" 2>/dev/null || echo "$DEFAULT_CHANNEL"
  else
    echo "$DEFAULT_CHANNEL"
  fi
}

set_config() {
  local url="$1"
  local channel="${2:-$DEFAULT_CHANNEL}"
  url="${url%/}"
  mkdir -p "$CONFIG_DIR"
  python3 -c "
import json
try:
    cfg = json.load(open('$CONFIG_FILE'))
except Exception:
    cfg = {}
cfg['url'] = '$url'
cfg['pi_channel'] = '$channel'
with open('$CONFIG_FILE', 'w') as f:
    json.dump(cfg, f, indent=2)
"
  echo "✓ Saved Beacon config to $CONFIG_FILE (URL: $url, Channel: $channel)"
}

check_connection() {
  local url="$1"
  local code
  code=$(curl -k -s -o /dev/null -w "%{http_code}" "$url/api/health" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    return 0
  fi
  code=$(curl -k -s -o /dev/null -w "%{http_code}" "$url/health" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    return 0
  fi
  # Try /api/bootstrap as fallback
  code=$(curl -k -s -o /dev/null -w "%{http_code}" "$url/api/bootstrap" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    return 0
  fi
  return 1
}

register_channel() {
  local url="$1"
  local channel="$2"
  curl -k -s -X POST "$url/api/channels/register" \
    -H "Content-Type: application/json" \
    -d "{\"id\": \"$channel\", \"name\": \"Pi\", \"icon\": \"bot\", \"color\": \"#e0913d\"}" >/dev/null 2>&1 || true
}

cmd_notify() {
  local url
  url=$(get_url)
  if [ -z "$url" ]; then
    echo "ERROR: Beacon server not configured." >&2
    exit 1
  fi
  local channel
  channel=$(get_channel)

  local title="${BEACON_TITLE:-Pi Alert}"
  local body="$*"
  local urgency="${BEACON_URGENCY:-normal}"

  curl -k -s -X POST "$url/api/notify" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json
print(json.dumps({
    'channel': '$channel',
    'title': '$title',
    'body': '''$body''',
    'urgency': '$urgency'
}))
")"
  echo "✓ Notification sent to $url [$channel]"
}

cmd_ask() {
  local url
  url=$(get_url)
  if [ -z "$url" ]; then
    echo "ERROR: Beacon server not configured." >&2
    exit 1
  fi
  local channel
  channel=$(get_channel)
  local prompt="$1"
  local type="${2:-text}" # boolean or text
  local timeout="${3:-300}"

  local res
  res=$(curl -k -s -X POST "$url/api/request?wait=true&timeout=$timeout" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json
print(json.dumps({
    'channel': '$channel',
    'title': 'Question from Pi',
    'prompt': '''$prompt''',
    'type': '$type',
    'timeout_seconds': int('$timeout')
}))
")")

  echo "$res"
}

cmd_choice() {
  local url
  url=$(get_url)
  if [ -z "$url" ]; then
    echo "ERROR: Beacon server not configured." >&2
    exit 1
  fi
  local channel
  channel=$(get_channel)
  local prompt="$1"
  shift
  local options=("$@")
  local timeout=300

  local opts_json
  opts_json=$(python3 -c "import json, sys; print(json.dumps(sys.argv[1:]))" "${options[@]}")

  local res
  res=$(curl -k -s -X POST "$url/api/request?wait=true&timeout=$timeout" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json
opts = json.loads('''$opts_json''')
print(json.dumps({
    'channel': '$channel',
    'title': 'Decision Needed',
    'prompt': '''$prompt''',
    'type': 'choice',
    'options': opts,
    'timeout_seconds': $timeout
}))
")")
  echo "$res"
}

cmd_status() {
  local url
  url=$(get_url)
  if [ -z "$url" ]; then
    echo "ERROR: Beacon server not configured." >&2
    exit 1
  fi
  curl -k -s "$url/api/bootstrap" | python3 -c "
import json, sys
data = json.load(sys.stdin)
pending = len(data.get('pending_requests', []))
notifs = len(data.get('recent_notifications', []))
chans = len(data.get('channels', []))
print(f'Beacon server: {sys.argv[1]}')
print(f'Pending prompts: {pending}')
print(f'Recent notifications: {notifs}')
print(f'Registered channels: {chans}')
" "$url"
}

case "${1:-}" in
  get-url)
    get_url
    ;;
  set-config)
    shift
    set_config "$@"
    ;;
  check)
    shift
    check_connection "$@"
    ;;
  register)
    shift
    register_channel "$@"
    ;;
  notify)
    shift
    cmd_notify "$@"
    ;;
  ask)
    shift
    cmd_ask "$@"
    ;;
  choice)
    shift
    cmd_choice "$@"
    ;;
  status)
    cmd_status
    ;;
  *)
    echo "Usage: $0 {get-url|set-config <url>|check <url>|notify <msg>|ask <prompt> [type] [timeout]|choice <prompt> <opt1> <opt2>...|status}"
    exit 1
    ;;
esac
