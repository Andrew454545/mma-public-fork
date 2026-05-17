/**
 * Shared helpers for E2E tests.
 * All browser calls go through withApi, which injects the test API as `api`.
 */

import type { TestAPI } from "@/lib/testApi.add";

/**
 * Run an async function in the browser with the test API injected as `api`.
 * Handles the done callback, try/catch, and serialization boilerplate.
 *
 * Usage: `await withApi(async (api, id) => api.fetchLocation(id), locId);`
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function withApi(
	fn: (api: TestAPI, ...args: any[]) => any,
	...args: any[]
): Promise<any> {
	const wrapped = new Function(
		"...___a",
		`const ___d = ___a.pop();
     const api = window.__TEST_API__;
     (async () => { try { ___d(await (${fn.toString()})(api, ...___a)); } catch(e) { ___d({error:e.message}); } })();`,
	);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return browser.executeAsync(wrapped as any, ...args);
}

export async function waitForReady() {
	await browser.waitUntil(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async () => browser.execute(() => (window as any).__TEST_API__?.ready === true),
		{ timeout: 30000, timeoutMsg: "App did not boot in time" },
	);
}

export async function createAndOpenMap(name: string): Promise<string> {
	const mapId = await withApi(async (api, n) => {
		const map = await api.createMap(n);
		await api.openMap(map.meta.id);
		return map.meta.id;
	}, name);
	if (typeof mapId === "string" && mapId.startsWith("ERROR")) throw new Error(mapId);
	return mapId as string;
}

export async function openMap(id: string) {
	await withApi(async (api, mapId) => api.openMap(mapId), id);
}

export async function closeMap() {
	await withApi(async (api) => {
		try {
			await api.closeMap();
		} catch {}
	});
}

export async function deleteMap(id: string) {
	await withApi(async (api, mapId) => {
		try {
			await api.deleteMap(mapId);
		} catch {}
	}, id);
}

export async function flushAndWait() {
	await withApi(async (api) => api.flushSave());
}

// --- Location helpers ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeLoc(overrides: Record<string, any> = {}): Record<string, any> {
	return {
		lat: Math.random() * 170 - 85,
		lng: Math.random() * 360 - 180,
		heading: Math.random() * 360,
		pitch: 0,
		zoom: 1,
		panoId: null,
		flags: 0,
		tags: [],
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeLocBatch(
	count: number,
	overrides: Record<string, any> | ((i: number) => Record<string, any>) = {},
): string {
	const overrideFn = typeof overrides === "function";
	if (overrideFn) {
		return `
      const locs = [];
      const overrideFn = ${overrides.toString()};
      for (let i = 0; i < ${count}; i++) {
        locs.push({
          lat: Math.random() * 170 - 85,
          lng: Math.random() * 360 - 180,
          heading: Math.random() * 360,
          pitch: 0, zoom: 1, panoId: null, flags: 0, tags: [],
          createdAt: new Date().toISOString(),
          ...overrideFn(i),
        });
      }
    `;
	}
	const ovStr = JSON.stringify(overrides);
	return `
    const locs = [];
    for (let i = 0; i < ${count}; i++) {
      locs.push({
        lat: Math.random() * 170 - 85,
        lng: Math.random() * 360 - 180,
        heading: Math.random() * 360,
        pitch: 0, zoom: 1, panoId: null, flags: 0, tags: [],
        createdAt: new Date().toISOString(),
        ...${ovStr},
      });
    }
  `;
}

export async function addLocs(locs: Record<string, unknown>[]): Promise<number[]> {
	const result = await withApi(async (api, locations) => {
		await api.addLocations(locations);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return locations.map((l: any) => l.id);
	}, locs);
	if (result && typeof result === "object" && "error" in result) throw new Error(result.error);
	return result as number[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getLoc(id: number): Promise<any> {
	return withApi(async (api, locId) => api.fetchLocation(locId), id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAllLocs(): Promise<any[]> {
	return withApi(async (api) => api.fetchAllLocations());
}

export async function getLocCount(): Promise<number> {
	return withApi(async (api) => api.getLocationCount());
}

export async function refreshSelections(): Promise<number[]> {
	return withApi(async (api) => (await api.syncSelections()).ids);
}

export async function createTag(
	name: string,
): Promise<{ id: number; name: string; color: string }> {
	return withApi(async (api, n) => (await api.resolveTagNames([n]))[0], name);
}
