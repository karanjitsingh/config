/**
 * Sudo Extension for Pi (terminal-based, masked password input)
 *
 * - Blocks `sudo` in regular bash commands
 * - Registers a `sudo_run` tool that:
 *   1. Confirms the command with the user
 *   2. Collects the password via a masked TUI input (shows ● per char)
 *   3. Pipes the password to sudo -S
 * - The password never enters the model context or session transcript
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Input, Text, type Component, type Focusable, matchesKey } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

// Match sudo as a command (at start of line or after ; | && ||), not in filenames
const SUDO_PATTERN = /(?:^|;|\|\||&&|\|)\s*sudo\b/i;

/** Custom password input that masks characters as ● */
class PasswordInput implements Component, Focusable {
	private value = "";
	private cursor = 0;
	focused = false;
	onSubmit?: (value: string) => void;
	onEscape?: () => void;

	getValue(): string {
		return this.value;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "enter") || matchesKey(data, "tui.input.submit")) {
			this.onSubmit?.(this.value);
			return;
		}
		if (matchesKey(data, "escape") || matchesKey(data, "tui.select.cancel")) {
			this.onEscape?.();
			return;
		}
		if (matchesKey(data, "backspace") || matchesKey(data, "tui.editor.deleteCharBackward")) {
			if (this.cursor > 0) {
				this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
				this.cursor--;
			}
			return;
		}
		if (matchesKey(data, "delete") || matchesKey(data, "tui.editor.deleteCharForward")) {
			if (this.cursor < this.value.length) {
				this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1);
			}
			return;
		}
		if (matchesKey(data, "left") || matchesKey(data, "tui.editor.cursorLeft")) {
			if (this.cursor > 0) this.cursor--;
			return;
		}
		if (matchesKey(data, "right") || matchesKey(data, "tui.editor.cursorRight")) {
			if (this.cursor < this.value.length) this.cursor++;
			return;
		}
		if (matchesKey(data, "home") || matchesKey(data, "tui.editor.cursorLineStart")) {
			this.cursor = 0;
			return;
		}
		if (matchesKey(data, "end") || matchesKey(data, "tui.editor.cursorLineEnd")) {
			this.cursor = this.value.length;
			return;
		}
		// Printable character
		const hasControlChars = [...data].some((ch) => {
			const code = ch.charCodeAt(0);
			return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
		});
		if (!hasControlChars && data.length > 0) {
			this.value = this.value.slice(0, this.cursor) + data + this.value.slice(this.cursor);
			this.cursor += data.length;
		}
	}

	invalidate(): void {}

	render(width: number): string[] {
		const prompt = "🔒 Password: ";
		const masked = "●".repeat(this.value.length);
		const beforeCursor = masked.slice(0, this.cursor);
		const atCursor = this.cursor < masked.length ? masked[this.cursor] : " ";
		const afterCursor = masked.slice(this.cursor + 1);

		// Inverse video cursor
		const cursorChar = `\x1b[7m${atCursor}\x1b[27m`;
		const display = beforeCursor + cursorChar + afterCursor;
		const line = prompt + display;
		const padding = " ".repeat(Math.max(0, width - line.length));
		return [line + padding];
	}
}

