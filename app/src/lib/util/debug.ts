/**
 * Lightweight timing + log helpers gated on `import.meta.env.DEV`.
 *
 * Replaces ad-hoc `console.time` / `console.timeEnd` pairs scattered
 * across the codebase. In production builds Vite/terser dead-code-
 * eliminates the call sites because the gate is a static `const`.
 *
 * Usage:
 *
 *   const span = debugSpan("openMap:loadWorkingTree");
 *   const locs = await loadWorkingTree(id);
 *   span.end(`${locs.length} locations`);
 *
 *   // or wrap an async block:
 *   const result = await debugTime("openMap:total", () => doWork());
 */

import { log } from "@/lib/util/log";

const ENABLED: boolean = import.meta.env.DEV;

export interface DebugSpan {
	/** Stop the span and emit a log line. `extra` is appended after the
	 *  duration (e.g., a count or size). No-op when debug is disabled. */
	end(extra?: string): void;
}

const NOOP_SPAN: DebugSpan = { end: () => {} };

export function debugSpan(label: string): DebugSpan {
	if (!ENABLED) return NOOP_SPAN;
	const start = performance.now();
	return {
		end(extra?: string) {
			const ms = performance.now() - start;
			const suffix = extra ? `  ${extra}` : "";
			// Keep the line easy to grep for ("[debug] ").
			log.debug(`[debug] ${label}: ${ms.toFixed(1)}ms${suffix}`);
		},
	};
}

export function debug(label: string, ...args: unknown[]): void {
	if (!ENABLED) return;
	log.debug(`[debug] ${label}`, ...args);
}

export async function debugTime<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
	if (!ENABLED) return await fn();
	const span = debugSpan(label);
	try {
		return await fn();
	} finally {
		span.end();
	}
}
