import { imageKeyToPanoId } from "@/lib/sv/svMeta";
import { fovToZoom, schemeBase } from "@/lib/util/util";

export interface ParsedUrl {
	lat: number;
	lng: number;
	heading: number;
	pitch: number;
	zoom: number;
	panoId: string | null;
	tags: string[];
}

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

function parseExpandedMapsUrl(url: URL): ParsedUrl | null {
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

export async function parseMapsUrl(input: string): Promise<ParsedUrl | null> {
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