export default function (pi: ExtensionAPI) {
	// Block sudo in regular bash commands
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = (event.input.command as string) ?? "";
		if (SUDO_PATTERN.test(command)) {
			ctx.ui.notify("⚠️ sudo blocked in bash — use sudo_run instead", "warning");
			return { block: true, reason: "sudo commands are blocked in bash. Use the sudo_run tool instead." };
		}
		return undefined;
	});

	// Register the sudo_run tool
	pi.registerTool({
		name: "sudo_run",
		label: "Sudo Run",
		description:
			"Run a command with sudo privileges. A password prompt will appear for the user to enter their password (masked). The password never enters the model context. Use this instead of putting sudo in bash commands.",
		promptSnippet: "Run commands with sudo via a secure masked password prompt",
		promptGuidelines: [
			"Use sudo_run instead of bash with sudo when elevated privileges are needed.",
			"sudo_run prompts the user for their password so they can review and approve the command before it runs.",
			"Never put sudo in bash commands — they are blocked. Always use sudo_run.",
		],
		parameters: Type.Object({
			argv: Type.Array(Type.String(), {
				description: 'Command and arguments as a list, e.g. ["apt", "install", "-y", "htop"]',
			}),
			reason: Type.String({
				description: "One-line justification for why sudo is needed, shown in the password dialog",
			}),
			timeout_seconds: Type.Optional(
				Type.Number({ description: "Hard timeout in seconds (default 120, max 3600)", default: 120 }),
			),
			cwd: Type.Optional(Type.String({ description: "Working directory for the command" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				throw new Error("sudo_run requires an interactive terminal for password entry.");
			}
			if (ctx.mode !== "tui") {
				throw new Error("sudo_run requires TUI mode for masked password input.");
			}

			// Show the user what command is about to run and ask for confirmation
			const cmdStr = params.argv.join(" ");
			const confirmed = await ctx.ui.confirm(
				"🔒 Sudo Command",
				`Command: ${cmdStr}\nReason: ${params.reason}\n\nAllow and enter password?`,
			);

			if (!confirmed) {
				throw new Error("User denied sudo command.");
			}

			// Collect password via custom masked input component
			const password = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
				const pwInput = new PasswordInput();

				pwInput.onSubmit = (value: string) => {
					done(value || null);
				};
				pwInput.onEscape = () => {
					done(null);
				};

				return pwInput;
			});

			if (!password) {
				throw new Error("No password provided. Command aborted.");
			}

			// Build the full command with sudo -S (read password from stdin)
			const timeout = Math.min(params.timeout_seconds ?? 120, 3600);
			const cwd = params.cwd ? resolve(ctx.cwd, params.cwd) : ctx.cwd;
			const fullArgv = ["sudo", "-S", ...params.argv];

			return await new Promise((resolvePromise, reject) => {
				const proc = spawn(fullArgv[0], fullArgv.slice(1), {
					cwd,
					env: { ...process.env },
					stdio: ["pipe", "pipe", "pipe"],
				});

				let stdout = "";
				let stderr = "";

				proc.stdout.on("data", (chunk: Buffer) => {
					stdout += chunk.toString();
				});

				proc.stderr.on("data", (chunk: Buffer) => {
					stderr += chunk.toString();
				});

				// Pipe password to sudo's stdin, then close it
				proc.stdin.write(password + "\n");
				proc.stdin.end();

				// Handle abort signal
				const onAbort = () => {
					proc.kill("SIGTERM");
					setTimeout(() => proc.kill("SIGKILL"), 2000);
				};
				signal?.addEventListener("abort", onAbort, { once: true });

				// Timeout
				const timer = setTimeout(() => {
					proc.kill("SIGTERM");
					setTimeout(() => proc.kill("SIGKILL"), 2000);
				}, timeout * 1000);

				proc.on("close", (code) => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);

					// Filter out the "Password:" prompt line from stderr
					const cleanStderr = stderr
						.split("\n")
						.filter((line) => !line.startsWith("[sudo]") && line !== "Password:")
						.join("\n")
						.trim();

					const output = [`exit_code: ${code ?? "unknown"}`];
					if (stdout.trim()) output.push(`--- stdout ---\n${stdout.trim()}`);
					if (cleanStderr) output.push(`--- stderr ---\n${cleanStderr}`);

					resolvePromise({
						content: [{ type: "text", text: output.join("\n") }],
						details: { exitCode: code, stdout, stderr: cleanStderr },
					});
				});

				proc.on("error", (err) => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
					reject(new Error(`Failed to run sudo: ${err.message}`));
				});
			});
		},
	});
}
