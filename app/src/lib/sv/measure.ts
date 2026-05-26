import { useSyncExternalStore, useEffect } from "react";
import MeasureToolClass from "measuretool-googlemaps-v3";
import type { Location } from "@/types";
import { createSyncStore } from "@/lib/util/syncStore";

// --- Measure tool state ---

interface MeasureState {
	instance: InstanceType<typeof MeasureToolClass> | null;
	isMeasuring: boolean;
}

let mState: MeasureState = { instance: null, isMeasuring: false };
const mStore = createSyncStore();
function mSnap() {
	return mState;
}

function createInstance(map: google.maps.Map) {
	const mt = new MeasureToolClass(map, {
		contextMenu: false,
		showSegmentLength: false,
	});
	mt.addListener("measure_start", () => {
		mState = { ...mState, isMeasuring: true };
		mStore.notify();
	});
	mt.addListener("measure_end", () => {
		mState = { ...mState, isMeasuring: false };
		mStore.notify();
		queueMicrotask(() => map.setOptions({ draggableCursor: "crosshair" }));
	});
	return mt;
}

export function startMeasure(map: google.maps.Map, latLng: { lat: number; lng: number }) {
	let { instance } = mState;
	if (!instance) {
		instance = createInstance(map);
		mState = { ...mState, instance };
		mStore.notify();
	}
	instance.start([latLng]);
}

export function endMeasure() {
	mState.instance?.end();
}

export function useMeasureState() {
	return useSyncExternalStore(mStore.subscribe, mSnap);
}

export function useMeasure() {
	const s = useMeasureState();
	useEffect(() => () => endMeasure(), []);
	return s;
}

// --- Lat/lng anchor state ---

let anchor: { lat: number; lng: number } | null = null;
const aStore = createSyncStore();
function aSnap() {
	return anchor;
}

export function setLatLngAnchor(v: { lat: number; lng: number } | null) {
	anchor = v;
	aStore.notify();
}

export function useLatLngAnchor() {
	return useSyncExternalStore(aStore.subscribe, aSnap);
}

// --- Context menu target ---

export interface ContextMenuTarget {
	location: Location | null;
	latLng: { lat: number; lng: number };
}

let cmTarget: ContextMenuTarget = { location: null, latLng: { lat: 0, lng: 0 } };

export function openContextMenuLatLng(latLng: { lat: number; lng: number }) {
	cmTarget = { location: null, latLng };
}

export function openContextMenuLocation(loc: Location) {
	cmTarget = { location: loc, latLng: { lat: loc.lat, lng: loc.lng } };
}

export function getContextMenuTarget() {
	return cmTarget;
}

// --- Formatting utilities ---

const kmFmt = new Intl.NumberFormat(["en"], {
	style: "unit",
	unit: "kilometer",
	maximumFractionDigits: 2,
});
const mFmt = new Intl.NumberFormat(["en"], {
	style: "unit",
	unit: "meter",
	maximumFractionDigits: 0,
});

export function formatDistance(meters: number): string {
	return meters > 1000 ? kmFmt.format(meters / 1000) : mFmt.format(meters);
}

const SCORE_BASE = 0.99866017;
const DEFAULT_MAX_ERROR = 185.34781;

export function computeScore(
	distanceMeters: number,
	maxErrorDistance: number = DEFAULT_MAX_ERROR,
): number {
	if (distanceMeters <= 25) return 5000;
	const scale = maxErrorDistance * Math.log(SCORE_BASE) * -1e4;
	return Math.round(5000 * SCORE_BASE ** (distanceMeters / scale));
}
