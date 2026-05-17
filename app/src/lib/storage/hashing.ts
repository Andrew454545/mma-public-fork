import type { Location } from "@/types";

const SORTED_KEYS: (keyof Location)[] = [
	"createdAt",
	"extra",
	"flags",
	"heading",
	"id",
	"lat",
	"lng",
	"panoId",
	"pitch",
	"tags",
	"zoom",
];

export function serializeChunk(locations: Location[]): string {
	return JSON.stringify(
		locations.map((loc) => {
			const obj: Record<string, unknown> = {};
			for (const key of SORTED_KEYS) {
				const val = loc[key];
				if (val !== undefined) obj[key] = val;
			}
			return obj;
		}),
	);
}

export async function hashBlob(data: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
	return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
