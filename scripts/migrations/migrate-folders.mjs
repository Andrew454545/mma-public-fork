#!/usr/bin/env node
/**
 * migrate-folders.mjs
 *
 * Renames tags in a map-making.app export to include their folder path,
 * so MMA's tag tree view displays them hierarchically.
 *
 * Usage:
 *   node scripts/migrations/migrate-folders.mjs <map-export.json...> [-o outdir]
 *   node scripts/migrations/migrate-folders.mjs <map-export.json...> -f folders.json [-o outdir]
 *
 * The folder hierarchy is read from:
 *   1. The embedded storage tag in the map export (auto-detected), or
 *   2. A separate userscript export passed with -f (from the "Export" button)
 *
 * Output: map JSON(s) with tags renamed to folder/path/tag, ready to import.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { basename, join, resolve, dirname } from "path";

const STORAGE_PREFIX = "[⚠️_DO_NOT_DELETE_MM_CLOUD_SAVE]";
const OLD_STORAGE_PREFIX = "[⚠️_NE_PAS_SUPPRIMER_MM_CLOUD_SAVE]";

const args = process.argv.slice(2);
if (!args.length) {
  console.error(
    "Usage: node scripts/migrations/migrate-folders.mjs <map-export.json...> [-f folders.json] [-o outdir]"
  );
  process.exit(1);
}

let outDir = null;
let foldersPath = null;
const inputPaths = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-o" && args[i + 1]) {
    outDir = resolve(args[++i]);
  } else if (args[i] === "-f" && args[i + 1]) {
    foldersPath = resolve(args[++i]);
  } else {
    inputPaths.push(args[i]);
  }
}

if (!inputPaths.length) {
  console.error("No input files specified.");
  process.exit(1);
}

if (outDir && !existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

// -- Folder tree → rename map --

function buildRenameMap(folders, parentPath = "") {
  const map = new Map();
  for (const f of folders) {
    const folderPath = parentPath ? `${parentPath}/${f.name}` : f.name;
    for (const tag of f.tags || []) {
      if (!map.has(tag)) map.set(tag, `${folderPath}/${tag}`);
    }
    if (f.children?.length) {
      for (const [k, v] of buildRenameMap(f.children, folderPath)) {
        if (!map.has(k)) map.set(k, v);
      }
    }
  }
  return map;
}

function isStorageTag(name) {
  return name.startsWith(STORAGE_PREFIX) || name.startsWith(OLD_STORAGE_PREFIX);
}

function extractEmbeddedFolders(mapData) {
  const tagDefs = mapData.extra?.tags;
  if (!tagDefs) return null;
  for (const tagName of Object.keys(tagDefs)) {
    if (!isStorageTag(tagName)) continue;
    const sep = tagName.indexOf(":::");
    if (sep === -1) continue;
    const encoded = tagName.slice(sep + 3);
    try {
      // LZString-compressed — but the userscript's Export button gives plain JSON.
      // Try plain JSON first, then bail (we can't decompress LZString in plain Node
      // without the library, and the user can just use the Export button instead).
      const parsed = JSON.parse(encoded);
      if (parsed?.folders) return parsed.folders;
    } catch {
      console.error(
        "  Found embedded folder data but it's LZString-compressed."
      );
      console.error(
        '  Use the userscript\'s "Export" button and pass the result with -f.'
      );
      return null;
    }
  }
  return null;
}

function loadExternalFolders(path) {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  if (raw.folders && Array.isArray(raw.folders)) return raw.folders;
  console.error(`  ${basename(path)}: no folders array found`);
  return null;
}

// -- Process one map export --

function processFile(inputPath, externalFolders) {
  const name = basename(inputPath);
  let mapData;
  try {
    mapData = JSON.parse(readFileSync(inputPath, "utf-8"));
  } catch (e) {
    console.error(`  SKIP ${name}: ${e.message}`);
    return false;
  }

  const coords = mapData.customCoordinates || mapData.locations;
  if (!coords || !Array.isArray(coords)) {
    console.error(`  SKIP ${name}: no customCoordinates found`);
    return false;
  }

  const folders = externalFolders || extractEmbeddedFolders(mapData);
  if (!folders) {
    console.error(`  SKIP ${name}: no folder data found (pass -f folders.json)`);
    return false;
  }

  const renameMap = buildRenameMap(folders);
  let renamed = 0;
  let skippedAliases = 0;

  // Count aliases (tags appearing in multiple folders)
  const tagFolderCount = new Map();
  const countTags = (fl) => {
    for (const tag of fl.tags || []) {
      tagFolderCount.set(tag, (tagFolderCount.get(tag) || 0) + 1);
    }
    for (const child of fl.children || []) countTags(child);
  };
  for (const f of folders) countTags(f);
  for (const [tag, count] of tagFolderCount) {
    if (count > 1) skippedAliases++;
  }

  // Rename tags on each location, mark storage-only locations for removal
  const storageLocIndices = new Set();
  for (let i = 0; i < coords.length; i++) {
    const loc = coords[i];
    const tags = loc.extra?.tags;
    if (!Array.isArray(tags)) continue;
    if (tags.every((t) => isStorageTag(t))) storageLocIndices.add(i);
    loc.extra.tags = tags
      .filter((t) => !isStorageTag(t))
      .map((t) => {
        const newName = renameMap.get(t);
        if (newName) {
          renamed++;
          return newName;
        }
        return t;
      });
  }

  // Strip storage-only locations
  if (mapData.customCoordinates) {
    mapData.customCoordinates = mapData.customCoordinates.filter((_, i) => !storageLocIndices.has(i));
  }

  // Rename tag definitions
  if (mapData.extra?.tags) {
    const newDefs = {};
    for (const [tagName, def] of Object.entries(mapData.extra.tags)) {
      if (isStorageTag(tagName)) continue;
      const newName = renameMap.get(tagName);
      newDefs[newName || tagName] = def;
    }
    mapData.extra.tags = newDefs;
  }

  const outName = name.replace(/\.json$/, "-mma.json");
  const outPath = outDir
    ? join(outDir, outName)
    : join(dirname(inputPath), outName);
  writeFileSync(outPath, JSON.stringify(mapData, null, 2), "utf-8");

  console.log(
    `  ${name} -> ${basename(outPath)}  (${renameMap.size} tags mapped, ${renamed} references renamed)`
  );
  if (skippedAliases > 0) {
    console.log(
      `    ${skippedAliases} tag(s) appear in multiple folders — first folder wins`
    );
  }

  return true;
}

// -- Main --

const externalFolders = foldersPath ? loadExternalFolders(foldersPath) : null;
if (foldersPath && !externalFolders) process.exit(1);

console.log(`Processing ${inputPaths.length} file(s)...`);
let ok = 0;
let fail = 0;
for (const p of inputPaths) {
  if (processFile(p, externalFolders)) ok++;
  else fail++;
}
console.log(`\nDone: ${ok} converted${fail ? `, ${fail} skipped` : ""}`);
