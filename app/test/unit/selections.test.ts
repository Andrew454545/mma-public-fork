import { describe, it, expect } from "vitest";
import {
	colorForKey,
	buildSelection,
	addSelection,
	removeSelection,
	intersectSelections,
	unionSelections,
	invertSelections,
	toggleManualSelection,
	selectionDisplayName,
	reorderSelections,
	composeSelections,
	decomposeChild,
	removeFromComposite,
} from "@/store/selections";
import type { MapData, Tag } from "@/types";

function makeMap(tags: Record<number, Tag> = {}): MapData {
	return {
		meta: {
			id: "map1",
			name: "Test",
			description: "",
			folder: null,
			locationCount: 0,
			tags,
			settings: {
				pointAlongRoad: false,
				preferDirection: null,
				preferOfficial: false,
				preferHigherQuality: false,
				onlyOfficial: false,
				cameraTypes: null,
				defaultPanoId: false,
				exportZoom: false,
				exportUnpanned: false,
			},
			scoreBounds: "auto",
			createdAt: "",
			updatedAt: "",
		},
	};
}

describe("colorForKey", () => {
	it("returns an RGB tuple", () => {
		const [r, g, b] = colorForKey("test");
		expect(r).toBeGreaterThanOrEqual(0);
		expect(r).toBeLessThanOrEqual(255);
		expect(g).toBeGreaterThanOrEqual(0);
		expect(b).toBeGreaterThanOrEqual(0);
	});

	it("is deterministic", () => {
		expect(colorForKey("foo")).toEqual(colorForKey("foo"));
	});

	it("produces different colors for different keys", () => {
		expect(colorForKey("alpha")).not.toEqual(colorForKey("beta"));
	});
});

describe("buildSelection", () => {
	const map = makeMap();

	it("Everything gets correct key", () => {
		const sel = buildSelection(map, { type: "Everything" });
		expect(sel.key).toBe("everything");
	});

	it("Tag gets key with tagId", () => {
		const sel = buildSelection(map, { type: "Tag", tagId: 42 });
		expect(sel.key).toBe("tag:42");
	});

	it("Untagged gets correct key", () => {
		const sel = buildSelection(map, { type: "Untagged" });
		expect(sel.key).toBe("untagged");
	});

	it("Unpanned gets correct key", () => {
		const sel = buildSelection(map, { type: "Unpanned" });
		expect(sel.key).toBe("unpanned");
	});

	it("PanoIds / NotPanoIds get correct keys", () => {
		expect(buildSelection(map, { type: "PanoIds" }).key).toBe("panoids");
		expect(buildSelection(map, { type: "NotPanoIds" }).key).toBe("notpanoids");
	});

	it("Manual gets correct key", () => {
		const sel = buildSelection(map, { type: "Manual", locations: [1, 2] });
		expect(sel.key).toBe("manual");
	});

	it("Filter generates key with field/op/value", () => {
		const sel = buildSelection(map, {
			type: "Filter",
			field: "altitude",
			op: "gt",
			value: 500,
		});
		expect(sel.key).toBe("filter:altitude:gt:500");
	});

	it("Filter between includes value2", () => {
		const sel = buildSelection(map, {
			type: "Filter",
			field: "altitude",
			op: "between",
			value: 0,
			value2: 1000,
		});
		expect(sel.key).toBe("filter:altitude:between:0:1000");
	});

	it("assigns a color", () => {
		const sel = buildSelection(map, { type: "Everything" });
		expect(sel.color).toHaveLength(3);
		expect(sel.color[0]).toBeGreaterThanOrEqual(0);
	});
});

describe("addSelection / removeSelection", () => {
	const map = makeMap();

	it("addSelection appends a new selection", () => {
		const result = addSelection(map, [], { type: "Everything" });
		expect(result).toHaveLength(1);
		expect(result[0].key).toBe("everything");
	});

	it("addSelection deduplicates by key", () => {
		const first = addSelection(map, [], { type: "Everything" });
		const second = addSelection(map, first, { type: "Everything" });
		expect(second).toHaveLength(1);
	});

	it("removeSelection removes by key", () => {
		const sels = addSelection(map, [], { type: "Everything" });
		const result = removeSelection(sels, "everything");
		expect(result).toHaveLength(0);
	});

	it("removeSelection decomposes composite on remove", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const s2 = buildSelection(map, { type: "Untagged" });
		const composite = buildSelection(map, { type: "Intersection", selections: [s1, s2] });
		const result = removeSelection([composite], composite.key);
		expect(result).toHaveLength(2);
	});
});

