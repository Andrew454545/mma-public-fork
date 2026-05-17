import { log } from "@/lib/util/log";

export type EditorEvent =
	| "location:add"
	| "location:remove"
	| "location:update"
	| "selection:change"
	| "map:open"
	| "map:close";

type Handler = (...args: unknown[]) => void;
const handlers = new Map<EditorEvent, Set<Handler>>();

export function emit(event: EditorEvent, ...args: unknown[]) {
	const set = handlers.get(event);
	if (!set) return;
	for (const h of set) {
		try { h(...args); } catch (e) { log.error(`[event] ${event}:`, e); }
	}
}

export function subscribe(event: EditorEvent, handler: Handler): () => void {
	let set = handlers.get(event);
	if (!set) {
		set = new Set();
		handlers.set(event, set);
	}
	set.add(handler);
	return () => { set!.delete(handler); };
}
