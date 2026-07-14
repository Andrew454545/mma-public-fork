// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mergePatches } from "@/lib/sv/svRunner";
import type { Location } from "@/types";

describe("mergePatches", () => {
	it("returns null for empty patches", () => {
		expect(mergePatches([])).toBeNull();
	});

	it("returns null when all patches are empty objects", () => {
		expect(mergePatches([{} as Partial<Location>])).toBeNull();
	});

	it("patches a top-level field", () => {
		expect(mergePatches([{ heading: 90 }])).toEqual({ heading: 90 });
	});

	it("last top-level patch wins", () => {
		expect(mergePatches([{ heading: 90 }, { heading: 180 }])).toEqual({ heading: 180 });
	});

	it("carries only patched extra keys (the store merges into the location)", () => {
		const result = mergePatches([{ extra: { timezone: "Europe/Paris" } } as Partial<Location>]);
		expect(result).toEqual({ extra: { timezone: "Europe/Paris" } });
	});

	it("merges extra from multiple patches", () => {
		const result = mergePatches([
			{ extra: { a: 1 } } as Partial<Location>,
			{ extra: { b: 2 } } as Partial<Location>,
		]);
		expect(result).toEqual({ extra: { a: 1, b: 2 } });
	});

	it("later extra keys override earlier ones", () => {
		const result = mergePatches([
			{ extra: { a: "mid" } } as Partial<Location>,
			{ extra: { a: "new" } } as Partial<Location>,
		]);
		expect(result).toEqual({ extra: { a: "new" } });
	});

	it("mixes top-level and extra in one result", () => {
		const result = mergePatches([
			{ heading: 45 },
			{ extra: { added: "yes" } } as Partial<Location>,
		]);
		expect(result).toEqual({ heading: 45, extra: { added: "yes" } });
	});
});
