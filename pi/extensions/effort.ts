/**
 * /effort extension - quickly set the thinking level from the command line.
 *
 * Usage:
 *   /effort        → shows current level
 *   /effort off
 *   /effort minimal
 *   /effort low
 *   /effort medium
 *   /effort high
 *   /effort xhigh
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export default function (pi: ExtensionAPI) {
  pi.registerCommand("effort", {
    description: "Get or set the thinking level (off / minimal / low / medium / high / xhigh)",

    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items = LEVELS.map((l) => ({ value: l, label: l }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },

    handler: async (args, ctx) => {
      const input = args.trim().toLowerCase() as ThinkingLevel;

      // No argument — show current level
      if (!input) {
        const current = pi.getThinkingLevel();
        ctx.ui.notify(`Current thinking level: ${current}`, "info");
        return;
      }

      if (!LEVELS.includes(input)) {
        ctx.ui.notify(
          `Unknown level "${input}". Choose from: ${LEVELS.join(", ")}`,
          "error"
        );
        return;
      }

      pi.setThinkingLevel(input);
      ctx.ui.notify(`Thinking level set to: ${input}`, "info");
    },
  });
}
