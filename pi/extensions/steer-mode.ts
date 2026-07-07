/**
 * Steer Mode Extension
 *
 * Ctrl+S   — toggle between ⚡ steer and 📥 queue modes
 * /qs      — toggle steer / queue mode
 * /q       — open queue in nvim / vim / nano for editing
 * /q clear — clear pending queue
 *
 * Ctrl+Space — toggle between ⚡ steer and 📥 queue modes
 *         Sent steers are shown in the widget while the agent is running.
 * Queue:  Enter adds to an internal list shown in a widget above the editor.
 *         Messages are sent after the agent finishes (not on abort).
 *         /q opens nvim to freely edit / reorder / delete items.
 *
 * When the agent is idle, messages send normally regardless of mode.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

type SendMode = "steer" | "queue";

export default function (pi: ExtensionAPI) {
	let mode: SendMode = "steer";

	// Messages waiting to be sent after the agent finishes.
	const pendingQueue: string[] = [];

	// Steer messages sent during the current agent run (display only, cleared on agent_start).
	const activeSteers: string[] = [];

	let isEditing = false;
	let drainPending = false;

	// ── Widget & status ───────────────────────────────────────────────────────

	function updateUI(ctx: ExtensionContext): void {
		// Footer
		if (mode === "steer") {
			ctx.ui.setStatus("steer-mode", ctx.ui.theme.fg("warning", "⚡ steer"));
		} else {
			const label = pendingQueue.length > 0 ? `📥 queue (${pendingQueue.length})` : "📥 queue";
			ctx.ui.setStatus("steer-mode", ctx.ui.theme.fg("accent", label));
		}

		const lines: string[] = [];

		// Sent steers this run
		if (activeSteers.length > 0) {
			lines.push(ctx.ui.theme.fg("warning", `⚡ Sent steers (${activeSteers.length}):`));
			for (const msg of activeSteers) {
				const firstLine = msg.split("\n")[0]!;
				const preview = firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine;
				lines.push(`  ${ctx.ui.theme.fg("dim", "→")} ${ctx.ui.theme.fg("muted", preview)}`);
			}
		}

		// Pending queue
		if (pendingQueue.length > 0) {
			if (lines.length > 0) lines.push("");
			lines.push(ctx.ui.theme.fg("accent", `📥 Queued (${pendingQueue.length}) — /q to edit, /q clear to clear:`));
			for (let i = 0; i < pendingQueue.length; i++) {
				const preview = pendingQueue[i]!.length > 80 ? pendingQueue[i]!.slice(0, 77) + "…" : pendingQueue[i]!;
				lines.push(`  ${ctx.ui.theme.fg("dim", `${i + 1}.`)} ${preview}`);
			}
		}

		ctx.ui.setWidget("steer-queue", lines.length > 0 ? lines : undefined);
	}

	function toggleMode(ctx: ExtensionContext): void {
		mode = mode === "steer" ? "queue" : "steer";
		updateUI(ctx);
		ctx.ui.notify(
			mode === "steer"
				? "⚡ Steer — Enter interrupts the agent"
				: "📥 Queue — Enter adds to queue (sent after agent finishes)",
			"info",
		);
	}

	// ── Shortcuts ─────────────────────────────────────────────────────────────

	pi.registerShortcut(Key.ctrl(" "), {
		description: "Toggle steer / queue send mode",
		handler: async (ctx) => toggleMode(ctx),
	});

	// ── Commands ──────────────────────────────────────────────────────────────

	pi.registerCommand("qs", {
		description: "Toggle steer / queue send mode",
		handler: async (_args, ctx) => toggleMode(ctx),
	});

	pi.registerCommand("q", {
		description: "Edit pending queue in nvim  |  /q clear — clear queue",
		handler: async (args, ctx) => {
			if (args.trim() === "clear") {
				const count = pendingQueue.length;
				pendingQueue.length = 0;
				updateUI(ctx);
				ctx.ui.notify(count > 0 ? `Cleared ${count} queued message(s)` : "Queue was already empty", "info");
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify("Queue editor requires TUI mode", "warning");
				return;
			}

			const tmpFile = path.join(os.tmpdir(), `pi-steer-queue-${process.pid}.txt`);
			const steerSection =
				activeSteers.length > 0
					? ["── Steers (read-only) ──", ...activeSteers.map((s) => s + "\n---"), ""].join("\n") + "\n"
					: "";
			const queueSection = ["── Queue ──", ...pendingQueue.map((m) => m + "\n---"), ""].join("\n");
			fs.writeFileSync(tmpFile, steerSection + queueSection, "utf-8");

			isEditing = true;
			let requestRender: (() => void) | undefined;
			await ctx.ui.custom<void>((tui, _theme, _kb, done) => {
				requestRender = () => tui.requestRender();
				tui.stop();
				process.stdout.write("\x1b[2J\x1b[H");

				const editor =
					spawnSync("which", ["nvim"]).status === 0
						? "nvim"
						: spawnSync("which", ["vim"]).status === 0
							? "vim"
							: "nano";
				spawnSync(editor, [tmpFile], { stdio: "inherit", env: process.env });

				tui.start();
				done(undefined);
				return { render: () => [], invalidate: () => {} };
			});
			isEditing = false;

			try {
				const raw = fs.readFileSync(tmpFile, "utf-8");
				fs.unlinkSync(tmpFile);
				const lines = raw.split("\n");

				function parseSection(sectionHeader: string): string[] {
					const start = lines.findIndex((l) => l.startsWith(sectionHeader));
					if (start < 0) return [];
					const end = lines.findIndex((l, i) => i > start && l.startsWith("──"));
					const body = lines.slice(start + 1, end >= 0 ? end : undefined).join("\n");
					return body
						.split(/^---$/m)
						.map((chunk) => chunk.trim())
						.filter((chunk) => chunk.length > 0);
				}

				const updatedSteers = parseSection("── Steers");
				const updated = parseSection("── Queue");

				activeSteers.length = 0;
				activeSteers.push(...updatedSteers);
				pendingQueue.length = 0;
				pendingQueue.push(...updated);
				updateUI(ctx);
				requestRender?.();
				ctx.ui.notify(
					pendingQueue.length > 0 ? `Queue updated — ${pendingQueue.length} message(s)` : "Queue cleared",
					"info",
				);
			} catch {
				ctx.ui.notify("Could not read queue file", "warning");
			}

			// Agent finished while we were editing — drain now.
			if (drainPending) {
				drainPending = false;
				if (pendingQueue.length > 0) {
					const [first, ...rest] = pendingQueue.splice(0);
					updateUI(ctx);
					pi.sendUserMessage(first!);
					for (const msg of rest) {
						pi.sendUserMessage(msg, { deliverAs: "followUp" });
					}
				}
			}
		},
	});

	// ── Session start ─────────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		updateUI(ctx);
	});

	// ── Clear steer log at the start of each agent run ────────────────────────

	pi.on("agent_start", async (_event, ctx) => {
		activeSteers.length = 0;
		updateUI(ctx);
	});

	// ── Input interception ────────────────────────────────────────────────────

	pi.on("input", async (event, ctx) => {
		// Extension-injected messages: pass through.
		if (event.source === "extension") {
			return { action: "continue" };
		}

		// Agent is idle → send normally.
		if (ctx.isIdle()) {
			return { action: "continue" };
		}

		if (mode === "steer") {
			// Track for widget display.
			activeSteers.push(event.text);
			updateUI(ctx);
			pi.sendUserMessage(event.text, { deliverAs: "steer" });
			return { action: "handled" };
		}

		// Queue mode: hold the message.
		pendingQueue.push(event.text);
		updateUI(ctx);
		ctx.ui.notify(`Queued (${pendingQueue.length} total) — /q to edit, /q clear to clear`, "info");
		return { action: "handled" };
	});

	// ── Drain queue when agent finishes ───────────────────────────────────────

	pi.on("agent_end", async (event, ctx) => {
		// Always clear the steer log.
		activeSteers.length = 0;

		if (pendingQueue.length === 0) {
			updateUI(ctx);
			return;
		}

		// Don't drain if editor is open — let it drain after editor closes.
		if (isEditing) {
			drainPending = true;
			updateUI(ctx);
			return;
		}

		// Don't drain on abort: if no assistant message was produced, the agent
		// was aborted before it could respond. Keep the queue intact for the next run.
		const messages = (event as unknown as { messages: AgentMessage[] }).messages ?? [];
		const hadResponse = messages.some((m) => m.role === "assistant");
		if (!hadResponse) {
			updateUI(ctx);
			return;
		}

		// Drain: send first message normally (triggers a new turn), rest as followUps.
		const [first, ...rest] = pendingQueue.splice(0);
		updateUI(ctx);
		pi.sendUserMessage(first!);
		for (const msg of rest) {
			pi.sendUserMessage(msg, { deliverAs: "followUp" });
		}
	});
}
