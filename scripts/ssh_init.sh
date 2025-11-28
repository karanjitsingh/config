
# Print motd
if [ -z "$SSH_ORIGINAL_COMMAND" ]; then
  # No command: Run login shell (for interactive or tunnel sessions)
  SHELL_CMD="$SHELL -l"
  cat /etc/motd
else
  # Command supplied: Run it (for exec requests)
  SHELL_CMD="/bin/sh -c '$SSH_ORIGINAL_COMMAND'"
fi

# disable sleep
# exec systemd-inhibit --who="SSH session" --why="Active SSH user delays suspend" --what=idle:sleep --mode=block $SHELL_CMD
# let's make disabling sleep explicit

$SHELL_CMD
