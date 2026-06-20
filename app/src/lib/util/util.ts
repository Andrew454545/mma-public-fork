import type { Tag } from "@/bindings.gen";
import type { TagSortMode } from "@/types";

/** Base URL for a Tauri custom URI scheme. Windows WebView2 uses http://<scheme>.localhost/. */
export function schemeBase(scheme: string): string {
	return navigator.platform.startsWith("Win")
		? `http://${scheme}.localhost/`
		: `${scheme}://localhost/`;
}

export function mmaBufUrl(path: string): string {
	return schemeBase("mma-buf") + path.replace(/\\/g, "/");
}

/** True when running under the web-serve bridge (a plain browser, no native shell). */
export function isWeb(): boolean {
	return Boolean(
		(window as { __TAURI_INTERNALS__?: { __webserve?: boolean } }).__TAURI_INTERNALS__?.__webserve,
	);
}

export function isFiniteNumber(v: unknown): v is number {
	return typeof v === "number" && isFinite(v);
}

// Order strings with embedded numbers by numeric value, not lexically
export function compareNatural(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true });
}

export interface NumericBuckets {
	count: number;
	min: number;
	max: number;
	bounds: [number, number][];
	labels: string[];
	bucketIndex(value: number): number;
}

// How to size equal-width numeric bins: `count` derives the width from the data range
// (adaptive, always ~N bins); `width` fixes the width with bins anchored at multiples of
// it (stable, comparable labels across datasets). One algorithm, two parameterizations.
export type NumericBinning = { by: "count"; n: number } | { by: "width"; w: number };

const fmtBound = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

// Split numeric values into equal-width bins. Non-finite values are ignored. Returns null
// when there's nothing to bin (no finite values, or — count mode — no spread).
export function binNumeric(values: number[], binning: NumericBinning): NumericBuckets | null {
	let min = Infinity;
	let max = -Infinity;
	let any = false;
	for (const n of values) {
		if (!Number.isFinite(n)) continue;
		any = true;
		if (n < min) min = n;
		if (n > max) max = n;
	}
	if (!any) return null;

	const bounds: [number, number][] = [];
	const labels: string[] = [];

	if (binning.by === "count") {
		const count = binning.n;
		if (count < 1 || min === max) return null;
		const step = (max - min) / count;
		for (let i = 0; i < count; i++) {
			const lo = min + step * i;
			const hi = i === count - 1 ? max : min + step * (i + 1);
			bounds.push([lo, hi]);
			labels.push(`${fmtBound(lo)}–${fmtBound(hi)}`);
		}
		return {
			count,
			min,
			max,
			bounds,
			labels,
			bucketIndex(value: number): number {
				if (value <= min) return 0;
				if (value >= max) return count - 1;
				const idx = Math.floor((value - min) / step);
				return idx < 0 ? 0 : idx >= count ? count - 1 : idx;
			},
		};
	}

	const w = binning.w;
	if (!(w > 0)) return null;
	const lo0 = Math.floor(min / w) * w;
	const count = Math.max(1, Math.floor((max - lo0) / w) + 1);
	for (let i = 0; i < count; i++) {
		const lo = lo0 + w * i;
		bounds.push([lo, lo + w]);
		labels.push(`${fmtBound(lo)}–${fmtBound(lo + w)}`);
	}
	return {
		count,
		min,
		max,
		bounds,
		labels,
		bucketIndex(value: number): number {
			const idx = Math.floor((value - lo0) / w);
			return idx < 0 ? 0 : idx >= count ? count - 1 : idx;
		},
	};
}

// Split a numeric range into `count` equal-width buckets (a histogram axis).
export function bucketize(values: number[], count: number): NumericBuckets | null {
	return binNumeric(values, { by: "count", n: count });
}

export function sortTagsByMode(tags: Tag[], mode: TagSortMode, counts: Record<number, number>): Tag[] {
	const sorted = [...tags];
	if (mode === "name") return sorted.sort((a, b) => a.name.localeCompare(b.name));
	if (mode === "amount") return sorted.sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
	return sorted.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}

// FOV (degrees) → zoom level
export function fovToZoom(fov: number): number {
	return -Math.log2((4 / 3) * Math.tan((Math.PI * fov) / 360)) + 1;
}
