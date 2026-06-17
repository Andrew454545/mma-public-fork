import { describe, it, expect } from "vitest";
import {
	lerp,
	gradientColor,
	isNumericField,
	fieldScale,
	buildGradientSelections,
} from "@/plugins/gradient/gradientMath";

describe("lerp", () => {
	it("t=0 returns first color", () => {
		expect(lerp([10, 20, 30], [200, 100, 50], 0)).toEqual([10, 20, 30]);
	});

	it("t=1 returns second color", () => {
		expect(lerp([10, 20, 30], [200, 100, 50], 1)).toEqual([200, 100, 50]);
	});

	it("t=0.5 returns midpoint", () => {
		expect(lerp([0, 0, 0], [100, 100, 100], 0.5)).toEqual([50, 50, 50]);
	});

	it("t=0.25 returns quarter point", () => {
		expect(lerp([0, 0, 0], [100, 200, 40], 0.25)).toEqual([25, 50, 10]);
	});

	it("rounds to integers", () => {
		expect(lerp([0, 0, 0], [1, 1, 1], 0.5)).toEqual([1, 1, 1]);
		expect(lerp([0, 0, 0], [3, 3, 3], 0.5)).toEqual([2, 2, 2]);
	});

	it("identical colors return same", () => {
		expect(lerp([42, 99, 200], [42, 99, 200], 0.7)).toEqual([42, 99, 200]);
	});

	it("handles negative channel interpolation", () => {
		expect(lerp([200, 200, 200], [0, 0, 0], 0.5)).toEqual([100, 100, 100]);
	});
});

describe("gradientColor", () => {
	const twoStops: [number, number, number][] = [
		[0, 0, 0],
		[255, 255, 255],
	];

	const threeStops: [number, number, number][] = [
		[255, 0, 0],
		[0, 255, 0],
		[0, 0, 255],
	];

	it("t=0 returns first stop", () => {
		expect(gradientColor(twoStops, 0)).toEqual([0, 0, 0]);
	});

	it("t=1 returns last stop", () => {
		expect(gradientColor(twoStops, 1)).toEqual([255, 255, 255]);
	});

	it("t<0 clamps to first stop", () => {
		expect(gradientColor(twoStops, -0.5)).toEqual([0, 0, 0]);
	});

	it("t>1 clamps to last stop", () => {
		expect(gradientColor(twoStops, 1.5)).toEqual([255, 255, 255]);
	});

	it("t=0.5 with 2 stops returns midpoint", () => {
		expect(gradientColor(twoStops, 0.5)).toEqual([128, 128, 128]);
	});

	it("3 stops: t=0 first, t=0.5 second, t=1 third", () => {
		expect(gradientColor(threeStops, 0)).toEqual([255, 0, 0]);
		expect(gradientColor(threeStops, 0.5)).toEqual([0, 255, 0]);
		expect(gradientColor(threeStops, 1)).toEqual([0, 0, 255]);
	});

	it("3 stops: t=0.25 midpoint of first two", () => {
		expect(gradientColor(threeStops, 0.25)).toEqual([128, 128, 0]);
	});

	it("5 stops at segment boundaries", () => {
		const fiveStops: [number, number, number][] = [
			[10, 0, 0],
			[20, 0, 0],
			[30, 0, 0],
			[40, 0, 0],
			[50, 0, 0],
		];
		expect(gradientColor(fiveStops, 0)).toEqual([10, 0, 0]);
		expect(gradientColor(fiveStops, 0.25)).toEqual([20, 0, 0]);
		expect(gradientColor(fiveStops, 0.5)).toEqual([30, 0, 0]);
		expect(gradientColor(fiveStops, 0.75)).toEqual([40, 0, 0]);
		expect(gradientColor(fiveStops, 1)).toEqual([50, 0, 0]);
	});

	it("single stop returns it for any t", () => {
		const oneStop: [number, number, number][] = [[42, 42, 42]];
		expect(gradientColor(oneStop, 0)).toEqual([42, 42, 42]);
		expect(gradientColor(oneStop, 1)).toEqual([42, 42, 42]);
	});
});

