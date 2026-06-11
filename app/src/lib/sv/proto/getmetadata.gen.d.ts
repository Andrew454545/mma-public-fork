/* Types for the pbf-generated reader (getmetadata.gen.js).
 * Regenerate the .js with `npm run proto:gen` after editing getmetadata.proto,
 * then keep these declarations in sync. */
import type { PbfReader, PbfWriter } from "pbf";

export interface GetMetadataRequest {
	context?: { productId: string; language: string };
	locale?: { language: string; regionCode: string };
	key: { key?: ImageKey }[];
	spec?: { component: number[] };
}
export interface ResponseStatus {
	code: number;
}
export interface ImageStatus {
	code: number;
}
export interface ImageKey {
	frontend: number;
	id: string;
}
export interface ImageSize {
	height: number;
	width: number;
}
export interface ImageTileSize {
	possible: { size?: ImageSize }[];
	tileSize?: ImageSize;
}
export interface ImageTiles {
	worldSize?: ImageSize;
	tileSize?: ImageTileSize;
	panoId: string;
}
export interface LocalizedText {
	text: string;
	language: string;
}
export interface ImageDescription {
	description: LocalizedText[];
}
export interface ImageAttribution {
	item: { name?: { name: string }; url: string }[];
	author: { name?: LocalizedText; profileUrl: string }[];
}
export interface LatLng {
	lat: number;
	lng: number;
}
export interface PanoLocation {
	location?: LatLng;
	altitude?: { meters: number };
	pov?: { heading: number; tilt: number; roll: number };
	level?: { id: number; name?: LocalizedText; abbreviation?: LocalizedText };
	countryCode: string;
}
export interface Pano {
	key?: ImageKey;
	location?: PanoLocation;
}
export interface PanoLink {
	target: number;
	properties?: { heading: number };
}
export interface PanoDate {
	year: number;
	month: number;
	day: number;
}
export interface PanoTime {
	target: number;
	date?: PanoDate;
}
export interface ImageInformation {
	status?: ImageStatus;
	location?: PanoLocation;
	relations?: { pano: Pano[] };
	link: PanoLink[];
	time: PanoTime[];
}
export interface ImageDate {
	sourceInfo?: { source: string };
	date?: PanoDate;
}
export interface ImageMetadata {
	status?: ImageStatus;
	pano?: ImageKey;
	tiles?: ImageTiles;
	description?: ImageDescription;
	attribution?: ImageAttribution;
	information: ImageInformation[];
	date?: ImageDate;
}
export interface GetMetadataResponse {
	status?: ResponseStatus;
	metadata: ImageMetadata[];
}

export function readGetMetadataResponse(pbf: PbfReader, end?: number): GetMetadataResponse;
export function readImageMetadata(pbf: PbfReader, end?: number): ImageMetadata;
export function readGetMetadataRequest(pbf: PbfReader, end?: number): GetMetadataRequest;
export function writeGetMetadataRequest(obj: GetMetadataRequest, pbf: PbfWriter): void;
