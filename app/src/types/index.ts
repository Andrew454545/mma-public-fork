export const enum LocationFlag {
	None = 0,
	LoadAsPanoId = 1,
	Informational = 2,
}

/** Panorama source type from Google's internal metadata. */
export const enum PanoType {
	Official = 2,
	Unknown = 3,
	UserUploaded = 10,
}

export interface Location {
	id: number;
	lat: number;
	lng: number;
	heading: number;
	pitch: number;
	zoom: number;
	panoId: string | null;
	flags: number;
	tags: number[];
	extra?: Record<string, unknown>;
	createdAt?: string;
	modifiedAt?: string;
}

export const LOCATION_CORE_KEYS = new Set([
	"lat",
	"lng",
	"heading",
	"pitch",
	"zoom",
	"panoId",
	"flags",
	"tags",
	"extra",
]);

export function hasLoadAsPanoId(loc: Location): boolean {
	return (loc.flags & LocationFlag.LoadAsPanoId) !== 0;
}

export function isInformational(loc: Location): boolean {
	return (loc.flags & LocationFlag.Informational) !== 0;
}

export function isPinnedToPano(loc: Location): boolean {
	return hasLoadAsPanoId(loc) && loc.panoId != null;
}

export function createLocation(
	partial: Partial<Location> & { lat: number; lng: number },
): Location {
	return {
		id: 0, // placeholder; Rust assigns the real ID
		heading: 0,
		pitch: 0,
		zoom: 0,
		panoId: null,
		flags: LocationFlag.None,
		tags: [],
		createdAt: new Date().toISOString(),
		...partial,
	};
}

export interface Tag {
	id: number;
	name: string;
	color: string;
	visible: boolean;
	order?: number;
}

export interface ExtraFieldDef {
	type: "string" | "number" | "date" | "month" | "enum";
	label?: string;
	values?: string[];
	labels?: Record<string, string>;
}

export interface MapSettings {
	pointAlongRoad: boolean;
	preferDirection: number | null;
	preferOfficial: boolean;
	preferHigherQuality: boolean;
	onlyOfficial: boolean;
	cameraTypes: string[] | null;
	defaultPanoId: boolean;
	exportZoom: boolean;
	exportUnpanned: boolean;
	enrichMetadata: boolean;
	enrichFields?: string[];
}

export interface MapMeta {
	id: string;
	name: string;
	description: string;
	folder: string | null;
	locationCount: number;
	tags: Record<string, Tag>;
	labels: string[];
	settings: MapSettings;
	scoreBounds: "auto" | [number, number, number, number];
	extra?: { fields?: Record<string, ExtraFieldDef> };
	createdAt: string;
	updatedAt: string;
	lastOpenedAt: string | null;
}

export interface MapData {
	meta: MapMeta;
}

export interface ImportResult {
	locationCount: number;
	tags: { id: number; name: string; color: string }[];
	delta: import("@/lib/render/CellManager").CellDelta;
	warnings: string[];
}

export type SortMode = "name" | "created" | "opened" | "amount";
export type TagSortMode = "default" | "name" | "amount";

export type WorkArea = "overview" | "location" | "duplicates" | "import" | "plugin";

export interface DuplicateGroup {
	distance: number;
	locations: Location[];
}

export interface CommitInfo {
	id: string;
	mapId: string;
	parentId: string | null;
	message: string | null;
	treeHash: string | null;
	added: number;
	removed: number;
	modified: number;
	locationCount: number;
	createdAt: string;
}
