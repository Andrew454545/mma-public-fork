import { useEffect, useRef } from "react";
import { addClickInterceptor } from "@/lib/map/mapState";
import { getBinding } from "@/lib/util/hotkeys";
import type { HotkeyAction } from "@/lib/util/hotkeys";
import { parseHotkey, matchesKey, isEditableElement } from "@/lib/hooks/useHotkey";

/** Hold a single-key hotkey to arm a crosshair, then a map click runs `onClick`
 *  (consuming the click so it never falls through to the default map handler). */
export function useHeldHotkeyClick(
	action: HotkeyAction,
	onClick: (lat: number, lng: number) => void,
	cursor = "crosshair",
) {
	const handlerRef = useRef(onClick);
	handlerRef.current = onClick;

	useEffect(() => {
		let held = false;

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.repeat || isEditableElement(e.target)) return;
			const binding = getBinding(action);
			if (!binding) return;
			for (const alt of parseHotkey(binding)) {
				if (alt.length === 1 && matchesKey(e, alt[0])) {
					held = true;
					document.body.style.cursor = cursor;
					return;
				}
			}
		};

		const onKeyUp = (e: KeyboardEvent) => {
			if (!held) return;
			const binding = getBinding(action);
			if (!binding) return;
			for (const alt of parseHotkey(binding)) {
				if (alt.length === 1 && e.key.toLowerCase() === alt[0].key) {
					held = false;
					document.body.style.cursor = "";
					return;
				}
			}
		};

		const onBlur = () => {
			if (held) {
				held = false;
				document.body.style.cursor = "";
			}
		};

		const dispose = addClickInterceptor((lat, lng) => {
			if (!held) return false;
			handlerRef.current(lat, lng);
			return true;
		});

		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", onBlur);

		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
			dispose();
			document.body.style.cursor = "";
		};
	}, [action, cursor]);
}
