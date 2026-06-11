// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import {
	matchMapKeyBinding,
	executeMapKeyAction,
	registerMapKeyActionHandler,
	handleMapKeyEvent,
} from "@/lib/map/mapKeyBindings";
import { isEditableElement } from "@/lib/hooks/useHotkey";
import type { MapKeyBinding } from "@/bindings.gen";

function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
	return new KeyboardEvent("keydown", { key, cancelable: true, ...init });
}

const applyTag = (tagId: number): MapKeyBinding["action"] => ({ type: "applyTag", tagId });

describe("matchMapKeyBinding", () => {
	const bindings: MapKeyBinding[] = [
		{ key: "m", action: applyTag(1) },
		{ key: "Mod+Shift+x", action: applyTag(2) },
		{ key: "", action: applyTag(3) },
	];

	it("matches a plain key", () => {
		expect(matchMapKeyBinding(keyEvent("m"), bindings)?.action).toEqual(applyTag(1));
	});

	it("matches a modifier combo", () => {
		const e = keyEvent("x", { ctrlKey: true, shiftKey: true });
		expect(matchMapKeyBinding(e, bindings)?.action).toEqual(applyTag(2));
	});

	it("does not match when modifiers differ", () => {
		expect(matchMapKeyBinding(keyEvent("m", { ctrlKey: true }), bindings)).toBeUndefined();
		expect(matchMapKeyBinding(keyEvent("x"), bindings)).toBeUndefined();
	});

	it("ignores empty-key bindings", () => {
		expect(matchMapKeyBinding(keyEvent(""), bindings)).toBeUndefined();
	});
});

describe("action handler registry", () => {
	const cleanups: Array<() => void> = [];
	afterEach(() => {
		while (cleanups.length) cleanups.pop()!();
	});

	it("executes a registered handler and reports consumption", () => {
		const seen: number[] = [];
		cleanups.push(registerMapKeyActionHandler("applyTag", (a) => seen.push(a.tagId)));
		expect(executeMapKeyAction(applyTag(7))).toBe(true);
		expect(seen).toEqual([7]);
	});

	it("returns false when no handler is registered", () => {
		expect(executeMapKeyAction(applyTag(7))).toBe(false);
	});

	it("unregister removes the handler", () => {
		const unregister = registerMapKeyActionHandler("applyTag", () => {});
		unregister();
		expect(executeMapKeyAction(applyTag(1))).toBe(false);
	});
});

describe("handleMapKeyEvent", () => {
	const cleanups: Array<() => void> = [];
	afterEach(() => {
		while (cleanups.length) cleanups.pop()!();
	});
	const bindings: MapKeyBinding[] = [{ key: "m", action: applyTag(1) }];

	it("consumes the event when a handler exists", () => {
		cleanups.push(registerMapKeyActionHandler("applyTag", () => {}));
		const e = keyEvent("m");
		expect(handleMapKeyEvent(e, bindings)).toBe(true);
		expect(e.defaultPrevented).toBe(true);
	});

	it("falls through (no preventDefault) when no handler is registered", () => {
		const e = keyEvent("m");
		expect(handleMapKeyEvent(e, bindings)).toBe(false);
		expect(e.defaultPrevented).toBe(false);
	});

	it("ignores repeats and already-handled events", () => {
		cleanups.push(registerMapKeyActionHandler("applyTag", () => {}));
		expect(handleMapKeyEvent(keyEvent("m", { repeat: true }), bindings)).toBe(false);
		const handled = keyEvent("m");
		handled.preventDefault();
		expect(handleMapKeyEvent(handled, bindings)).toBe(false);
	});

	it("ignores keys typed into editable elements", () => {
		cleanups.push(registerMapKeyActionHandler("applyTag", () => {}));
		const input = document.createElement("input");
		document.body.appendChild(input);
		expect(isEditableElement(input)).toBe(true);
		const e = keyEvent("m");
		Object.defineProperty(e, "target", { value: input });
		expect(handleMapKeyEvent(e, bindings)).toBe(false);
		input.remove();
	});
});

// Invariant: per-map bindings (window capture) win over global hotkeys
// (document capture) regardless of listener registration order, because the
// capture phase propagates window -> document. Global handlers skip events
// that are already defaultPrevented.
describe("precedence over global hotkey layer", () => {
	it("window-capture map binding preempts a document-capture global handler", () => {
		const order: string[] = [];
		const globalHandler = (e: KeyboardEvent) => {
			if (e.defaultPrevented) return;
			order.push("global");
		};
		// Register the global (document, capture) handler FIRST to prove order independence.
		document.addEventListener("keydown", globalHandler, true);
		const unregister = registerMapKeyActionHandler("applyTag", () => order.push("map"));
		const mapHandler = (e: KeyboardEvent) => {
			handleMapKeyEvent(e, [{ key: "m", action: applyTag(1) }]);
		};
		window.addEventListener("keydown", mapHandler, true);

		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "m", cancelable: true, bubbles: true }));

		document.removeEventListener("keydown", globalHandler, true);
		window.removeEventListener("keydown", mapHandler, true);
		unregister();
		expect(order).toEqual(["map"]);
	});
});
