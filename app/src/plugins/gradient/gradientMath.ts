import type { ExtraFieldDef, SelectionProps } from "@/bindings.gen";
import { bucketize, compareNatural } from "@/lib/util/util";

export function lerp(
	a: [number, number, number],
	b: [number, number, number],
	t: number,
): [number, number, number] {
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t),
	];
}

export function gradientColor(stops: [number, number, number][], t: number): [number, number, number] {
	if (t <= 0) return stops[0];
	if (t >= 1) return stops[stops.length - 1];
	const segment = t * (stops.length - 1);
	const i = Math.floor(segment);
	return lerp(stops[i], stops[Math.min(i + 1, stops.length - 1)], segment - i);
}

export function isNumericField(def: ExtraFieldDef | undefined): boolean {
	if (!def) return false;
	return def.type === "number" || def.type === "date";
}

// Numeric position of a categorical value, for proportional (not ordinal) gradient
// mapping. Months ("YYYY-MM") become an ordinal month count; numeric strings their
// value. Returns null for non-numeric categories (caller falls back to even spacing).
export function fieldScale(value: string, type: string | undefined): number | null {
	if (type === "month") {
		const [y, m] = value.split("-").map(Number);
		return Number.isFinite(y) && Number.isFinite(m) ? y * 12 + (m - 1) : null;
	}
	const n = Number(value);
	return value.trim() !== "" && Number.isFinite(n) ? n : null;
}

export interface GradientSelection {
	props: SelectionProps;
	key: string;
	color: [number, number, number];
}

// Turn field values into colored selections. Unscoped → live Filter buckets that match the
// whole map. Scoped → static Locations buckets holding only the given ids, so both the bucket
// bounds and the coloring come from the subset. `key` mirrors the engine's key (for
// setSelectionColors): Filter keys by predicate, Locations by its id list.
export function buildGradientSelections(
	values: { id: number; raw: unknown }[],
	opts: {
		numeric: boolean;
		fieldKey: string;
		fieldType: string | undefined;
		stops: [number, number, number][];
		bucketCount: number;
		scoped: boolean;
	},
): GradientSelection[] {
	const { numeric, fieldKey, fieldType, stops, bucketCount, scoped } = opts;
	if (values.length === 0) return [];
	const out: GradientSelection[] = [];

	if (numeric) {
		const nums = values.map((v) => ({ id: v.id, n: Number(v.raw) }));
		const buckets = bucketize(nums.map((v) => v.n), bucketCount);
		if (!buckets) return [];
		const last = buckets.bounds.length - 1;
		buckets.bounds.forEach(([lo, hi], i) => {
			const color = gradientColor(stops, i / (bucketCount - 1));
			if (scoped) {
				// Half-open bins [lo,hi) except the last [lo,hi], so each id lands in exactly one.
				const ids = nums
					.filter((v) => v.n >= lo && (i === last ? v.n <= hi : v.n < hi))
					.map((v) => v.id);
				if (ids.length === 0) return;
				out.push({ props: { type: "Locations", locations: ids, name: null }, key: ids.join(","), color });
			} else {
				out.push({
					props: { type: "Filter", field: fieldKey, op: "between", value: lo, value2: hi },
					key: `filter:${fieldKey}:between:${lo}:${hi}`,
					color,
				});
			}
		});
		return out;
	}

	const distinct = [...new Set(values.map((v) => String(v.raw)))].sort(compareNatural);
	const scales = distinct.map((v) => fieldScale(v, fieldType));
	const proportional = distinct.length > 1 && scales.every((s) => s !== null);
	const lo = proportional ? Math.min(...(scales as number[])) : 0;
	const hi = proportional ? Math.max(...(scales as number[])) : 0;
	distinct.forEach((v, i) => {
		const t =
			proportional && hi > lo
				? ((scales[i] as number) - lo) / (hi - lo)
				: distinct.length === 1
					? 0.5
					: i / (distinct.length - 1);
		const color = gradientColor(stops, t);
		if (scoped) {
			const ids = values.filter((x) => String(x.raw) === v).map((x) => x.id);
			if (ids.length === 0) return;
			out.push({ props: { type: "Locations", locations: ids, name: null }, key: ids.join(","), color });
		} else {
			out.push({
				props: { type: "Filter", field: fieldKey, op: "eq", value: v, value2: null },
				key: `filter:${fieldKey}:eq:${v}`,
				color,
			});
		}
	});
	return out;
}
