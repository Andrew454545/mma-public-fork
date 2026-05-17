declare module "measuretool-googlemaps-v3" {
	export default class MeasureTool {
		constructor(map: google.maps.Map, options?: Record<string, unknown>);
		start(points?: { lat: number; lng: number }[]): void;
		end(): void;
		addListener(event: string, cb: (...args: unknown[]) => void): void;
		removeListener(event: string): void;
		length: number;
		lengthText: string;
		isMeasuring: boolean;
	}
}
