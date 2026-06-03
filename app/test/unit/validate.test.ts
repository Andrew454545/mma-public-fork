// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocationFlag } from "@/types";
import type { Location } from "@/types";
import { ValidationState } from "@/store/selections";

vi.mock("@/lib/sv/svMeta", () => ({ fetchSvMetadata: vi.fn() }));
vi.mock("@/lib/sv/lookup.add", async () => {
	const actual = await vi.importActual<typeof import("@/lib/sv/lookup.add")>("@/lib/sv/lookup.add");
	return { ...actual, getPanoAtCoords: vi.fn() };
});

import { validateOne } from "@/lib/sv/validate";
import { fetchSvMetadata } from "@/lib/sv/svMeta";

const mockFetch = vi.mocked(fetchSvMetadata);

// 22-char official ids per OFFICIAL_PANO_RE: 21 of [-_A-Za-z0-9] then [AQgw].
const OFFICIAL_OLD = "AAAAAAAAAAAAAAAAAAAAAA"; // ends 'A'
const OFFICIAL_NEW = "BBBBBBBBBBBBBBBBBBBBBQ"; // ends 'Q'
const UNOFFICIAL = "U".repeat(30); // length > 22 -> isUnofficial heuristic

type Pano = google.maps.StreetViewResolvedPanoramaData;

function pano(opts: {
	pano: string;
	cameraType?: string | null;
	time?: { pano: string; date?: Date }[];
}): Pano {
	const { pano: id, cameraType = "gen4", time = [] } = opts;
	return {
		location: { latLng: { lat: () => 0, lng: () => 0 }, pano: id },
		imageDate: "2022-01",
		time: time.map((t) => ({ pano: t.pano, date: t.date ?? new Date(0) })),
		tiles: { worldSize: { width: 0, height: 8192 } },
		extra: { cameraType, countryCode: null, _levelId: null },
	} as unknown as Pano;
}

function pinned(panoId: string): Location {
	return { id: 1, lat: 0, lng: 0, flags: LocationFlag.LoadAsPanoId, panoId } as Location;
}

beforeEach(() => mockFetch.mockReset());

describe("timeline check scans official coverage (fix #1)", () => {
	it("pinned official pano with newer OFFICIAL coverage in timeline -> UpdateAvailable", async () => {
		mockFetch.mockResolvedValue([
			pano({
				pano: OFFICIAL_OLD,
				time: [
					{ pano: OFFICIAL_OLD, date: new Date(2020, 0) },
					{ pano: OFFICIAL_NEW, date: new Date(2023, 0) },
				],
			}),
		]);
		expect(await validateOne(pinned(OFFICIAL_OLD))).toBe(ValidationState.UpdateAvailable);
	});

	it("pinned official pano that IS the newest in its timeline -> Ok", async () => {
		mockFetch.mockResolvedValue([
			pano({
				pano: OFFICIAL_NEW,
				time: [
					{ pano: OFFICIAL_OLD, date: new Date(2020, 0) },
					{ pano: OFFICIAL_NEW, date: new Date(2023, 0) },
				],
			}),
		]);
		expect(await validateOne(pinned(OFFICIAL_NEW))).toBe(ValidationState.Ok);
	});
});

describe("Unofficial reuses the app-wide isUnofficial heuristic (fix #2)", () => {
	it("a long-id (user-uploaded) pano -> Unofficial", async () => {
		mockFetch.mockResolvedValue([pano({ pano: UNOFFICIAL })]);
		expect(await validateOne(pinned(UNOFFICIAL))).toBe(ValidationState.Unofficial);
	});

	it("a 22-char official pano is not Unofficial", async () => {
		mockFetch.mockResolvedValue([pano({ pano: OFFICIAL_OLD, time: [{ pano: OFFICIAL_OLD }] })]);
		const result = await validateOne(pinned(OFFICIAL_OLD));
		expect(result).not.toBe(ValidationState.Unofficial);
		expect(result).toBe(ValidationState.Ok);
	});
});
