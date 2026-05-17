import { getDb } from "@/lib/storage/db";
import { getSettings } from "@/store/settings.add";
import { getCurrentMapId } from "@/store/useMapStore";
import { log } from "@/lib/util/log";

const MAX_ENTRIES = 10_000;

export interface SeenEntry {
	id: number;
	pano_id: string;
	lat: number;
	lng: number;
	heading: number;
	pitch: number;
	zoom: number;
	entered_at: number;
	map_id: string | null;
	location_id: number | null;
	country_code: string | null;
	address: string | null;
	thumbnail: string | null;
}

interface PendingEntry {
	panoId: string;
	lat: number;
	lng: number;
	enteredAt: number;
	mapId: string | null;
	locationId: number | null;
	countryCode: string | null;
	address: string | null;
}

let staged: PendingEntry | null = null;
let canvasGetter: (() => HTMLCanvasElement | null) | null = null;
let skipNextPanoId: string | null = null;
let latestGeo: { countryCode: string | null; address: string | null } = {
	countryCode: null,
	address: null,
};

export function seenSetCanvas(getter: (() => HTMLCanvasElement | null) | null) {
	canvasGetter = getter;
}

export function seenSkipNext(panoId: string) {
	skipNextPanoId = panoId;
}

export function seenUpdateGeo(countryCode: string | null, address: string | null) {
	latestGeo = { countryCode, address };
	if (staged) {
		if (countryCode) staged.countryCode = countryCode;
		if (address) staged.address = address;
	}
}

export function seenPanoChanged(
	panoId: string,
	lat: number,
	lng: number,
	locationId: number | null,
	countryCode: string | null,
	address: string | null,
	getPov: () => { heading: number; pitch: number; zoom: number },
) {
	const settings = getSettings();
	if (!settings.enableSeen) return;

	if (skipNextPanoId === panoId) {
		skipNextPanoId = null;
		return;
	}

	// Flush previous entry
	if (staged) {
		flushStaged(getPov);
	}

	// Stage immediately so any exit path can flush it
	staged = {
		panoId,
		lat,
		lng,
		enteredAt: Date.now(),
		mapId: getCurrentMapId(),
		locationId,
		countryCode: countryCode || latestGeo.countryCode,
		address: address || latestGeo.address,
	};
}

function flushStaged(getPov: () => { heading: number; pitch: number; zoom: number }) {
	if (!staged) return;
	const entry = staged;
	staged = null;

	let thumbnail: string | null = null;
	if (getSettings().enableSeenThumbnails && canvasGetter) {
		const canvas = canvasGetter();
		if (canvas && canvas.width > 0 && canvas.height > 0) {
			thumbnail = captureThumbnail(canvas);
		}
	}

	writeEntry(entry, getPov(), thumbnail);
}

export function seenFlush(getPov: () => { heading: number; pitch: number; zoom: number }) {
	flushStaged(getPov);
}

const RESOLUTIONS = { low: [160, 90], medium: [320, 180], high: [640, 360] } as const;

function captureThumbnail(canvas: HTMLCanvasElement): string | null {
	try {
		const [w, h] = RESOLUTIONS[getSettings().seenResolution] ?? RESOLUTIONS.medium;
		const offscreen = document.createElement("canvas");
		offscreen.width = w;
		offscreen.height = h;
		const ctx = offscreen.getContext("2d");
		if (!ctx) return null;
		ctx.drawImage(canvas, 0, 0, w, h);
		const dataUrl = offscreen.toDataURL("image/jpeg", 0.6);
		const base64 = dataUrl.split(",")[1];
		if (!base64 || base64.length < 100) return null;
		return base64;
	} catch {
		return null;
	}
}

async function writeEntry(
	entry: PendingEntry,
	pov: { heading: number; pitch: number; zoom: number },
	thumbnail: string | null,
) {
	const db = getDb();
	try {
		await db.execute(
			`INSERT INTO seen (pano_id, lat, lng, heading, pitch, zoom, entered_at, map_id, location_id, country_code, address, thumbnail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				entry.panoId,
				entry.lat,
				entry.lng,
				pov.heading,
				pov.pitch,
				pov.zoom,
				entry.enteredAt,
				entry.mapId,
				entry.locationId,
				entry.countryCode,
				entry.address,
				thumbnail,
			],
		);

		const countRows = await db.select<{ cnt: number }[]>("SELECT COUNT(*) as cnt FROM seen");
		const count = countRows[0]?.cnt ?? 0;
		if (count > MAX_ENTRIES) {
			await db.execute(
				`DELETE FROM seen WHERE id IN (
          SELECT id FROM seen ORDER BY entered_at ASC LIMIT ?
        )`,
				[count - MAX_ENTRIES],
			);
		}
	} catch (e) {
		log.warn("[seen] failed to write entry:", e);
	}
}

export interface SeenFilter {
	country?: string | null;
	mapId?: string | null;
	search?: string | null;
}

function buildWhere(filter?: SeenFilter): { clause: string; params: unknown[] } {
	const conditions: string[] = [];
	const params: unknown[] = [];
	if (filter?.country) {
		conditions.push("country_code = ?");
		params.push(filter.country);
	}
	if (filter?.mapId) {
		conditions.push("map_id = ?");
		params.push(filter.mapId);
	}
	if (filter?.search) {
		conditions.push("address LIKE ?");
		params.push(`%${filter.search}%`);
	}
	const clause = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
	return { clause, params };
}

export async function getSeenEntries(
	limit = 100,
	offset = 0,
	filter?: SeenFilter,
): Promise<SeenEntry[]> {
	const db = getDb();
	const { clause, params } = buildWhere(filter);
	return db.select<SeenEntry[]>(
		`SELECT id, pano_id, lat, lng, heading, pitch, zoom, entered_at, map_id, location_id, country_code, address, thumbnail FROM seen${clause} ORDER BY entered_at DESC LIMIT ? OFFSET ?`,
		[...params, limit, offset],
	);
}

export async function getSeenCount(filter?: SeenFilter): Promise<number> {
	const db = getDb();
	const { clause, params } = buildWhere(filter);
	const rows = await db.select<{ cnt: number }[]>(
		`SELECT COUNT(*) as cnt FROM seen${clause}`,
		params,
	);
	return rows[0]?.cnt ?? 0;
}

export async function getSeenCountries(): Promise<string[]> {
	const db = getDb();
	const rows = await db.select<{ country_code: string }[]>(
		"SELECT DISTINCT country_code FROM seen WHERE country_code IS NOT NULL ORDER BY country_code",
	);
	return rows.map((r) => r.country_code);
}

export async function getSeenMaps(): Promise<{ id: string; name: string }[]> {
	const db = getDb();
	const rows = await db.select<{ id: string; name: string }[]>(
		"SELECT DISTINCT s.map_id AS id, COALESCE(m.name, s.map_id) AS name FROM seen s LEFT JOIN maps m ON m.id = s.map_id WHERE s.map_id IS NOT NULL ORDER BY name",
	);
	return rows;
}

export async function clearSeen(): Promise<void> {
	const db = getDb();
	await db.execute("DELETE FROM seen");
}
