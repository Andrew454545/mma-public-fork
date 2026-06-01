/**
 * Street View mock, installed from the test side by monkey-patching the runtime
 * boundaries the app uses -- NO app code is touched. Enabled via the wdio `beforeSuite`
 * hook when MMA_TEST_MOCK_SV is set (scripts/e2e.sh --mock).
 *
 *  - window.fetch: the app fetches Google's internal RPCs directly for GetMetadata
 *    (fetchSvMetadata) and SingleImageSearch (resolveExactTimestamp). We return
 *    hand-built protobuf-array responses shaped exactly as parseResult expects.
 *  - google.maps.StreetViewService.getPanorama: fetchPanoData / getPanoAtCoords go
 *    through this (opensv sets window.google). We return canned pano data.
 *  - google.maps.StreetViewPanorama (the viewer): its `status_changed` event drives
 *    seen-recording. Real tiles never load offline, so we override getStatus/getPano/
 *    getPosition and fire the event after setPano.
 *
 * The function below is serialized and run in the webview via browser.execute, so it
 * must be entirely self-contained (no imports, no outer references).
 */
export function installSvMock(): void {
	const w = window as unknown as { fetch: typeof fetch; google?: any; __mmaSvMocked?: boolean };
	if (w.__mmaSvMocked) return;
	w.__mmaSvMocked = true;

	interface Fix {
		lat: number;
		lng: number;
		cc: string;
		alt: number;
		dates: string[];
	}
	const FIX: Record<string, Fix> = {
		"-zrYsLR4Fh-cfJG_EMZ1-A": { lat: 52.10947502806108, lng: 34.90131410856584, cc: "RU", alt: 142, dates: ["2012-08", "2015-06", "2021-09"] },
		"CAoSF0NJSE0wb2dLRUlDQWdJQ3FpZG1xM3dF": { lat: 64.44241333767505, lng: 46.193924009405855, cc: "RU", alt: 90, dates: ["2019-07"] },
		"5upMz1_zTGPdkIXG6_QM3g": { lat: 55.510656, lng: 157.636627, cc: "RU", alt: 30, dates: ["2018-05"] },
	};
	const isDead = (p: string) => !p || /DEAD|DOES_NOT_EXIST/i.test(p);
	const fixFor = (pano: string, lat = 0, lng = 0): Fix | null => {
		if (isDead(pano)) return null;
		if (FIX[pano]) return FIX[pano];
		// Coords are encoded in synthetic ids (MOCK_lat_lng) so a pano fetched by id
		// resolves to the same position it did when found by coordinate.
		const m = /^MOCK_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)$/.exec(pano);
		const [la, ln] = m ? [+m[1], +m[2]] : [lat, lng];
		return { lat: la, lng: ln, cc: "US", alt: 100, dates: ["2020-06", "2022-06"] };
	};
	const panoAtCoords = (lat: number, lng: number): string | null => {
		if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return null; // ocean
		for (const [p, f] of Object.entries(FIX)) {
			if (Math.abs(f.lat - lat) < 0.01 && Math.abs(f.lng - lng) < 0.01) return p;
		}
		return `MOCK_${lat.toFixed(4)}_${lng.toFixed(4)}`;
	};
	const ymDate = (ym: string): Date => {
		const [y, m] = ym.split("-").map(Number);
		return new Date(y, (m ?? 1) - 1, 1);
	};

	// --- window.fetch -------------------------------------------------------
	const origFetch = w.fetch.bind(w);

	// One GetMetadata result array, matching the positional shape parseResult reads.
	// imageKey is echoed into r[1] so imageKeyToPanoId round-trips to the original pano id.
	const metaResult = (imageKey: any): any => {
		const pano = imageKey && imageKey[1] ? imageKey[1] : "";
		const f = fixFor(pano);
		if (!f) return [[3]]; // status != 1 -> parseResult yields null
		const [y, m] = f.dates[f.dates.length - 1].split("-").map(Number);
		const locData = [[null, null, f.lat, f.lng], [f.alt], [0], [null], f.cc];
		const loc0 = [null, locData, null, [[]], null, null, [], null, []];
		const tiles = [null, null, [8192, 16384], [null, [512, 512]]]; // worldH 8192 -> gen4
		const dateInfo = [null, null, null, null, null, null, null, [y, m, 1]];
		return [[1], imageKey, tiles, [null, null, []], [[[[""]]]], [loc0], dateInfo];
	};

	w.fetch = async function (input: any, init?: any): Promise<Response> {
		const url = typeof input === "string" ? input : input?.url ?? "";
		if (url.includes("GetMetadata")) {
			const body = JSON.parse(init?.body ?? "[]");
			const results = (body[2] ?? []).map((e: any) => metaResult(e[0]));
			return new Response(JSON.stringify([[0], results]), { status: 200 });
		}
		if (url.includes("SingleImageSearch")) {
			// Any non-"no images" body counts as "image found", so resolveExactTimestamp's
			// binary search always narrows downward and converges to a valid timestamp.
			return new Response(JSON.stringify([["img"]]), { status: 200 });
		}
		return origFetch(input, init);
	} as typeof fetch;

	// --- google.maps.StreetViewService.getPanorama --------------------------
	const viewerData = (pano: string, f: Fix): any => {
		const last = f.dates.length - 1;
		return {
			copyright: "",
			location: { latLng: { lat: () => f.lat, lng: () => f.lng }, pano, shortDescription: "", description: "" },
			imageDate: f.dates[last],
			time: f.dates.map((d, i) => ({ pano: i === last ? pano : `${pano}~${i}`, AA: ymDate(d) })),
			links: [],
			tiles: { worldSize: { width: 16384, height: 8192 }, tileSize: { width: 512, height: 512 }, centerHeading: 0, originHeading: 0 },
		};
	};
	const mockGetPanorama = async (req: any): Promise<any> => {
		let pano: string | null = null;
		let rlat = 0;
		let rlng = 0;
		if (req?.pano) pano = req.pano;
		else if (req?.location) {
			const ll = req.location;
			rlat = typeof ll.lat === "function" ? ll.lat() : ll.lat;
			rlng = typeof ll.lng === "function" ? ll.lng() : ll.lng;
			pano = panoAtCoords(rlat, rlng);
		}
		const f = pano ? fixFor(pano, rlat, rlng) : null;
		if (!pano || !f) return { data: {} }; // no location -> app treats as null
		return { data: viewerData(pano, f) };
	};

	// --- google.maps.StreetViewPanorama (the viewer) ------------------------
	// Drives seen-recording via status_changed. Keep the real setPano (so getPov/getZoom
	// internals stay live) and only override status/pano/position + fire the event.
	const patchViewer = (g: any): void => {
		const proto = g?.maps?.StreetViewPanorama?.prototype;
		if (!proto || proto.__mmaMocked) return;
		const origSetPano = proto.setPano;
		proto.setPano = function (p: string) {
			this.__mp = p;
			const f = p && !isDead(p) ? fixFor(p) : null;
			this.__mpos = f ? { lat: f.lat, lng: f.lng } : null;
			try {
				origSetPano && origSetPano.call(this, p);
			} catch {
				/* ignore */
			}
			const self = this;
			setTimeout(() => {
				try {
					g.maps.event.trigger(self, "pano_changed");
					g.maps.event.trigger(self, "status_changed");
				} catch {
					/* ignore */
				}
			}, 0);
		};
		proto.getStatus = function () {
			return this.__mp && !isDead(this.__mp) ? "OK" : "ZERO_RESULTS";
		};
		proto.getPano = function () {
			return this.__mp || "";
		};
		proto.getPosition = function () {
			const p = this.__mpos;
			return p ? { lat: () => p.lat, lng: () => p.lng } : null;
		};
		proto.__mmaMocked = true;
	};

	const patchSVS = (g: any): boolean => {
		const proto = g?.maps?.StreetViewService?.prototype;
		if (!proto) return false;
		if (!proto.__mmaMocked) {
			proto.getPanorama = mockGetPanorama;
			proto.__mmaMocked = true;
		}
		patchViewer(g);
		return true;
	};

	// opensv builds google.maps lazily and by mutation, so poll for StreetViewService
	// and patch the prototypes the moment it appears -- before the first pano lookup.
	if (!patchSVS(w.google)) {
		const iv = setInterval(() => {
			if (patchSVS((window as any).google)) clearInterval(iv);
		}, 10);
		setTimeout(() => clearInterval(iv), 20000);
	}
}
