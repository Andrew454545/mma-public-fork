import type { GeneratorSettings } from "./types";

function normalizeText(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^\w\s-]/g, "")
		.trim();
}

function tokenize(text: string): string[] {
	return text.split(/[\s_,.;!?()'"“”«»]+/).filter(Boolean);
}

function sectionMatch(text: string, target: string): boolean {
	const term = normalizeText(target);
	const normalized = text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
	const pattern = new RegExp(`(^${term}$|^${term},|,\\s*${term}$|,\\s*${term},)`, "i");
	return pattern.test(normalized);
}

const GOOGLE_RPC_BASE =
	"https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService";
const roadNameCache = new Map<string, Promise<string | null>>();

export function hasRoadName(loc: google.maps.StreetViewLocation): boolean {
	return !!loc.road?.trim();
}

function googleMapsGetMetadataPayload(pano: string) {
	const panoType = pano.startsWith("CIHM") || pano.length !== 22 ? 10 : 2;
	return JSON.stringify([
		["apiv3", null, null, null, "US", null, null, null, null, null, [[0]]],
		["en", "US"],
		[[[panoType, pano]]],
		[[1, 2, 3, 4, 8, 6]],
	]);
}

function extractRoadFromGetMetadataJson(data: unknown): string | null {
	const root = Array.isArray(data) ? data[1]?.[0] : null;
	const meta = root?.[5]?.[0];
	const road = meta?.[12]?.[0]?.[0]?.[0]?.[2]?.[0];
	return typeof road === "string" && road.trim() ? road : null;
}

async function fetchRoadNameFromGetMetadata(panoId: string): Promise<string | null> {
	try {
		const response = await fetch(`${GOOGLE_RPC_BASE}/GetMetadata`, {
			method: "POST",
			headers: {
				"content-type": "application/json+protobuf",
				"x-user-agent": "grpc-web-javascript/0.1",
			},
			body: googleMapsGetMetadataPayload(panoId),
			mode: "cors",
			credentials: "omit",
		});
		if (!response.ok) return null;
		return extractRoadFromGetMetadataJson(await response.json());
	} catch {
		return null;
	}
}

/** Resolve Google's hidden road-name field for official panos. This mirrors the
 * VirtualStreets generator: reject if `pano.location.road` is present, with the
 * GetMetadata road path used to populate that field when StreetViewService omits it. */
export async function resolveRoadName(loc: google.maps.StreetViewLocation): Promise<boolean> {
	if (hasRoadName(loc)) return true;
	const panoId = loc.pano?.trim();
	if (!panoId || panoId.length !== 22 || panoId.startsWith("CIHM")) return false;
	let lookup = roadNameCache.get(panoId);
	if (!lookup) {
		lookup = fetchRoadNameFromGetMetadata(panoId);
		roadNameCache.set(panoId, lookup);
	}
	const road = await lookup;
	if (!road) return false;
	loc.road = road;
	return true;
}

/** Match a found pano's description against the user's search terms. Mirrors the
 *  reference generator's "search in panorama description" filter. */
export function passesDescriptionSearch(
	loc: google.maps.StreetViewLocation,
	s: GeneratorSettings,
): boolean {
	if (!s.searchInDescription || !s.searchTerms.trim()) return true;

	const searchTerms = s.searchTerms
		.split(",")
		.map((term) => normalizeText(term.trim()))
		.filter(Boolean);

	const description = loc.description ?? "";
	const shortDescription = loc.shortDescription ?? "";
	const combined = `${description} ${shortDescription}`;
	const normalizedText = normalizeText(combined);
	const words = tokenize(combined).map(normalizeText);

	const hasMatch = searchTerms.some((term) => {
		switch (s.searchMode) {
			case "contains":
				return normalizedText.includes(term);
			case "fullword":
				return new RegExp(`\\b${term}\\b`, "i").test(words.join(" "));
			case "startswith":
				return words.some((word) => word.startsWith(term));
			case "endswith":
				return words.some((word) => word.endsWith(term));
			case "sectionmatch":
				return sectionMatch(description, term) || sectionMatch(shortDescription, term);
		}
	});

	return s.searchFilterType === "exclude" ? !hasMatch : hasMatch;
}

export function getCameraGeneration(
	pano: google.maps.StreetViewResolvedPanoramaData,
): 0 | 1 | 23 | 4 {
	const h = pano.tiles?.worldSize?.height;
	switch (h) {
		case 1664:
			return 1;
		case 6656:
			return 23;
		case 8192:
			return 4;
		default:
			return 0;
	}
}

function extractDate(entry: Record<string, unknown>): Date | null {
	for (const val of Object.values(entry)) {
		if (val instanceof Date) return val;
	}
	return null;
}

function dateToYM(d: Date): string {
	return d.getFullYear() + "-" + (d.getMonth() > 8 ? "" : "0") + (d.getMonth() + 1);
}

export function passesInitialFilters(
	res: google.maps.StreetViewResolvedPanoramaData,
	s: GeneratorSettings,
): boolean {
	if (s.rejectRoadName && hasRoadName(res.location)) return false;

	if (s.rejectUnofficial && !s.rejectOfficial) {
		if (
			s.rejectNoDescription &&
			!s.rejectDescription &&
			!res.location.description &&
			!res.location.shortDescription
		)
			return false;
		if (s.getIntersection && res.links.length < 3) return false;
		if (s.rejectDescription && (res.location.description || res.location.shortDescription))
			return false;
		if (s.pinpointSearch && res.links.length < 2) return false;
		if (s.getIntersection && !s.pinpointSearch && res.links.length < 3) return false;
		if (
			s.pinpointSearch &&
			res.links.length === 2 &&
			Math.abs(res.links[0].heading! - res.links[1].heading!) > s.pinpointAngle
		)
			return false;
	}

	if (s.rejectOfficial) {
		if (/^\xA9 (?:\d+ )?Google$/.test(res.copyright!)) return false;
	}

	if (s.rejectGen1 && getCameraGeneration(res) === 1) return false;

	if (s.findGeneration && (!s.checkAllDates || s.selectMonths)) {
		if (getCameraGeneration(res) !== s.generation) return false;
	}

	return true;
}

export function passesDateFilters(
	res: google.maps.StreetViewResolvedPanoramaData,
	s: GeneratorSettings,
): "direct" | "checkAll" | "months" | false {
	if (s.randomInTimeline) return "direct";

	if (s.checkAllDates && res.time && !s.selectMonths && !s.rejectOfficial) {
		if (!res.time.length) return false;
		const fromDate = Date.parse(s.fromDate);
		const toDate = Date.parse(s.toDate);
		for (const entry of res.time) {
			if (s.rejectUnofficial && entry.pano.length !== 22) continue;
			const d = extractDate(entry);
			if (!d) continue;
			const iDate = Date.parse(dateToYM(d));
			if (iDate >= fromDate && iDate <= toDate) return "checkAll";
		}
		return false;
	}

	if (s.selectMonths && !s.rejectOfficial) {
		if (!res.time?.length) return false;
		return "months";
	}

	if (s.rejectDateless && !res.imageDate) return false;
	if (
		Date.parse(res.imageDate!) < Date.parse(s.fromDate) ||
		Date.parse(res.imageDate!) > Date.parse(s.toDate)
	)
		return false;
	return "direct";
}

export function isPanoGood(
	pano: google.maps.StreetViewResolvedPanoramaData,
	s: GeneratorSettings,
): boolean {
	if (!passesDescriptionSearch(pano.location, s)) return false;
	if (s.rejectRoadName && hasRoadName(pano.location)) return false;

	if (s.rejectUnofficial && !s.rejectOfficial) {
		if (pano.location.pano.length !== 22) return false;
		if (s.filterByLinks && (pano.links.length < s.minLinks || pano.links.length > s.maxLinks))
			return false;
		if (
			s.rejectNoDescription &&
			!s.rejectDescription &&
			!pano.location.description &&
			!pano.location.shortDescription
		)
			return false;
		if (s.getIntersection && pano.links.length < 3) return false;
		if (s.rejectDescription && (pano.location.description || pano.location.shortDescription))
			return false;
		if (s.pinpointSearch && pano.links.length < 2) return false;
		if (s.getIntersection && !s.pinpointSearch && pano.links.length < 3) return false;
		if (
			s.pinpointSearch &&
			pano.links.length === 2 &&
			Math.abs(pano.links[0].heading! - pano.links[1].heading!) > s.pinpointAngle
		)
			return false;
	}

	if (s.rejectDateless && !pano.imageDate) return false;

	const fromDate = Date.parse(s.fromDate);
	const toDate = Date.parse(s.toDate);

	if (!s.selectMonths) {
		if (!s.checkAllDates || s.rejectOfficial) {
			const locDate = Date.parse(pano.imageDate!);
			if (locDate < fromDate || locDate > toDate) return false;
		}
	}

	if (s.onlyOneInTimeframe && pano.time) {
		for (const entry of pano.time) {
			if (s.rejectUnofficial && entry.pano.length !== 22) continue;
			if (entry.pano === pano.location.pano) continue;
			const d = extractDate(entry);
			if (!d) continue;
			const iDate = Date.parse(dateToYM(d));
			if (iDate >= fromDate && iDate <= toDate) return false;
		}
	}

	if (s.checkAllDates && !s.selectMonths && !s.rejectOfficial) {
		if (!pano.time?.length) return false;
		if (s.findGeneration && getCameraGeneration(pano) !== s.generation) return false;
		if (s.rejectGen1 && getCameraGeneration(pano) === 1) return false;
		let dateWithin = false;
		for (const entry of pano.time) {
			if (s.rejectUnofficial && entry.pano.length !== 22) continue;
			const d = extractDate(entry);
			if (!d) continue;
			const iDate = Date.parse(dateToYM(d));
			if (iDate >= fromDate && iDate <= toDate) {
				dateWithin = true;
				break;
			}
		}
		if (!dateWithin) return false;
	}

	if (s.selectMonths && !s.rejectOfficial) {
		if (!pano.time?.length) return false;
		const fM = parseInt(s.fromMonth);
		const tM = parseInt(s.toMonth);
		const fY = parseInt(s.fromYear);
		const tY = parseInt(s.toYear);

		if (s.checkAllDates) {
			let dateWithin = false;
			for (const entry of pano.time) {
				if (s.rejectUnofficial && entry.pano.length !== 22) continue;
				const d = extractDate(entry);
				if (!d) continue;
				const m = d.getMonth() + 1;
				const y = d.getFullYear();
				if (y < fY || y > tY) continue;
				const inRange = fM <= tM ? m >= fM && m <= tM : m >= fM || m <= tM;
				if (inRange) {
					dateWithin = true;
					break;
				}
			}
			if (!dateWithin) return false;
		} else {
			if (!pano.imageDate) return false;
			const year = parseInt(pano.imageDate.slice(0, 4));
			const month = parseInt(pano.imageDate.slice(5));
			if (year < fY || year > tY) return false;
			const inRange = fM <= tM ? month >= fM && month <= tM : month >= fM || month <= tM;
			if (!inRange) return false;
		}
	}

	return true;
}

export function computeHeading(
	pano: google.maps.StreetViewResolvedPanoramaData,
	s: GeneratorSettings,
): number {
	let heading = 0;
	if (s.adjustHeading) {
		if (s.headingReference === "forward") {
			heading = pano.tiles?.centerHeading ?? 0;
		} else if (s.headingReference === "backward") {
			heading = ((pano.tiles?.centerHeading ?? 0) + 180) % 360;
		} else if (s.headingReference === "link" && pano.links?.length > 0) {
			heading = pano.links[0].heading ?? 0;
		}
		const dev = s.headingDeviation;
		if (dev > 0) heading += Math.floor(Math.random() * (2 * dev + 1)) - dev;
	}
	return heading;
}
