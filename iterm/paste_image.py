#!/usr/bin/python3
"""Paste clipboard files/images into the front iTerm2 session, even over SSH.

Run as an iTerm2 "Run Coprocess" key binding: whatever this prints is typed
into the session. Files copied in Finder keep their names; raw image data is
saved as clip-<timestamp>.png. If the session is running `ssh`, everything is uploaded to
the remote host (reusing the same ssh arguments) and the remote paths are
printed. Otherwise the local paths are printed.
"""
import os
import shlex
import subprocess
import sys
import time

LOCAL_DIR = "/tmp/iterm-clip"
REMOTE_DIR = "/tmp/iterm-clip"

# ssh flags that take an argument
SSH_ARG_FLAGS = set("BbcDEeFIiJLlmOoPpQRSWw")
# ssh flags we drop because they break a non-interactive upload
SSH_DROP_FLAGS = set("tTNfnGV")


def notify(msg):
    script = f"display notification {applescript_str(msg)} with title \"Paste image\""
    subprocess.run(["osascript", "-e", script], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def applescript_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def clipboard_file_paths():
    """Paths of files copied in Finder, if any."""
    js = (
        'ObjC.import("AppKit");'
        'var a = $.NSPasteboard.generalPasteboard.readObjectsForClassesOptions('
        '$([$.NSURL]), $({NSPasteboardURLReadingFileURLsOnlyKey: true}));'
        'var o = []; if (a) for (var i = 0; i < a.count; i++) o.push(a.objectAtIndex(i).path.js);'
        'o.join("\\n")'
    )
    r = subprocess.run(["osascript", "-l", "JavaScript", "-e", js],
                       capture_output=True, text=True)
    return [p for p in r.stdout.splitlines() if p] if r.returncode == 0 else []


def save_clipboard_image(path):
    script = [
        f"set f to open for access POSIX file {applescript_str(path)} with write permission",
        "set eof f to 0",
        "write (the clipboard as «class PNGf») to f",
        "close access f",
    ]
    args = ["osascript"]
    for line in script:
        args += ["-e", line]
    r = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return r.returncode == 0 and os.path.exists(path) and os.path.getsize(path) > 0


def front_session_tty():
    r = subprocess.run(
        ["osascript", "-e", 'tell application "iTerm2" to tty of current session of current window'],
        capture_output=True, text=True,
    )
    return r.stdout.strip() if r.returncode == 0 else None


def find_ssh_argv(tty):
    """Return argv of the innermost ssh process attached to the tty, or None."""
    r = subprocess.run(["ps", "-t", os.path.basename(tty), "-o", "pid=,args="],
                       capture_output=True, text=True)
    found = None
    for line in r.stdout.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) < 2:
            continue
        argv = shlex.split(parts[1])
        if argv and os.path.basename(argv[0]) == "ssh":
            found = argv  # later (higher pid) wins -> usually the innermost
    return found


def build_upload_cmd(ssh_argv, remote_cmd):
    """Rebuild the ssh command: same options + destination, our remote command."""
    opts, dest = [], None
    args = ssh_argv[1:]
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith("-") and len(a) > 1:
            cluster = a[1:]
            kept = ""
            for j, ch in enumerate(cluster):
                if ch in SSH_ARG_FLAGS:
                    val = cluster[j + 1:]
                    if not val:
                        i += 1
                        val = args[i] if i < len(args) else ""
                    if kept:
                        opts.append("-" + kept)
                        kept = ""
                    opts += ["-" + ch, val]
                    break
                if ch not in SSH_DROP_FLAGS:
                    kept += ch
            else:
                if kept:
                    opts.append("-" + kept)
            i += 1
            continue
        dest = a  # first non-option arg; anything after is a remote command
        break
    if dest is None:
        return None
    return ["ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
            *opts, dest, remote_cmd]


def main():
    local_paths = clipboard_file_paths()
    if not local_paths:
        os.makedirs(LOCAL_DIR, exist_ok=True)
        image_path = os.path.join(LOCAL_DIR, f"clip-{time.strftime('%Y%m%d-%H%M%S')}.png")
        if not save_clipboard_image(image_path):
            notify("No file or image on the clipboard")
            return
        local_paths = [image_path]

    tty = front_session_tty()
    ssh_argv = find_ssh_argv(tty) if tty else None
    if not ssh_argv:
        sys.stdout.write(" ".join(shlex.quote(p) for p in local_paths) + " ")
        return

    remote_cmd = f"mkdir -p {REMOTE_DIR} && tar -xf - -C {REMOTE_DIR} 2>/dev/null"
    cmd = build_upload_cmd(ssh_argv, remote_cmd)
    if cmd is None:
        notify("Couldn't parse ssh command: " + " ".join(ssh_argv))
        return
    # One tar stream so several files (or folders) go over a single connection.
    tar_cmd = ["tar", "--no-mac-metadata", "-cf", "-"]
    for p in local_paths:
        tar_cmd += ["-C", os.path.dirname(p) or "/", os.path.basename(p)]
    env = dict(os.environ, COPYFILE_DISABLE="1")
    tar = subprocess.Popen(tar_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
    r = subprocess.run(cmd, stdin=tar.stdout, stdout=subprocess.DEVNULL,
                       stderr=subprocess.PIPE, text=True)
    tar.stdout.close()
    tar.wait()
    if r.returncode != 0 or tar.returncode != 0:
        notify(f"Upload failed: {r.stderr.strip()[:200]}")
        return
    remote_paths = [f"{REMOTE_DIR}/{os.path.basename(p)}" for p in local_paths]
    sys.stdout.write(" ".join(shlex.quote(p) for p in remote_paths) + " ")


if __name__ == "__main__":
    main()
