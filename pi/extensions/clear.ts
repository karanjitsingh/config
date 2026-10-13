/**
 * /clear extension - start a fresh session while keeping the current model
 * and thinking level (unlike /new, which reverts to the default model).
 *
 * The model restore must happen in a `session_start` handler, not inside
 * `withSession`: session replacement invalidates the `pi` object captured at
 * load time, so `pi.setModel()` / `pi.setThinkingLevel()` called from the
 * command handler's closure always throws a stale-context error. After
 * replacement, pi re-runs this factory with a fresh `pi` bound to the new
 * runtime, and `session_start` (reason "new") is emitted to those handlers
 * before `withSession` runs. Plain data survives the switch via this
 * module-level slot, because the replacement runtime reuses the cached
 * extension module.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Set by /clear, consumed by the replacement runtime's session_start handler. */
let pendingRestore: { provider: string; modelId: string; thinkingLevel?: ThinkingLevel } | undefined;

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "new" || !pendingRestore) return;

		const { provider, modelId, thinkingLevel } = pendingRestore;
		pendingRestore = undefined;

		// This factory run is bound to the new runtime, so pi.* is valid here.
		const model = ctx.modelRegistry.find(provider, modelId);
		if (model) {
			const ok = await pi.setModel(model);
			if (!ok && ctx.hasUI) {
				ctx.ui.notify(`Could not restore ${provider}/${modelId} (auth not configured)`, "warning");
			}
		} else if (ctx.hasUI) {
			ctx.ui.notify(`Could not restore ${provider}/${modelId} (model unavailable)`, "warning");
		}

		if (thinkingLevel) {
			pi.setThinkingLevel(thinkingLevel);
		}
	});

	pi.registerCommand("clear", {
		description: "Start a new session, keeping the current model and thinking level",

		handler: async (_args, ctx) => {
			// Capture plain data before session replacement invalidates this ctx.
			// Do NOT touch pi.* or ctx after ctx.newSession().
			pendingRestore = ctx.model
				? { provider: ctx.model.provider, modelId: ctx.model.id, thinkingLevel: ctx.thinkingLevel }
				: undefined;

			const result = await ctx.newSession({
				withSession: async (freshCtx) => {
					// The session_start handler above has already restored the
					// model and thinking level by the time this runs.
					if (freshCtx.hasUI) {
						freshCtx.ui.notify("Context cleared — kept model and thinking level", "info");
					}
				},
			});

			if (result.cancelled) {
				pendingRestore = undefined;
			}
		},
	});
}
