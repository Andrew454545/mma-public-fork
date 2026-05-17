import { describe, it, expect } from "vitest";
import { serializeChunk } from "@/lib/storage/hashing";
import type { Location } from "@/types";

function loc(overrides: Partial<Location> = {}): Location {
	return {
		id: "test-id",
		lat: 40.7,
		lng: -74.0,
		heading: 90,
		pitch: 0,
		zoom: 1,
		panoId: "abc",
		tags: ["t1"],
		createdAt: "2024-01-01",
		...overrides,
	};
}

describe("serializeChunk", () => {
	it("produces deterministic JSON with sorted keys", () => {
		const result = serializeChunk([loc()]);
		const parsed = JSON.parse(result);
		const keys = Object.keys(parsed[0]);
		expect(keys).toEqual([
			"createdAt",
			"heading",
			"id",
			"lat",
			"lng",
			"panoId",
			"pitch",
			"tags",
			"zoom",
		]);
	});

	it("is deterministic regardless of object key order", () => {
		const a = loc();
		const b = {
			zoom: a.zoom,
			id: a.id,
			lat: a.lat,
			lng: a.lng,
			heading: a.heading,
			pitch: a.pitch,
			panoId: a.panoId,
			tags: a.tags,
			createdAt: a.createdAt,
		} as Location;
		expect(serializeChunk([a])).toBe(serializeChunk([b]));
	});

	it("handles empty array", () => {
		expect(serializeChunk([])).toBe("[]");
	});

	it("serializes multiple locations", () => {
		const locs = [loc({ id: "a" }), loc({ id: "b" })];
		const parsed = JSON.parse(serializeChunk(locs));
		expect(parsed).toHaveLength(2);
		expect(parsed[0].id).toBe("a");
		expect(parsed[1].id).toBe("b");
	});
});
