#!/usr/bin/env node
/**
 * Inspect a map's on-disk storage state: base Arrow, delta sidecar, SQLite metadata,
 * and commit history. Run from anywhere:
 *
 *   node scripts/inspect-map.mjs <map-name-or-id>
 *   node scripts/inspect-map.mjs apcw
 *   node scripts/inspect-map.mjs 3662d293-...
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.env.APPDATA, "app.map-making.local");
const DB_PATH = join(DATA_DIR, "mma.db");
const ARROW_DIR = join(DATA_DIR, "arrow");

function sql(query) {
	return execSync(`sqlite3 "${DB_PATH}" "${query}"`, { encoding: "utf-8" }).trim();
}

function sqlRows(query) {
	const raw = sql(query);
	return raw ? raw.split("\n").map((r) => r.split("|")) : [];
}

function fmtBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Resolve map ---
const arg = process.argv[2];
if (!arg) {
	const maps = sqlRows("SELECT id, name, location_count FROM maps ORDER BY name;");
	console.log("Usage: node scripts/inspect-map.mjs <name-or-id>\n");
	console.log("Available maps:");
	for (const [id, name, count] of maps) {
		console.log(`  ${name}  (${count} locs)  ${id}`);
	}
	process.exit(0);
}

const isUuid = /^[0-9a-f]{8}-/.test(arg);
const query = isUuid
	? `SELECT id, name, location_count FROM maps WHERE id = '${arg}';`
	: `SELECT id, name, location_count FROM maps WHERE name LIKE '%${arg}%' LIMIT 1;`;
const match = sqlRows(query);
if (match.length === 0) {
	console.error(`No map found matching "${arg}"`);
	process.exit(1);
}
const [mapId, mapName, locCount] = match[0];

console.log(`\n=== ${mapName} ===`);
console.log(`ID:              ${mapId}`);
console.log(`SQLite loc count: ${locCount}`);

// --- Base Arrow file ---
const basePath = join(ARROW_DIR, `${mapId}.arrow`);
if (existsSync(basePath)) {
	const st = statSync(basePath);
	console.log(`\nBase Arrow:      ${fmtBytes(st.size)}  (modified ${st.mtime.toISOString()})`);
} else {
	console.log("\nBase Arrow:      (missing)");
}

// --- Delta sidecar ---
const deltaPath = join(ARROW_DIR, `${mapId}_delta.arrow`);
if (existsSync(deltaPath)) {
	const st = statSync(deltaPath);
	const buf = readFileSync(deltaPath);
	console.log(`Delta sidecar:   ${fmtBytes(st.size)}  (modified ${st.mtime.toISOString()})`);

	// Parse top-level msgpack structure to get array lengths.
	// DeltaOverlay = { adds: Location[], dead_ids: u32[], patches: Location[] }
	try {
		const counts = parseDeltaCounts(buf);
		console.log(`  adds:    ${counts.adds}`);
		console.log(`  dead:    ${counts.dead_ids}`);
		console.log(`  patches: ${counts.patches}`);

		const total = parseInt(locCount, 10);
		if (total > 0 && counts.patches > total * 0.5) {
			console.log(`  *** WARNING: ${counts.patches} patches vs ${total} total — over 50% of locations patched`);
		}
	} catch {
		console.log("  (could not parse msgpack structure)");
	}
} else {
	console.log("Delta sidecar:   (none — clean since last commit)");
}

// --- Commit history ---
const commits = sqlRows(
	`SELECT id, parent_id, created_at, location_count, message FROM commits WHERE map_id = '${mapId}' ORDER BY created_at;`
);
console.log(`\nCommits: ${commits.length}`);
for (const [cid, _parent, createdAt, cLocCount, msg] of commits) {
	const short = cid.slice(0, 10);
	const label = msg || "(no message)";
	console.log(`  ${short}  ${createdAt}  ${cLocCount} locs  "${label}"`);
}

// --- Edit history ---
try {
	const histRaw = sql(
		`SELECT length(undo_stack), length(redo_stack) FROM edit_history WHERE map_id = '${mapId}';`
	);
	if (histRaw) {
		const [undoBytes, redoBytes] = histRaw.split("|");
		console.log(`\nEdit history:    undo=${fmtBytes(+undoBytes)}  redo=${fmtBytes(+redoBytes)}`);
	}
} catch {
	console.log("\nEdit history:    (none)");
}

console.log("");

// ---------------------------------------------------------------------------
// Minimal msgpack parser — just enough to read the DeltaOverlay key/array-len
// structure without pulling in a dependency.
// ---------------------------------------------------------------------------
function parseDeltaCounts(buf) {
	let pos = 0;
	const counts = {};

	function readByte() { return buf[pos++]; }
	function readU16() { const v = buf.readUInt16BE(pos); pos += 2; return v; }
	function readU32() { const v = buf.readUInt32BE(pos); pos += 4; return v; }

	function readStrLen() {
		const b = readByte();
		if ((b & 0xe0) === 0xa0) return b & 0x1f;          // fixstr
		if (b === 0xd9) return readByte();                   // str8
		if (b === 0xda) return readU16();                    // str16
		if (b === 0xdb) return readU32();                    // str32
		throw new Error(`not a string at ${pos - 1}: 0x${b.toString(16)}`);
	}

	function readArrayLen() {
		const b = readByte();
		if ((b & 0xf0) === 0x90) return b & 0x0f;           // fixarray
		if (b === 0xdc) return readU16();                    // array16
		if (b === 0xdd) return readU32();                    // array32
		throw new Error(`not an array at ${pos - 1}: 0x${b.toString(16)}`);
	}

	function skipValue() {
		const b = readByte();
		// positive fixint / negative fixint / nil / bool
		if ((b & 0x80) === 0 || (b & 0xe0) === 0xe0 || b === 0xc0 || b === 0xc2 || b === 0xc3) return;
		// fixstr
		if ((b & 0xe0) === 0xa0) { pos += b & 0x1f; return; }
		// fixmap
		if ((b & 0xf0) === 0x80) { const n = b & 0x0f; for (let i = 0; i < n * 2; i++) skipValue(); return; }
		// fixarray
		if ((b & 0xf0) === 0x90) { const n = b & 0x0f; for (let i = 0; i < n; i++) skipValue(); return; }
		// typed
		switch (b) {
			case 0xc4: pos += readByte(); return;             // bin8
			case 0xc5: pos += readU16(); return;              // bin16
			case 0xc6: pos += readU32(); return;              // bin32
			case 0xca: pos += 4; return;                      // float32
			case 0xcb: pos += 8; return;                      // float64
			case 0xcc: pos += 1; return;                      // uint8
			case 0xcd: pos += 2; return;                      // uint16
			case 0xce: pos += 4; return;                      // uint32
			case 0xcf: pos += 8; return;                      // uint64
			case 0xd0: pos += 1; return;                      // int8
			case 0xd1: pos += 2; return;                      // int16
			case 0xd2: pos += 4; return;                      // int32
			case 0xd3: pos += 8; return;                      // int64
			case 0xd9: pos += readByte(); return;             // str8
			case 0xda: pos += readU16(); return;              // str16
			case 0xdb: pos += readU32(); return;              // str32
			case 0xdc: { const n = readU16(); for (let i = 0; i < n; i++) skipValue(); return; }  // array16
			case 0xdd: { const n = readU32(); for (let i = 0; i < n; i++) skipValue(); return; }  // array32
			case 0xde: { const n = readU16(); for (let i = 0; i < n * 2; i++) skipValue(); return; } // map16
			case 0xdf: { const n = readU32(); for (let i = 0; i < n * 2; i++) skipValue(); return; } // map32
			case 0xd4: pos += 2; return;                      // fixext1
			case 0xd5: pos += 3; return;                      // fixext2
			case 0xd6: pos += 5; return;                      // fixext4
			case 0xd7: pos += 9; return;                      // fixext8
			case 0xd8: pos += 17; return;                     // fixext16
			case 0xc7: { const n = readByte(); pos += n + 1; return; }  // ext8
			case 0xc8: { const n = readU16(); pos += n + 1; return; }   // ext16
			case 0xc9: { const n = readU32(); pos += n + 1; return; }   // ext32
			default: throw new Error(`unknown msgpack type 0x${b.toString(16)} at ${pos - 1}`);
		}
	}

	// Top-level: fixmap with 3 keys
	const mapByte = readByte();
	const mapLen = (mapByte & 0xf0) === 0x80 ? (mapByte & 0x0f) : (() => { throw new Error("not a fixmap"); })();

	for (let i = 0; i < mapLen; i++) {
		const keyLen = readStrLen();
		const key = buf.slice(pos, pos + keyLen).toString();
		pos += keyLen;
		const arrLen = readArrayLen();
		counts[key] = arrLen;
		for (let j = 0; j < arrLen; j++) skipValue();
	}

	return counts;
}
