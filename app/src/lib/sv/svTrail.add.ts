import { useSyncExternalStore } from "react";

let trail: [number, number][] = [];
let version = 0;
let listeners: (() => void)[] = [];

function notify() {
	version++;
	for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
	listeners.push(fn);
	return () => {
		listeners = listeners.filter((l) => l !== fn);
	};
}

function getSnapshot() {
	return version;
}

export function resetTrail(lng: number, lat: number) {
	trail = [[lng, lat]];
	notify();
}

export function pushTrail(lng: number, lat: number) {
	if (trail.length > 0) {
		const last = trail[trail.length - 1];
		if (last[0] === lng && last[1] === lat) return;
	}
	trail = [...trail, [lng, lat]];
	notify();
}

export function clearTrail() {
	if (trail.length === 0) return;
	trail = [];
	notify();
}

export function getTrail(): [number, number][] {
	return trail;
}

export function useTrailVersion() {
	return useSyncExternalStore(subscribe, getSnapshot);
}
