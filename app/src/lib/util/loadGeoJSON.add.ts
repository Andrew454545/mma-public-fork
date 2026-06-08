import { selectPolygon } from "@/store/useMapStore";
import type { PolygonGeometry } from "@/store/selections";

export async function loadGeoJSON() {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = ".json,.geojson";
	input.multiple = true;
	input.onchange = async () => {
		if (!input.files) return;
		for (const file of input.files) {
			try {
				const text = await file.text();
				const data = JSON.parse(text);
				const features = data.type === "FeatureCollection" ? data.features : [data];
				for (const f of features) {
					if (f.geometry?.type === "Polygon") {
						selectPolygon({
							coordinates: f.geometry.coordinates,
							properties: f.properties ?? undefined,
						});
					} else if (f.geometry?.type === "MultiPolygon") {
						const [first, ...rest] = f.geometry.coordinates;
						if (!first) continue;
						const poly: PolygonGeometry = {
							coordinates: first,
							properties: f.properties ?? undefined,
						};
						if (rest.length) poly.extraPolygons = rest;
						selectPolygon(poly);
					}
				}
			} catch {
				/* ignore malformed files */
			}
		}
	};
	input.click();
}
