import { useEffect } from "react";
import type { MapKeyAction, MapKeyBinding } from "@/bindings.gen";
import { parseHotkey, matchesKey, isEditableElement } from "@/lib/hooks/useHotkey";

/**
 * Per-map key binding layer. Bindings live on `MapSettings.keyBindings`; each maps
 * a combo string (same format as global hotkeys) to a MapKeyAction. Action handlers
 * are registered by the component that owns the relevant state (e.g. the location
 * editor registers applyTag while a location is open), so an action only consumes
 * the key when it is currently applicable — otherwise the event falls through to
 * the global hotkey layer.
 */

type ActionType = MapKeyAction["type"];
type ActionOf<T extends ActionType> = Extract<MapKeyAction, { type: T }>;

const handlers = new Map<ActionType, (action: MapKeyAction) => void>();

export function registerMapKeyActionHandler<T extends ActionType>(
	type: T,
	fn: (action: ActionOf<T>) => void,
): () => void {
	handlers.set(type, fn as (action: MapKeyAction) => void);
	return () => {
		if (handlers.get(type) === fn) handlers.delete(type);
	};
}

export function matchMapKeyBinding(
	e: KeyboardEvent,
	bindings: MapKeyBinding[],
): MapKeyBinding | undefined {
	for (const b of bindings) {
		if (!b.key) continue;
		for (const alt of parseHotkey(b.key)) {
			if (alt.length === 1 && matchesKey(e, alt[0])) return b;
		}
	}
	return undefined;
}

/** Returns true if a registered handler consumed the action. */
export function executeMapKeyAction(action: MapKeyAction): boolean {
	const fn = handlers.get(action.type);
	if (!fn) return false;
	fn(action);
	return true;
}

/** Resolve a keydown against the current bindings; consume it if handled. */
export function handleMapKeyEvent(e: KeyboardEvent, bindings: MapKeyBinding[]): boolean {
	if (e.defaultPrevented || e.repeat) return false;
	if (isEditableElement(e.target)) return false;
	if (bindings.length === 0) return false;
	const binding = matchMapKeyBinding(e, bindings);
	if (!binding) return false;
	if (!executeMapKeyAction(binding.action)) return false;
	e.preventDefault();
	return true;
}

/**
 * Mounted once by the map editor. Listens on window in the capture phase so
 * per-map bindings win over the document-capture global hotkey handlers
 * regardless of mount order (capture propagates window -> document).
 */
export function useMapKeyBindings(getBindings: () => MapKeyBinding[]) {
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			handleMapKeyEvent(e, getBindings());
		};
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
}
