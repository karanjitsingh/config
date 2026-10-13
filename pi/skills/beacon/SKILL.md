---
name: beacon
description: "Send push notifications to the user's phone, pause and ask human-in-the-loop questions (yes/no, choices, text input), or wire notification alerts into automations via the Beacon server. Activate whenever the user asks to 'notify me', 'let me know when done', 'talk to me directly', 'ping my phone', or when /skill:beacon is invoked."
license: MIT
allowed-tools: bash, read, write
metadata:
  version: 1.0.0
---

# Beacon: Notifications & Human-in-the-Loop for Pi

This skill connects Pi to **Beacon**, a self-hosted tailnet notification channel and async human-in-the-loop (HITL) prompt inbox.
Beacon sends Web Push notifications to the user's phone and lets them approve, choose, or type responses directly from the Beacon PWA.

All commands below use the bundled helper script. Resolve it relative to this skill directory:

```bash
BEACON="$HOME/.pi/agent/skills/beacon/scripts/beacon.sh"
```

When invoked as `/skill:beacon <subcommand> [args...]`, the arguments arrive as part of the user request. Parse the subcommand (`notify`, `ask`, `choice`, `status`, `config`) from the request text and follow the matching section below.

---

## 1. First-Time Setup & Configuration

Before sending alerts or asking questions, verify that Beacon is configured:

1. **Check for configuration**:
   - Run `bash "$BEACON" get-url`, or check if `$BEACON_URL` is set in the environment.
   - If a URL is returned, verify connectivity with `bash "$BEACON" check "$URL"` (exit code `0` = reachable).

2. **If NOT configured (or configured server is unreachable)**:
   - Ask the user directly in the chat:
     > "Where is your Beacon server running? (e.g. `https://<tailscale-machine>:8450` or `http://localhost:8450`)"
   - Once the user provides the URL (e.g. `URL`):
     - Validate connectivity:
       ```bash
       curl -k -s -o /dev/null -w "%{http_code}" "$URL/health"
       ```
       (Returns `200` if reachable).
     - Save the configuration (writes `url` and a `pi_channel` key; it preserves any existing keys used by other agents):
       ```bash
       bash "$BEACON" set-config "$URL"
       ```
     - Register the `pi` channel:
       ```bash
       curl -k -s -X POST "$URL/api/channels/register" \
         -H "Content-Type: application/json" \
         -d '{"id": "pi", "name": "Pi", "icon": "bot", "color": "#e0913d"}'
       ```
     - Inform the user:
       > "✓ Beacon configured at `$URL` on channel `pi`."

---

## 2. Command Handling (`/skill:beacon`)

### A. `notify <message>`
Send a fire-and-forget notification to the user's phone.
```bash
bash "$BEACON" notify "<message>"
```
Optionally set a custom title or urgency via environment variables:
```bash
BEACON_TITLE="Task Finished" BEACON_URGENCY="urgent" bash "$BEACON" notify "<message>"
```
Notify the user that the push notification was dispatched.

### B. `ask "<question>"`
Ask a question and **pause execution** until the user answers on their phone.
Beacon keeps the HTTP connection open (`?wait=true`) until the user responds or the timeout expires (default 300s).

1. **If yes/no question**:
   ```bash
   bash "$BEACON" ask "<question>" boolean
   ```
2. **If open-ended text question**:
   ```bash
   bash "$BEACON" ask "<question>" text
   ```
3. **Custom timeout** (e.g. 60s):
   ```bash
   bash "$BEACON" ask "<question>" boolean 60
   ```
Parse the JSON response `.response` or `.response_text` and report it back to the conversation.

### C. `choice "<question>" <option1> <option2> ...`
Present multiple options for the user to tap on their phone:
```bash
bash "$BEACON" choice "<question>" "opt1" "opt2" "opt3"
```
Parse the JSON response `.response` and report the chosen option.

### D. `status`
Check inbox activity and channel statistics:
```bash
bash "$BEACON" status
```
Print the number of pending prompts, unread notifications, and registered channels.

### E. `config [url]`
If a URL is provided, validate it and run:
```bash
bash "$BEACON" set-config "$URL"
```
Otherwise print the current config (`bash "$BEACON" get-url`).

---

## 3. Autonomous Usage (Without Explicit `/skill:beacon`)

When running in non-interactive sessions or long autonomous coding loops:

1. **Long-running Task Completion**:
   - If a background build, long test suite, or complex refactor takes more than ~2 minutes, send a Beacon notification upon completion:
     > `bash "$BEACON" notify "Finished: <task summary>"`
2. **Critical Human-in-the-Loop Decisions**:
   - When about to perform a high-impact or destructive action (dropping tables, force-pushing, discarding uncommitted git changes, deleting resources):
     - Do NOT guess.
     - Run `bash "$BEACON" ask "<question>" boolean` to buzz the user's phone.
     - If the user approves, proceed. If they reject, stop safely.
3. **Ambiguity Resolution**:
   - If multiple architectural options exist and the user may be away from the terminal, send a `choice` prompt.

---

## 4. Conversational Requests & Automations

When the user asks you to:
- **"Let me know when this is done"** / **"notify me when finished"**:
  Run the command/build/task, and immediately on completion send a push alert:
  ```bash
  BEACON_TITLE="Task Finished" bash "$BEACON" notify "Finished: <task summary>"
  ```
- **"Talk to me directly"** / **"Ask me on my phone"**:
  Use `bash "$BEACON" ask "<question>" text` to pause execution and buzz the user's phone directly. Once answered in the PWA, resume with their response.
- **"Wire this into an automation / cron / git hook"**:
  Provide or embed the direct curl call into their script without needing external libraries:
  ```bash
  # Send alert from any bash script or cron:
  curl -d "Deploy succeeded" "https://<beacon-host>:8450/api/notify"

  # Pipe failure logs directly from a CI or build command:
  ./test-suite.sh 2>&1 | curl -X POST "https://<beacon-host>:8450/api/notify?title=Test+Failed&urgency=urgent" --data-binary @-
  ```
