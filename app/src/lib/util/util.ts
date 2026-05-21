/** Base URL for a Tauri custom URI scheme. Windows WebView2 uses http://<scheme>.localhost/. */
export function schemeBase(scheme: string): string {
	return navigator.platform.startsWith("Win")
		? `http://${scheme}.localhost/`
		: `${scheme}://localhost/`;
}

export function mmaBufUrl(path: string): string {
	return schemeBase("mma-buf") + path.replace(/\\/g, "/");
}

export function isFiniteNumber(v: unknown): v is number {
	return typeof v === "number" && isFinite(v);
}

// FOV (degrees) → zoom level
export function fovToZoom(fov: number): number {
	return -Math.log2((4 / 3) * Math.tan((Math.PI * fov) / 360)) + 1;
}