describe("intersectSelections", () => {
	const map = makeMap();

	it("creates intersection of two selections", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const s2 = buildSelection(map, { type: "Untagged" });
		const result = intersectSelections(map, [s1, s2], null);
		expect(result).toHaveLength(1);
		expect(result[0].props.type).toBe("Intersection");
	});

	it("does nothing with fewer than 2 selections", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const result = intersectSelections(map, [s1], null);
		expect(result).toHaveLength(1);
		expect(result[0].props.type).toBe("PanoIds");
	});

	it("flattens nested intersections", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const s2 = buildSelection(map, { type: "Untagged" });
		const inter = intersectSelections(map, [s1, s2], null);
		const s3 = buildSelection(map, { type: "Unpanned" });
		const result = intersectSelections(map, [...inter, s3], null);
		expect(result).toHaveLength(1);
		const children = (result[0].props as { type: "Intersection"; selections: any[] }).selections;
		expect(children).toHaveLength(3);
	});
});

describe("unionSelections", () => {
	const map = makeMap();

	it("creates union of two selections", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const s2 = buildSelection(map, { type: "Untagged" });
		const result = unionSelections(map, [s1, s2], null);
		expect(result).toHaveLength(1);
		expect(result[0].props.type).toBe("Union");
	});

	it("flattens nested unions", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const s2 = buildSelection(map, { type: "Untagged" });
		const union = unionSelections(map, [s1, s2], null);
		const s3 = buildSelection(map, { type: "Unpanned" });
		const result = unionSelections(map, [...union, s3], null);
		expect(result).toHaveLength(1);
		const children = (result[0].props as { type: "Union"; selections: any[] }).selections;
		expect(children).toHaveLength(3);
	});
});

describe("invertSelections", () => {
	const map = makeMap();

	it("wraps a single selection in Invert", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const result = invertSelections(map, [s1], null);
		expect(result).toHaveLength(1);
		expect(result[0].props.type).toBe("Invert");
	});

	it("double invert unwraps back to original", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const inverted = invertSelections(map, [s1], null);
		const result = invertSelections(map, inverted, null);
		expect(result).toHaveLength(1);
		expect(result[0].props.type).toBe("PanoIds");
	});
});

describe("toggleManualSelection", () => {
	const map = makeMap();

	it("creates manual selection if none exists", () => {
		const result = toggleManualSelection(map, [], 1);
		expect(result).toHaveLength(1);
		expect(result[0].key).toBe("manual");
	});

	it("adds to existing manual selection", () => {
		const initial = toggleManualSelection(map, [], 1);
		const result = toggleManualSelection(map, initial, 2);
		const ids = (result[0].props as { type: "Manual"; locations: number[] }).locations;
		expect(ids).toContain(1);
		expect(ids).toContain(2);
	});

	it("removes from existing manual selection", () => {
		let sels = toggleManualSelection(map, [], 1);
		sels = toggleManualSelection(map, sels, 2);
		sels = toggleManualSelection(map, sels, 1);
		const ids = (sels[0].props as { type: "Manual"; locations: number[] }).locations;
		expect(ids).toEqual([2]);
	});

	it("removes manual selection entirely when last location toggled off", () => {
		let sels = toggleManualSelection(map, [], 1);
		sels = toggleManualSelection(map, sels, 1);
		expect(sels).toHaveLength(0);
	});
});

describe("reorderSelections", () => {
	const map = makeMap();

	it("moves selection before target", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const s2 = buildSelection(map, { type: "Untagged" });
		const s3 = buildSelection(map, { type: "Unpanned" });
		const result = reorderSelections([s1, s2, s3], s3.key, s1.key, "before");
		expect(result.map((s) => s.key)).toEqual([s3.key, s1.key, s2.key]);
	});

	it("moves selection after target", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const s2 = buildSelection(map, { type: "Untagged" });
		const s3 = buildSelection(map, { type: "Unpanned" });
		const result = reorderSelections([s1, s2, s3], s1.key, s3.key, "after");
		expect(result.map((s) => s.key)).toEqual([s2.key, s3.key, s1.key]);
	});
});

