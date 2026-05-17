import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

let db: Database;

export async function initDb(): Promise<void> {
	const uri: string = await invoke("get_db_uri");
	db = await Database.load(uri);
	await db.execute("PRAGMA foreign_keys = ON");
	await db.execute("PRAGMA journal_mode = WAL");
	await db.execute("PRAGMA synchronous = NORMAL");
}

export function getDb(): Database {
	return db;
}
