/**
 * Steer Mode Extension
 *
 * Ctrl+Space — toggle between ⚡ steer and 📥 queue modes
 * /qs      — toggle steer / queue mode
 * /q       — open queue in nvim / vim / nano for editing
 * /q clear — clear pending queue
 *
 * Steer: Enter sends the message immediately as a real-time interrupt. Sent
 *         steers appear in the widget as a read-only log (they cannot be
 *         deleted — they were already delivered).
 * Queue:  Enter adds to an internal list shown in a widget above the editor.
 *         Messages are sent after the agent finishes (not on abort).
 *         /q opens nvim to freely edit / reorder / delete queue items.
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

	// Send queued messages to the agent. The delivery mode depends on whether the
	// agent is currently streaming, because a bare sendUserMessage() throws
	// "Agent is already processing" while the agent is mid-run (notably inside an
	// agent_end handler, where isStreaming is still true until finishRun() runs).
	function drain(ctx: ExtensionContext): void {
		if (pendingQueue.length === 0) return;

		if (ctx.isIdle()) {
			// Agent is idle: send the first message to start a fresh turn, and keep
			// the rest in pendingQueue — they'll be queued as followUp at the next
			// agent_end (which runs while streaming, see the else branch).
			const first = pendingQueue.shift()!;
			updateUI(ctx);
			pi.sendUserMessage(first);
			return;
		}

		// Agent is streaming (e.g. inside agent_end): queue everything as followUp.
		// The agent's post-run continuation (agent.continue()) drains them in order.
		const items = pendingQueue.splice(0);
		updateUI(ctx);
		for (const msg of items) {
			pi.sendUserMessage(msg, { deliverAs: "followUp" });
		}
	}

	// ── Shortcuts ─────────────────────────────────────────────────────────────

	pi.registerShortcut(Key.ctrl("space"), {
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

				// Steers are read-only: they were already delivered as real-time interrupts
				// the moment Enter was pressed, so edits/deletions in the editor cannot
				// un-send them. Only the Queue section is parsed back.
				const updated = parseSection("── Queue");

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

			// Agent finished while we were editing — drain now. drain() checks
			// ctx.isIdle() and picks a safe delivery mode (the agent is idle here).
			if (drainPending) {
				drainPending = false;
				drain(ctx);
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

		// Drain: route through drain(), which queues as followUp since the agent is
		// still streaming at agent_end (a bare sendUserMessage would throw
		// "Agent is already processing"). The post-run continuation drains them.
		drain(ctx);
	});
}
