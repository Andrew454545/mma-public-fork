import { registerPlugin, setPendingManifest, type PluginManifest } from "./registry";
import { createLocation, type Location, type Tag } from "@/types";
import type { SelectionProps } from "@/store/selections";
import {
	registerEnrichFields,
	registerEnrichmentProvider,
} from "@/lib/data/fieldDefs.add";
import { invoke } from "@tauri-apps/api/core";
import { Command } from "@tauri-apps/plugin-shell";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import * as store from "@/store/useMapStore";
import { getGoogleMap } from "@/lib/map/mapState";
import { subscribe, type EditorEvent } from "@/lib/events";

type Handler = (...args: unknown[]) => void;

declare global {
	interface Window {
		MMA: typeof mmaApi;
	}
	// Allow bare `MMA.xxx` usage without `window.` prefix
	const MMA: typeof mmaApi;
}

const mmaApi = {
	// Bootstrap
	registerPlugin,
	createLocation,
	registerEnrichFields,
	registerEnrichmentProvider,

	// Tauri primitives
	invoke,
	shell: { Command },
	dialog: { open: dialogOpen, save: dialogSave },

	// Map & locations
	getMap: () => store.getCurrentMap(),
	getActiveLocation: () => store.getActiveLocation(),
	getGoogleMap: () => getGoogleMap(),
	addLocations: (locs: Location[]) => store.addLocations(locs),
	removeLocations: (ids: Set<number>) => store.removeLocations(ids),
	updateLocation: (id: number, patch: Partial<Location>) => store.updateLocation(id, patch),
	setActiveLocation: (id: number | null) => store.setActiveLocation(id),

	// Tags
	addTag: (tag: Tag) => store.addTag(tag),
	updateTag: (tagId: number, patch: Partial<Tag>) => store.updateTag(tagId, patch),

	// Selections
	getSelections: () => store.getSelections(),
	getSelectedLocationIds: () => store.getSelectedLocationIds(),
	queryIds: (props: SelectionProps) => invoke<number[]>("store_resolve_selection", { props }),
	getLocationsByIds: (ids: number[]) => store.fetchLocationsByIds(ids),

	// Plugin mode
	enterPluginMode: (pluginId: string) => store.setPluginMode(pluginId),
	exitPluginMode: () => store.exitPluginMode(),

	// Events
	on(event: EditorEvent, handler: Handler) {
		return subscribe(event, handler);
	},
};

export type MMAApi = typeof mmaApi;
window.MMA = mmaApi;

// Core plugins auto-discovered via glob. Each folder's index.ts calls registerPlugin().
const corePlugins = import.meta.glob("./*/index.ts");

async function loadCorePlugins() {
	await Promise.all(Object.values(corePlugins).map((load) => load()));
}

async function loadUserPlugins() {
	let manifests: PluginManifest[];
	try {
		manifests = await invoke<PluginManifest[]>("list_user_plugins");
	} catch {
		return;
	}
	for (const m of manifests) {
		try {
			setPendingManifest(m);
			await import(/* @vite-ignore */ `mma-plugin://localhost/${m.id}/${m.main}`);
			setPendingManifest(null);
		} catch (e) {
			setPendingManifest(null);
			console.error(`[plugin] failed to load user plugin "${m.id}":`, e);
		}
	}
}

export const pluginsReady = loadCorePlugins().then(loadUserPlugins);
