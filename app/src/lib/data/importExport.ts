import { imageKeyToPanoId } from "@/lib/sv/svMeta";
import { fovToZoom, schemeBase } from "@/lib/util/util";
import type { Location } from "@/types";

/** A single location parsed out of a pasted Maps URL or a bare coordinate. */
export type ParsedLocation = Pick<Location, "lat" | "lng" | "heading" | "pitch" | "zoom" | "panoId"> & {
	/** Tag names */
	tags: string[];
};

async function resolveShortUrl(url: URL): Promise<URL> {
	const id = url.pathname.split("/").at(-1);
	if (!id) return url;
	const source = url.hostname === "maps.app.goo.gl" ? "mapsapp" : undefined;
	// Routed through the Tauri `googl` URI-scheme handler (resolves the redirect
	// server-side), so it works in dev and release.
	const proxyUrl = `${schemeBase("googl")}${id}${source ? `?source=${source}` : ""}`;
	const res = await fetch(proxyUrl, { headers: { accept: "application/json" } });
	if (!res.ok) throw new Error("Failed to resolve short URL");
	return new URL(await res.json());
}

function parseExpandedMapsUrl(url: URL): ParsedLocation | null {
	let params: URLSearchParams | null = null;
	if (url.hash) params = new URLSearchParams(url.hash.slice(1));
	params ??= new URLSearchParams();

	const tags = params.has("extra[tags]")
		? params.getAll("extra[tags]")
		: url.searchParams.getAll("extra[tags]");

	if (url.hostname.startsWith("www.google.") && url.pathname.startsWith("/maps")) {
		const m =
			/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)a,(-?\d+(?:\.\d+)?)y(?:,(-?\d+(?:\.\d+)?)h)?,(-?\d+(?:\.\d+)?)t(?:,-?\d+(?:\.\d+)?r)?\/data=(?:.*?)!1s([0-9a-zA-Z_-]+)!2e(\d+)/.exec(
				url.pathname,
			);
		if (m) {
			const lat = parseFloat(m[1] ?? "");
			const lng = parseFloat(m[2] ?? "");
			const zoom = m[4] ? fovToZoom(parseFloat(m[4])) : 0;
			const heading = m[5] ? parseFloat(m[5]) : 0;
			const pitch = m[6] ? parseFloat(m[6]) - 90 : 0;
			const rawId = m[7] ?? null;
			const type = m[8] ? parseInt(m[8], 10) : 0;
			const panoId = rawId ? imageKeyToPanoId([type === 0 ? 2 : type, rawId]) : null;
			return { lat, lng, heading, pitch, zoom, panoId, tags };
		}

		if (url.searchParams.get("map_action") === "pano") {
			const vp = url.searchParams.get("viewpoint");
			if (!vp) return null;
			const parts = vp.split(",");
			const lat = parseFloat(parts[0] ?? "");
			const lng = parseFloat(parts[1] ?? "");
			const heading = parseFloat(url.searchParams.get("heading") ?? "0");
			const pitch = parseFloat(url.searchParams.get("pitch") ?? "0");
			const panoId = url.searchParams.get("pano") || null;
			const zoom = fovToZoom(parseFloat(url.searchParams.get("fov") ?? "90"));
			return { lat, lng, heading, pitch, zoom, panoId, tags };
		}

		if (url.searchParams.get("layer") === "c" && url.searchParams.has("cbll")) {
			const cbll = url.searchParams.get("cbll")?.split(",");
			if (cbll) {
				const lat = parseFloat(cbll[0] ?? "");
				const lng = parseFloat(cbll[1] ?? "");
				return { lat, lng, heading: 0, pitch: 0, zoom: 0, panoId: null, tags };
			}
		}
	} else if (url.hostname.startsWith("artsandculture.google.") && url.searchParams.has("sv_pid")) {
		const lat = parseFloat(url.searchParams.get("sv_lat") ?? "0");
		const lng = parseFloat(url.searchParams.get("sv_lng") ?? "0");
		const heading = parseFloat(url.searchParams.get("sv_h") ?? "0");
		const pitch = parseFloat(url.searchParams.get("s_p") ?? "0");
		const panoId = url.searchParams.get("sv_pid");
		const zoom = parseFloat(url.searchParams.get("sv_z") ?? "0");
		return { lat, lng, heading, pitch, zoom, panoId, tags };
	}

	return null;
}

// One coordinate component: signed degrees, optional `°`, optional minutes (with
// `'`/`′`) and seconds (with `"`/`″`), optional N/S/E/W hemisphere. Markers are
// required for DMS/DDM so bare integers can't masquerade as degrees+minutes.
const COORD_COMPONENT = String.raw`([+-]?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*(?:(\d+(?:\.\d+)?)\s*["″]?)?)?\s*([NSEWnsew])?`;
const COORD_PAIR = new RegExp(`^${COORD_COMPONENT}\\s*[, ]\\s*${COORD_COMPONENT}$`);

/** Parse a single bare coordinate pair in decimal, DMS, or DDM form into a
 * single location. Returns null if the text isn't a recognizable lat/lng pair.
 * Examples: `41.17, 14.04`, `41.17 14.04`, `40°26'46"N 79°58'56"W`,
 * `40°26.7'N, 79°58.9'W`, `14.04 E, 41.17 N`. */
export function parseCoordinates(input: string): ParsedLocation | null {
	const m = COORD_PAIR.exec(input.trim());
	if (!m) return null;

	const component = (deg: string, min: string, sec: string, hemi: string) => {
		let val = parseFloat(deg) + (min ? parseFloat(min) / 60 : 0) + (sec ? parseFloat(sec) / 3600 : 0);
		const h = hemi?.toUpperCase();
		if (h === "S" || h === "W") val = -Math.abs(val);
		const axis = h === "N" || h === "S" ? "lat" : h === "E" || h === "W" ? "lng" : null;
		return { val, axis };
	};

	const a = component(m[1]!, m[2]!, m[3]!, m[4]!);
	const b = component(m[5]!, m[6]!, m[7]!, m[8]!);

	// Lat first by default; explicit hemispheres can flip the order (e.g. lng, lat).
	const swap = a.axis === "lng" || b.axis === "lat";
	const lat = swap ? b.val : a.val;
	const lng = swap ? a.val : b.val;
	if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

	return { lat, lng, heading: 0, pitch: 0, zoom: 0, panoId: null, tags: [] };
}

export async function parseMapsUrl(input: string): Promise<ParsedLocation | null> {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}

	try {
		if (url.hostname === "goo.gl" && url.pathname.startsWith("/maps/")) {
			url = await resolveShortUrl(url);
		} else if (url.hostname === "maps.app.goo.gl") {
			url = await resolveShortUrl(url);
		}
	} catch {
		return null;
	}

	return parseExpandedMapsUrl(url);
}
