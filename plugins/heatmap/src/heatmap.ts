import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";

export interface HeatmapSettings {
	visible: boolean;
	intensity: number;
	radiusPixels: number;
	opacity: number;
	threshold: number;
}

export const DEFAULT_SETTINGS: HeatmapSettings = {
	visible: true,
	intensity: 1,
	radiusPixels: 30,
	opacity: 0.6,
	threshold: 0.05,
};

interface LocPoint {
	lat: number;
	lng: number;
}

let overlay: GoogleMapsOverlay | null = null;
let locStore: { locations: Map<number, unknown>; onChange(cb: () => void): () => void; destroy(): void } | null = null;
let settings: HeatmapSettings = { ...DEFAULT_SETTINGS };
let onSettingsChange: (() => void) | null = null;

export function getSettings(): HeatmapSettings {
	return settings;
}

export function getLocationCount(): number {
	return selectedLocations().length;
}

function selectedLocations(): LocPoint[] {
	if (!locStore) return [];
	const ids = MMA.getSelectedLocationIds();
	const out: LocPoint[] = [];
	for (const id of ids) {
		const loc = locStore.locations.get(id) as { lat: number; lng: number } | undefined;
		if (loc) out.push({ lat: loc.lat, lng: loc.lng });
	}
	return out;
}

export function setOnSettingsChange(cb: (() => void) | null) {
	onSettingsChange = cb;
}

export function updateSettings(patch: Partial<HeatmapSettings>) {
	settings = { ...settings, ...patch };
	rebuild();
	onSettingsChange?.();
}

function rebuild() {
	if (!overlay) return;
	if (!settings.visible) {
		overlay.setProps({ layers: [] });
		return;
	}
	const data = selectedLocations();

	const layer = new HeatmapLayer({
		id: "mma-heatmap",
		data,
		getPosition: (d: LocPoint) => [d.lng, d.lat],
		getWeight: 1,
		radiusPixels: settings.radiusPixels,
		intensity: settings.intensity,
		threshold: settings.threshold,
		opacity: settings.opacity,
		debounceTimeout: 100,
	});

	overlay.setProps({ layers: [layer] });
}

export async function init(): Promise<() => void> {
	const map = MMA.getGoogleMap();
	if (!map) throw new Error("No map instance");

	locStore = await MMA.createLocationStore();

	overlay = new GoogleMapsOverlay({ layers: [] });
	overlay.setMap(map);
	rebuild();

	const unsubStore = locStore.onChange(() => {
		rebuild();
		onSettingsChange?.();
	});
	const unsubSel = MMA.on("selection:change", () => {
		rebuild();
		onSettingsChange?.();
	});

	return () => {
		unsubStore();
		unsubSel();
		locStore?.destroy();
		locStore = null;
		if (overlay) {
			overlay.setMap(null);
			overlay.finalize();
			overlay = null;
		}
		settings = { ...DEFAULT_SETTINGS };
		onSettingsChange = null;
	};
}
