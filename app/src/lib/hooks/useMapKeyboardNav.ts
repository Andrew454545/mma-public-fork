import { useEffect, useRef } from "react";
import { getSettings } from "@/store/settings";
import { parseHotkey, matchesKey, isEditableElement } from "@/lib/hooks/useHotkey";
import { getBinding } from "@/lib/util/hotkeys";
import { google } from "@/lib/sv/opensv";

/** Held-key map panning/zooming (pan*, mapZoomIn/Out) via an RAF tick loop, scoped to the
 *  given map. Bindings are resolved once on mount; speeds read live from app settings. */
export function useMapKeyboardNav(map: google.maps.Map | null) {
	const navRef = useRef({
		held: new Set<string>(),
		zoom: null as number | null,
		rafId: 0,
		alt: false,
		lastTime: 0,
	});

	useEffect(() => {
		if (!map) return;
		const gmap = map;
		const nav = navRef.current;
		const actions = ["panLeft", "panRight", "panUp", "panDown", "mapZoomIn", "mapZoomOut"] as const;

		function tick() {
			if (nav.held.size === 0) {
				nav.rafId = 0;
				nav.lastTime = 0;
				return;
			}

			const now = performance.now();
			const dt = nav.lastTime ? (now - nav.lastTime) / 16.667 : 1;
			nav.lastTime = now;

			const proj = gmap.getProjection();
			const center = gmap.getCenter();
			if (!proj || !center) {
				nav.rafId = 0;
				nav.lastTime = 0;
				return;
			}

			if (nav.zoom === null) nav.zoom = gmap.getZoom() ?? 2;

			const s = getSettings();
			const slow = nav.alt ? s.slowModifier : 1;
			let dx = 0,
				dy = 0;
			if (nav.held.has("panLeft")) dx -= (s.mapPanSpeed * dt) / slow;
			if (nav.held.has("panRight")) dx += (s.mapPanSpeed * dt) / slow;
			if (nav.held.has("panUp")) dy -= (s.mapPanSpeed * dt) / slow;
			if (nav.held.has("panDown")) dy += (s.mapPanSpeed * dt) / slow;

			const zoomStep = (0.02 * dt) / slow;
			if (nav.held.has("mapZoomIn")) nav.zoom += zoomStep;
			if (nav.held.has("mapZoomOut")) nav.zoom = Math.max(1, nav.zoom - zoomStep);

			const scale = Math.pow(2, nav.zoom);
			const worldPoint = proj.fromLatLngToPoint(center)!;
			worldPoint.x += dx / scale;
			worldPoint.y += dy / scale;

			gmap.moveCamera({
				center: proj.fromPointToLatLng(worldPoint)!,
				zoom: nav.zoom,
			});
			nav.rafId = requestAnimationFrame(tick);
		}

		const bindings = actions.map((a) => ({
			action: a,
			parsed: parseHotkey(getBinding(a)),
		}));

		function onKeyDown(e: KeyboardEvent) {
			nav.alt = e.altKey;
			if (e.key === "Alt") {
				e.preventDefault();
				return;
			}
			if (e.defaultPrevented || e.repeat) return;
			if (isEditableElement(e.target)) return;
			for (const { action, parsed } of bindings) {
				for (const alt of parsed) {
					if (alt.length === 1 && matchesKey(e, alt[0], { ignoreAlt: true })) {
						nav.held.add(action);
						if (!nav.rafId) nav.rafId = requestAnimationFrame(tick);
						return;
					}
				}
			}
		}

		function onKeyUp(e: KeyboardEvent) {
			nav.alt = e.altKey;
			if (nav.held.size === 0) return;
			const key = e.key.toLowerCase();
			for (const { action, parsed } of bindings) {
				for (const alt of parsed) {
					if (alt.length === 1 && alt[0].key === key) {
						nav.held.delete(action);
					}
				}
			}
		}

		const zoomListener = map.addListener("zoom_changed", () => {
			if (nav.held.size === 0) nav.zoom = null;
		});

		function onBlur() {
			nav.held.clear();
		}

		document.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("keyup", onKeyUp, true);
		window.addEventListener("blur", onBlur);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("keyup", onKeyUp, true);
			window.removeEventListener("blur", onBlur);
			if (nav.rafId) cancelAnimationFrame(nav.rafId);
			google.maps.event.removeListener(zoomListener);
		};
	}, [map]);
}
