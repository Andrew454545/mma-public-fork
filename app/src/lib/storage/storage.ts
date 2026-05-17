import type { MapData, MapMeta, Tag } from "@/types";
import { getDb } from "@/lib/storage/db";
import { invoke } from "@tauri-apps/api/core";

export async function saveDirty(): Promise<void> {
	await invoke("store_save_dirty");
}

interface MapRow {
	id: string;
	name: string;
	description: string;
	folder: string | null;
	settings: string;
	score_bounds: string;
	extra: string;
	tags: string;
	labels: string;
	location_count: number;
	created_at: string;
	updated_at: string;
	last_opened_at: string | null;
}

function mapRowToMeta(row: MapRow): MapMeta {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		folder: row.folder,
		locationCount: row.location_count,
		tags: JSON.parse(row.tags || "{}"),
		labels: JSON.parse(row.labels || "[]"),
		settings: JSON.parse(row.settings),
		scoreBounds: JSON.parse(row.score_bounds),
		extra: row.extra ? JSON.parse(row.extra) : undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastOpenedAt: row.last_opened_at,
	};
}

// --- Map CRUD ---

export async function listMaps(): Promise<MapMeta[]> {
	const db = getDb();
	const maps = await db.select<MapRow[]>(`SELECT * FROM maps`);
	return maps.map((m) => mapRowToMeta(m));
}

export async function getMap(id: string): Promise<MapData | null> {
	const db = getDb();
	const maps = await db.select<MapRow[]>("SELECT * FROM maps WHERE id = ?", [id]);
	if (maps.length === 0) return null;
	return { meta: mapRowToMeta(maps[0]) };
}

export async function createMap(name: string, folder: string | null = null): Promise<MapData> {
	const db = getDb();
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	const settings = JSON.stringify({
		pointAlongRoad: true,
		preferDirection: null,
		preferOfficial: true,
		preferHigherQuality: false,
		onlyOfficial: false,
		cameraTypes: null,
		defaultPanoId: false,
		exportZoom: false,
		exportUnpanned: true,
		enrichMetadata: false,
	});
	const scoreBounds = '"auto"';

	await db.execute(
		"INSERT INTO maps (id, name, description, folder, settings, score_bounds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		[id, name, "", folder, settings, scoreBounds, now, now],
	);

	return {
		meta: {
			id,
			name,
			description: "",
			folder,
			locationCount: 0,
			tags: {},
			labels: [],
			settings: JSON.parse(settings),
			scoreBounds: "auto",
			createdAt: now,
			updatedAt: now,
			lastOpenedAt: null,
		},
	};
}

export async function deleteMap(id: string): Promise<void> {
	const db = getDb();
	await db.execute("DELETE FROM maps WHERE id = ?", [id]);
}

export async function updateMapMeta(id: string, patch: Partial<MapMeta>): Promise<void> {
	const db = getDb();
	const fields: string[] = [];
	const values: unknown[] = [];

	if (patch.name !== undefined) {
		fields.push("name = ?");
		values.push(patch.name);
	}
	if (patch.description !== undefined) {
		fields.push("description = ?");
		values.push(patch.description);
	}
	if (patch.folder !== undefined) {
		fields.push("folder = ?");
		values.push(patch.folder);
	}
	if (patch.settings !== undefined) {
		fields.push("settings = ?");
		values.push(JSON.stringify(patch.settings));
	}
	if (patch.scoreBounds !== undefined) {
		fields.push("score_bounds = ?");
		values.push(JSON.stringify(patch.scoreBounds));
	}
	if (patch.extra !== undefined) {
		fields.push("extra = ?");
		values.push(JSON.stringify(patch.extra));
	}
	if (patch.labels !== undefined) {
		fields.push("labels = ?");
		values.push(JSON.stringify(patch.labels));
	}

	fields.push("updated_at = ?");
	values.push(new Date().toISOString());

	await db.execute(`UPDATE maps SET ${fields.join(", ")} WHERE id = ?`, [...values, id]);
}

// --- Tag persistence (tags live as JSON on the maps row) ---

export async function saveTags(mapId: string, tags: Record<string, Tag>): Promise<void> {
	const db = getDb();
	await db.execute("UPDATE maps SET tags = ?, updated_at = ? WHERE id = ?", [
		JSON.stringify(tags),
		new Date().toISOString(),
		mapId,
	]);
}

export async function touchMapOpened(mapId: string): Promise<void> {
	const db = getDb();
	const now = new Date().toISOString();
	await db.execute("UPDATE maps SET last_opened_at = ? WHERE id = ?", [now, mapId]);
}

export async function updateMapLabels(mapId: string, labels: string[]): Promise<void> {
	const db = getDb();
	await db.execute("UPDATE maps SET labels = ?, updated_at = ? WHERE id = ?", [
		JSON.stringify(labels),
		new Date().toISOString(),
		mapId,
	]);
}

// --- Folder ops ---

export async function renameFolder(from: string, to: string): Promise<void> {
	const db = getDb();
	await db.execute("UPDATE maps SET folder = ? WHERE folder = ?", [to, from]);
}

export async function deleteFolder(name: string): Promise<void> {
	const db = getDb();
	await db.execute("UPDATE maps SET folder = NULL WHERE folder = ?", [name]);
}

export async function moveMapToFolder(mapId: string, folder: string | null): Promise<void> {
	const db = getDb();
	await db.execute("UPDATE maps SET folder = ? WHERE id = ?", [folder, mapId]);
}

// --- Pano date cache ---

export async function getCachedPanoDate(panoId: string): Promise<number | null> {
	const db = getDb();
	const rows = await db.select<{ timestamp: number }[]>(
		"SELECT timestamp FROM pano_date_cache WHERE pano_id = ?",
		[panoId],
	);
	return rows.length > 0 ? rows[0].timestamp : null;
}

export async function setCachedPanoDate(panoId: string, timestamp: number): Promise<void> {
	const db = getDb();
	await db.execute("INSERT OR REPLACE INTO pano_date_cache (pano_id, timestamp) VALUES (?, ?)", [
		panoId,
		timestamp,
	]);
}
