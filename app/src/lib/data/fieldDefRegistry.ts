/**
 * Unified field-definition registry.
 *
 * Field **existence** (which keys have data) is tracked separately by
 * `knownFieldKeys` in `useMapStore`. This module handles field **metadata**
 * (type, label, enum values) from two sources, in priority order:
 *
 *   1. **User overrides** — persisted in `MapMeta.extra.fields`, editable via
 *      ManageFields. Loaded on map open, updated on save. Curated defs for
 *      well-known SV keys are written here by Rust (`known_field_def`) when the
 *      key first appears in location data, so they show up the same way.
 *   2. **Plugin defs** — declared by `EnrichmentProvider.fieldDefs` at
 *      registration time. Available as long as the plugin is active.
 *
 * `getFieldDef(key)` returns the highest-priority definition for a key,
 * or `undefined` if no metadata is declared (the UI falls back to the raw key name).
 */

import type { ExtraFieldDef } from "@/types";

let pluginDefs: Record<string, ExtraFieldDef> = {};
let userDefs: Record<string, ExtraFieldDef> = {};

/** Register field definitions from an enrichment provider (called at activation). */
export function registerPluginFieldDefs(defs: Record<string, ExtraFieldDef>) {
	pluginDefs = { ...pluginDefs, ...defs };
}

/** Remove plugin field definitions by key (called when a plugin is deactivated). */
export function unregisterPluginFieldDefs(keys: string[]) {
	if (keys.length === 0) return;
	const next = { ...pluginDefs };
	for (const k of keys) delete next[k];
	pluginDefs = next;
}

/** Load user-customized field definitions from `MapMeta.extra.fields` (called on map open). */
export function setUserFieldDefs(defs: Record<string, ExtraFieldDef>) {
	userDefs = defs;
}

/** Merge auto-registered/inferred defs into the user layer (e.g. after a mutation
 *  discovers new extra keys). Existing entries win, so user edits and previously-loaded
 *  defs are never clobbered. Keeps the registry the live source of truth without a reload. */
export function mergeUserFieldDefs(defs: Record<string, ExtraFieldDef>) {
	userDefs = { ...defs, ...userDefs };
}

/** Clear per-map state on map close. Plugin defs persist across maps. */
export function resetForMapChange() {
	userDefs = {};
}

/** Look up metadata for a single field key. Returns `undefined` if no metadata exists. */
export function getFieldDef(key: string): ExtraFieldDef | undefined {
	return userDefs[key] ?? pluginDefs[key];
}

/** Merged view of all field definitions across all layers. */
export function getAllFieldDefs(): Record<string, ExtraFieldDef> {
	return { ...pluginDefs, ...userDefs };
}
