export function isFiniteNumber(v: unknown): v is number {
	return typeof v === "number" && isFinite(v);
}

// FOV (degrees) → zoom level
export function fovToZoom(fov: number): number {
	return -Math.log2((4 / 3) * Math.tan((Math.PI * fov) / 360)) + 1;
}
