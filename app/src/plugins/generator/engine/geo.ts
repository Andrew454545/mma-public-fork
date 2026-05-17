import { pointInPolygon } from "@/lib/geo/geo";

export function randomPointInBounds(
	south: number,
	north: number,
	west: number,
	east: number,
): { lat: number; lng: number } {
	const sinS = Math.sin((south * Math.PI) / 180);
	const sinN = Math.sin((north * Math.PI) / 180);
	const lat = (Math.asin(Math.random() * (sinN - sinS) + sinS) * 180) / Math.PI;
	const lng = west + Math.random() * (east - west);
	return { lat, lng };
}

export function getBoundingBox(
	feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
): [west: number, south: number, east: number, north: number] {
	let west = Infinity,
		south = Infinity,
		east = -Infinity,
		north = -Infinity;
	const coords =
		feature.geometry.type === "Polygon"
			? [feature.geometry.coordinates]
			: feature.geometry.coordinates;
	for (const poly of coords) {
		for (const ring of poly) {
			for (const [lng, lat] of ring) {
				if (lng < west) west = lng;
				if (lng > east) east = lng;
				if (lat < south) south = lat;
				if (lat > north) north = lat;
			}
		}
	}
	return [west, south, east, north];
}

export function pointInGeoJsonGeometry(
	lng: number,
	lat: number,
	geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): boolean {
	if (geometry.type === "Polygon") {
		return pointInPolygon(lng, lat, geometry.coordinates);
	}
	for (const poly of geometry.coordinates) {
		if (pointInPolygon(lng, lat, poly)) return true;
	}
	return false;
}
