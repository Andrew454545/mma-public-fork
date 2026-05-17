let googleMap: google.maps.Map | null = null;

export function setGoogleMap(map: google.maps.Map | null) {
	googleMap = map;
}

export function getGoogleMap(): google.maps.Map | null {
	return googleMap;
}

type ClickInterceptor = (lat: number, lng: number) => boolean;
let clickInterceptor: ClickInterceptor | null = null;

export function setClickInterceptor(fn: ClickInterceptor | null) {
	clickInterceptor = fn;
}

export function tryInterceptClick(lat: number, lng: number): boolean {
	return clickInterceptor ? clickInterceptor(lat, lng) : false;
}

type DrawInterceptor = (rings: number[][][]) => boolean;
let drawInterceptor: DrawInterceptor | null = null;

export function setDrawInterceptor(fn: DrawInterceptor | null) {
	drawInterceptor = fn;
}

export function tryInterceptDraw(rings: number[][][]): boolean {
	return drawInterceptor ? drawInterceptor(rings) : false;
}
