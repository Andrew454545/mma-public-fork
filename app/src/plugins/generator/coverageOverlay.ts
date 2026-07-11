// The generator's own deck.gl overlay for the search-coverage "fog of war".
// Mirrors the heatmap plugin: get the shared map, stack our own GoogleMapsOverlay on
// it, render into it, tear it down on deactivate. Core is never touched.

import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { BitmapLayer } from "@deck.gl/layers";
import { subscribe, getCoverageImage } from "./searchCoverage";

let overlay: GoogleMapsOverlay | null = null;

function redraw(): void {
	const data = getCoverageImage();
	if (!data) {
		overlay?.setProps({ layers: [] });
		return;
	}
	if (!overlay) {
		const map = MMA.getGoogleMap();
		if (!map) return; // no map yet; the next probe's redraw will retry
		overlay = new GoogleMapsOverlay({ layers: [] });
		overlay.setMap(map);
	}
	overlay.setProps({
		layers: [
			new BitmapLayer({
				id: "mma-generator-coverage",
				image: data.image,
				bounds: data.bounds,
				opacity: 0.35,
				pickable: false,
				_imageCoordinateSystem: "lnglat" as const,
			}),
		],
	});
}

/** Mount the plugin's own coverage overlay. Returns a teardown for activate()'s cleanup. */
export function mountCoverageOverlay(): () => void {
	const unsub = subscribe(redraw);
	redraw();
	return () => {
		unsub();
		if (overlay) {
			overlay.setMap(null);
			overlay.finalize();
			overlay = null;
		}
	};
}