describe("selectionDisplayName", () => {
	it("returns type name for simple types", () => {
		const map = makeMap();
		const sel = buildSelection(map, { type: "Everything" });
		expect(selectionDisplayName(map, sel)).toBe("Everything");
	});

	it("returns tag name for Tag selection", () => {
		const map = makeMap({ 42: { id: 42, name: "My Tag", color: "#f00", visible: true } });
		const sel = buildSelection(map, { type: "Tag", tagId: 42 });
		expect(selectionDisplayName(map, sel)).toBe("Tag: My Tag");
	});

	it("falls back to tag ID if tag not found", () => {
		const map = makeMap();
		const sel = buildSelection(map, { type: "Tag", tagId: 999 });
		expect(selectionDisplayName(map, sel)).toBe("Tag: 999");
	});

	it("display name for Filter eq", () => {
		const map = makeMap();
		const sel = buildSelection(map, {
			type: "Filter",
			field: "countryCode",
			op: "eq",
			value: "BR",
		});
		expect(selectionDisplayName(map, sel)).toBe("countryCode = BR");
	});

	it("display name for Filter between", () => {
		const map = makeMap();
		const sel = buildSelection(map, {
			type: "Filter",
			field: "altitude",
			op: "between",
			value: 0,
			value2: 3000,
		});
		expect(selectionDisplayName(map, sel)).toBe("altitude between 0..3000");
	});
});

describe("composeSelections", () => {
	const map = makeMap();

	it("drag onto drop creates intersection", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const s2 = buildSelection(map, { type: "Untagged" });
		const result = composeSelections(map, [s1, s2], s2.key, s1.key, "intersection");
		expect(result).toHaveLength(1);
		expect(result[0].props.type).toBe("Intersection");
	});

	it("drag onto drop creates union", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const s2 = buildSelection(map, { type: "Untagged" });
		const result = composeSelections(map, [s1, s2], s2.key, s1.key, "union");
		expect(result).toHaveLength(1);
		expect(result[0].props.type).toBe("Union");
	});

	it("drag onto existing composite adds as child", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const s2 = buildSelection(map, { type: "Untagged" });
		const composed = composeSelections(map, [s1, s2], s2.key, s1.key, "intersection");
		const s3 = buildSelection(map, { type: "Unpanned" });
		const result = composeSelections(
			map,
			[...composed, s3],
			s3.key,
			composed[0].key,
			"intersection",
		);
		expect(result).toHaveLength(1);
		const children = (result[0].props as { selections: any[] }).selections;
		expect(children).toHaveLength(3);
	});

	it("returns unchanged if drag equals drop", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const result = composeSelections(map, [s1], s1.key, s1.key, "intersection");
		expect(result).toEqual([s1]);
	});

	it("returns unchanged if key not found", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const result = composeSelections(map, [s1], "nonexistent", s1.key, "intersection");
		expect(result).toEqual([s1]);
	});
});

describe("decomposeChild", () => {
	const map = makeMap();

	it("extracts a child from a composite", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const s2 = buildSelection(map, { type: "Untagged" });
		const s3 = buildSelection(map, { type: "Unpanned" });
		const composed = composeSelections(
			map,
			composeSelections(map, [s1, s2], s2.key, s1.key, "intersection").concat(s3),
			s3.key,
			composeSelections(map, [s1, s2], s2.key, s1.key, "intersection")[0].key,
			"intersection",
		);
		const parentKey = composed[0].key;
		const result = decomposeChild(map, composed, parentKey, s2.key);
		expect(result.length).toBeGreaterThan(composed.length);
	});
});

describe("removeFromComposite", () => {
	const map = makeMap();

	it("removes a child and reduces composite", () => {
		const s1 = buildSelection(map, { type: "PanoIds" });
		const s2 = buildSelection(map, { type: "Untagged" });
		const s3 = buildSelection(map, { type: "Unpanned" });
		let sels = [s1, s2, s3];
		sels = composeSelections(map, sels, s2.key, s1.key, "intersection");
		sels = composeSelections(map, [...sels, s3], s3.key, sels[0].key, "intersection");
		const parentKey = sels[0].key;
		const result = removeFromComposite(map, sels, parentKey, s2.key);
		expect(result).toHaveLength(sels.length);
		const children = (result[0].props as { selections: any[] }).selections;
		expect(children.every((c: any) => c.key !== s2.key)).toBe(true);
	});
});