describe("isNumericField", () => {
	it("undefined returns false", () => {
		expect(isNumericField(undefined)).toBe(false);
	});

	it("number type returns true", () => {
		expect(isNumericField({ type: "number" })).toBe(true);
	});

	it("date type returns true", () => {
		expect(isNumericField({ type: "date" })).toBe(true);
	});

	it("string type returns false", () => {
		expect(isNumericField({ type: "string" })).toBe(false);
	});

	it("enum type returns false", () => {
		expect(isNumericField({ type: "enum" })).toBe(false);
	});

	it("month type returns false", () => {
		expect(isNumericField({ type: "month" })).toBe(false);
	});
});

describe("fieldScale", () => {
	it("maps months to an ordinal month count (proportional to time)", () => {
		const jan2010 = fieldScale("2010-01", "month")!;
		const jan2011 = fieldScale("2011-01", "month")!;
		const jul2010 = fieldScale("2010-07", "month")!;
		expect(jan2011 - jan2010).toBe(12);
		expect(jul2010 - jan2010).toBe(6);
	});

	it("parses numeric strings to their value", () => {
		expect(fieldScale("80", "string")).toBe(80);
		expect(fieldScale("300", "string")).toBe(300);
	});

	it("returns null for non-numeric categories", () => {
		expect(fieldScale("gen4", "enum")).toBeNull();
		expect(fieldScale("", "string")).toBeNull();
		expect(fieldScale("2010-XX", "month")).toBeNull();
	});
});

describe("buildGradientSelections", () => {
	const stops: [number, number, number][] = [
		[0, 0, 0],
		[255, 255, 255],
	];
	const numericValues = [
		{ id: 1, raw: 0 },
		{ id: 2, raw: 50 },
		{ id: 3, raw: 100 },
	];

	it("unscoped numeric emits live Filter buckets that match the whole map", () => {
		const sels = buildGradientSelections(numericValues, {
			numeric: true,
			fieldKey: "altitude",
			fieldType: "number",
			stops,
			bucketCount: 2,
			scoped: false,
		});
		expect(sels.every((s) => s.props.type === "Filter")).toBe(true);
		expect(sels.every((s) => s.key.startsWith("filter:altitude:between:"))).toBe(true);
	});

	it("scoped numeric emits Locations buckets restricted to the subset's ids, each id in one bucket", () => {
		const sels = buildGradientSelections(numericValues, {
			numeric: true,
			fieldKey: "altitude",
			fieldType: "number",
			stops,
			bucketCount: 2,
			scoped: true,
		});
		expect(sels.every((s) => s.props.type === "Locations")).toBe(true);
		// every input id appears exactly once across all buckets
		const ids = sels.flatMap((s) =>
			s.props.type === "Locations" ? s.props.locations : [],
		);
		expect(ids.sort()).toEqual([1, 2, 3]);
		// key mirrors the engine's Locations key (its id list)
		const first = sels[0];
		if (first.props.type === "Locations") {
			expect(first.key).toBe(first.props.locations.join(","));
		}
	});

	it("scoped enum groups the subset's ids by distinct value", () => {
		const sels = buildGradientSelections(
			[
				{ id: 1, raw: "a" },
				{ id: 2, raw: "b" },
				{ id: 3, raw: "a" },
			],
			{ numeric: false, fieldKey: "tag", fieldType: "string", stops, bucketCount: 0, scoped: true },
		);
		expect(sels.every((s) => s.props.type === "Locations")).toBe(true);
		const aBucket = sels.find((s) => s.props.type === "Locations" && s.props.locations.includes(1));
		expect(aBucket?.props.type === "Locations" && aBucket.props.locations.sort()).toEqual([1, 3]);
	});

	it("empty values yield no selections", () => {
		expect(
			buildGradientSelections([], {
				numeric: true,
				fieldKey: "x",
				fieldType: "number",
				stops,
				bucketCount: 5,
				scoped: true,
			}),
		).toEqual([]);
	});
});
