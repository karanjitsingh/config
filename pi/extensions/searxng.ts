/**
 * SearXNG web search tool for Pi.
 *
 * Registers `web_search`, backed by a SearXNG instance with JSON output enabled.
 * Set SEARXNG_URL to override the default (http://127.0.0.1:8888).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const BASE_URL = (process.env.SEARXNG_URL ?? "http://127.0.0.1:8888").replace(/\/+$/, "");
const TIMEOUT_MS = 20_000;
const SNIPPET_CHARS = 300;

interface SearxResult {
	title?: string;
	url?: string;
	content?: string;
	publishedDate?: string;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web via SearXNG. Returns titles, URLs and snippets. Use for current information, documentation, or anything outside your training data.",
		promptSnippet: "Search the web (SearXNG) for current information",
		promptGuidelines: [
			"Use web_search for recent events, versions, docs and facts you are unsure about.",
			"Fetch a result's URL (e.g. with curl in bash) when a snippet is not enough.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			max_results: Type.Optional(Type.Number({ description: "Results to return (default 8, max 20)", default: 8 })),
			time_range: Type.Optional(
				Type.String({ description: 'Limit to recent results: "day", "week", "month" or "year"' }),
			),
		}),
		async execute(_toolCallId, params, signal) {
			const limit = Math.min(Math.max(Math.floor(params.max_results ?? 8), 1), 20);
			const url = new URL(`${BASE_URL}/search`);
			url.searchParams.set("q", params.query);
			url.searchParams.set("format", "json");
			if (params.time_range) url.searchParams.set("time_range", params.time_range);

			const timeout = AbortSignal.timeout(TIMEOUT_MS);
			const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
			if (!res.ok) throw new Error(`SearXNG returned HTTP ${res.status} from ${BASE_URL}`);

			const data = (await res.json()) as { results?: SearxResult[] };
			const results = (data.results ?? []).slice(0, limit);
			if (results.length === 0) {
				return { content: [{ type: "text", text: `No results for "${params.query}".` }], details: { count: 0 } };
			}

			const text = results
				.map((r, i) => {
					const snippet = (r.content ?? "").replace(/\s+/g, " ").trim().slice(0, SNIPPET_CHARS);
					const date = r.publishedDate ? ` (${r.publishedDate.slice(0, 10)})` : "";
					return `${i + 1}. ${r.title ?? "(untitled)"}${date}\n   ${r.url}\n   ${snippet}`;
				})
				.join("\n\n");

			return { content: [{ type: "text", text }], details: { count: results.length, query: params.query } };
		},
	});
}
