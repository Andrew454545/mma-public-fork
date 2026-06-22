// Toggleable overlay of every Street View pano ever seen (across all maps). The dots are
// rendered as a layer *inside the core scene* (buildSceneLayers), exactly like the staged
// import preview — so picking, hover cursor, and clicks flow through the one deck pass with
// no second overlay or interceptors. This module just owns the toggle + data + reactivity.

import { useSyncExternalStore } from "react";
import { log } from "@/lib/util/log";
import { subscribe as onEvent } from "@/lib/events";
import { fetchLocation, setActiveLocation, previewVirtualLocation } from "@/store/useMapStore";
import { createLocation, LocationFlag } from "@/types";
import { getSeenCount, getSeenEntries, seenSkipNext } from "./seen";
import type { SeenEntry } from "@/bindings.gen";

let entries: SeenEntry[] = [];
let active = false;
let version = 0;
const listeners = new Set<() => void>();

function notify() {
	version++;
	for (const l of listeners) l();
}

/** Repaint signal for the scene; include in the surface's rebuild deps. */
export function useSeenOverlayVersion(): number {
	return useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		() => version,
	);
}

export function isSeenOverlayActive(): boolean {
	return active;
}

export function getSeenOverlayEntries(): SeenEntry[] {
	return entries;
}

export function toggleSeenOverlay(): void {
	active = !active;
	if (!active) entries = [];
	notify();
	if (active) void load();
}

async function load() {
	try {
		const count = await getSeenCount();
		entries = count > 0 ? await getSeenEntries(count, 0, undefined, false) : [];
	} catch (e) {
		log.error("[seen-overlay] load failed:", e);
		entries = [];
	}
	if (active) notify();
}

/** Open the seen entry at `index` (deck pick index): select its real location if present on
 *  this map, else a read-only virtual preview that loads the exact pano. Nothing is added. */
export async function openSeenEntry(index: number): Promise<void> {
	const entry = entries[index];
	if (!entry) return;
	seenSkipNext(entry.panoId);
	if (entry.locationId != null) {
		const existing = await fetchLocation(entry.locationId);
		if (existing && existing.panoId === entry.panoId) {
			void setActiveLocation(existing.id);
			return;
		}
	}
	const preview = createLocation({
		lat: entry.lat,
		lng: entry.lng,
		heading: entry.heading,
		pitch: entry.pitch,
		zoom: entry.zoom,
		panoId: entry.panoId,
		extra: entry.countryCode ? { countryCode: entry.countryCode } : undefined,
	});
	preview.flags = LocationFlag.LoadAsPanoId; // resolve the exact pano, not nearest coverage
	previewVirtualLocation(preview);
}

onEvent("map:close", () => {
	if (!active && entries.length === 0) return;
	active = false;
	entries = [];
	notify();
});
