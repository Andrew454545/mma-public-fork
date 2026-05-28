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

/**
 * Trace sequential steps within a function. Each `.step()` logs the time
 * since the previous step (or creation). `.end()` logs a summary with total.
 *
 *     const t = trace("commit");
 *     await bakeAndSave();
 *     t.step("bake_and_save");         // → [commit] bake_and_save=12ms
 *     await computeDiff();
 *     t.step("computeCommitDiff");     // → [commit] computeCommitDiff=3ms
 *     t.end();                         // → [commit] total=15ms
 *
 * Or collect everything into one summary line:
 *
 *     const t = trace("selection", { summary: true });
 *     // ... do work ...
 *     t.step("ipc");
 *     // ... more work ...
 *     t.step("apply");
 *     t.end({ selected: result.count });
 *     // → [selection] total=45ms ipc=30ms apply=15ms selected=42
 *
 * No-op in production builds.
 */
export interface Trace {
	step(label: string, extra?: string): void;
	end(data?: Record<string, unknown>): void;
}

const NOOP_TRACE: Trace = { step: () => {}, end: () => {} };

export function trace(group: string, opts?: { summary?: boolean }): Trace {
	if (!ENABLED) return NOOP_TRACE;
	const summary = opts?.summary ?? false;
	const t0 = performance.now();
	let prev = t0;
	const steps: { label: string; ms: number; extra?: string }[] = [];

	return {
		step(label: string, extra?: string) {
			const now = performance.now();
			const ms = now - prev;
			steps.push({ label, ms, extra });
			if (!summary) {
				const suffix = extra ? `  ${extra}` : "";
				log.debug(`[${group}] ${label}=${ms.toFixed(0)}ms${suffix}`);
			}
			prev = now;
		},
		end(data?: Record<string, unknown>) {
			const total = performance.now() - t0;
			if (summary) {
				const parts = [`total=${total.toFixed(0)}ms`];
				for (const s of steps) {
					let part = `${s.label}=${s.ms.toFixed(0)}ms`;
					if (s.extra) part += ` ${s.extra}`;
					parts.push(part);
				}
				if (data) {
					for (const [k, v] of Object.entries(data)) parts.push(`${k}=${v}`);
				}
				log.debug(`[${group}] ${parts.join(" ")}`);
			} else {
				const extras = data
					? " " + Object.entries(data).map(([k, v]) => `${k}=${v}`).join(" ")
					: "";
				log.debug(`[${group}] total=${total.toFixed(0)}ms${extras}`);
			}
		},
	};
}
