import type { Location } from "@/bindings.gen";
import { nowUnix } from "@/lib/util/format";

/** Street View camera orientation (POV). */
export type LocationPOV = Pick<Location, "heading" | "pitch" | "zoom">;

export type LatLng = google.maps.LatLngLiteral;

export const enum LocationFlag {
	None = 0,
	LoadAsPanoId = 1,
	Informational = 2,
	// Virtual-preview kind tags. JS-only and set only on the ephemeral active-location preview
	// (never persisted) — strip with VIRTUAL_FLAGS before materializing one into the map.
	ImportPreview = 4,
	SeenOverlay = 8,
}

/** Mask of the virtual-only kind bits, to clear when turning a preview into a real location. */
export const VIRTUAL_FLAGS = LocationFlag.ImportPreview | LocationFlag.SeenOverlay;

/** Panorama source type from Google's internal metadata. */
export const enum PanoType {
	Official = 2,
	Unknown = 3,
	UserUploaded = 10,
}

export function hasLoadAsPanoId(loc: Location): boolean {
	return (loc.flags & LocationFlag.LoadAsPanoId) !== 0;
}

export function isInformational(loc: Location): boolean {
	return (loc.flags & LocationFlag.Informational) !== 0;
}

export function isPinnedToPano(loc: Location): boolean {
	return hasLoadAsPanoId(loc) && loc.panoId != null;
}

/** Virtual locations exist only ephemerally as the single active-location preview — never in
 *  the map. They display like real locations but every mutate path no-ops. Identity is a unique
 *  negative id (so id-only checks work); the kind rides in `flags` (read where you hold the
 *  full Location). */
export function isVirtualLocation(loc: { id: number }): boolean {
	return loc.id < 0;
}

export function isImportPreview(loc: Location): boolean {
	return (loc.flags & LocationFlag.ImportPreview) !== 0;
}

export function isSeenPreview(loc: Location): boolean {
	return (loc.flags & LocationFlag.SeenOverlay) !== 0;
}

export function createLocation(
	partial: Partial<Location> & LatLng,
): Location {
	return {
		id: 0, // placeholder; Rust assigns the real ID
		heading: 0,
		pitch: 0,
		zoom: 0,
		panoId: null,
		flags: LocationFlag.None,
		tags: [],
		extra: null,
		createdAt: nowUnix(),
		modifiedAt: null,
		...partial,
	};
}

export type SortMode = "name" | "created" | "opened" | "amount";
export type TagSortMode = "default" | "name" | "amount";

export type WorkArea = "overview" | "location" | "duplicates" | "import" | "plugin" | "diff";
