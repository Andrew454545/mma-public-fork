// TODO: add GC for orphaned Arrow blobs in arrow/blobs/ — deleted commits leave unreferenced files on disk
import type { CommitInfo } from "@/types";
import { getDb } from "@/lib/storage/db";
import { invoke } from "@tauri-apps/api/core";

async function sha256(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const buf = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

interface BlobEntry {
	geohash: string;
	blobHash: string;
	locationCount: number;
}

export interface CommitDiff {
	added: number;
	removed: number;
	modified: number;
}

export async function createCommit(
	mapId: string,
	message?: string,
	diff?: CommitDiff,
): Promise<string> {
	const db = getDb();
	const now = new Date().toISOString();

	const [parentRow] = await db.select<{ id: string }[]>(
		"SELECT id FROM commits WHERE map_id = ? ORDER BY created_at DESC LIMIT 1",
		[mapId],
	);
	const parentId = parentRow?.id ?? null;

	const entries: BlobEntry[] = await invoke("store_snapshot_commit");

	const locationCount = entries.reduce((s, e) => s + e.locationCount, 0);
	const hashContent = entries
		.sort((a, b) => a.geohash.localeCompare(b.geohash))
		.map((e) => `${e.geohash} ${e.blobHash}`)
		.join("\n");
	const treeHash = await sha256(hashContent);
	const id = await sha256(`tree ${treeHash}\nparent ${parentId ?? ""}\ndate ${now}`);

	const { added = 0, removed = 0, modified = 0 } = diff ?? {};

	await db.execute(
		"INSERT INTO commits (id, map_id, parent_id, message, location_count, created_at, tree_hash, added, removed, modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		[id, mapId, parentId, message ?? null, locationCount, now, treeHash, added, removed, modified],
	);

	const BATCH = 200;
	for (let i = 0; i < entries.length; i += BATCH) {
		const batch = entries.slice(i, i + BATCH);
		const placeholders = batch.map(() => "(?, ?, ?, ?)").join(", ");
		const values = batch.flatMap((e) => [id, e.geohash, e.blobHash, e.locationCount]);
		await db.execute(
			`INSERT INTO commit_trees (commit_id, geohash, blob_hash, location_count) VALUES ${placeholders}`,
			values,
		);
	}

	return id;
}

export async function listCommits(mapId: string): Promise<CommitInfo[]> {
	const db = getDb();
	const rows = await db.select<
		{
			id: string;
			map_id: string;
			parent_id: string | null;
			message: string | null;
			tree_hash: string | null;
			added: number;
			removed: number;
			modified: number;
			location_count: number;
			created_at: string;
		}[]
	>("SELECT * FROM commits WHERE map_id = ? ORDER BY created_at DESC", [mapId]);
	return rows.map((r) => ({
		id: r.id,
		mapId: r.map_id,
		parentId: r.parent_id,
		message: r.message,
		treeHash: r.tree_hash,
		added: r.added,
		removed: r.removed,
		modified: r.modified,
		locationCount: r.location_count,
		createdAt: r.created_at,
	}));
}

export async function checkout(mapId: string, commitId: string): Promise<void> {
	const db = getDb();
	const rows = await db.select<{ geohash: string; blob_hash: string; location_count: number }[]>(
		"SELECT geohash, blob_hash, location_count FROM commit_trees WHERE commit_id = ?",
		[commitId],
	);
	const blobs: BlobEntry[] = rows.map((r) => ({
		geohash: r.geohash,
		blobHash: r.blob_hash,
		locationCount: r.location_count,
	}));
	await invoke("store_restore_commit", { mapId, blobs });
}

export function shortHash(id: string): string {
	return id.slice(0, 7);
}
